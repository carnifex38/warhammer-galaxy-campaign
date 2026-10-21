import { useCallback, useEffect, useRef, useState } from 'react'
import type { Request, Response } from './worker.ts'
import type { Choice, ForceView, RoleView, RosterView, SavedRoster, SelDetail, SelSummary, SlotView, StatTable } from './roster.ts'

// The army builder screen: pick an army, add detachments and units, edit each unit's loadout, see the points and the
// rules' complaints as you go. All the work happens in a worker (see worker.ts); this file only draws what it sends back.

/** What a profile stores for one army list built here. */
export interface StoredRoster { game: 'hh3'; armyId: string; saved: SavedRoster }

const DATA = `${import.meta.env.BASE_URL}data`
const BASE: Record<StoredRoster['game'], string> = { hh3: `${DATA}/hh3` }

type Call = (req: Request) => Promise<Response>

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

export default function ArmyBuilder({ stored, name, onChange }: { stored?: StoredRoster; name: string; onChange: (s: StoredRoster) => void }) {
  const call = useWorker()
  const [armies, setArmies] = useState<{ id: string; name: string }[] | null>(null)
  const [armyId, setArmyId] = useState(stored?.armyId ?? '')
  const [view, setView] = useState<RosterView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const started = useRef(false)
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
    if (r.saved) onChange({ game: 'hh3', armyId: armyRef.current, saved: r.saved })
  }, [onChange])

  const start = useCallback(async (id: string, saved?: SavedRoster) => {
    setBusy(true)
    setError('')
    const r = await call({ op: 'load', base: BASE.hh3, armyId: id, saved })
    setBusy(false)
    if (r.ok && r.dropped) setNote(`${r.dropped} entries are no longer in the rules data and were left out.`)
    apply(r)
  }, [call, apply])

  useEffect(() => {
    if (started.current || !stored) return
    started.current = true
    void start(stored.armyId, stored.saved)
  }, [stored, start])

  const act = useCallback(async (req: Request) => { apply(await call(req)) }, [call, apply])

  if (error && !view) return <p className="login-error" role="alert">{error}</p>

  if (!view) {
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
        <p className="muted bld-hint">The rules for the Horus Heresy (3rd edition) come from the community BSData files, the same data New Recruit uses. They download once, then work offline.</p>
      </div>
    )
  }

  const pts = view.costs[0]
  const errors = view.issues.filter((i) => i.level === 'error')
  const top = view.forces

  return (
    <div className="bld">
      <header className="bld-head">
        <div className="bld-total">
          <b>{pts ? Math.round(pts.total) : 0}</b>
          <span>{pts?.name ?? 'Points'}</span>
          <label className="bld-limit">limit
            <input type="number" min={0} step={50} value={pts && pts.limit >= 0 ? pts.limit : ''} placeholder="none"
              onChange={(e) => pts && void act({ op: 'limit', id: pts.id, value: e.target.value === '' ? -1 : Number(e.target.value) })} />
          </label>
        </div>
        <div className="bld-export">
          <button className="ghost" onClick={async () => { const r = await call({ op: 'ros', zipped: true }); if (r.ok && r.file) download(r.file.name, r.file.bytes) }} title="A file New Recruit and BattleScribe can open">Export .rosz</button>
          <button className="ghost" onClick={async () => { const r = await call({ op: 'ros', zipped: false }); if (r.ok && r.file) download(r.file.name, r.file.bytes) }}>.ros</button>
        </div>
      </header>

      {note && <p className="muted">{note}</p>}
      {error && <p className="login-error" role="alert">{error}</p>}

      <details className="bld-issues" open={errors.length > 0 && errors.length < 6}>
        <summary className={errors.length ? 'bad' : 'good'}>{errors.length ? `${errors.length} problem${errors.length === 1 ? '' : 's'} with this list` : 'No problems found'}</summary>
        <ul>{view.issues.map((i, n) => <li key={n} className={i.level}>{i.text}</li>)}</ul>
      </details>

      {top.map((f) => <ForceBlock key={f.uid} f={f} act={act} call={call} view={view} depth={0} />)}

      <div className="bld-addforce">
        <select value="" onChange={(e) => { if (e.target.value) void act({ op: 'addForce', parent: null, entry: e.target.value, army: armyId }) }} aria-label="Add a force">
          <option value="">+ Add a force (army organisation)…</option>
          {view.forceChoices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
    </div>
  )
}

function ForceBlock({ f, act, call, view, depth }: { f: ForceView; act: (r: Request) => Promise<void>; call: Call; view: RosterView; depth: number }) {
  return (
    <section className={`bld-force depth${Math.min(depth, 2)}`}>
      <header>
        <h4>{f.name}{f.issues > 0 && <span className="bld-badge" title="Problems in this force">{f.issues}</span>}</h4>
        <span className="bld-pts">{Math.round(f.pts)} pts</span>
        <button className="ghost" onClick={() => void act({ op: 'removeForce', uid: f.uid })} aria-label={`Remove ${f.name}`}>Remove</button>
      </header>
      {f.roles.map((r) => <RoleBlock key={r.id || 'none'} role={r} forceUid={f.uid} act={act} call={call} view={view} />)}
      {f.forces.map((c) => <ForceBlock key={c.uid} f={c} act={act} call={call} view={view} depth={depth + 1} />)}
      {f.childChoices.length > 0 && (
        <select value="" onChange={(e) => { if (e.target.value) void act({ op: 'addForce', parent: f.uid, entry: e.target.value }) }} aria-label={`Add a detachment to ${f.name}`}>
          <option value="">+ Add a detachment…</option>
          {f.childChoices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </section>
  )
}

function RoleBlock({ role, forceUid, act, call, view }: { role: RoleView; forceUid: string; act: (r: Request) => Promise<void>; call: Call; view: RosterView }) {
  const limit = role.min || role.max ? ` ${role.count}/${role.min && role.max ? `${role.min}–${role.max}` : role.max ? `max ${role.max}` : `min ${role.min}`}` : role.count ? ` ${role.count}` : ''
  const short = role.min !== undefined && role.count < role.min
  const over = role.max !== undefined && role.count > role.max
  return (
    <div className="bld-role">
      <h5 className={short || over ? 'bad' : ''}>{role.name}<span>{limit}</span></h5>
      {role.selections.map((s) => <SelCard key={s.uid} s={s} act={act} call={call} view={view} />)}
      {role.choices.length > 0 && (
        <select value="" onChange={(e) => { if (e.target.value) void act({ op: 'add', container: forceUid, slot: e.target.value }) }} aria-label={`Add to ${role.name}`}>
          <option value="">+ Add {role.name}…</option>
          {role.choices.map((c: Choice) => <option key={c.id} value={c.id}>{c.name}{c.pts ? ` (${c.pts} pts)` : ''}</option>)}
        </select>
      )}
    </div>
  )
}

function SelCard({ s, act, call, view }: { s: SelSummary; act: (r: Request) => Promise<void>; call: Call; view: RosterView }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false) // the long list of options is only open while choosing wargear
  const [detail, setDetail] = useState<SelDetail | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    void call({ op: 'detail', uid: s.uid }).then((r) => { if (live && r.ok) setDetail(r.detail ?? null) })
    return () => { live = false }
  }, [open, call, s.uid, view])
  return (
    <div className={`bld-sel${open ? ' open' : ''}`}>
      <div className="bld-sel-row">
        <button className="bld-sel-name" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> {s.name}{s.issues > 0 && <span className="bld-badge">{s.issues}</span>}
        </button>
        <span className="bld-pts">{Math.round(s.pts)} pts</span>
        <button className="ghost" onClick={() => void act({ op: 'remove', uid: s.uid })} aria-label={`Remove ${s.name}`}>✕</button>
      </div>
      {open && detail && (
        <div className="bld-slots">
          {editing ? (
            <>
              <div className="bld-edit-head"><b>Choose wargear</b><button className="primary" onClick={() => setEditing(false)}>Done</button></div>
              <SlotList slots={detail.slots} container={detail.uid} act={act} />
            </>
          ) : (
            <UnitSheet d={detail} onEdit={() => setEditing(true)} />
          )}
        </div>
      )}
      {open && !detail && <p className="muted">Opening…</p>}
    </div>
  )
}

/** The unit as it stands: what it carries, its stat lines, and its rules (folded away until wanted). */
function UnitSheet({ d, onEdit }: { d: SelDetail; onEdit: () => void }) {
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
      <button className="ghost bld-edit" onClick={onEdit}>Change wargear</button>
    </div>
  )
}

function StatBlock({ t }: { t: StatTable }) {
  // empty columns (a weapon with no traits, say) are left out so the table stays narrow
  const keep = t.columns.map((_, i) => t.rows.some((r) => r.values[i]?.trim()))
  return (
    <div className="bld-stats">
      <table>
        <thead><tr><th>{t.type}</th>{t.columns.map((c, i) => keep[i] && <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{t.rows.map((r, n) => <tr key={n}><th>{r.name}</th>{r.values.map((v, i) => keep[i] && <td key={i}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function SlotList({ slots, container, act }: { slots: SlotView[]; container: string; act: (r: Request) => Promise<void> }) {
  return (
    <ul className="bld-slotlist">
      {slots.map((s) => <SlotRow key={s.id} s={s} container={container} act={act} />)}
    </ul>
  )
}

function SlotRow({ s, container, act }: { s: SlotView; container: string; act: (r: Request) => Promise<void> }) {
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
        <span className="bld-pts">{s.pts ? `${s.pts} pts` : ''}</span>
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
