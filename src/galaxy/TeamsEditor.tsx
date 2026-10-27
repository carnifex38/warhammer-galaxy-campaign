import { useState } from 'react'
import { DEFAULT_TEAMS, MAX_TEAM_NAME, isDefaultTeams, type TeamId } from '../teams'
import type { EventApi } from './eventConfig'

const SWATCHES = ['#3d8bff', '#ff4141', '#2fc46b', '#f2b630', '#a855f7', '#18c5c5', '#ff7a1f', '#e8e8f0']

function TeamRow({ id, events }: { id: TeamId; events: EventApi }) {
  const t = events.teams[id]
  // the name is only kept once the host leaves the box, so an empty box while typing does not snap back to the default
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => { if (draft !== null) events.setTeam(id, { name: draft }); setDraft(null) }
  return (
    <div className="team-edit">
      <i className="team-dot" style={{ background: t.color }} aria-hidden="true" />
      <input
        className="team-name"
        value={draft ?? t.name}
        maxLength={MAX_TEAM_NAME}
        aria-label={`Name of side ${id}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
      <div className="team-colours" role="group" aria-label={`Colour of ${t.name}`}>
        {SWATCHES.map((c) => (
          <button key={c} className={`swatch${t.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={t.color === c} onClick={() => events.setTeam(id, { color: c })} />
        ))}
        <input type="color" value={t.color} aria-label={`Pick any colour for ${t.name}`} onChange={(e) => events.setTeam(id, { color: e.target.value })} />
      </div>
    </div>
  )
}

/** Host tab: what the two sides are called and the colour each one shows on the map. */
export default function TeamsEditor({ events }: { events: EventApi }) {
  return (
    <section className="host-sector">
      <div className="team-panel">
        <span className="team-title">
          Teams
          <small className="muted" style={{ display: 'block' }}>The name and colour of each side, on the map, the seats and the Territory page. The 3D map picks up a new colour when you go back to it.</small>
        </span>
        <TeamRow id="A" events={events} />
        <TeamRow id="B" events={events} />
        <div><button className="ghost" disabled={isDefaultTeams(events.teams)} onClick={() => { events.setTeam('A', DEFAULT_TEAMS.A); events.setTeam('B', DEFAULT_TEAMS.B) }}>Back to {DEFAULT_TEAMS.A.name} and {DEFAULT_TEAMS.B.name}</button></div>
      </div>
    </section>
  )
}
