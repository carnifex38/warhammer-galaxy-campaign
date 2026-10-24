import { useState } from 'react'
import { downloadSave, fetchSave, loadSave, readSaveFile, summarize, type EventSave, type SaveParts, type SaveReport, type SaveSummary } from '../eventSave'

// The Host tab's "Save and load" section: download the whole event as one file, or load a file back (all of it, or only the parts
// ticked). Loading replaces what is there now for each part ticked, so it shows what the file holds and asks first.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function describeReport(r: SaveReport): string {
  const parts: string[] = []
  if (r.setup) parts.push('The setup was loaded.')
  if (r.battlezones || r.seatsKept || r.seatsDropped) parts.push(`${plural(r.battlezones, 'battlezone')} with ${plural(r.seatsKept, 'seat')}${r.seatsDropped ? ` (${plural(r.seatsDropped, 'player')} not found on this server, left out)` : ''}.`)
  if (r.events || r.signupsKept || r.signupsDropped) parts.push(`${plural(r.events, 'calendar event')} with ${plural(r.signupsKept, 'sign-up')}${r.signupsDropped ? ` (${plural(r.signupsDropped, 'player')} not found on this server, left out)` : ''}.`)
  return parts.join(' ') || 'Nothing was loaded.'
}

export default function SaveLoad({ token }: { token: string | undefined }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, setPending] = useState<{ save: EventSave; summary: SaveSummary; fileName: string } | null>(null)
  const [parts, setParts] = useState<SaveParts>({ setup: true, battlezones: true, calendar: true })
  const [loaded, setLoaded] = useState(false)

  const guard = async (job: () => Promise<void>) => {
    setBusy(true)
    setNote(null)
    try { await job() } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : 'That did not work.' }) } finally { setBusy(false) }
  }

  const download = () => guard(async () => {
    const save = await fetchSave(token)
    downloadSave(save)
    const s = summarize(save)
    setNote({ ok: true, text: `Saved: ${plural(s.planetsSet, 'planet setting')}, ${plural(s.zones, 'battlezone')}, ${plural(s.events, 'calendar event')}. Keep the file somewhere safe.` })
  })

  const choose = (file: File | undefined) => guard(async () => {
    if (!file) return
    const save = await readSaveFile(file)
    const summary = summarize(save)
    setPending({ save, summary, fileName: file.name })
    setParts({ setup: summary.hasSetup, battlezones: summary.zones > 0, calendar: summary.events > 0 })
  })

  const load = () => guard(async () => {
    if (!pending) return
    const chosen = [parts.setup && 'the setup', parts.battlezones && 'the battlezones', parts.calendar && 'the calendar'].filter(Boolean).join(', ')
    if (!window.confirm(`Load ${chosen} from "${pending.fileName}"? This replaces what the event has now for those parts.`)) return
    const report = await loadSave(token, pending.save, parts)
    setPending(null)
    setLoaded(true)
    setNote({ ok: true, text: `${describeReport(report)} The page reloads in a moment to show it.` })
    // this page still holds the old setup in memory: reloading it keeps an edit made now from saving the old setup back over what was loaded
    setTimeout(() => location.reload(), 3500)
  })

  const s = pending?.summary
  const none = !parts.setup && !parts.battlezones && !parts.calendar

  return (
    <section className="host-sector save-load">
      <div className="hulk-controls">
        <span className="pname">
          Save and load the event
          <small className="muted" style={{ display: 'block' }}>
            One file holds the setup (planets, locks, space hulks, every information text and mission), the battlezones (who sits where, what is in play, who won) and the calendar.
            Players' accounts and army lists are not in it: they stay with the players.
          </small>
        </span>
      </div>
      <div className="save-actions">
        <button className="ghost" disabled={busy} onClick={() => void download()}>Download a save</button>
        <label className={`ghost save-pick${busy ? ' off' : ''}`}>
          Load a save…
          <input type="file" accept=".json,application/json" disabled={busy} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void choose(f) }} />
        </label>
      </div>

      {pending && s && (
        <div className="save-pending">
          <p><b>{pending.fileName}</b><span className="muted"> · saved {new Date(s.savedAt).toLocaleString()}</span></p>
          <label className="save-part">
            <input type="checkbox" checked={parts.setup} disabled={!s.hasSetup} onChange={(e) => setParts({ ...parts, setup: e.target.checked })} />
            <span>
              <strong>Setup</strong>
              <em>{s.hasSetup ? `${plural(s.planetsSet, 'planet setting')}, ${plural(s.texts, 'information text')}, ${plural(s.locks, 'locked sector')}, ${plural(s.hulks, 'space hulk')}` : 'nothing was set up in this save'}</em>
            </span>
          </label>
          <label className="save-part">
            <input type="checkbox" checked={parts.battlezones} disabled={s.zones === 0} onChange={(e) => setParts({ ...parts, battlezones: e.target.checked })} />
            <span>
              <strong>Battlezones</strong>
              <em>{s.zones ? `${plural(s.zones, 'battlezone')}, ${plural(s.seats, 'seat')}, ${plural(s.results, 'declared result')}` : 'none in this save'}</em>
            </span>
          </label>
          <label className="save-part">
            <input type="checkbox" checked={parts.calendar} disabled={s.events === 0} onChange={(e) => setParts({ ...parts, calendar: e.target.checked })} />
            <span>
              <strong>Calendar</strong>
              <em>{s.events ? `${plural(s.events, 'event')}, ${plural(s.signups, 'sign-up')}` : 'no events in this save'}</em>
            </span>
          </label>
          <p className="muted save-warn">Seats and sign-ups go back to the same players, matched by name. A player with no account on this server is left out.</p>
          <div className="save-actions">
            <button className="primary" disabled={busy || none} onClick={() => void load()}>Load it</button>
            <button className="ghost" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}

      {note && <p className={note.ok ? 'save-ok' : 'login-error'} role={note.ok ? 'status' : 'alert'}>{note.text}</p>}
      {loaded && <button className="ghost save-reload" onClick={() => location.reload()}>Reload now</button>}
    </section>
  )
}
