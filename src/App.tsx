import { Suspense, lazy, useEffect, useState } from 'react'
import LoginScreen from './LoginScreen'
import { preloadGalaxy } from './preloadGalaxy'
import { ROLE_LABEL, useAuth, type Role } from './auth'
import { useEventConfig } from './galaxy/eventConfig'

// the 3D galaxy and the host screen are separate downloads, fetched in the background while the player is on the login screen
const GalaxyView = lazy(() => import('./galaxy/GalaxyView'))
const HostView = lazy(() => import('./galaxy/HostView'))

type TabId = 'galaxy' | 'lists' | 'event' | 'host'

const TABS: { id: TabId; label: string; icon: string; blurb: string; roles: Role[] }[] = [
  { id: 'galaxy', label: 'Galaxy', icon: '✦', blurb: 'Interactive galaxy map: sectors, planets and battlezones.', roles: ['guest', 'player', 'gm'] },
  { id: 'lists', label: 'Army Lists', icon: '☰', blurb: 'Build and view 40k and 30k armies.', roles: ['player', 'gm'] },
  { id: 'event', label: 'Event', icon: '\u2691', blurb: 'Join an event and see your battlezone assignment.', roles: ['player', 'gm'] },
  { id: 'host', label: 'Host', icon: '\u2699', blurb: 'Set up the event.', roles: ['gm'] },
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
          <span className={`userchip role-${auth.session.role}`} title={ROLE_LABEL[auth.session.role]}>
            <b>{auth.session.name}</b>
            <i>{ROLE_LABEL[auth.session.role]}</i>
          </span>
          <button className="ghost logout" onClick={() => { setTab('galaxy'); auth.logout() }}>Log out</button>
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
            <GalaxyView events={events} canClaim={auth.session.role !== 'guest'} />
          </Suspense>
        </main>
      ) : activeId === 'host' ? (
        <main className="content">
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <HostView events={events} />
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
