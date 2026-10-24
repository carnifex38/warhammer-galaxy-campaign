import { useEffect, useRef, useState } from 'react'
import type { Army, ProfileSummary } from '../api'
import type { AuthApi } from '../auth'
import { useMyProfile, type ClaimsApi, type Seat, type Team, type Viewing } from '../claims'

// Who is at a battlezone: two sides, and for each player the army list they brought. Players drop in and out freely while the
// battlezone is open; the gamemaster marks it in play (which freezes the lists) or reopens it. Tapping a player's list opens it
// in the Army Lists tab: this is the only place players can read each other's lists.

const TEAMS: Team[] = ['A', 'B']

/** Gamemaster: change a seated player's team or list. The list choices are fetched when the gamemaster asks for them. */
function GmSeatEdit({ seat, otherTeam, claims, tableId, run, busy }: { seat: Seat; otherTeam: Team; claims: ClaimsApi; tableId: string; run: (job: () => Promise<void>) => Promise<void>; busy: boolean }) {
  const [armies, setArmies] = useState<Army[] | null>(null)
  const [picking, setPicking] = useState(false)
  const pickList = () => {
    setPicking(true)
    void claims.gmArmies(seat.profileId).then(setArmies).catch(() => setArmies([]))
  }
  return (
    <div className="seat-gm">
      <button className="ghost" disabled={busy} onClick={() => void run(() => claims.assign(tableId, seat.profileId, otherTeam, seat.armyId))}>Move to Team {otherTeam}</button>
      {!picking ? (
        <button className="ghost" disabled={busy} onClick={pickList}>Change list</button>
      ) : armies === null ? (
        <small className="muted">Loading…</small>
      ) : armies.length === 0 ? (
        <small className="muted">No lists</small>
      ) : (
        <select value={seat.armyId} disabled={busy} aria-label={`List for ${seat.name}`} onChange={(e) => void run(async () => { await claims.assign(tableId, seat.profileId, seat.team, e.target.value); setPicking(false) })}>
          {armies.map((a) => <option key={a.id} value={a.id}>{(a.name || 'Untitled army')} · {a.era.toUpperCase()}</option>)}
        </select>
      )}
    </div>
  )
}

/** Gamemaster: put any player at this battlezone, on a team, with one of their lists. */
function GmAddPlayer({ tableId, claims, seatedIds, run, busy }: { tableId: string; claims: ClaimsApi; seatedIds: string[]; run: (job: () => Promise<void>) => Promise<void>; busy: boolean }) {
  const [players, setPlayers] = useState<ProfileSummary[] | null>(null)
  const [profileId, setProfileId] = useState('')
  const [armies, setArmies] = useState<Army[] | null>(null) // null = not loaded yet
  const [armyId, setArmyId] = useState('')
  const [team, setTeam] = useState<Team>('A')
  const [open, setOpen] = useState(false)
  // `claims` is a new object on every render, so the effects below read it through a ref: otherwise each re-render of the page would
  // cancel the load in flight and the lists would never arrive
  const api = useRef(claims)
  api.current = claims

  useEffect(() => {
    if (!open || players) return
    void api.current.gmPlayers().then(setPlayers).catch(() => setPlayers([]))
  }, [open, players])
  useEffect(() => {
    if (!profileId) return
    let live = true
    void api.current.gmArmies(profileId).then((a) => { if (live) { setArmies(a); setArmyId(a[0]?.id ?? '') } }).catch(() => { if (live) setArmies([]) })
    return () => { live = false }
  }, [profileId])

  const free = (players ?? []).filter((p) => !seatedIds.includes(p.id))
  if (!open) return <button className="ghost seat-gm-add" onClick={() => setOpen(true)}>+ Add a player</button>
  return (
    <div className="seat-join seat-gm-form">
      {players === null ? <small className="muted">Loading players…</small> : free.length === 0 ? <small className="muted">Every player is already here (or none have signed up yet).</small> : (
        <>
          <select value={profileId} onChange={(e) => { setArmies(null); setArmyId(''); setProfileId(e.target.value) }} aria-label="Player">
            <option value="">Choose a player…</option>
            {free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {profileId && (armies === null ? <small className="muted">Loading lists…</small> : armies.length === 0 ? <small className="muted">That player has no army lists yet.</small> : (
            <select value={armyId} onChange={(e) => setArmyId(e.target.value)} aria-label="Army list">
              {armies.map((a) => <option key={a.id} value={a.id}>{(a.name || 'Untitled army')} · {a.era.toUpperCase()}</option>)}
            </select>
          ))}
          <div className="seat-sides" role="group" aria-label="Team">
            {TEAMS.map((t) => <button key={t} className={team === t ? 'on' : ''} aria-pressed={team === t} onClick={() => setTeam(t)}>Team {t}</button>)}
          </div>
          <button className="primary" disabled={busy || !profileId || !armyId} onClick={() => void run(async () => { await claims.assign(tableId, profileId, team, armyId); setProfileId(''); setArmyId(''); setArmies(null); setPlayers(null) })}>Add to Team {team}</button>
        </>
      )}
      <button className="ghost" onClick={() => setOpen(false)}>Close</button>
    </div>
  )
}

function SeatRow({ seat, mine, canRead, gm, onView, onRemove, edit }: { seat: Seat; mine: boolean; canRead: boolean; gm: boolean; onView: () => void; onRemove: () => void; edit?: React.ReactNode }) {
  return (
    <li className="seat">
      <div className="seat-who">
        <b>{seat.name}{mine && <em> (you)</em>}</b>
        <small>{seat.missing ? 'List removed' : `${seat.armyName} · ${seat.era.toUpperCase()}${seat.pts !== undefined ? ` · ${seat.pts} pts` : ''}`}{seat.locked ? ' · locked' : ''}</small>
      </div>
      {canRead && !seat.missing && <button className="ghost" onClick={onView}>View list</button>}
      {gm && <button className="ghost" onClick={onRemove} aria-label={`Remove ${seat.name}`}>✕</button>}
      {gm && edit}
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
  const [pickedTeam, setPickedTeam] = useState<Team | null>(null) // the side tapped; until then, the side already held (or A)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = armyId || mine?.armyId || me?.armies[0]?.id || ''
  const chosenTeam = pickedTeam ?? mine?.team ?? 'A'

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

      {role === 'gm' && (
        <div className="seat-result">
          <span>Result</span>
          {TEAMS.map((t) => <button key={t} className={claims.winnerOf(tableId)?.team === t ? 'on' : ''} disabled={busy} onClick={() => void run(() => claims.setWinner(tableId, claims.winnerOf(tableId)?.team === t ? null : t))}>Team {t} won</button>)}
        </div>
      )}
      {claims.winnerOf(tableId) && <p className="seat-won">Team {claims.winnerOf(tableId)?.team} won this battlezone. A void shield is up.</p>}
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
                    edit={<GmSeatEdit seat={s} otherTeam={t === 'A' ? 'B' : 'A'} claims={claims} tableId={tableId} run={run} busy={busy} />}
                  />
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {role === 'gm' && <GmAddPlayer tableId={tableId} claims={claims} seatedIds={seats.map((s) => s.profileId)} run={run} busy={busy} />}

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
            {TEAMS.map((t) => <button key={t} className={chosenTeam === t ? 'on' : ''} aria-pressed={chosenTeam === t} onClick={() => setPickedTeam(t)}>Team {t}</button>)}
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
