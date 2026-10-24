// The roster side of the army builder: adding and removing forces and selections, keeping automatic selections correct,
// checking the data's rules, and turning all of it into plain objects the screen can draw. Works on top of engine.ts.
import type { ImportedForce, ImportedRoster, ImportedSel } from './importRoster.ts'
import { Engine, flatEntries, newRoster, nextUid, rootSlots, slotsOf, type Ctx, type Force, type Node, type Roster, type Sel, type Slot, type System } from './engine.ts'

// ---------------------------------------------------------------------------------------------------------------
// what the screen sees
// ---------------------------------------------------------------------------------------------------------------

export interface Choice { id: string; name: string; pts: number; hidden?: boolean }
export interface Issue { uid: string; level: 'error' | 'warning'; text: string }
export interface SelSummary { uid: string; name: string; number: number; pts: number; issues: number; /** one short line under the name: what is in the unit */ brief: string }
export interface RoleView { id: string; name: string; count: number; min?: number; max?: number; selections: SelSummary[]; choices: Choice[] }
export interface ForceView { uid: string; name: string; catalogue: string; pts: number; roles: RoleView[]; forces: ForceView[]; childChoices: Choice[]; issues: number }
export interface CostView { id: string; name: string; total: number; limit: number }
export interface RosterView { name: string; costs: CostView[]; forces: ForceView[]; issues: Issue[]; forceChoices: Choice[]; armies: { id: string; name: string }[] }

/** One option of a selection (an entry or a group of entries), as the loadout editor shows it. */
export interface SlotView {
  id: string
  name: string
  isGroup: boolean
  pts: number // cost of one
  number: number // how many are selected
  min: number
  max: number // the most that can be selected in total (999 when there is no limit)
  children?: SlotView[]
  selected?: SelDetail // the selection, when this entry is selected: its own options
}
export interface StatTable { type: string; columns: string[]; rows: { name: string; values: string[] }[] }
export interface RuleView { name: string; text: string }
export interface SelDetail {
  uid: string; name: string; number: number; pts: number
  slots: SlotView[] // every option, for the loadout editor
  issues: string[]
  // the unit as it is now (filled in for the selection that was opened, not for the ones inside it)
  loadout: string[] // what each kind of model carries
  stats: StatTable[] // the stat lines and weapon lines of what is selected
  rules: RuleView[] // special rules and wargear descriptions that apply
}

/** What came of reading another app's roster. */
export interface ImportReport {
  matched: number
  skipped: string[] // entries the rules data here does not have (or that sit somewhere else now)
  theirPoints: number // what the other app calculated
  ourPoints: number
}

export interface SavedSel { e: string; n: number; s?: SavedSel[] }
export interface SavedForce { e: string; c: string; s: SavedSel[]; f: SavedForce[] }
export interface SavedRoster { v: 1; sys: string; name: string; limits: Record<string, number>; forces: SavedForce[] }

const MAX = 999

type Holder = Sel | Force
const label = (e: Engine, h: Holder): string => (h.kind === 'force' ? String(h.link?.name ?? h.entry.name) : e.nameOf(h.slot, { self: h, parent: h.parent }))

export class Builder {
  sys: System
  eng: Engine
  roster: Roster
  /** The cost type shown as "points". */
  pts: string
  /** The selection the player just added or changed: automatic clean-up keeps it and removes older ones instead. */
  private fresh = ''

  constructor(sys: System, roster?: Roster, name = 'New roster') {
    this.sys = sys
    this.roster = roster ?? newRoster(sys, name)
    this.eng = new Engine(sys, this.roster)
    const types: Node[] = sys.gst.costTypes ?? []
    this.pts = (types.find((t) => /^point/i.test(t.name)) ?? types[0])?.id ?? ''
  }

  // ---- finding things ----

  private index(): Map<string, Holder> {
    const m = new Map<string, Holder>()
    const go = (f: Force) => {
      m.set(f.uid, f)
      const walk = (list: Sel[]) => { for (const s of list) { m.set(s.uid, s); walk(s.selections) } }
      walk(f.selections)
      for (const c of f.forces) go(c)
    }
    for (const f of this.roster.forces) go(f)
    return m
  }

  private container(uid: string): Holder | undefined { return this.index().get(uid) }

  private slotsFor(h: Holder): Slot[] { return h.kind === 'force' ? rootSlots(this.sys, h.catalogueId) : slotsOf(this.sys, h.slot) }

  /**
   * What can be added to a holder. A force only offers the entries whose battlefield role it lists (the Primary Detachment
   * has no Allegiance role, so it does not offer, or ask for, an Allegiance); a selection offers all of its options.
   */
  private slotsHere(h: Holder): Slot[] {
    if (h.kind !== 'force') return slotsOf(this.sys, h.slot)
    const roles = new Set<string>()
    for (const cl of [...(h.entry.categoryLinks ?? []), ...(h.link?.categoryLinks ?? [])]) roles.add(cl.targetId)
    return rootSlots(this.sys, h.catalogueId).filter((slot) => {
      if (slot.isGroup) return true
      const cat = this.eng.slotCategory(slot, h)
      return !cat || roles.has(cat)
    })
  }

  // ---- forces ----

  /** The forces that can be added under a force (or at the top of the roster). */
  forceChoices(parent: Force | Roster): { entry: Node; link?: Node }[] {
    if (parent.kind === 'roster') return (this.sys.gst.forceEntries ?? []).map((entry: Node) => ({ entry }))
    const owner = parent.entry
    const out: { entry: Node; link?: Node }[] = []
    for (const e of owner.forceEntries ?? []) out.push({ entry: e })
    for (const l of owner.forceEntryLinks ?? []) { const t = this.sys.byId.get(l.targetId); if (t) out.push({ entry: t, link: l }) }
    return out
  }

  addForce(parentUid: string | null, entryId: string, catalogueId?: string): string | null {
    const found = parentUid ? this.container(parentUid) : this.roster
    if (!found || found.kind === 'sel') return null
    const parent: Force | Roster = found
    const choice = this.forceChoices(parent).find((c) => (c.link?.id ?? c.entry.id) === entryId || c.entry.id === entryId)
    if (!choice) return null
    const cat = catalogueId ?? (parent.kind === 'force' ? parent.catalogueId : '')
    if (!cat) return null
    const f: Force = { kind: 'force', uid: nextUid(), entry: choice.entry, link: choice.link, catalogueId: cat, selections: [], forces: [], parent }
    parent.forces.push(f)
    this.reconcile()
    return f.uid
  }

  removeForce(uid: string) {
    const f = this.container(uid)
    if (!f || f.kind !== 'force') return
    const list = f.parent.forces
    list.splice(list.indexOf(f), 1)
    this.reconcile()
  }

  // ---- selections ----

  private makeSel(parent: Holder, slot: Slot, number: number): Sel {
    const s: Sel = { kind: 'sel', uid: nextUid(), slot, number, selections: [], parent }
    parent.selections.push(s)
    return s
  }

  /** Add an entry to a force or selection. Mandatory parts (minimums, defaults) are added with it. */
  addSelection(containerUid: string, slotId: string, number = 1): string | null {
    const c = this.container(containerUid)
    if (!c) return null
    const slot = this.find(this.slotsFor(c), slotId)
    if (!slot || slot.isGroup) return null
    // adding a model or upgrade that is already there raises its number; every unit is its own selection
    const existing = slot.node.type === 'unit' ? undefined : c.selections.find((s) => s.slot.id === slot.id)
    const sel = existing ?? this.makeSel(c, slot, 0)
    sel.number += number
    if (!existing) this.populate(sel)
    this.fresh = sel.uid
    this.reconcile()
    this.fresh = ''
    return sel.uid
  }

  setNumber(uid: string, n: number) {
    const s = this.container(uid)
    if (!s || s.kind !== 'sel') return
    if (n <= 0) { this.remove(uid); return }
    const old = s.number
    s.number = Math.floor(n)
    if (old > 0) this.scale(s, s.number / old) // what is carried by the models goes up and down with them
    this.fresh = s.uid
    this.reconcile()
    this.fresh = ''
  }

  remove(uid: string) {
    const s = this.container(uid)
    if (!s || s.kind !== 'sel') return
    s.parent.selections.splice(s.parent.selections.indexOf(s), 1)
    this.reconcile()
  }

  /** Split off a selection with a different loadout: one model of a squad gets its own record to change. */
  split(uid: string, count = 1): string | null {
    const s = this.container(uid)
    if (!s || s.kind !== 'sel') return null
    if (s.number <= count) return null
    const old = s.number
    const copy = this.cloneSel(s, s.parent)
    this.scale(copy, count / old)
    copy.number = count
    this.scale(s, (old - count) / old)
    s.number = old - count
    s.parent.selections.push(copy)
    this.reconcile()
    return copy.uid
  }

  /** Change everything inside a selection in step with it (numbers are totals, so ten models carry ten of each thing). */
  private scale(s: Sel, ratio: number) {
    for (const c of s.selections) { c.number = Math.max(1, Math.round(c.number * ratio)); this.scale(c, ratio) }
  }

  private cloneSel(s: Sel, parent: Holder): Sel {
    const c: Sel = { kind: 'sel', uid: nextUid(), slot: s.slot, number: s.number, selections: [], parent }
    c.selections = s.selections.map((x) => this.cloneSel(x, c))
    return c
  }

  private find(slots: Slot[], id: string): Slot | undefined {
    for (const s of slots) {
      if (s.id === id) return s
      if (s.isGroup) { const r = this.find(s.children ?? [], id); if (r) return r }
    }
    return undefined
  }

  /** Give a new selection what the data says it must have: minimums and defaults. */
  private populate(sel: Sel, depth = 0) {
    if (depth > 6) return
    const here: Ctx = { parent: sel }
    const tree = slotsOf(this.sys, sel.slot)
    const visit = (slots: Slot[]) => {
      for (const slot of slots) {
        if (this.eng.isHidden(slot, here)) continue
        if (slot.isGroup) {
          const min = this.minHere(slot, here)
          const def = slot.node.defaultSelectionEntryId as string | undefined
          if (min > 0 && def) {
            const target = flatEntries(slot.children ?? []).find((c) => c.ids.includes(def))
            if (target && !sel.selections.some((x) => x.slot.id === target.id)) {
              const child = this.makeSel(sel, target, min)
              this.populate(child, depth + 1)
            }
          }
          visit(slot.children ?? [])
          continue
        }
        const want = Math.max(this.minHere(slot, here), Number(slot.node.defaultAmount ?? slot.link?.defaultAmount ?? 0) * sel.number)
        if (want > 0 && !sel.selections.some((x) => x.slot.id === slot.id)) {
          const child = this.makeSel(sel, slot, want)
          this.populate(child, depth + 1)
        }
      }
    }
    visit(tree)
  }

  /** The smallest number of a slot that must be under its parent (only limits counted against the parent). */
  private minHere(slot: Slot, ctx: Ctx): number {
    let min = 0
    for (const l of this.eng.limits([slot.node, slot.link], ctx)) if (l.type === 'min' && (l.node.scope === 'parent') && l.value > min) min = l.value
    return min
  }

  /**
   * Keep automatic constraints true, as BattleScribe does: when a rule raises a minimum the missing selections appear, and
   * when it lowers a maximum the extra ones disappear (this is how "exchange the bolter" swaps the default weapon).
   */
  reconcile() {
    for (let pass = 0; pass < 8; pass++) {
      this.eng.touch()
      let changed = false
      const visit = (c: Holder) => {
        const ctx: Ctx = { parent: c }
        const walk = (slots: Slot[]) => {
          for (const slot of slots) {
            if (this.eng.isHidden(slot, ctx)) { if (slot.isGroup) { /* hidden groups keep what they have */ } continue }
            for (const lim of this.eng.limits([slot.node, slot.link], ctx)) {
              if (!lim.node.automatic) continue
              const count = this.eng.countFor(slot, lim.node, ctx)
              if (lim.type === 'min' && count < lim.value) {
                const target = slot.isGroup ? flatEntries(slot.children ?? []).find((x) => x.ids.includes(slot.node.defaultSelectionEntryId)) : slot
                if (target && !target.isGroup) {
                  const have = c.selections.find((x) => x.slot.id === target.id)
                  if (have) have.number += lim.value - count
                  else this.populate(this.makeSel(c, target, lim.value - count))
                  changed = true
                  this.eng.touch()
                }
              } else if (lim.type === 'max' && count > lim.value) {
                // choosing a new option in a full group swaps out what was there before: the oldest go first, what was just picked stays
                let extra = count - lim.value
                const members = slot.isGroup ? flatEntries(slot.children ?? []) : [slot]
                const order = c.selections.map((_, i) => i).filter((i) => c.selections[i].uid !== this.fresh).concat(c.selections.map((_, i) => i).filter((i) => c.selections[i].uid === this.fresh))
                const removed: number[] = []
                for (const i of order) {
                  if (extra <= 0) break
                  const s = c.selections[i]
                  if (!members.some((m) => m.id === s.slot.id)) continue
                  const take = Math.min(s.number, extra)
                  s.number -= take
                  extra -= take
                  if (s.number <= 0) removed.push(i)
                  changed = true
                  this.eng.touch()
                }
                for (const i of removed.sort((a, b) => b - a)) c.selections.splice(i, 1)
              }
            }
            if (slot.isGroup) walk(slot.children ?? [])
          }
        }
        walk(this.slotsHere(c))
        for (const s of [...c.selections]) visit(s)
        if (c.kind === 'force') {
          // child forces that must exist (a minimum of one, for example the primary detachment)
          for (const ch of this.forceChoices(c)) {
            for (const k of [...(ch.entry.constraints ?? []), ...(ch.link?.constraints ?? [])]) {
              if (k.type !== 'min' || k.field !== 'forces' || !k.automatic) continue
              const id = ch.link?.id ?? ch.entry.id
              if (!c.forces.some((f) => (f.link?.id ?? f.entry.id) === id) && this.eng.modded(Number(k.value), [ch.entry, ch.link], k.id, { parent: c }) > 0) {
                c.forces.push({ kind: 'force', uid: nextUid(), entry: ch.entry, link: ch.link, catalogueId: c.catalogueId, selections: [], forces: [], parent: c })
                changed = true
                this.eng.touch()
              }
            }
          }
          for (const f of c.forces) visit(f)
        }
      }
      for (const f of this.roster.forces) visit(f)
      if (!changed) break
    }
    this.eng.touch()
  }

  // ---- checking ----

  private messages(owners: (Node | undefined)[], field: 'error' | 'warning', ctx: Ctx): string[] {
    const out: string[] = []
    for (const o of owners) {
      if (!o) continue
      const m = this.eng.modded<string>('', [o], field, ctx)
      if (m) out.push(String(m))
    }
    return out
  }

  validate(): Issue[] {
    const e = this.eng
    const issues: Issue[] = []
    const say = (uid: string, level: Issue['level'], text: string) => issues.push({ uid, level, text })

    for (const t of this.sys.gst.costTypes ?? []) {
      const limit = this.roster.limits[t.id]
      const total = e.total(t.id)
      if (limit >= 0 && total > limit) say('', 'error', `${t.name}: ${total} used, limit is ${limit}.`)
    }

    const checkSlots = (c: Holder, owner: string) => {
      const ctx: Ctx = { parent: c }
      const walk = (slots: Slot[]) => {
        for (const slot of slots) {
          if (e.isHidden(slot, ctx)) continue
          const name = e.nameOf(slot, ctx)
          for (const lim of e.limits([slot.node, slot.link], ctx)) {
            const count = e.countFor(slot, lim.node, ctx)
            if (lim.type === 'min' && count < lim.value) say(c.uid, 'error', `${owner}: needs at least ${lim.value} ${name} (has ${count}).`)
            if (lim.type === 'max' && count > lim.value) say(c.uid, 'error', `${owner}: at most ${lim.value} ${name} allowed (has ${count}).`)
          }
          if (slot.isGroup) walk(slot.children ?? [])
        }
      }
      walk(this.slotsHere(c))
    }

    const checkSel = (s: Sel, owner: string) => {
      const ctx: Ctx = { self: s, parent: s.parent }
      const name = label(e, s)
      for (const m of this.messages([s.slot.node, s.slot.link], 'error', ctx)) say(s.uid, 'error', `${name}: ${m}`)
      for (const m of this.messages([s.slot.node, s.slot.link], 'warning', ctx)) say(s.uid, 'warning', `${name}: ${m}`)
      checkSlots(s, `${owner} › ${name}`)
      for (const c of s.selections) checkSel(c, `${owner} › ${name}`)
    }

    const checkForce = (f: Force) => {
      const ctx: Ctx = { self: f, parent: f.parent }
      const name = label(e, f)
      // the force itself: how many of it, and its own cost limits
      for (const lim of e.limits([f.entry, f.link], ctx)) {
        const scope = lim.node.scope
        const roster = this.roster
        const holder = scope === 'roster' ? roster : f.parent
        let count = 0
        if (lim.node.field === 'forces') {
          const walk = (list: Force[]) => { for (const x of list) { if (x.entry.id === f.entry.id) count++; walk(x.forces) } }
          walk(holder.kind === 'roster' ? holder.forces : holder.forces)
        } else {
          count = e.forceCost(f, lim.node.field)
        }
        if (lim.type === 'max' && count > lim.value && lim.node.field === 'forces') say(f.uid, 'error', `${name}: at most ${lim.value} allowed (has ${count}).`)
        if (lim.type === 'min' && count < lim.value && lim.node.field === 'forces') say(f.uid, 'error', `${name}: needs at least ${lim.value}.`)
      }
      for (const m of this.messages([f.entry, f.link], 'error', ctx)) say(f.uid, 'error', `${name}: ${m}`)
      for (const m of this.messages([f.entry, f.link], 'warning', ctx)) say(f.uid, 'warning', `${name}: ${m}`)
      // the battlefield roles
      for (const cl of [...(f.entry.categoryLinks ?? []), ...(f.link?.categoryLinks ?? [])]) {
        if (e.modded(!!cl.hidden, [cl], 'hidden', ctx)) continue
        const count = f.selections.reduce((n, s) => n + (e.categories(s).primary === cl.targetId ? s.number : 0), 0)
        for (const lim of e.limits([cl], ctx)) {
          if (lim.type === 'min' && count < lim.value) say(f.uid, 'error', `${name}: needs at least ${lim.value} ${cl.name} (has ${count}).`)
          if (lim.type === 'max' && count > lim.value) say(f.uid, 'error', `${name}: at most ${lim.value} ${cl.name} allowed (has ${count}).`)
        }
        for (const m of this.messages([cl], 'error', ctx)) say(f.uid, 'error', `${name}: ${m}`)
      }
      checkSlots(f, name)
      for (const s of f.selections) checkSel(s, name)
      for (const c of f.forces) checkForce(c)
    }
    for (const f of this.roster.forces) checkForce(f)
    const seen = new Set<string>()
    return issues.filter((i) => { const k = `${i.uid}|${i.text}`; if (seen.has(k)) return false; seen.add(k); return true })
  }

  // ---- views ----

  private choice(slot: Slot, ctx: Ctx): Choice {
    const probe: Sel = { kind: 'sel', uid: '', slot, number: 1, selections: [], parent: ctx.parent as Sel | Force, virtual: true }
    return { id: slot.id, name: this.eng.nameOf(slot, ctx), pts: this.eng.unitCost(probe, this.pts) }
  }

  private summary(s: Sel, counts: Map<string, number>): SelSummary {
    return { uid: s.uid, name: label(this.eng, s), number: s.number, pts: this.eng.cost(s, this.pts), issues: counts.get(s.uid) ?? 0, brief: this.brief(s) }
  }

  /** A short line for under a unit's name: its models (or, for a single model, what it carries). */
  private brief(s: Sel): string {
    const e = this.eng
    const shown = (c: Sel) => c.number > 0 && !e.isHidden(c.slot, { parent: c.parent })
    const models = s.selections.filter((c) => shown(c) && c.slot.node.type === 'model')
    const carried = (sel: Sel, out: string[] = []): string[] => {
      for (const c of sel.selections) {
        if (!shown(c)) continue
        out.push(c.number > 1 ? `${label(e, c)} ×${c.number}` : label(e, c))
        carried(c, out)
      }
      return out
    }
    if (models.length > 1) return models.map((m) => `${m.number}× ${label(e, m)}`).join(', ')
    if (models.length === 1 && models[0].number > 1) return `${models[0].number}× ${label(e, models[0])}`
    const list = carried(s).filter((n) => !/detachment|prime unit/i.test(n))
    return list.slice(0, 6).join(', ') + (list.length > 6 ? '…' : '')
  }

  view(): RosterView {
    const e = this.eng
    e.touch()
    const issues = this.validate()
    const counts = new Map<string, number>()
    for (const i of issues) if (i.level === 'error') counts.set(i.uid, (counts.get(i.uid) ?? 0) + 1)

    const forceView = (f: Force): ForceView => {
      const ctx: Ctx = { self: f, parent: f.parent }
      const roles: RoleView[] = []
      const roots = rootSlots(this.sys, f.catalogueId)
      const fctx: Ctx = { parent: f }
      const byRole = new Map<string, Choice[]>()
      for (const slot of roots) {
        if (slot.isGroup || e.isHidden(slot, fctx)) continue
        const cat = e.slotCategory(slot, f)
        if (!cat) continue
        const list = byRole.get(cat) ?? []
        list.push(this.choice(slot, fctx))
        byRole.set(cat, list)
      }
      const seen = new Set<string>()
      const roleOf = (id: string, name: string, cl?: Node) => {
        seen.add(id)
        const lims = cl ? e.limits([cl], ctx) : []
        const min = lims.filter((l) => l.type === 'min').reduce((m, l) => Math.max(m, l.value), 0)
        const maxs = lims.filter((l) => l.type === 'max').map((l) => l.value)
        const sels = f.selections.filter((s) => e.categories(s).primary === id)
        roles.push({
          id, name,
          count: sels.reduce((n, s) => n + s.number, 0),
          min: min || undefined,
          max: maxs.length ? Math.min(...maxs) : undefined,
          selections: sels.map((s) => this.summary(s, counts)),
          choices: (byRole.get(id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
        })
      }
      for (const cl of [...(f.entry.categoryLinks ?? []), ...(f.link?.categoryLinks ?? [])]) {
        if (e.modded(!!cl.hidden, [cl], 'hidden', ctx)) continue
        const lims0 = e.limits([cl], ctx)
        if (!(byRole.has(cl.targetId) || f.selections.some((s) => e.categories(s).primary === cl.targetId) || lims0.some((l) => l.type === 'min' && l.value > 0))) continue
        roleOf(cl.targetId, cl.name, cl)
      }
      // anything in a role the force does not list (so nothing is ever hidden from the player)
      for (const s of f.selections) { const id = e.categories(s).primary ?? ''; if (!seen.has(id)) roleOf(id, id ? String(this.sys.byId.get(id)?.name ?? 'Other') : 'Other') }
      const childChoices: Choice[] = []
      for (const ch of this.forceChoices(f)) {
        if (e.modded(!!ch.entry.hidden || !!ch.link?.hidden, [ch.entry, ch.link], 'hidden', { parent: f })) continue
        childChoices.push({ id: ch.link?.id ?? ch.entry.id, name: String(ch.link?.name ?? ch.entry.name), pts: 0 })
      }
      return {
        uid: f.uid, name: label(e, f), catalogue: String(this.sys.cats.get(f.catalogueId)?.name ?? ''),
        pts: e.forceCost(f, this.pts), roles, forces: f.forces.map(forceView), childChoices, issues: counts.get(f.uid) ?? 0,
      }
    }

    const forceChoices: Choice[] = []
    for (const ch of this.forceChoices(this.roster)) {
      if (e.modded(!!ch.entry.hidden, [ch.entry], 'hidden', { parent: this.roster })) continue
      forceChoices.push({ id: ch.entry.id, name: String(ch.entry.name), pts: 0 })
    }
    const costs: CostView[] = (this.sys.gst.costTypes ?? [])
      .filter((t: Node) => !t.hidden)
      .map((t: Node) => ({ id: t.id, name: t.name, total: e.total(t.id), limit: this.roster.limits[t.id] ?? -1 }))
    const armies = [...this.sys.cats.values()].filter((c) => !c.library).map((c) => ({ id: c.id, name: String(c.name) })).sort((a, b) => a.name.localeCompare(b.name))
    return { name: this.roster.name, costs, forces: this.roster.forces.map(forceView), issues, forceChoices, armies }
  }

  /** The options of one selection, for the loadout editor. Only what is open on screen is worked out. */
  detail(uid: string): SelDetail | null {
    const s = this.container(uid)
    if (!s || s.kind !== 'sel') return null
    return this.selDetail(s, true, this.validate())
  }

  /** The stat lines, weapon lines, rules and a one-line-per-model loadout for what is selected inside a unit. */
  private describe(root: Sel): { loadout: string[]; stats: StatTable[]; rules: RuleView[] } {
    const e = this.eng
    const profileTypes: Node[] = this.sys.gst.profileTypes ?? []
    const columnsOf = (p: Node) => (profileTypes.find((t) => t.id === p.typeId || t.name === p.typeName)?.characteristicTypes ?? []).map((c: Node) => c.name as string)
    const tables = new Map<string, StatTable>()
    const rules: RuleView[] = []
    const seen = new Set<string>()
    const TABLE_TYPES = new Set(['Profile', 'Vehicle', 'Ranged Weapon', 'Melee Weapon'])

    const take = (sel: Sel) => {
      const ctx: Ctx = { self: sel, parent: sel.parent }
      for (const owner of [sel.slot.node, sel.slot.link]) {
        if (!owner) continue
        const list: Node[] = [...(owner.profiles ?? [])]
        for (const l of owner.infoLinks ?? []) {
          const t = this.sys.byId.get(l.targetId)
          if (!t) continue
          if (l.type === 'rule') {
            if (seen.has(t.id)) continue
            seen.add(t.id)
            if (e.modded(!!(t.hidden || l.hidden), [t, l], 'hidden', ctx)) continue
            rules.push({ name: e.modded(String(t.name), [t, l], 'name', ctx), text: String(t.description ?? '') })
          } else if (l.type === 'profile') list.push(t)
        }
        for (const r of owner.rules ?? []) {
          if (seen.has(r.id)) continue
          seen.add(r.id)
          rules.push({ name: e.modded(String(r.name), [r], 'name', ctx), text: String(r.description ?? '') })
        }
        for (const p of list) {
          if (seen.has(p.id)) continue
          seen.add(p.id)
          if (e.modded(!!p.hidden, [p], 'hidden', ctx)) continue
          const name = e.modded(String(p.name), [p], 'name', ctx)
          const values: Record<string, string> = {}
          for (const c of p.characteristics ?? []) values[c.name] = String(e.modded(c.$text ?? '', [p], c.typeId, ctx))
          if (TABLE_TYPES.has(p.typeName)) {
            const cols = columnsOf(p)
            const t: StatTable = tables.get(p.typeName) ?? { type: p.typeName, columns: cols, rows: [] }
            t.rows.push({ name, values: cols.map((c: string) => values[c] ?? '') })
            tables.set(p.typeName, t)
          } else {
            const text = Object.entries(values).map(([k, v]) => (k === 'Description' || k === 'Summary' ? v : `${k}: ${v}`)).filter(Boolean).join(' ')
            rules.push({ name, text })
          }
        }
      }
    }
    const walk = (sel: Sel) => { take(sel); for (const c of sel.selections) if (c.number > 0) walk(c) }
    walk(root)

    // one line per kind of model: how many, and everything it carries
    // (entries the data hides, such as detachment bookkeeping, are not part of what the unit carries)
    const shown = (c: Sel) => c.number > 0 && !e.isHidden(c.slot, { parent: c.parent })
    const items = (sel: Sel, out: string[] = []): string[] => {
      for (const c of sel.selections) {
        if (!shown(c)) continue
        out.push(c.number > 1 ? `${label(e, c)} ×${c.number}` : label(e, c))
        items(c, out)
      }
      return out
    }
    const loadout: string[] = []
    const models = root.selections.filter((c) => shown(c) && c.slot.node.type === 'model')
    const others = root.selections.filter((c) => shown(c) && c.slot.node.type !== 'model')
    for (const m of models) { const list = items(m); loadout.push(`${m.number} × ${label(e, m)}${list.length ? ': ' + list.join(', ') : ''}`) }
    const extra: string[] = []
    for (const o of others) { extra.push(o.number > 1 ? `${label(e, o)} ×${o.number}` : label(e, o)); items(o, extra) }
    if (extra.length) loadout.push(models.length ? `Upgrades: ${extra.join(', ')}` : extra.join(', '))

    const order = ['Profile', 'Vehicle', 'Ranged Weapon', 'Melee Weapon']
    const stats = [...tables.values()].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    return { loadout, stats, rules }
  }

  private selDetail(s: Sel, top = false, all: Issue[] = []): SelDetail {
    const e = this.eng
    const ctx: Ctx = { parent: s }
    const issues = all.filter((i) => i.uid === s.uid).map((i) => i.text)
    const build = (slots: Slot[]): SlotView[] => {
      const out: SlotView[] = []
      for (const slot of slots) {
        if (e.isHidden(slot, ctx)) continue
        const lims = e.limits([slot.node, slot.link], ctx)
        let min = 0
        let max = MAX
        let headroom = MAX
        for (const l of lims) {
          const count = e.countFor(slot, l.node, ctx)
          if (l.type === 'min' && l.node.scope === 'parent') min = Math.max(min, l.value)
          if (l.type === 'max') headroom = Math.min(headroom, l.value - count)
        }
        const mine = s.selections.filter((x) => (slot.isGroup ? flatEntries(slot.children ?? []).some((m) => m.id === x.slot.id) : x.slot.id === slot.id))
        const number = mine.reduce((n, x) => n + x.number, 0)
        max = headroom >= MAX ? MAX : number + Math.max(0, headroom)
        const view: SlotView = { id: slot.id, name: e.nameOf(slot, ctx), isGroup: slot.isGroup, pts: 0, number, min, max }
        if (slot.isGroup) view.children = build(slot.children ?? [])
        else {
          const probe: Sel = { kind: 'sel', uid: '', slot, number: 1, selections: [], parent: s, virtual: true }
          view.pts = e.unitCost(probe, this.pts)
          const sel = mine[0]
          if (sel) view.selected = this.selDetail(sel)
        }
        out.push(view)
      }
      return out
    }
    const info = top ? this.describe(s) : { loadout: [], stats: [], rules: [] }
    return { uid: s.uid, name: label(e, s), number: s.number, pts: e.cost(s, this.pts), slots: build(slotsOf(this.sys, s.slot)), issues, ...info }
  }

  // ---- importing ----

  /**
   * Fill this roster from another app's. Every selection is matched to its place by its entry id (New Recruit and this builder
   * use the same ids), so a list built there comes out as the same units, models and wargear here.
   */
  importRoster(r: ImportedRoster): ImportReport {
    const skipped: string[] = []
    let matched = 0
    const load = (c: Holder, list: ImportedSel[], where: string) => {
      const slots = this.slotsFor(c)
      for (const x of list) {
        let slot = this.find(slots, x.entryId)
        if (!slot) { // the same entry reached by a different route: match on the entry itself
          const last = x.entryId.split('::').pop()
          const all = flatEntries(slots)
          slot = all.find((y) => y.node.id === last)
        }
        if (!slot || slot.isGroup) { skipped.push(`${where} › ${x.name}`); continue }
        const s = this.makeSel(c, slot, x.number)
        matched++
        load(s, x.selections, `${where} › ${x.name}`)
      }
    }
    const loadForce = (x: ImportedForce, parent: Force | Roster) => {
      const parts = x.entryId.split('::')
      const entry = this.sys.byId.get(parts[parts.length - 1])
      if (!entry) { skipped.push(x.name); return }
      const link = parts.length > 1 ? this.sys.byId.get(parts[0]) : undefined
      const f: Force = { kind: 'force', uid: nextUid(), entry, link, catalogueId: x.catalogueId, selections: [], forces: [], parent }
      parent.forces.push(f)
      matched++
      load(f, x.selections, x.name)
      for (const c of x.forces) loadForce(c, f)
    }
    this.roster.name = r.name
    if (r.limit >= 0) this.roster.limits[this.pts] = r.limit
    for (const f of r.forces) loadForce(f, this.roster)
    this.eng.touch()
    return { matched, skipped, theirPoints: r.points, ourPoints: this.eng.total(this.pts) }
  }

  // ---- saving ----

  save(): SavedRoster {
    const sel = (s: Sel): SavedSel => ({ e: s.slot.id, n: s.number, ...(s.selections.length ? { s: s.selections.map(sel) } : {}) })
    const force = (f: Force): SavedForce => ({ e: f.link ? `${f.link.id}::${f.entry.id}` : f.entry.id, c: f.catalogueId, s: f.selections.map(sel), f: f.forces.map(force) })
    return { v: 1, sys: this.sys.gst.id, name: this.roster.name, limits: { ...this.roster.limits }, forces: this.roster.forces.map(force) }
  }

  /** Rebuild a roster from a saved one. Entries the data no longer has are skipped (and counted). */
  static load(sys: System, saved: SavedRoster): { builder: Builder; dropped: number } {
    const b = new Builder(sys, undefined, saved.name)
    Object.assign(b.roster.limits, saved.limits)
    let dropped = 0
    const loadSel = (c: Holder, list: SavedSel[]) => {
      const slots = b.slotsFor(c)
      for (const x of list) {
        const slot = b.find(slots, x.e)
        if (!slot || slot.isGroup) { dropped++; continue }
        const s = b.makeSel(c, slot, x.n)
        loadSel(s, x.s ?? [])
      }
    }
    const loadForce = (x: SavedForce, parent: Force | Roster) => {
      const parts = x.e.split('::')
      const entry = sys.byId.get(parts[parts.length - 1])
      if (!entry) { dropped++; return }
      const link = parts.length > 1 ? sys.byId.get(parts[0]) : undefined
      const f: Force = { kind: 'force', uid: nextUid(), entry, link, catalogueId: x.c, selections: [], forces: [], parent }
      parent.forces.push(f)
      loadSel(f, x.s)
      for (const c of x.f) loadForce(c, f)
    }
    for (const x of saved.forces) loadForce(x, b.roster)
    b.eng.touch()
    return { builder: b, dropped }
  }
}

