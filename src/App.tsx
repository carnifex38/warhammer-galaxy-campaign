import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import LoginScreen from './LoginScreen'
import { preloadGalaxy } from './preloadGalaxy'
import { DevSwitch } from './devTools' // DEV-TOOLS
import { ROLE_LABEL, useAuth, type Role } from './auth'
import { useEventConfig } from './galaxy/eventConfig'
import { useClaims, type Viewing } from './claims'
import { useCalendar } from './calendar'
import { useServerRestarting, useUpdateReady } from './updateReady'
import type { GalaxySelection } from './galaxy/GalaxyView'
import { TeamsProvider, setTeamsNow, teamVars } from './teams'

// the 3D galaxy and the host screen are separate downloads, fetched in the background while the player is on the login screen
const GalaxyView = lazy(() => import('./galaxy/GalaxyView'))
const HostView = lazy(() => import('./galaxy/HostView'))
const ArmyLists = lazy(() => import('./ArmyLists'))
const OptionsView = lazy(() => import('./OptionsView'))
const CalendarView = lazy(() => import('./CalendarView'))
const TerritoryView = lazy(() => import('./TerritoryView'))

type TabId = 'galaxy' | 'territory' | 'lists' | 'calendar' | 'host' | 'options'

const TABS: { id: TabId; label: string; icon: string; roles: Role[]; /** reachable only from elsewhere (no button in the menu) */ hidden?: boolean }[] = [
  { id: 'galaxy', label: 'Galaxy', icon: '✦', roles: ['guest', 'player', 'gm'] },
  { id: 'territory', label: 'Territory', icon: '\u2691', roles: ['guest', 'player', 'gm'], hidden: true },
  { id: 'lists', label: 'Army Lists', icon: '☰', roles: ['player', 'gm'] },
  { id: 'calendar', label: 'Calendar', icon: '\u25a6', roles: ['guest', 'player', 'gm'] },
  { id: 'host', label: 'Host', icon: '\u2699', roles: ['gm'] },
  { id: 'options', label: 'Options', icon: '◐', roles: ['guest', 'player', 'gm'] },
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
  const calendar = useCalendar(auth)
  const updateReady = useUpdateReady()
  const restarting = useServerRestarting()
  // a calendar event to open when the Calendar tab comes up (chosen from a planet's screen in the galaxy)
  const [calendarFocus, setCalendarFocus] = useState<string | null>(null)
  // which team's tab the Territory page opens on (chosen from the key on the galaxy map)
  const [territoryTeam, setTerritoryTeam] = useState<'A' | 'B'>('A')
  // a player's list opened from a battlezone: shown in the Army Lists tab, with a way back to where they were
  const [viewing, setViewing] = useState<Viewing | null>(null)
  const galaxySel = useRef<GalaxySelection | undefined>(undefined)
  const online = useOnline()
  useEffect(() => { preloadGalaxy() }, [])
  const serverUp = events.sync !== 'offline'
  const denied = events.sync === 'denied'

  // the server no longer accepts this gamemaster login (the password was changed): back to the login screen
  useEffect(() => { if (denied) auth.logout() }, [denied])

  setTeamsNow(events.teams) // for the 3D scenes, which cannot read the context

  if (!auth.session) return <LoginScreen auth={auth} />

  // each role sees only its own tabs
  const tabs = TABS.filter((t) => t.roles.includes(auth.session!.role))
  const activeId = tabs.some((t) => t.id === tab) ? tab : 'galaxy'
  const current = tabs.find((t) => t.id === activeId)!

  return (
    <TeamsProvider value={events.teams}>
    <div className="shell" style={teamVars(events.teams)}>
      {updateReady && (
        <div className="update-bar" role="status">
          A new version of the site is ready.
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      )}
      <header className="topbar">
        <h1>Galaxy Campaign</h1>
        <div className="topbar-right">
          <DevSwitch auth={auth} /> {/* DEV-TOOLS */}
          <span className={`userchip role-${auth.session.role}`} title={ROLE_LABEL[auth.session.role]}>
            <b>{auth.session.name}</b>
            <i>{ROLE_LABEL[auth.session.role]}</i>
          </span>
          <button className="ghost logout" onClick={() => { setTab('galaxy'); setViewing(null); galaxySel.current = undefined; auth.logout() }}>Log out</button>
          <span className={`status ${online && serverUp && !restarting ? 'on' : 'off'}`}>{!online ? 'Offline' : restarting ? 'Restarting…' : serverUp ? 'Online' : 'No server'}</span>
        </div>
      </header>

      <nav className="nav" aria-label="Main">
        {tabs.filter((t) => !t.hidden).map((t) => (
          <button
            key={t.id}
            className={t.id === activeId || (activeId === 'territory' && t.id === 'galaxy') ? 'active' : ''}
            aria-current={t.id === activeId ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            <span className="icon" aria-hidden="true">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
        <span className="version" title="The version of the app you are using">Version {__APP_VERSION__}</span>
      </nav>

      {activeId === 'galaxy' ? (
        <main className="content full">
          <Suspense fallback={<div className="galaxy-wait">Opening the galaxy…</div>}>
            <GalaxyView
              events={events}
              auth={auth}
              claims={claims}
              calendar={calendar}
              onOpenEvent={(id) => { setCalendarFocus(id); setTab('calendar') }}
              onOpenHeld={(team) => { setTerritoryTeam(team); setTab('territory') }}
              getInitial={() => galaxySel.current}
              onSelect={(s) => { galaxySel.current = s }}
              onViewList={(v) => { setViewing(v); setTab('lists') }}
            />
          </Suspense>
        </main>
      ) : activeId === 'territory' ? (
        <main className="content">
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <TerritoryView
              events={events}
              claims={claims}
              initialTeam={territoryTeam}
              onBack={() => setTab('galaxy')}
              onOpenPlanet={(sector, planet) => { galaxySel.current = { sector, planet, table: null }; setTab('galaxy') }}
            />
          </Suspense>
        </main>
      ) : activeId === 'calendar' ? (
        <main className="content">
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <CalendarView
              auth={auth}
              calendar={calendar}
              events={events}
              focusId={calendarFocus}
              onFocusUsed={() => setCalendarFocus(null)}
              onOpenPlanet={(sector, planet) => { galaxySel.current = { sector, planet, table: null }; setTab('galaxy') }}
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
      ) : (
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
      )}
    </div>
    </TeamsProvider>
  )
}
