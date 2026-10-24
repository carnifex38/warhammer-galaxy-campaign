// The army builder's rules engine. It reads BSData (the community rules data behind BattleScribe and New Recruit) and
// reproduces what those apps do: build a roster of forces and selections, work out points, apply the data's modifiers and
// conditions, keep automatic selections up to date, and report constraint errors.
//
// Kept in one file with no imports so it runs anywhere: in the browser's worker, and straight in Node for tests.
// Speed notes: the data is indexed once; slot trees are cached per entry; every evaluation pass uses small memo tables,
// so asking about hundreds of entries in one go does not repeat work.

export type Node = Record<string, any> // a BSData node (entry, group, link, constraint, modifier...), read as it is in the files

export interface System {
  gst: Node
  cats: Map<string, Node>
  byId: Map<string, Node>
  slotCache: Map<string, Slot[]>
  modCache: WeakMap<Node, FlatMod[]>
}

/** Index the game system and its catalogues so any id can be looked up at once. */
export function buildSystem(gst: Node, cats: Node[]): System {
  const byId = new Map<string, Node>()
  const walk = (o: unknown) => {
    if (Array.isArray(o)) { for (const x of o) walk(x); return }
    if (o === null || typeof o !== 'object') return
    const n = o as Node
    if (typeof n.id === 'string' && !byId.has(n.id)) byId.set(n.id, n)
    for (const k in n) { const v = n[k]; if (v !== null && typeof v === 'object') walk(v) }
  }
  walk(gst)
  const map = new Map<string, Node>()
  for (const c of cats) { walk(c); map.set(c.id, c) }
  return { gst, cats: map, byId, slotCache: new Map(), modCache: new WeakMap() }
}

// ---------------------------------------------------------------------------------------------------------------
// slots: what an entry can contain (its options), as a tree of entries and groups
// ---------------------------------------------------------------------------------------------------------------

export interface Slot {
  id: string // the id used in a saved roster (the same as New Recruit's): the links passed through on the way down, then the entry id, joined with ::
  links: string[] // every entry link on the way down from the top, including those of the units above
  node: Node // the entry or group
  link?: Node // the entry link it was reached through
  isGroup: boolean
  groups: Node[] // enclosing groups (outermost first)
  ids: string[] // every id a rule may use to name this slot (entry, links, groups)
  children?: Slot[] // groups only
}

function makeSlot(sys: System, node: Node, link: Node | undefined, chain: Slot[], prefix: string[]): Slot {
  const group = link ? link.type === 'selectionEntryGroup' : node.type === undefined // groups have no type attribute
  const linkIds = link ? [...prefix, link.id] : prefix
  const id = [...linkIds, node.id].join('::')
  const groups = chain.map((g) => g.node)
  // the ids a rule may use to name THIS option: its entry, its own link, and the groups it sits in (not the units above it)
  const ids = [node.id, ...(link ? [link.id] : []), ...chain.flatMap((g) => [g.node.id, ...(g.link ? [g.link.id] : [])])]
  const slot: Slot = { id, links: linkIds, node, link, isGroup: group, groups, ids }
  if (group) slot.children = buildSlots(sys, node, link, [...chain, slot], linkIds)
  return slot
}

function buildSlots(sys: System, owner: Node, link: Node | undefined, chain: Slot[], prefix: string[]): Slot[] {
  const out: Slot[] = []
  const take = (o: Node) => {
    for (const e of o.selectionEntries ?? []) out.push(makeSlot(sys, e, undefined, chain, prefix))
    for (const g of o.selectionEntryGroups ?? []) out.push(makeSlot(sys, g, undefined, chain, prefix))
    for (const l of o.entryLinks ?? []) {
      const t = sys.byId.get(l.targetId)
      if (t) out.push(makeSlot(sys, t, l, chain, prefix))
    }
  }
  take(owner)
  if (link && owner !== link) take(link)
  return out
}

/** The options of a slot's entry (cached: the same entry always has the same options). */
export function slotsOf(sys: System, slot: Slot): Slot[] {
  const key = slot.id
  let s = sys.slotCache.get(key)
  if (!s) {
    // New Recruit's ids: an entry linked from inside another entry is not part of the path of what is inside it (only the first link, at the top, is)
    const prefix = slot.link && slot.link.type === 'selectionEntry' && slot.links.length > 1 ? slot.links.slice(0, -1) : slot.links
    s = buildSlots(sys, slot.node, slot.link, [], prefix)
    sys.slotCache.set(key, s)
  }
  return s
}

/** The options an entry link or entry offers at the top of a force: the root entries of the catalogue and what it imports. */
export function rootSlots(sys: System, catalogueId: string): Slot[] {
  const key = `root::${catalogueId}`
  const have = sys.slotCache.get(key)
  if (have) return have
  const out: Slot[] = []
  const seen = new Set<string>()
  const add = (owner: Node) => { for (const s of buildSlots(sys, owner, undefined, [], [])) if (!seen.has(s.id)) { seen.add(s.id); out.push(s) } }
  add(sys.gst)
  const visit = (id: string, guard: Set<string>) => {
    const c = sys.cats.get(id)
    if (!c || guard.has(id)) return
    guard.add(id)
    add(c)
    for (const l of c.catalogueLinks ?? []) if (l.importRootEntries) visit(l.targetId, guard)
  }
  visit(catalogueId, new Set())
  sys.slotCache.set(key, out)
  return out
}

/** Flatten a slot tree into its entry slots (groups opened up). */
export function flatEntries(slots: Slot[], out: Slot[] = []): Slot[] {
  for (const s of slots) { if (s.isGroup) flatEntries(s.children ?? [], out); else out.push(s) }
  return out
}
// ---------------------------------------------------------------------------------------------------------------
// roster instances
// ---------------------------------------------------------------------------------------------------------------

export interface Sel { kind: 'sel'; uid: string; slot: Slot; number: number; selections: Sel[]; parent: Sel | Force; virtual?: boolean }
export interface Force { kind: 'force'; uid: string; entry: Node; link?: Node; catalogueId: string; selections: Sel[]; forces: Force[]; parent: Force | Roster }
export interface Roster { kind: 'roster'; name: string; limits: Record<string, number>; forces: Force[]; systemId: string }

let counter = 0
export const nextUid = () => `u${(++counter).toString(36)}`

export function newRoster(sys: System, name: string): Roster {
  const limits: Record<string, number> = {}
  for (const c of sys.gst.costTypes ?? []) limits[c.id] = c.defaultCostLimit ?? -1
  return { kind: 'roster', name, limits, forces: [], systemId: sys.gst.id }
}

type Holder = Sel | Force | Roster

const holderParent = (h: Holder): Holder | null => (h.kind === 'roster' ? null : h.parent)
function forceOf(h: Holder): Force | null {
  let c: Holder | null = h
  while (c && c.kind !== 'force') c = holderParent(c)
  return c as Force | null
}

// ---------------------------------------------------------------------------------------------------------------
// modifiers and conditions
// ---------------------------------------------------------------------------------------------------------------

interface Picked { s: Sel; w: number }
interface FlatMod { mod: Node; holders: Node[] } // the modifier, and the condition holders that must all pass

function flatMods(sys: System, owner: Node): FlatMod[] {
  let r = sys.modCache.get(owner)
  if (r) return r
  r = []
  const go = (o: Node, holders: Node[]) => {
    for (const m of o.modifiers ?? []) r!.push({ mod: m, holders: m.conditions || m.conditionGroups ? [...holders, m] : holders })
    for (const g of o.modifierGroups ?? []) go(g, g.conditions || g.conditionGroups ? [...holders, g] : holders)
  }
  go(owner, [])
  sys.modCache.set(owner, r)
  return r
}

export interface Ctx {
  self?: Sel | Force // the selection or force the rules belong to (missing when the entry is not selected yet)
  parent: Holder // where it is, or would be added
}

const VIRTUAL = (parent: Holder): Sel => ({ kind: 'sel', uid: '', slot: { id: '', links: [], node: {}, isGroup: false, groups: [], ids: [] }, number: 0, selections: [], parent: parent as Sel | Force, virtual: true })

const TYPE_SCOPES = new Set(['unit', 'model', 'upgrade', 'selectionEntry'])

export class Engine {
  sys: System
  roster: Roster
  // memo tables for one pass; cleared whenever the roster changes
  private catMemo = new Map<Sel, { primary?: string; all: Set<string> }>()
  private catBusy = new Set<Sel>()
  private hiddenMemo = new Map<string, boolean>()
  private costMemo = new Map<string, number>()

  constructor(sys: System, roster: Roster) { this.sys = sys; this.roster = roster }

  /** Call after any change to the roster. */
  touch() { this.catMemo.clear(); this.hiddenMemo.clear(); this.costMemo.clear() }

  // ---- scopes and counting ----

  private scopeOf(scope: string, ctx: Ctx): Holder | null {
    const here: Holder = ctx.self ?? ctx.parent
    switch (scope) {
      case 'self': return ctx.self ?? VIRTUAL(ctx.parent)
      case 'parent': return ctx.self ? ctx.self.parent : ctx.parent
      case 'force': case 'primary-catalogue': return forceOf(here) ?? this.roster
      case 'roster': return this.roster
      case 'root-entry': {
        let c: Holder = here
        while (c.kind === 'sel' && c.parent.kind === 'sel') c = c.parent
        return c
      }
      case 'ancestor': return ctx.parent
      case 'primary-category': return ctx.self ? ctx.self.parent : ctx.parent
    }
    // an entry type (unit, model, upgrade) or an id: the nearest ancestor (or self) that matches
    let c: Holder | null = here
    while (c) {
      if (c.kind === 'sel') {
        if (TYPE_SCOPES.has(scope) ? c.slot.node.type === scope : c.slot.ids.includes(scope) || this.categories(c).all.has(scope)) return c
      } else if (c.kind === 'force') {
        if (c.entry.id === scope || c.link?.id === scope) return c
      }
      c = holderParent(c)
    }
    return VIRTUAL(ctx.parent)
  }

  /** The selections inside a scope: its own, and optionally everything below (and in child forces). */
  private collect(scope: Holder, incSel: boolean, incForces: boolean, out: Picked[] = []): Picked[] {
    // numbers are totals, as in BattleScribe: ten marines carrying bolters is a bolter selection of 10
    const down = (list: Sel[], w: number) => { for (const s of list) { out.push({ s, w }); if (incSel) down(s.selections, w) } }
    if (scope.kind === 'sel') down(scope.selections, 1)
    else if (scope.kind === 'force') {
      down(scope.selections, 1)
      if (incForces) for (const f of scope.forces) this.collect(f, incSel, true, out)
    } else for (const f of scope.forces) { down(f.selections, 1); if (incForces) for (const c of f.forces) this.collect(c, incSel, true, out) }
    return out
  }

  private forcesIn(scope: Holder, incForces: boolean, out: Force[] = []): Force[] {
    const list = scope.kind === 'sel' ? [] : scope.forces
    for (const f of list) { out.push(f); if (incForces) this.forcesIn(f, true, out) }
    return out
  }

  /** Does this selection match the id a rule names? (an entry, link, group or category id, or an entry type) */
  private matches(s: Sel, childId: string): boolean {
    if (childId === 'any') return true
    if (childId === 'model' || childId === 'unit' || childId === 'upgrade') return s.slot.node.type === childId
    return s.slot.ids.includes(childId) || this.categories(s).all.has(childId)
  }

  /** What a rule's `field` measures inside `scope`: selections, forces, or a cost. */
  private measure(field: string, scope: Holder, childId: string, incSel: boolean, incForces: boolean): number {
    if (field === 'forces') {
      let n = 0
      for (const f of this.forcesIn(scope, incForces)) if (childId === 'any' || f.entry.id === childId || f.link?.id === childId) n++
      return n
    }
    if (field === 'selections') {
      let n = 0
      for (const { s, w } of this.collect(scope, incSel, incForces)) if (this.matches(s, childId)) n += s.number * w
      return n
    }
    if (field.startsWith('limit::')) return this.roster.limits[field.slice(7)] ?? -1
    // a cost type: the cost of the matching selections
    let total = 0
    for (const { s, w } of this.collect(scope, incSel, incForces)) if (this.matches(s, childId)) total += this.cost(s, field, incSel) * w
    return total
  }

  /** Everything above a rule's owner: parent, grandparent and so on up to the force. */
  private ancestors(ctx: Ctx): Holder[] {
    const out: Holder[] = []
    let h: Holder | null = ctx.self ? ctx.self.parent : ctx.parent
    while (h) { if (h.kind !== 'roster') out.push(h); h = holderParent(h) }
    return out
  }

  private isInstance(h: Holder, childId: string, primaryCatalogue = false): boolean {
    if (h.kind === 'sel') return h.virtual ? false : this.matches(h, childId)
    if (h.kind === 'force') return primaryCatalogue ? h.catalogueId === childId : h.entry.id === childId || h.link?.id === childId || h.catalogueId === childId
    return childId === h.systemId
  }

  private conditionPasses(c: Node, ctx: Ctx): boolean {
    if (c.scope === 'ancestor') {
      // "any unit or force above this one" (for example: is a model above this weapon a Free Power Weapon holder?)
      const above = this.ancestors(ctx)
      if (c.type === 'instanceOf') return above.some((h) => this.isInstance(h, c.childId))
      if (c.type === 'notInstanceOf') return !above.some((h) => this.isInstance(h, c.childId))
      let have = 0
      for (const h of above) if (h.kind === 'sel' && this.matches(h, c.childId)) have += h.number
      switch (c.type) {
        case 'lessThan': return have < c.value
        case 'greaterThan': return have > c.value
        case 'equalTo': return have === c.value
        case 'notEqualTo': return have !== c.value
        case 'atLeast': return have >= c.value
        case 'atMost': return have <= c.value
      }
      return false
    }
    const scope = this.scopeOf(c.scope, ctx)
    if (!scope) return false
    if (c.type === 'instanceOf' || c.type === 'notInstanceOf') {
      let is = false
      if (scope.kind === 'sel') is = scope.virtual ? false : this.matches(scope, c.childId)
      else if (scope.kind === 'force') is = c.scope === 'primary-catalogue' ? scope.catalogueId === c.childId : scope.entry.id === c.childId || scope.link?.id === c.childId || scope.catalogueId === c.childId
      else is = c.childId === scope.systemId
      return c.type === 'instanceOf' ? is : !is
    }
    const have = this.measure(c.field, scope, c.childId, !!c.includeChildSelections, !!c.includeChildForces)
    const want = c.percentValue ? (c.value / 100) * this.roster.limits[c.field] : c.value
    switch (c.type) {
      case 'lessThan': return have < want
      case 'greaterThan': return have > want
      case 'equalTo': return have === want
      case 'notEqualTo': return have !== want
      case 'atLeast': return have >= want
      case 'atMost': return have <= want
    }
    return false
  }

  private groupPasses(g: Node, ctx: Ctx): boolean {
    const parts: boolean[] = []
    for (const c of g.conditions ?? []) parts.push(this.conditionPasses(c, ctx))
    for (const s of g.conditionGroups ?? []) parts.push(this.groupPasses(s, ctx))
    if (parts.length === 0) return true
    return g.type === 'or' ? parts.some(Boolean) : parts.every(Boolean)
  }

  private holderPasses(h: Node, ctx: Ctx): boolean {
    for (const c of h.conditions ?? []) if (!this.conditionPasses(c, ctx)) return false
    for (const g of h.conditionGroups ?? []) if (!this.groupPasses(g, ctx)) return false
    return true
  }

  private repeatCount(m: Node, ctx: Ctx): number {
    let n = 0
    for (const r of m.repeats ?? []) {
      const scope = this.scopeOf(r.scope, ctx)
      if (!scope) continue
      const have = this.measure(r.field, scope, r.childId, !!r.includeChildSelections, !!r.includeChildForces)
      const per = r.value || 1
      n += (r.roundUp ? Math.ceil(have / per) : Math.floor(have / per)) * (r.repeats ?? 1)
    }
    return n
  }

  /** The value of one of an entry's fields after the modifiers on `owners` that apply here. */
  modded<T>(base: T, owners: (Node | undefined)[], field: string, ctx: Ctx): T {
    let v: any = base
    for (const o of owners) {
      if (!o) continue
      for (const { mod: m, holders } of flatMods(this.sys, o)) {
        if (m.field !== field) continue
        if (holders.length && !holders.every((h) => this.holderPasses(h, ctx))) continue
        const hasRepeats = m.repeats && m.repeats.length > 0
        const rep = hasRepeats ? this.repeatCount(m, ctx) : 1
        switch (m.type) {
          case 'set': v = m.value; break
          case 'increment': v = (Number(v) || 0) + Number(m.value) * rep; break
          case 'decrement': v = (Number(v) || 0) - Number(m.value) * rep; break
          case 'multiply': v = (Number(v) || 0) * Number(m.value); break
          case 'divide': v = Number(m.value) ? (Number(v) || 0) / Number(m.value) : v; break
          case 'ceil': v = Math.ceil(Number(v) || 0); break
          case 'floor': v = Math.floor(Number(v) || 0); break
          case 'append': v = v ? `${v}${m.join ?? ' '}${m.value}` : m.value; break
          case 'prepend': v = v ? `${m.value}${m.join ?? ' '}${v}` : m.value; break
          case 'replace': v = String(v ?? '').split(String(m.arg ?? '')).join(String(m.value)); break
        }
      }
    }
    return v as T
  }

  // ---- categories, hidden, names, costs ----

  /** The battlefield roles and tags a selection has, after modifiers. */
  categories(s: Sel): { primary?: string; all: Set<string> } {
    const have = this.catMemo.get(s)
    if (have) return have
    const node = s.slot.node, link = s.slot.link
    const all = new Set<string>()
    let primary: string | undefined
    for (const cl of [...(node.categoryLinks ?? []), ...(link?.categoryLinks ?? [])]) { all.add(cl.targetId); if (cl.primary) primary = cl.targetId }
    const base = { primary, all }
    if (this.catBusy.has(s)) return base // a rule asked about its own categories: use the plain ones
    this.catBusy.add(s)
    const ctx: Ctx = { self: s, parent: s.parent }
    for (const o of [node, link]) {
      if (!o) continue
      for (const { mod: m, holders } of flatMods(this.sys, o)) {
        if (m.field !== 'category') continue
        if (holders.length && !holders.every((h) => this.holderPasses(h, ctx))) continue
        if (m.type === 'add') all.add(m.value)
        else if (m.type === 'remove') { all.delete(m.value); if (primary === m.value) primary = undefined }
        else if (m.type === 'set-primary') { all.add(m.value); primary = m.value }
        else if (m.type === 'unset-primary') { if (primary === m.value) primary = undefined }
      }
    }
    this.catBusy.delete(s)
    const r = { primary, all }
    this.catMemo.set(s, r)
    return r
  }

  /** The primary category a not-yet-selected slot would have in a force. */
  slotCategory(slot: Slot, parent: Holder): string | undefined {
    const probe: Sel = { kind: 'sel', uid: '', slot, number: 0, selections: [], parent: parent as Sel | Force, virtual: true }
    return this.categories(probe).primary
  }

  isHidden(slot: Slot, ctx: Ctx): boolean {
    const key = `${slot.id}@${(ctx.self ?? ctx.parent as any).uid ?? 'r'}`
    const have = this.hiddenMemo.get(key)
    if (have !== undefined) return have
    this.hiddenMemo.set(key, false) // guard against rules that depend on themselves
    let h = false
    for (const g of slot.groups) if (this.modded(!!g.hidden, [g], 'hidden', ctx)) { h = true; break }
    if (!h) h = this.modded(!!slot.node.hidden || !!slot.link?.hidden, [slot.node, slot.link], 'hidden', ctx)
    this.hiddenMemo.set(key, h)
    return h
  }

  nameOf(slot: Slot, ctx: Ctx): string {
    return this.modded<string>(slot.link?.name ?? slot.node.name ?? '', [slot.node, slot.link], 'name', ctx)
  }

  /** The cost of ONE of this selection (before the number selected), for a cost type. Links override the entry's own cost. */
  unitCost(s: Sel, typeId: string): number {
    const node = s.slot.node, link = s.slot.link
    const pick = (o?: Node) => o?.costs?.find((c: Node) => c.typeId === typeId)
    const base = pick(link) ?? pick(node)
    return this.modded<number>(Number(base?.value ?? 0), [node, link], typeId, { self: s, parent: s.parent })
  }

  /** The cost of the selection: its number times the unit cost, plus (optionally) everything inside it. */
  cost(s: Sel, typeId: string, withChildren = true): number {
    const key = `${s.uid}:${typeId}:${withChildren ? 1 : 0}`
    const have = this.costMemo.get(key)
    if (have !== undefined) return have
    let t = this.unitCost(s, typeId) * s.number
    if (withChildren) for (const c of s.selections) t += this.cost(c, typeId, true)
    this.costMemo.set(key, t)
    return t
  }

  forceCost(f: Force, typeId: string): number {
    let t = 0
    for (const s of f.selections) t += this.cost(s, typeId, true)
    for (const c of f.forces) t += this.forceCost(c, typeId)
    return t
  }

  total(typeId: string): number {
    let t = 0
    for (const f of this.roster.forces) t += this.forceCost(f, typeId)
    return t
  }

  // ---- constraints ----

  /** The min/max limits that apply to a slot (or force, or role) here, with the data's modifiers applied. */
  limits(owners: (Node | undefined)[], ctx: Ctx): { type: 'min' | 'max'; value: number; node: Node }[] {
    const out: { type: 'min' | 'max'; value: number; node: Node }[] = []
    for (const o of owners) {
      for (const c of o?.constraints ?? []) {
        if (c.type !== 'min' && c.type !== 'max') continue
        let value = this.modded<number>(Number(c.value), owners, c.id, ctx)
        // limits are per model: with ten models in the selection, "at most 1" means at most ten
        if (c.field === 'selections') {
          const scope = this.scopeOf(c.scope, ctx)
          if (scope && scope.kind === 'sel' && !scope.virtual && scope.number > 1) value *= scope.number
        }
        if (c.type === 'max' && value < 0) continue // a maximum below zero means "no limit" in BattleScribe
        out.push({ type: c.type, value, node: c })
      }
    }
    return out
  }

  /** How many of this slot are selected under a container (what a constraint on it counts). */
  countFor(slot: Slot, c: Node, ctx: Ctx): number {
    const scope = this.scopeOf(c.scope, ctx)
    if (!scope) return 0
    const id = c.shared ? slot.node.id : slot.isGroup ? slot.node.id : (slot.link?.id ?? slot.node.id)
    if (c.field === 'forces') return this.measure('forces', scope, id, false, !!c.includeChildForces)
    if (c.field === 'selections') {
      let n = 0
      for (const { s, w } of this.collect(scope, !!c.includeChildSelections, !!c.includeChildForces)) {
        if (s.slot.ids.includes(id) || (c.shared && s.slot.ids.includes(slot.node.id))) n += s.number * w
      }
      return n
    }
    let t = 0
    for (const { s, w } of this.collect(scope, !!c.includeChildSelections, !!c.includeChildForces)) if (s.slot.ids.includes(id)) t += this.cost(s, c.field, !!c.includeChildSelections) * w
    return t
  }
}
