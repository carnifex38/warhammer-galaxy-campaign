import { useEffect, useMemo, useState } from 'react'
import type { ProfileSummary } from './api'
import type { AuthApi } from './auth'
import { dayKey, MAX_EVENT_PLANETS, type CalendarApi, type CalendarEvent, type EventDraft } from './calendar'
import { usePortrait } from './planetPortrait'
import type { Planet, Sector } from './galaxy/data'
import type { EventApi } from './galaxy/eventConfig'
import { lookFor, type Era } from './galaxy/planetLooks'

// The calendar: a month of boxes (the event names show in them on a computer; on a phone the days carry dots and the events are listed
// below), and an event opens to the list of planets being fought over: portrait, sector, and how many players are going. Tapping a
// planet takes the player to the galaxy, already looking at it. The gamemaster adds, edits and removes events right here.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ERA_KEY = 'galaxy-era'

function currentEra(): Era {
  try { return localStorage.getItem(ERA_KEY) === '30k' ? '30k' : '40k' } catch { return '40k' }
}

const parseDay = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d) }
const longDate = (key: string) => parseDay(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = (key: string) => parseDay(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

/** The weeks of a month as rows of seven days, Monday first, padded with the days either side. */
function monthWeeks(first: Date): Date[][] {
  const lead = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead)
  const weeks: Date[][] = []
  for (let w = 0; w < 6; w++) {
    const row = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i))
    if (w >= 4 && row[0].getMonth() !== first.getMonth()) break // no empty last row
    weeks.push(row)
  }
  return weeks
}

interface Found { planet: Planet; sector: Sector }

/** A planet's portrait: the real picture once it is drawn, a disc in the planet's colours until then. */
function Portrait({ planet, era, size = 64 }: { planet: Planet; era: Era; size?: number }) {
  const url = usePortrait(planet.name, era)
  const look = lookFor(planet.name, era)
  return (
    <span
      className="cal-portrait"
      style={{ width: size, height: size, background: url ? `center / cover url(${url})` : `radial-gradient(circle at 35% 30%, ${look.landB}, ${look.landA} 55%, ${look.deep})` }}
      aria-hidden="true"
    />
  )
}

export default function CalendarView({ auth, calendar, events, onOpenPlanet, focusId, onFocusUsed }: {
  auth: AuthApi
  calendar: CalendarApi
  events: EventApi
  onOpenPlanet: (sectorId: string, planetId: string) => void
  /** An event to open straight away (chosen from a planet's screen in the galaxy). */
  focusId?: string | null
  onFocusUsed?: () => void
}) {
  const isGm = auth.session?.role === 'gm'
  const [era] = useState(currentEra)
  const [today] = useState(() => dayKey(new Date()))
  const [month, setMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1) })
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null)
  const [focusDay, setFocusDay] = useState<string | null>(null)
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [error, setError] = useState('')

  // every planet an event can name: the gamemaster sees them all, players only the ones the host has shown
  const found = useMemo(() => {
    const m = new Map<string, Found>()
    for (const sector of isGm ? events.sectors : events.visibleSectors) for (const planet of sector.planets) m.set(planet.id, { planet, sector })
    return m
  }, [events.sectors, events.visibleSectors, isGm])

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>()
    for (const e of calendar.events) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return m
  }, [calendar.events])
  const weeks = useMemo(() => monthWeeks(month), [month])
  const monthKey = dayKey(month).slice(0, 7)
  const inMonth = calendar.events.filter((e) => e.date.startsWith(monthKey) && (!focusDay || e.date === focusDay))
  const selected = calendar.events.find((e) => e.id === selectedId) ?? null

  // opened from a planet's screen: show that event's month, and say the request has been used
  const focused = focusId ? calendar.events.find((e) => e.id === focusId) : undefined
  useEffect(() => {
    if (!focusId) return
    if (focused) { setMonth(new Date(parseDay(focused.date).getFullYear(), parseDay(focused.date).getMonth(), 1)); onFocusUsed?.() }
    else if (calendar.events.length) onFocusUsed?.() // the event is gone
  }, [focusId, focused, calendar.events.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const guard = async (run: () => Promise<void>) => {
    setError('')
    try { await run() } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.') }
  }
  const step = (n: number) => { setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1)); setFocusDay(null) }
  const goToday = () => { const n = new Date(); setMonth(new Date(n.getFullYear(), n.getMonth(), 1)); setFocusDay(null) }
  const open = (id: string) => { setSelectedId(id); setEditing(null) }

  return (
    <div className="cal">
      <header className="cal-head">
        <div className="cal-nav">
          <button className="ghost" onClick={() => step(-1)} aria-label="Previous month">‹</button>
          <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <button className="ghost" onClick={() => step(1)} aria-label="Next month">›</button>
          <button className="ghost" onClick={goToday}>Today</button>
        </div>
        {isGm && <button className="cal-new" onClick={() => { setEditing('new'); setSelectedId(null) }}>+ New event</button>}
      </header>
      {error && <p className="cal-error" role="alert">{error}</p>}

      <div className="cal-body">
        <section className="cal-main" aria-label="Month">
          <div className="cal-grid" role="grid">
            {WEEKDAYS.map((d) => <div key={d} className="cal-wd" role="columnheader">{d}</div>)}
            {weeks.flat().map((d) => {
              const key = dayKey(d)
              const list = byDay.get(key) ?? []
              const out = d.getMonth() !== month.getMonth()
              return (
                <div
                  key={key}
                  role="gridcell"
                  className={`cal-day${out ? ' out' : ''}${key === today ? ' today' : ''}${key < today ? ' past' : ''}${focusDay === key ? ' focus' : ''}${list.length ? ' has' : ''}`}
                  onClick={() => { if (list.length) setFocusDay(focusDay === key ? null : key) }}
                >
                  <span className="cal-num">{d.getDate()}</span>
                  <span className="cal-chips">
                    {list.map((e) => (
                      <button key={e.id} className={`cal-chip${e.id === selectedId ? ' on' : ''}`} onClick={(ev) => { ev.stopPropagation(); open(e.id) }} title={e.name}>
                        <i aria-hidden="true" />
                        <span>{e.name}</span>
                      </button>
                    ))}
                  </span>
                </div>
              )
            })}
          </div>

          {/* on a phone the month is only dots, so the events are listed here */}
          <div className="cal-agenda">
            <h3>
              {focusDay ? shortDate(focusDay) : 'This month'}
              {focusDay && <button className="ghost" onClick={() => setFocusDay(null)}>Show the month</button>}
            </h3>
            {inMonth.length === 0 && <p className="muted">Nothing scheduled{focusDay ? ' that day' : ' this month'}.</p>}
            {inMonth.map((e) => {
              const planets = e.planets.map((p) => found.get(p.planetId)).filter((x): x is Found => !!x)
              return (
                <button key={e.id} className={`cal-card${e.date < today ? ' past' : ''}${e.id === selectedId ? ' on' : ''}`} onClick={() => open(e.id)}>
                  <span className="cal-badge"><b>{parseDay(e.date).getDate()}</b><i>{parseDay(e.date).toLocaleDateString(undefined, { month: 'short' })}</i></span>
                  <span className="cal-card-text">
                    <strong>{e.name}</strong>
                    <em>{planets.length} planet{planets.length === 1 ? '' : 's'} · {e.planets.reduce((n, p) => n + p.players.length, 0)} signed up</em>
                  </span>
                  <span className="cal-card-faces">{planets.slice(0, 3).map(({ planet }) => <Portrait key={planet.id} planet={planet} era={era} size={30} />)}</span>
                </button>
              )
            })}
          </div>
        </section>

        {!selected && !editing && (
          <aside className="cal-empty">
            <strong>{calendar.events.length ? 'Pick an event' : 'Nothing scheduled yet'}</strong>
            <p>{calendar.events.length ? 'Choose an event on the calendar to see the planets being fought over and who is going.' : isGm ? 'Add the first event with the New event button.' : 'When the gamemaster schedules an event it will appear here.'}</p>
          </aside>
        )}
        {(selected || editing) && (
          <aside className="cal-detail" aria-label="Event">
            {editing ? (
              <Editor
                key={editing}
                initial={editing === 'new' ? null : calendar.events.find((e) => e.id === editing) ?? null}
                found={found}
                sectors={isGm ? events.sectors : events.visibleSectors}
                defaultDate={focusDay ?? (monthKey === today.slice(0, 7) ? today : `${monthKey}-01`)}
                onCancel={() => setEditing(null)}
                onSave={(draft) => guard(async () => {
                  if (editing === 'new') await calendar.create(draft)
                  else await calendar.update(editing, draft)
                  setEditing(null)
                  if (editing === 'new') { setMonth(new Date(parseDay(draft.date).getFullYear(), parseDay(draft.date).getMonth(), 1)); setFocusDay(null) }
                })}
              />
            ) : selected && (
              <Detail
                event={selected}
                found={found}
                era={era}
                today={today}
                isGm={isGm}
                myId={calendar.myId}
                onClose={() => setSelectedId(null)}
                onOpenPlanet={onOpenPlanet}
                onEdit={() => setEditing(selected.id)}
                onDelete={() => { if (window.confirm(`Remove "${selected.name}" from the calendar?`)) void guard(async () => { await calendar.remove(selected.id); setSelectedId(null) }) }}
                onSignUp={(planetId) => guard(() => calendar.signUp(selected.id, planetId))}
                onLeave={() => guard(() => calendar.leave(selected.id))}
                onKick={(profileId) => guard(() => calendar.removePlayer(selected.id, profileId))}
                loadPlayers={calendar.gmPlayers}
                onAssign={(planetId, profileId) => guard(() => calendar.assignPlayer(selected.id, planetId, profileId))}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------- one event

function Detail({ event, found, era, today, isGm, myId, onClose, onOpenPlanet, onEdit, onDelete, onSignUp, onLeave, onKick, loadPlayers, onAssign }: {
  event: CalendarEvent
  found: Map<string, Found>
  era: Era
  today: string
  isGm: boolean
  myId: string | null
  onClose: () => void
  onOpenPlanet: (sectorId: string, planetId: string) => void
  onEdit: () => void
  onDelete: () => void
  onSignUp: (planetId: string) => void
  onLeave: () => void
  onKick: (profileId: string) => void
  loadPlayers: () => Promise<ProfileSummary[]>
  onAssign: (planetId: string, profileId: string) => void | Promise<void>
}) {
  const past = event.date < today
  const shown = event.planets.filter((p) => found.has(p.planetId))
  return (
    <div className="cal-event">
      <button className="ghost cal-close" onClick={onClose}>‹ Back</button>
      <h3>{event.name}</h3>
      <p className="cal-when">{longDate(event.date)}{past ? ' · finished' : event.date === today ? ' · today' : ''}</p>
      {event.notes && <p className="cal-notes">{event.notes}</p>}
      {isGm && (
        <div className="cal-gm">
          <button className="ghost" onClick={onEdit}>Edit</button>
          <button className="ghost danger" onClick={onDelete}>Remove</button>
        </div>
      )}
      <h4>Planets{shown.length ? ` (${shown.length})` : ''}</h4>
      {shown.length === 0 && <p className="muted">No planets have been announced for this event yet.</p>}
      <ul className="cal-planets">
        {shown.map((p) => {
          const { planet, sector } = found.get(p.planetId)!
          const mine = !!myId && p.players.some((x) => x.profileId === myId)
          const full = p.target > 0 && p.players.length >= p.target
          return (
            <li key={p.planetId} className={mine ? 'mine' : ''}>
              <button className="cal-planet" onClick={() => onOpenPlanet(sector.id, planet.id)} aria-label={`Open ${planet.name} in the galaxy`}>
                <Portrait planet={planet} era={era} />
                <span className="cal-planet-text">
                  <strong>{planet.name}{planet.forge ? ' ⚙' : ''}</strong>
                  <span className="cal-sector" style={{ ['--c' as string]: sector.color }}><i aria-hidden="true" />{sector.name}</span>
                  <span className={`cal-count${full ? ' full' : ''}`}>{p.players.length}{p.target > 0 ? ` of ${p.target}` : ''} player{p.players.length === 1 && p.target === 0 ? '' : 's'}{full ? ' · full' : ''}</span>
                </span>
                <span className="cal-go" aria-hidden="true">View ›</span>
              </button>
              <div className="cal-signup">
                {myId && !past && (mine
                  ? <button className="ghost" onClick={onLeave}>Leave</button>
                  : <button onClick={() => onSignUp(p.planetId)} disabled={full}>{full ? 'Full' : 'Sign up'}</button>)}
                {p.players.length > 0 && (
                  <ul className="cal-players">
                    {p.players.map((x) => (
                      <li key={x.profileId} className={x.profileId === myId ? 'me' : ''}>
                        {x.name}
                        {isGm && <button className="cal-kick" onClick={() => onKick(x.profileId)} aria-label={`Remove ${x.name}`}>✕</button>}
                      </li>
                    ))}
                  </ul>
                )}
                {isGm && <AddPlayer taken={p.players.map((x) => x.profileId)} loadPlayers={loadPlayers} onAssign={(profileId) => onAssign(p.planetId, profileId)} />}
              </div>
            </li>
          )
        })}
      </ul>
      {!myId && !past && shown.length > 0 && <p className="muted cal-hint">Sign in with a player profile to sign up for a planet.</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------- the gamemaster's editor

function Editor({ initial, found, sectors, defaultDate, onCancel, onSave }: {
  initial: CalendarEvent | null
  found: Map<string, Found>
  sectors: Sector[]
  defaultDate: string
  onCancel: () => void
  onSave: (draft: EventDraft) => void | Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [date, setDate] = useState(initial?.date ?? defaultDate)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [planets, setPlanets] = useState<{ planetId: string; target: number }[]>(initial?.planets.map((p) => ({ planetId: p.planetId, target: p.target })) ?? [])
  const [filter, setFilter] = useState('')

  const chosen = new Set(planets.map((p) => p.planetId))
  const matches = filter.trim()
    ? sectors.flatMap((s) => s.planets.map((planet) => ({ planet, sector: s }))).filter(({ planet }) => !chosen.has(planet.id) && planet.name.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 8)
    : []
  const canSave = name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date)

  return (
    <form className="cal-editor" onSubmit={(e) => { e.preventDefault(); if (canSave) void onSave({ name: name.trim(), date, notes: notes.trim(), planets }) }}>
      <h3>{initial ? 'Edit event' : 'New event'}</h3>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. The Siege of Terra" autoFocus /></label>
      <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Notes (optional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={600} rows={3} placeholder="Points limit, what to bring, where to meet…" /></label>

      <h4>Planets</h4>
      <ul className="cal-edit-planets">
        {planets.map((p) => {
          const f = found.get(p.planetId)
          return (
            <li key={p.planetId}>
              <span className="cal-edit-name">{f?.planet.name ?? p.planetId}<small>{f?.sector.name ?? ''}</small></span>
              <span className="stepper" role="group" aria-label={`${f?.planet.name ?? p.planetId} players wanted`}>
                <button type="button" onClick={() => setPlanets((all) => all.map((x) => (x.planetId === p.planetId ? { ...x, target: Math.max(0, x.target - 1) } : x)))} aria-label="Fewer players">−</button>
                <output>{p.target === 0 ? 'Any' : p.target}</output>
                <button type="button" onClick={() => setPlanets((all) => all.map((x) => (x.planetId === p.planetId ? { ...x, target: Math.min(99, x.target + 1) } : x)))} aria-label="More players">+</button>
              </span>
              <button type="button" className="ghost" onClick={() => setPlanets((all) => all.filter((x) => x.planetId !== p.planetId))} aria-label={`Remove ${f?.planet.name ?? p.planetId}`}>✕</button>
            </li>
          )
        })}
      </ul>
      {planets.length < MAX_EVENT_PLANETS && (
        <div className="cal-add">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Add a planet: type a name…" aria-label="Add a planet" />
          {matches.length > 0 && (
            <ul className="cal-matches">
              {matches.map(({ planet, sector }) => (
                <li key={planet.id}>
                  <button type="button" onClick={() => { setPlanets((all) => [...all, { planetId: planet.id, target: 0 }]); setFilter('') }}>
                    + {planet.name}<small style={{ color: sector.color }}>{sector.name}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {filter.trim() && matches.length === 0 && <p className="muted">No planet matches that.</p>}
        </div>
      )}
      <div className="cal-actions">
        <button type="submit" disabled={!canSave}>{initial ? 'Save changes' : 'Add to calendar'}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

/** The gamemaster signs a player up for a planet: the players are loaded the first time it is opened. */
function AddPlayer({ taken, loadPlayers, onAssign }: { taken: string[]; loadPlayers: () => Promise<ProfileSummary[]>; onAssign: (profileId: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [players, setPlayers] = useState<ProfileSummary[] | null>(null)
  const [pick, setPick] = useState('')

  const show = () => {
    setOpen(true)
    if (!players) void loadPlayers().then(setPlayers).catch(() => setPlayers([]))
  }
  if (!open) return <button className="ghost cal-add-player" onClick={show}>+ Add player</button>
  const choices = (players ?? []).filter((x) => !taken.includes(x.id))
  return (
    <span className="cal-add-player-row">
      <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Player to add">
        <option value="">{players === null ? 'Loading players…' : choices.length ? 'Choose a player…' : 'No more players'}</option>
        {choices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <button disabled={!pick} onClick={() => { void onAssign(pick); setPick(''); setOpen(false) }}>Add</button>
      <button className="ghost" onClick={() => { setOpen(false); setPick('') }}>Cancel</button>
    </span>
  )
}
