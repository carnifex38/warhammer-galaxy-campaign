import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import LoginScreen from './LoginScreen'
import { preloadGalaxy } from './preloadGalaxy'
import { DevSwitch } from './devTools' // DEV-TOOLS
import { ROLE_LABEL, useAuth, type Role } from './auth'
import { useEventConfig } from './galaxy/eventConfig'
import { useClaims, type Viewing } from './claims'
import type { GalaxySelection } from './galaxy/GalaxyView'

// the 3D galaxy and the host screen are separate downloads, fetched in the background while the player is on the login screen
const GalaxyView = lazy(() => import('./galaxy/GalaxyView'))
const HostView = lazy(() => import('./galaxy/HostView'))
const ArmyLists = lazy(() => import('./ArmyLists'))
const OptionsView = lazy(() => import('./OptionsView'))

type TabId = 'galaxy' | 'lists' | 'event' | 'host' | 'options'

const TABS: { id: TabId; label: string; icon: string; blurb: string; roles: Role[] }[] = [
  { id: 'galaxy', label: 'Galaxy', icon: '✦', blurb: 'Interactive galaxy map: sectors, planets and battlezones.', roles: ['guest', 'player', 'gm'] },
  { id: 'lists', label: 'Army Lists', icon: '☰', blurb: 'Build and view 40k and 30k armies.', roles: ['player', 'gm'] },
  { id: 'event', label: 'Event', icon: '\u2691', blurb: 'Join an event and see your battlezone assignment.', roles: ['player', 'gm'] },
  { id: 'host', label: 'Host', icon: '\u2699', blurb: 'Set up the event.', roles: ['gm'] },
  { id: 'options', label: 'Options', icon: '◐', blurb: 'Graphics, UI and display settings.', roles: ['guest', 'player', 'gm'] },
]

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

export default function App() {
  const auth = useAuth()
  const role = auth.session?.role
  const [tab, setTab] = useState<TabId>('galaxy')
  const events = useEventConfig(role === 'gm', auth.session?.token)
  const claims = useClaims(auth)
  // a player's list opened from a battlezone: shown in the Army Lists tab, with a way back to where they were
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const galaxySel = useRef<GalaxySelection | undefined>(undefined)
  const online = useOnline()
  useEffect(() => { preloadGalaxy() }, [])
  const serverUp = events.sync !== 'offline'
  const denied = events.sync === 'denied'

  // the server no longer accepts this gamemaster login (the password was changed): back to the login screen
  useEffect(() => { if (denied) auth.logout() }, [denied])

  if (!auth.session) return <LoginScreen auth={auth} />

  // each role sees only its own tabs
  const tabs = TABS.filter((t) => t.roles.includes(auth.session!.role))
  const activeId = tabs.some((t) => t.id === tab) ? tab : 'galaxy'
  const current = tabs.find((t) => t.id === activeId)!

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Galaxy Campaign</h1>
        <div className="topbar-right">
          <DevSwitch auth={auth} /> {/* DEV-TOOLS */}
          <span className={`userchip role-${auth.session.role}`} title={ROLE_LABEL[auth.session.role]}>
            <b>{auth.session.name}</b>
            <i>{ROLE_LABEL[auth.session.role]}</i>
          </span>
          <button className="ghost logout" onClick={() => { setTab('galaxy'); setViewing(null); galaxySel.current = undefined; auth.logout() }}>Log out</button>
          <span className={`status ${online && serverUp ? 'on' : 'off'}`}>{!online ? 'Offline' : serverUp ? 'Online' : 'No server'}</span>
        </div>
      </header>

      <nav className="nav" aria-label="Main">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={t.id === activeId ? 'active' : ''}
            aria-current={t.id === activeId ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            <span className="icon" aria-hidden="true">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {activeId === 'galaxy' ? (
        <main className="content full">
          <Suspense fallback={<div className="galaxy-wait">Opening the galaxy…</div>}>
            <GalaxyView
              events={events}
              auth={auth}
              claims={claims}
              getInitial={() => galaxySel.current}
              onSelect={(s) => { galaxySel.current = s }}
              onViewList={(v) => { setViewing(v); setTab('lists') }}
            />
          </Suspense>
        </main>
      ) : activeId === 'host' ? (
        <main className="content">
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <HostView events={events} claims={claims} />
          </Suspense>
        </main>
      ) : activeId === 'options' ? (
        <main className="content">
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <OptionsView />
          </Suspense>
        </main>
      ) : activeId === 'lists' ? (
        <main className="content">
          <h2>{current.label}</h2>
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <ArmyLists
              auth={auth}
              claims={claims}
              viewing={viewing}
              onCloseViewing={() => setViewing(null)}
              onBackToZone={() => { setViewing(null); setTab('galaxy') }}
            />
          </Suspense>
        </main>
      ) : (
        <main className="content">
          <h2>{current.label}</h2>
          <p>{current.blurb}</p>
          <p className="muted">Coming soon.</p>
        </main>
      )}
    </div>
  )
}
