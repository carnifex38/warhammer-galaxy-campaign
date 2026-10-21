import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Request, Response } from './worker.ts'
import { readRosterFile } from './importRoster.ts'
import type { Choice, ForceView, RoleView, RosterView, SavedRoster, SelDetail, SelSummary, SlotView, StatTable } from './roster.ts'

// The army builder screen, laid out like New Recruit so it reads well on a phone: the list is flat blocks (a force, its roles, its
// units, each unit one row with a short line of what is in it). The eye opens the unit's stat lines and rules; tapping the name
// (when editing) opens its wargear. Adding is a searchable picker. All the work happens in a worker (see worker.ts); this file only
// draws what it sends back.

/** What a profile stores for one army list built here. */
export interface StoredRoster { game: 'hh3'; armyId: string; saved: SavedRoster; /** the total when it was last saved, so a closed list can show it without loading anything */ pts?: number }

const DATA = `${import.meta.env.BASE_URL}data`
const BASE: Record<StoredRoster['game'], string> = { hh3: `${DATA}/hh3` }

type Call = (req: Request) => Promise<Response>
type Act = (req: Request) => Promise<void>

function useWorker(): Call {
  const worker = useRef<Worker | null>(null)
  const pending = useRef(new Map<number, (r: Response) => void>())
  const next = useRef(0)
  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; res: Response }>) => { pending.current.get(e.data.id)?.(e.data.res); pending.current.delete(e.data.id) }
    worker.current = w
    return () => { w.terminate(); worker.current = null }
  }, [])
  return useCallback((req: Request) => new Promise<Response>((ok) => {
    const id = ++next.current
    pending.current.set(id, ok)
    worker.current?.postMessage({ id, req })
  }), [])
}

const download = (name: string, bytes: Uint8Array) => {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---- what every part of the screen shares ----

type Popup =
  | { kind: 'info'; uid: string }
  | { kind: 'edit'; uid: string }
  | { kind: 'add'; title: string; choices: Choice[]; pick: (id: string) => Req }
type Req = Request

interface Shared { act: Act; call: Call; view: RosterView; editing: boolean; open: (p: Popup) => void }
const Ctx = createContext<Shared | null>(null)
const useShared = () => useContext(Ctx)!

function Eye() {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5C6.5 5 2.5 9.2 1 12c1.5 2.8 5.5 7 11 7s9.5-4.2 11-7c-1.5-2.8-5.5-7-11-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-2.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z" fill="currentColor" /></svg>
}

/** A full-screen sheet over the page (a bottom sheet on a phone, a centred card on a wide screen). */
function Modal({ title, sub, onClose, children }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div className="bld-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bld-modal-card" role="dialog" aria-label={title}>
        <header>
          <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
          <button className="bld-x" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="bld-modal-body">{children}</div>
      </div>
    </div>
  )
}

export default function ArmyBuilder({ stored, name, onChange, editing = true }: { stored?: StoredRoster; name: string; onChange: (s: StoredRoster) => void; /** false: just show the list, with nothing to change */ editing?: boolean }) {
  const call = useWorker()
  const [armies, setArmies] = useState<{ id: string; name: string }[] | null>(null)
  const [armyId, setArmyId] = useState(stored?.armyId ?? '')
  const [view, setView] = useState<RosterView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [popup, setPopup] = useState<Popup | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const armyRef = useRef(armyId)
  armyRef.current = armyId

  // what armies the data has (a tiny file), and, if this list was built before, open it again
  useEffect(() => {
    let live = true
    void call({ op: 'armies', base: BASE.hh3 }).then((r) => { if (live && r.ok) setArmies(r.armies ?? []); else if (live && !r.ok) setError(r.error) })
    return () => { live = false }
  }, [call])

  const apply = useCallback((r: Response) => {
    if (!r.ok) { setError(r.error); return }
    setError('')
    if (r.view) setView(r.view)
    if (r.saved) onChange({ game: 'hh3', armyId: armyRef.current, saved: r.saved, pts: r.view?.costs[0] ? Math.round(r.view.costs[0].total) : undefined })
  }, [onChange])

  const start = useCallback(async (id: string, saved?: SavedRoster) => {
    setBusy(true)
    setError('')
    const r = await call({ op: 'load', base: BASE.hh3, armyId: id, saved })
    setBusy(false)
    if (r.ok && r.dropped) setNote(`${r.dropped} entries are no longer in the rules data and were left out.`)
    apply(r)
  }, [call, apply])

  // open a list that was built before, once, when this screen appears (it runs again if React remounts the screen, because the
  // worker it asked is stopped then; the latest `start` is read through a ref so a changing callback does not re-run it)
  const startRef = useRef(start)
  startRef.current = start
  const storedAtOpen = useRef(stored)
  useEffect(() => {
    const s = storedAtOpen.current
    if (s) void startRef.current(s.armyId, s.saved)
  }, [])

  const act = useCallback<Act>(async (req) => { apply(await call(req)) }, [call, apply])

  /** Open a list made in New Recruit or BattleScribe (.json, .ros or .rosz). */
  const importFile = useCallback(async (file: File) => {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const roster = await readRosterFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
      const cat = roster.forces[0]?.catalogueId
      if (!cat) throw new Error('That list has no army in it.')
      armyRef.current = cat
      setArmyId(cat)
      const loaded = await call({ op: 'load', base: BASE.hh3, armyId: cat })
      if (!loaded.ok) throw new Error(loaded.error)
      const r = await call({ op: 'import', roster })
      if (!r.ok) throw new Error(r.error)
      apply(r)
      const rep = r.report
      if (rep) setNote(`Imported ${rep.matched} entries from ${file.name}. ${rep.theirPoints ? `That app counted ${Math.round(rep.theirPoints)} pts; this builder counts ${Math.round(rep.ourPoints)}${Math.round(rep.theirPoints) === Math.round(rep.ourPoints) ? ' (the same).' : '.'}` : ''}${rep.skipped.length ? ` ${rep.skipped.length} entries were not found in the rules data: ${rep.skipped.slice(0, 3).join('; ')}${rep.skipped.length > 3 ? '…' : ''}` : ''}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }, [call, apply])

  const shared = useMemo<Shared | null>(() => (view ? { act, call, view, editing, open: setPopup } : null), [act, call, view, editing])

  if (!view && !editing && !stored) return <p className="muted">No list built yet. Press Edit to start one.</p>
  if (!view && !editing) return <p className="muted">Opening the list…</p>

  if (!view || !shared) {
    return (
      <div className="bld-start">
        <h4>Choose an army</h4>
        {!armies && <p className="muted">Loading the army list…</p>}
        {armies && (
          <div className="bld-start-row">
            <select value={armyId} onChange={(e) => setArmyId(e.target.value)} aria-label="Army">
              <option value="">Pick an army…</option>
              {armies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="primary" disabled={!armyId || busy} onClick={() => void start(armyId).then(() => void call({ op: 'name', name }))}>{busy ? 'Loading rules…' : 'Start building'}</button>
          </div>
        )}
        <div className="bld-import">
          <button className="ghost" disabled={busy} onClick={() => fileInput.current?.click()}>Import a list from New Recruit or BattleScribe</button>
          <input ref={fileInput} type="file" accept=".json,.ros,.rosz,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
        </div>
        {error && <p className="login-error" role="alert">{error}</p>}
        <p className="muted bld-hint">The rules for the Horus Heresy (3rd edition) come from the community BSData files, the same data New Recruit uses. They download once, then work offline.</p>
      </div>
    )
  }

  const pts = view.costs[0]
  const errors = view.issues.filter((i) => i.level === 'error')

  return (
    <Ctx.Provider value={shared}>
      <div className="bld">
        <header className="bld-bar">
          <div className="bld-chips">
            <span className="chip pts">{pts ? Math.round(pts.total) : 0}{pts && pts.limit >= 0 ? ` / ${pts.limit}` : ''} pts</span>
            <span className={`chip ${errors.length ? 'bad' : 'good'}`}>{errors.length} {errors.length === 1 ? 'error' : 'errors'}</span>
          </div>
          <div className="bld-tools">
            {editing && pts && (
              <label className="bld-limit">limit
                <input type="number" min={0} step={50} value={pts.limit >= 0 ? pts.limit : ''} placeholder="none" onChange={(e) => void act({ op: 'limit', id: pts.id, value: e.target.value === '' ? -1 : Number(e.target.value) })} />
              </label>
            )}
            <button className="ghost" onClick={async () => { const r = await call({ op: 'ros', zipped: true }); if (r.ok && r.file) download(r.file.name, r.file.bytes) }} title="A file New Recruit and BattleScribe can open">Export</button>
            {editing && <button className="ghost" disabled={busy} onClick={() => fileInput.current?.click()} title="Replace this list with one from New Recruit or BattleScribe">Import</button>}
            {editing && <input ref={fileInput} type="file" accept=".json,.ros,.rosz,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />}
          </div>
        </header>

        {note && <p className="muted">{note}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}

        {errors.length > 0 && (
          <details className="bld-issues">
            <summary>{errors.length} {errors.length === 1 ? 'problem' : 'problems'} with this list</summary>
            <ul>{view.issues.map((i, n) => <li key={n} className={i.level}>{i.text}</li>)}</ul>
          </details>
        )}

        {view.forces.map((f) => <ForceBlock key={f.uid} f={f} depth={0} />)}

        {editing && (
          <button className="bld-add" onClick={() => setPopup({ kind: 'add', title: 'Add a force', choices: view.forceChoices, pick: (id) => ({ op: 'addForce', parent: null, entry: id, army: armyId }) })}>
            + Add a force
          </button>
        )}

        {popup?.kind === 'add' && <PickerModal title={popup.title} choices={popup.choices} onPick={(id) => { void act(popup.pick(id)); setPopup(null) }} onClose={() => setPopup(null)} />}
        {popup?.kind === 'info' && <UnitModal uid={popup.uid} mode="info" onClose={() => setPopup(null)} />}
        {popup?.kind === 'edit' && <UnitModal uid={popup.uid} mode="edit" onClose={() => setPopup(null)} />}
      </div>
    </Ctx.Provider>
  )
}

// ---- the list ----

function ForceBlock({ f, depth }: { f: ForceView; depth: number }) {
  const { act, editing, open } = useShared()
  return (
    <section className={`bld-force depth${Math.min(depth, 2)}`}>
      <header className="bld-force-head">
        <h4>{f.name}</h4>
        <span className="chip pts">{Math.round(f.pts)} pts</span>
        {f.issues > 0 && <span className="chip bad" title="Problems in this force">{f.issues}</span>}
        {editing && (
          <>
            {f.childChoices.length > 0 && (
              <button className="ghost bld-plus" aria-label={`Add a detachment to ${f.name}`} onClick={() => open({ kind: 'add', title: 'Add a detachment', choices: f.childChoices, pick: (id) => ({ op: 'addForce', parent: f.uid, entry: id }) })}>+</button>
            )}
            <button className="ghost bld-icon" onClick={() => void act({ op: 'removeForce', uid: f.uid })} aria-label={`Remove ${f.name}`}>✕</button>
          </>
        )}
      </header>
      {f.roles.filter((r) => editing || r.selections.length > 0).map((r) => <RoleBlock key={r.id || 'none'} role={r} forceUid={f.uid} />)}
      {f.forces.map((c) => <ForceBlock key={c.uid} f={c} depth={depth + 1} />)}
    </section>
  )
}

function RoleBlock({ role, forceUid }: { role: RoleView; forceUid: string }) {
  const { editing, open } = useShared()
  const [folded, setFolded] = useState(false)
  const limit = role.min || role.max ? `${role.count}/${role.min && role.max ? (role.min === role.max ? role.max : `${role.min}–${role.max}`) : role.max ?? `${role.min}+`}` : role.count ? String(role.count) : ''
  const bad = (role.min !== undefined && role.count < role.min) || (role.max !== undefined && role.count > role.max)
  const pts = role.selections.reduce((n, s) => n + s.pts, 0)
  return (
    <div className="bld-role">
      <div className="bld-role-head">
        <button className="bld-role-name" onClick={() => setFolded((x) => !x)} aria-expanded={!folded}>
          <span aria-hidden="true">{folded ? '▸' : '▾'}</span> {role.name || 'Other'}
          {pts > 0 && <span className="chip pts">{Math.round(pts)} pts</span>}
          {limit && <span className={`bld-count${bad ? ' bad' : ''}`}>({limit})</span>}
        </button>
        {editing && role.choices.length > 0 && (
          <button className="ghost bld-plus" aria-label={`Add to ${role.name}`} onClick={() => open({ kind: 'add', title: `Add: ${role.name}`, choices: role.choices, pick: (id) => ({ op: 'add', container: forceUid, slot: id }) })}>+</button>
        )}
      </div>
      {!folded && role.selections.map((s) => <UnitRow key={s.uid} s={s} />)}
    </div>
  )
}

function UnitRow({ s }: { s: SelSummary }) {
  const { act, editing, open } = useShared()
  return (
    <div className="bld-unit">
      <button className="bld-unit-main" onClick={() => open({ kind: editing ? 'edit' : 'info', uid: s.uid })}>
        <span className="bld-unit-top">
          <b>{s.name}</b>
          <span className="chip pts">{Math.round(s.pts)} pts</span>
          {s.issues > 0 && <span className="chip bad">{s.issues}</span>}
        </span>
        {s.brief && <small>{s.brief}</small>}
      </button>
      <button className="bld-icon" onClick={() => open({ kind: 'info', uid: s.uid })} aria-label={`${s.name} information`}><Eye /></button>
      {editing && <button className="bld-icon" onClick={() => void act({ op: 'remove', uid: s.uid })} aria-label={`Remove ${s.name}`}>✕</button>}
    </div>
  )
}

// ---- pop-ups ----

function PickerModal({ title, choices, onPick, onClose }: { title: string; choices: Choice[]; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = choices.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Modal title={title} onClose={onClose}>
      <input className="bld-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search" />
      <ul className="bld-pick">
        {list.map((c) => (
          <li key={c.id}>
            <button onClick={() => onPick(c.id)}><span>{c.name}</span>{c.pts > 0 && <span className="chip pts">{c.pts} pts</span>}</button>
          </li>
        ))}
        {list.length === 0 && <li className="muted">Nothing matches.</li>}
      </ul>
    </Modal>
  )
}

/** A unit's information (stat lines, what it carries, rules) or, when editing, its wargear. */
function UnitModal({ uid, mode, onClose }: { uid: string; mode: 'info' | 'edit'; onClose: () => void }) {
  const { act, call, view, editing } = useShared()
  const [detail, setDetail] = useState<SelDetail | null>(null)
  const [tab, setTab] = useState<'info' | 'edit'>(mode)
  // the unit is looked at again whenever the list changes (a wargear choice changes points and rules)
  useEffect(() => {
    let live = true
    void call({ op: 'detail', uid }).then((r) => { if (live && r.ok) setDetail(r.detail ?? null) })
    return () => { live = false }
  }, [call, uid, view])
  useEffect(() => { if (!editing) setTab('info') }, [editing])
  const title = detail?.name ?? '…'
  return (
    <Modal title={title} sub={detail ? `${Math.round(detail.pts)} pts` : undefined} onClose={onClose}>
      {editing && (
        <div className="bld-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'info'} className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}>Info</button>
          <button role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>Wargear</button>
        </div>
      )}
      {!detail && <p className="muted">Opening…</p>}
      {detail && (tab === 'info' ? <UnitSheet d={detail} /> : (
        <>
          <SlotList slots={detail.slots} container={detail.uid} act={act} />
          <div className="bld-done"><button className="primary" onClick={onClose}>Done</button></div>
        </>
      ))}
    </Modal>
  )
}

/** The unit as it stands: what it carries, its stat lines, and its rules (folded away until wanted). */
function UnitSheet({ d }: { d: SelDetail }) {
  return (
    <div className="bld-sheet">
      {d.issues.length > 0 && <ul className="bld-sheet-issues">{d.issues.map((t, i) => <li key={i}>{t}</li>)}</ul>}
      <ul className="bld-loadout">{d.loadout.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {d.stats.map((t) => <StatBlock key={t.type} t={t} />)}
      {d.rules.length > 0 && (
        <details className="bld-rules">
          <summary>Rules ({d.rules.length})</summary>
          {d.rules.map((r, i) => (
            <details key={i} className="bld-rule">
              <summary>{r.name}</summary>
              <p>{r.text || 'No description in the data.'}</p>
            </details>
          ))}
        </details>
      )}
    </div>
  )
}

// columns that hold words, not numbers: they go on a line under the numbers so the numbers fit a phone screen
const WORDY = new Set(['Type', 'Special Rules', 'Traits', 'Transport Capacity', 'Access Points'])

/** One kind of stat line (models, ranged weapons...): the name, the numbers across, and the wordy parts underneath. */
function StatBlock({ t }: { t: StatTable }) {
  const num = t.columns.map((c, i) => ({ c, i })).filter(({ c, i }) => !WORDY.has(c) && t.rows.some((r) => r.values[i]?.trim()))
  const words = t.columns.map((c, i) => ({ c, i })).filter(({ c }) => WORDY.has(c))
  return (
    <div className="bld-stats">
      <h5>{t.type}</h5>
      <table style={{ '--cols': Math.max(1, num.length) } as CSSProperties}>
        <thead><tr>{num.map(({ c }) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {t.rows.map((r, n) => {
            const notes = words.map(({ c, i }) => (r.values[i]?.trim() && r.values[i].trim() !== '-' ? `${c === 'Type' ? '' : `${c}: `}${r.values[i]}` : '')).filter(Boolean)
            return [
              <tr key={`${n}n`} className="stat-name"><td colSpan={Math.max(1, num.length)}>{r.name}</td></tr>,
              <tr key={`${n}v`} className="stat-vals">{num.map(({ i }) => <td key={i}>{r.values[i]}</td>)}</tr>,
              notes.length > 0 && <tr key={`${n}t`} className="stat-notes"><td colSpan={Math.max(1, num.length)}>{notes.join(' · ')}</td></tr>,
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

function SlotList({ slots, container, act }: { slots: SlotView[]; container: string; act: Act }) {
  return (
    <ul className="bld-slotlist">
      {slots.map((s) => <SlotRow key={s.id} s={s} container={container} act={act} />)}
    </ul>
  )
}

function SlotRow({ s, container, act }: { s: SlotView; container: string; act: Act }) {
  if (s.isGroup) {
    // a group is only a heading when everything in it is just a choice; it carries no number of its own
    return (
      <li className="bld-group">
        <span className="bld-group-name">{s.name}</span>
        <SlotList slots={s.children ?? []} container={container} act={act} />
      </li>
    )
  }
  const canAdd = s.number < s.max
  const selUid = s.selected?.uid
  return (
    <li className={`bld-entry${s.number > 0 ? ' on' : ''}`}>
      <div className="bld-entry-row">
        <span className="bld-entry-name">{s.name}</span>
        {s.pts > 0 && <span className="chip pts">{s.pts} pts</span>}
        <span className="bld-step">
          <button className="ghost" disabled={!selUid || s.number <= s.min} onClick={() => selUid && void act({ op: 'setNumber', uid: selUid, n: s.number - 1 })} aria-label={`Fewer ${s.name}`}>−</button>
          <b>{s.number}</b>
          <button className="ghost" disabled={!canAdd} onClick={() => void act({ op: 'add', container, slot: s.id })} aria-label={`More ${s.name}`}>+</button>
        </span>
      </div>
      {s.selected && s.selected.slots.length > 0 && <SlotList slots={s.selected.slots} container={s.selected.uid} act={act} />}
    </li>
  )
}
