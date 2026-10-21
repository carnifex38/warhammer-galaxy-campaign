import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Unauthorized, createDummyProfile, deleteMyProfile, deleteProfile, getMyProfile, getProfile, listProfiles, saveMyProfile, saveProfile, type Army, type Profile, type ProfileSummary } from './api'
import type { AuthApi } from './auth'
import { DEV_PLAYER_ID, local } from './localProfiles' // DEV-TOOLS
import type { StoredRoster } from './builder/ArmyBuilder'
import type { ClaimsApi, SeatList, Viewing } from './claims'

// the army builder (and the rules data it reads) only downloads when someone opens it
const ArmyBuilder = lazy(() => import('./builder/ArmyBuilder'))

// The Army Lists tab. A player sees and edits the army lists on their own profile. The gamemaster sees every profile in a
// list, can open any of them to read or edit its lists, can delete a profile, and can also have a profile of their own.
// (The lists are a name, an era and notes for now; the army builder will grow out of this.)

/** Where the profiles are kept: on the server, or in this browser for the developer roles (DEV-TOOLS). */
interface Backend {
  list: () => Promise<ProfileSummary[]>
  get: (id: string) => Promise<Profile>
  save: (id: string, armies: Army[]) => Promise<Profile>
  remove: (id: string) => Promise<void>
  dummy: () => Promise<Profile>
}
const serverBackend = (token: string): Backend => ({
  list: () => listProfiles(token),
  get: (id) => getProfile(token, id),
  save: (id, armies) => saveProfile(token, id, armies),
  remove: async (id) => { await deleteProfile(token, id) },
  dummy: () => createDummyProfile(token),
})

const newId = () => Math.random().toString(36).slice(2, 10)
const when = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** One army list: folded to its name, era and points; opens to show what is in it; changed only after pressing Edit. */
function ArmyCard({ a, open, editing, onToggle, onEdit, onChange, onRemove }: {
  a: Army
  open: boolean
  editing: boolean
  onToggle: () => void
  onEdit: (on: boolean) => void
  onChange: (patch: Partial<Army>) => void
  onRemove: () => void
}) {
  const stored = a.roster as StoredRoster | undefined
  const pts = stored?.pts
  return (
    <div className={`army-card${open ? ' open' : ''}`}>
      <button className="army-head" onClick={onToggle} aria-expanded={open}>
        <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <b>{a.name.trim() || 'Untitled army'}</b>
        <span className="era-chip">{a.era.toUpperCase()}</span>
        <span className="army-pts">{pts !== undefined ? `${pts} pts` : '—'}</span>
      </button>
      {open && (
        <div className="army-body">
          {editing && (
            <div className="army-row">
              <input value={a.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} placeholder="Army name" aria-label="Army name" />
              <select value={a.era} onChange={(e) => onChange({ era: e.target.value as Army['era'] })} aria-label="Era">
                <option value="40k">40K</option>
                <option value="30k">30K</option>
              </select>
              <button className="ghost" onClick={onRemove} aria-label={`Remove ${a.name || 'army'}`}>Remove</button>
            </div>
          )}
          {editing
            ? <textarea value={a.notes} maxLength={4000} rows={3} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Notes, ideas for this army…" aria-label="Army notes" />
            : a.notes.trim() && <p className="army-notes">{a.notes}</p>}
          {a.era === '30k' ? (
            <Suspense fallback={<p className="muted">Opening the list…</p>}>
              <ArmyBuilder stored={stored} name={a.name} editing={editing} onChange={(r) => { if (editing) onChange({ roster: r }) }} />
            </Suspense>
          ) : (
            <p className="muted army-build-note">The army builder for 40K is coming. For now, use the notes.</p>
          )}
          <div className="army-foot">
            {editing
              ? <button className="primary" onClick={() => onEdit(false)}>Done</button>
              : <button className="ghost" onClick={() => onEdit(true)}>Edit</button>}
          </div>
        </div>
      )}
    </div>
  )
}

/** The lists of one profile, with save and delete. Used for the player's own profile and for any profile the gamemaster opens. */
function ProfileEditor({ profile, who, onSave, onDelete }: {
  profile: Profile
  who: 'own' | 'gm'
  onSave: (armies: Army[]) => Promise<Profile>
  onDelete: () => Promise<void>
}) {
  const [armies, setArmies] = useState<Army[]>(profile.armies)
  const [saved, setSaved] = useState<Army[]>(profile.armies)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [openIds, setOpenIds] = useState<string[]>([]) // lists are folded away until opened
  const [editIds, setEditIds] = useState<string[]>([]) // and can only be changed after pressing Edit
  const dirty = JSON.stringify(armies) !== JSON.stringify(saved)

  const edit = (id: string, patch: Partial<Army>) => { setArmies((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x))); setError('') }
  const run = async (job: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await job() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) }
  }
  const save = () => run(async () => { const p = await onSave(armies); setSaved(p.armies); setArmies(p.armies) })
  const remove = () => {
    const warn = who === 'own' ? 'Delete your profile and all of its army lists? This cannot be undone.' : `Delete the profile "${profile.name}" and all of its army lists? This cannot be undone.`
    if (window.confirm(warn)) void run(onDelete)
  }

  return (
    <section className="prof">
      <header className="prof-head">
        <div>
          <h3>{profile.name}</h3>
          <p className="muted">Created {when(profile.created)} · changed {when(profile.updated)}</p>
        </div>
        <button className="danger" onClick={remove} disabled={busy}>Delete profile</button>
      </header>

      {armies.length === 0 && <p className="muted">No army lists yet.</p>}
      {armies.map((a) => (
        <ArmyCard
          key={a.id}
          a={a}
          open={openIds.includes(a.id)}
          editing={editIds.includes(a.id)}
          onToggle={() => setOpenIds((l) => (l.includes(a.id) ? l.filter((x) => x !== a.id) : [...l, a.id]))}
          onEdit={(on) => { setEditIds((l) => (on ? [...l, a.id] : l.filter((x) => x !== a.id))); if (on) setOpenIds((l) => (l.includes(a.id) ? l : [...l, a.id])) }}
          onChange={(patch) => edit(a.id, patch)}
          onRemove={() => setArmies((l) => l.filter((x) => x.id !== a.id))}
        />
      ))}

      <div className="prof-actions">
        <button className="ghost" onClick={() => { const id = newId(); setArmies((l) => [...l, { id, name: '', era: '40k', notes: '' }]); setOpenIds((l) => [...l, id]); setEditIds((l) => [...l, id]) }} disabled={armies.length >= 60}>+ Add army</button>
        <span className="spacer" />
        {dirty && <button className="ghost" onClick={() => { setArmies(saved); setError('') }} disabled={busy}>Undo changes</button>}
        <button className="primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
      </div>
      {error && <p className="login-error" role="alert">{error}</p>}
    </section>
  )
}

/** A player's own profile. */
function MyProfile({ auth, token }: { auth: AuthApi; token: string }) {
  const dev = !!auth.session?.dev // DEV-TOOLS: the developer player keeps a practice profile in this browser
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    ;(dev ? local.mine() : getMyProfile(token)).then((p) => { if (live) setProfile(p) }).catch((e) => {
      if (!live) return
      if (e instanceof Unauthorized) auth.dropProfile() // the profile is gone (deleted by the gamemaster) or its password changed
      else setError(e instanceof Error ? e.message : 'Could not load your profile.')
    })
    return () => { live = false }
  }, [token, dev]) // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="login-error" role="alert">{error}</p>
  if (!profile) return <p className="muted">Loading your profile…</p>
  return (
    <ProfileEditor
      profile={profile}
      who="own"
      onSave={(armies) => (dev ? local.save(DEV_PLAYER_ID, armies) : saveMyProfile(token, armies))}
      onDelete={async () => { if (dev) await local.remove(DEV_PLAYER_ID); else await deleteMyProfile(token); auth.logout() }}
    />
  )
}

/** The gamemaster's small form to sign in to, or make, a profile of their own. */
function OwnProfileForm({ auth, onLinked }: { auth: AuthApi; onLinked: () => void }) {
  const [create, setCreate] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try { await auth.linkGmProfile(name, password, create); onLinked() } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); setPassword('') } finally { setBusy(false) }
  }
  return (
    <form className="own-form" onSubmit={submit}>
      <h4>Playing too? Your own profile</h4>
      <div className="login-mode" role="group" aria-label="Profile">
        <button type="button" className={!create ? 'on' : ''} aria-pressed={!create} onClick={() => { setCreate(false); setError('') }}>Sign in</button>
        <button type="button" className={create ? 'on' : ''} aria-pressed={create} onClick={() => { setCreate(true); setError('') }}>New profile</button>
      </div>
      <input value={name} maxLength={24} onChange={(e) => { setName(e.target.value); setError('') }} placeholder="Profile name" aria-label="Profile name" autoComplete="username" />
      <input type="password" value={password} maxLength={64} onChange={(e) => { setPassword(e.target.value); setError('') }} placeholder="Password" aria-label="Password" autoComplete={create ? 'new-password' : 'current-password'} />
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy || !name.trim() || !password}>{create ? 'Create profile' : 'Sign in'}</button>
    </form>
  )
}

/** One profile in the gamemaster's list: a slim row that opens (and loads its army lists) when clicked. */
function ProfileRow({ summary, backend, mine, open, onToggle, onChanged }: {
  summary: ProfileSummary
  backend: Backend
  mine: boolean
  open: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let live = true
    setError('')
    backend.get(summary.id).then((p) => { if (live) setProfile(p) }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not open that profile.') })
    return () => { live = false }
  }, [open, summary.id, backend])

  return (
    <li className={`profile-row${open ? ' open' : ''}`}>
      <button className="profile-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <b>{summary.name}{mine && <em> (you)</em>}</b>
        <span className="profile-row-meta">{summary.armyCount} {summary.armyCount === 1 ? 'army' : 'armies'} · {when(summary.updated)}</span>
      </button>
      {open && (
        <div className="profile-row-body">
          {error && <p className="login-error" role="alert">{error}</p>}
          {!profile && !error && <p className="muted">Opening…</p>}
          {profile && (
            <ProfileEditor
              profile={profile}
              who="gm"
              onSave={async (armies) => { const p = await backend.save(profile.id, armies); onChanged(); return p }}
              onDelete={async () => { await backend.remove(profile.id); onChanged() }}
            />
          )}
        </div>
      )}
    </li>
  )
}

/**
 * The gamemaster's view: every profile as a row that expands in place, with a search for when there are many.
 * `token` is the gamemaster's server token; without one (the developer gamemaster) the practice profiles in this browser are used.
 */
function AllProfiles({ auth, token }: { auth: AuthApi; token: string | null }) {
  const backend = useMemo(() => (token ? serverBackend(token) : local), [token])
  const [list, setList] = useState<ProfileSummary[] | null>(null)
  const [error, setError] = useState('')
  const [openIds, setOpenIds] = useState<string[]>([])
  const [mineId, setMineId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const myToken = auth.session?.profileToken
  const own = !auth.session?.dev // DEV-TOOLS: the developer gamemaster has no server login, so no profile of their own to link

  const refresh = useCallback(() => {
    backend.list().then((l) => { setList(l); setError(''); setOpenIds((ids) => ids.filter((id) => l.some((p) => p.id === id))) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load the profiles.'))
  }, [backend])
  useEffect(refresh, [refresh])

  // which profile (if any) is the gamemaster's own
  useEffect(() => {
    if (!myToken) { setMineId(null); return }
    getMyProfile(myToken).then((p) => setMineId(p.id)).catch((e) => { if (e instanceof Unauthorized) auth.dropProfile() })
  }, [myToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setOpenIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  const addDummy = () => {
    backend.dummy().then((p) => { refresh(); setOpenIds((ids) => [...ids, p.id]) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not add the dummy player.'))
  }

  const shown = (list ?? []).filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="army-all">
      <div className="army-bar">
        <h3>Profiles{list ? ` (${list.length})` : ''}</h3>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search names" aria-label="Search profiles" />
        <button className="ghost" onClick={() => setOpenIds([])} disabled={openIds.length === 0}>Collapse all</button>
        <button className="ghost" onClick={refresh}>Refresh</button>
        <button className="ghost" onClick={addDummy} title="Adds a practice player with sample army lists. Its password is: dummy">+ Add dummy player</button>
      </div>
      {error && <p className="login-error" role="alert">{error}</p>}
      {!list && !error && <p className="muted">Loading…</p>}
      {list && shown.length === 0 && <p className="muted">{list.length === 0 ? 'No profiles yet. Players make them when they sign up.' : 'No match.'}</p>}
      <ul className="profile-rows">
        {shown.map((p) => (
          <ProfileRow key={p.id} summary={p} backend={backend} mine={p.id === mineId} open={openIds.includes(p.id)} onToggle={() => toggle(p.id)} onChanged={refresh} />
        ))}
      </ul>
      {!own ? null : myToken ? (
        <p className="muted own-note">
          You are signed in to your own profile.
          {mineId && <> <button className="link" onClick={() => setOpenIds((ids) => (ids.includes(mineId) ? ids : [...ids, mineId]))}>Open it</button> ·</>} <button className="link" onClick={auth.dropProfile}>Sign out of it</button>
        </p>
      ) : (
        <OwnProfileForm auth={auth} onLinked={refresh} />
      )}
    </div>
  )
}

/** A list opened from a battlezone: read-only, with a way back to where the player was. */
function ViewedList({ v, claims, onClose, onBack }: { v: Viewing; claims: ClaimsApi; onClose: () => void; onBack: () => void }) {
  const [list, setList] = useState<SeatList | null>(null)
  const [error, setError] = useState('')
  // load again whenever the seat changes (the player edits a live list, or the gamemaster locks or reopens the battlezone)
  const seat = claims.seatsOf(v.tableId).find((x) => x.profileId === v.profileId)
  const key = `${claims.statusOf(v.tableId)}|${seat?.armyId}|${seat?.armyName}|${seat?.pts}|${seat?.team}|${seat ? 1 : 0}`
  useEffect(() => {
    let live = true
    claims.loadList(v.tableId, v.profileId).then((l) => { if (live) { setList(l); setError('') } }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not open that list.') })
    return () => { live = false }
  }, [v.tableId, v.profileId, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const stored = list?.roster as StoredRoster | null | undefined
  return (
    <section className="viewed">
      <header className="viewed-head">
        <div>
          <h3>{list?.name?.trim() || 'Army list'}</h3>
          <p className="muted">{v.player} · Team {list?.team ?? v.team} · {v.where}{list ? (list.locked ? ' · locked: the battlezone is in play' : ' · live: updates until the battlezone is in play') : ''}</p>
        </div>
        <div className="viewed-actions">
          <button className="primary" onClick={onBack}>Back to the battlezone</button>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </header>
      {error && <p className="login-error" role="alert">{error}</p>}
      {!list && !error && <p className="muted">Opening the list…</p>}
      {list && (
        <>
          {list.notes.trim() && <p className="army-notes">{list.notes}</p>}
          {list.era === '30k' && stored
            ? <Suspense fallback={<p className="muted">Opening the list…</p>}><ArmyBuilder stored={stored} name={list.name} editing={false} onChange={() => undefined} /></Suspense>
            : !list.notes.trim() && <p className="muted">This list has no units written down.</p>}
        </>
      )}
    </section>
  )
}

export default function ArmyLists({ auth, claims, viewing, onCloseViewing, onBackToZone }: {
  auth: AuthApi
  claims: ClaimsApi
  viewing: Viewing | null
  onCloseViewing: () => void
  onBackToZone: () => void
}) {
  const s = auth.session
  if (!s) return null
  const viewed = viewing && <ViewedList key={`${viewing.tableId}/${viewing.profileId}`} v={viewing} claims={claims} onClose={onCloseViewing} onBack={onBackToZone} />
  if (s.role === 'gm') {
    if (s.dev) return <>{viewed}<AllProfiles auth={auth} token={null} /></> // DEV-TOOLS: practice profiles in this browser
    if (!s.token) return <p className="muted">Sign in as gamemaster to see the profiles.</p>
    return <>{viewed}<AllProfiles auth={auth} token={s.token} /></>
  }
  if (s.dev) return <>{viewed}<MyProfile auth={auth} token="" /></> // DEV-TOOLS
  if (s.profileToken) return <>{viewed}<MyProfile auth={auth} token={s.profileToken} /></>
  return (
    <>
      {viewed}
      <section className="prof">
        <h3>No profile yet</h3>
        <p className="muted">Army lists live on a profile. Log out, choose Player, and make a new profile with a name and a password. No email is needed.</p>
      </section>
    </>
  )
}
