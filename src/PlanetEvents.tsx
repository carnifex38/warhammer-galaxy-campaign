import { dayKey, type CalendarEvent } from './calendar'

// On a planet's screen in the galaxy: the upcoming calendar events that will be fought over on it, with how many players are going and
// who they are. Tapping one opens it in the calendar.

const parseDay = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d) }

export default function PlanetEvents({ events, planetId, myId, onOpen }: { events: CalendarEvent[]; planetId: string; myId: string | null; onOpen: (eventId: string) => void }) {
  const today = dayKey(new Date())
  const upcoming = events
    .filter((e) => e.date >= today)
    .map((e) => ({ e, p: e.planets.find((x) => x.planetId === planetId) }))
    .filter((x): x is { e: CalendarEvent; p: CalendarEvent['planets'][number] } => !!x.p)
    .slice(0, 5)
  if (upcoming.length === 0) return null
  return (
    <section className="planet-events" aria-label="Planned events">
      <h4>Planned events</h4>
      <ul>
        {upcoming.map(({ e, p }) => {
          const d = parseDay(e.date)
          return (
            <li key={e.id}>
              <button onClick={() => onOpen(e.id)} aria-label={`${e.name}, open in the calendar`}>
                <span className="cal-badge"><b>{d.getDate()}</b><i>{d.toLocaleDateString(undefined, { month: 'short' })}</i></span>
                <span className="pe-text">
                  <strong>{e.name}</strong>
                  <em>{p.players.length}{p.target > 0 ? ` of ${p.target}` : ''} going{e.date === today ? ' · today' : ''}</em>
                  {p.players.length > 0 && (
                    <span className="pe-players">
                      {p.players.map((x) => <i key={x.profileId} className={x.profileId === myId ? 'me' : ''}>{x.name}</i>)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
