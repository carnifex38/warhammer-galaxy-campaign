import { useState } from 'react'
import type { AuthApi } from '../auth'
import { useMyProfile, type ClaimsApi, type Seat, type Team, type Viewing } from '../claims'

// Who is at a battlezone: two sides, and for each player the army list they brought. Players drop in and out freely while the
// battlezone is open; the gamemaster marks it in play (which freezes the lists) or reopens it. Tapping a player's list opens it
// in the Army Lists tab: this is the only place players can read each other's lists.

const TEAMS: Team[] = ['A', 'B']

function SeatRow({ seat, mine, canRead, gm, onView, onRemove }: { seat: Seat; mine: boolean; canRead: boolean; gm: boolean; onView: () => void; onRemove: () => void }) {
  return (
    <li className="seat">
      <div className="seat-who">
        <b>{seat.name}{mine && <em> (you)</em>}</b>
        <small>{seat.missing ? 'List removed' : `${seat.armyName} · ${seat.era.toUpperCase()}${seat.pts !== undefined ? ` · ${seat.pts} pts` : ''}`}{seat.locked ? ' · locked' : ''}</small>
      </div>
      {canRead && !seat.missing && <button className="ghost" onClick={onView}>View list</button>}
      {gm && <button className="ghost" onClick={onRemove} aria-label={`Remove ${seat.name}`}>✕</button>}
    </li>
  )
}

export default function Seats({ tableId, where, auth, claims, onView }: { tableId: string; where: string; auth: AuthApi; claims: ClaimsApi; onView: (v: Viewing) => void }) {
  const role = auth.session?.role ?? 'guest'
  const me = useMyProfile(auth)
  const seats = claims.seatsOf(tableId)
  const status = claims.statusOf(tableId)
  const mine = seats.find((s) => s.profileId === me?.id)
  const [armyId, setArmyId] = useState('')
  const [team, setTeam] = useState<Team>('A')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = armyId || mine?.armyId || me?.armies[0]?.id || ''
  const chosenTeam = mine && !busy ? mine.team : team

  const run = async (job: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await job() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) }
  }

  const open = status === 'open'
  const canJoin = role !== 'guest' && !!me
  const armies = me?.armies ?? []

  return (
    <section className="seats">
      <header className="seats-head">
        <h4>Players</h4>
        {role === 'gm' && (
          <button className="ghost" disabled={busy} onClick={() => void run(() => claims.setStatus(tableId, open ? 'in_play' : 'open'))} title={open ? 'Lists freeze as they are now' : 'Lists go live again'}>
            {open ? 'Mark in play' : 'Reopen'}
          </button>
        )}
      </header>

      <div className="seat-teams">
        {TEAMS.map((t) => {
          const list = seats.filter((s) => s.team === t)
          return (
            <div key={t} className="seat-team">
              <h5>Team {t}</h5>
              {list.length === 0 && <p className="muted">Empty</p>}
              <ul>
                {list.map((s) => (
                  <SeatRow
                    key={s.profileId}
                    seat={s}
                    mine={s.profileId === me?.id}
                    canRead={role !== 'guest'}
                    gm={role === 'gm'}
                    onView={() => onView({ tableId, profileId: s.profileId, player: s.name, team: s.team, where })}
                    onRemove={() => void run(() => claims.remove(tableId, s.profileId))}
                  />
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {!open && <p className="muted seat-note">In play: the lists are locked as they were.</p>}
      {role === 'guest' && <p className="muted seat-note">Log in as a player to take a seat.</p>}
      {role !== 'guest' && !me && <p className="muted seat-note">{role === 'gm' ? 'To take a seat yourself, make a profile of your own in the Army Lists tab.' : 'Make a profile (log out, choose Player, New profile) to take a seat.'}</p>}
      {canJoin && open && armies.length === 0 && <p className="muted seat-note">Add an army list in the Army Lists tab first, then come back to take a seat.</p>}

      {canJoin && open && armies.length > 0 && (
        <div className="seat-join">
          <select value={chosen} onChange={(e) => setArmyId(e.target.value)} aria-label="Army list to bring">
            {armies.map((a) => <option key={a.id} value={a.id}>{(a.name || 'Untitled army')} · {a.era.toUpperCase()}</option>)}
          </select>
          <div className="seat-sides" role="group" aria-label="Team">
            {TEAMS.map((t) => <button key={t} className={chosenTeam === t ? 'on' : ''} aria-pressed={chosenTeam === t} onClick={() => setTeam(t)}>Team {t}</button>)}
          </div>
          <button className="primary" disabled={busy || !chosen} onClick={() => void run(() => claims.claim(tableId, chosenTeam, chosen))}>
            {mine ? 'Update my seat' : `Join Team ${chosenTeam}`}
          </button>
          {mine && <button className="ghost" disabled={busy} onClick={() => void run(() => claims.leave(tableId))}>Leave</button>}
        </div>
      )}
      {canJoin && !open && mine && <button className="ghost" disabled={busy} onClick={() => void run(() => claims.leave(tableId))}>Leave this battlezone</button>}
      {error && <p className="login-error" role="alert">{error}</p>}
    </section>
  )
}
