import PlanetEvents from '../PlanetEvents'
import { holderOf } from '../holders'
import type { CalendarApi } from '../calendar'
import { useEffect, useMemo, useRef, useState } from 'react'
import Galaxy3D, { type PlanetInfo } from './Galaxy3D'
import type { Era } from './planetLooks'
import type { EventApi } from './eventConfig'
import type { Sector } from './data'
import { isHulkId, openCount } from './data'
import InfoPanel from './InfoPanel'
import Seats from './Seats'
import type { AuthApi } from '../auth'
import type { ClaimsApi, Viewing } from '../claims'
import { EMPTY_INFO, defaultPlanetInfo, defaultSectorInfo, defaultZoneInfo } from './infoDefaults'

const ERA_KEY = 'galaxy-era'
const ERA_LABEL: Record<Era, string> = { '40k': 'The Dark Imperium', '30k': 'The Horus Heresy' }

function savedEra(): Era {
  try {
    return localStorage.getItem(ERA_KEY) === '30k' ? '30k' : '40k'
  } catch {
    return '40k'
  }
}

/** Dev only: open straight onto a planet with `?planet=Terra` (handy for tuning planet looks). */
function devStart(sectors: Sector[]) {
  if (!import.meta.env.DEV) return null
  const name = new URLSearchParams(location.search).get('planet')?.toLowerCase()
  if (!name) return null
  for (const s of sectors) {
    const p = s.planets.find((q) => q.name.toLowerCase() === name)
    if (p) return { sector: s.id, planet: p.id }
  }
  return null
}

/** Where the player was in the galaxy (kept by the app so it can come back after reading a list). */
export interface GalaxySelection { sector: string | null; planet: string | null; table: string | null }

export default function GalaxyView({ events, auth, claims, calendar, onOpenEvent, onOpenHeld, onViewList, getInitial, onSelect }: {
  events: EventApi
  auth: AuthApi
  claims: ClaimsApi
  calendar: CalendarApi
  /** Open a calendar event (chosen from this planet's planned events). */
  onOpenEvent: (eventId: string) => void
  /** Open the Territory page on a team's tab (from the key on the map). */
  onOpenHeld: (team: 'A' | 'B') => void
  onViewList: (v: Viewing) => void
  getInitial?: () => GalaxySelection | undefined
  onSelect?: (s: GalaxySelection) => void
}) {
  // a planet as the event has it, with each battlezone's real status (open or in play) from the claims
  const viewOf = (p: Sector['planets'][number]) => {
    const v = events.planetView(p)
    return { ...v, tables: v.tables.map((t) => ({ ...t, status: claims.statusOf(t.id) })) }
  }
  // a battlezone is live (explosions on its spot) once it is in play or anyone has taken a seat there
  // the winner of a battlezone: the result the gamemaster declared
  const winnerOf = (id: string) => claims.winnerOf(id)
  const isLive = (t: { id: string; status: string }) => !winnerOf(t.id) && (t.status !== 'open' || claims.seatsOf(t.id).length > 0)
  // players see only what the host shows: hidden planets are gone, locked sectors stay shut
  const SECTORS = events.visibleSectors
  const lockedIds = events.lockedForPlayers
  const isLocked = (id: string) => lockedIds.includes(id)
  const start = devStart(SECTORS)
  const [era, setEraState] = useState<Era>(savedEra)
  // switching era dips the map into darkness, changes underneath, then brings it back, instead of a hard cut
  const [pendingEra, setPendingEra] = useState<Era | null>(null)
  const [fading, setFading] = useState(false)
  const eraTimers = useRef<number[]>([])
  useEffect(() => () => eraTimers.current.forEach((t) => window.clearTimeout(t)), [])
  const applyEra = (e: Era) => {
    setEraState(e)
    try { localStorage.setItem(ERA_KEY, e) } catch { /* private mode: just don't remember it */ }
  }
  const setEra = (e: Era) => {
    if (e === (pendingEra ?? era)) return
    eraTimers.current.forEach((t) => window.clearTimeout(t))
    eraTimers.current = []
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { applyEra(e); return }
    setPendingEra(e)
    setFading(true)
    eraTimers.current.push(
      window.setTimeout(() => { applyEra(e); setPendingEra(null) }, 340), // the change happens while the map is dark
      window.setTimeout(() => setFading(false), 480),
    )
  }
  const shownEra = pendingEra ?? era
  const [initial] = useState(() => getInitial?.())
  const [sectorId, setSectorId] = useState<string | null>(initial?.sector ?? start?.sector ?? null)
  const [planetId, setPlanetId] = useState<string | null>(initial?.planet ?? start?.planet ?? null)
  const [tableId, setTableId] = useState<string | null>(initial?.table ?? null)
  useEffect(() => { onSelect?.({ sector: sectorId, planet: planetId, table: tableId }) }, [sectorId, planetId, tableId]) // eslint-disable-line react-hooks/exhaustive-deps
  // the list row the pointer is over; the matching sector / planet lights up in 3D
  const [hover, setHover] = useState<{ kind: 'sector' | 'planet'; id: string } | null>(null)
  // the battlezone row the pointer is over: a targeting reticle settles on its spot on the planet
  const [hoverZone, setHoverZone] = useState<string | null>(null)

  // on wide screens the information window sits over the left of the map and the view glides to make room
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1000px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1000px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // the information window that is open: a sector or a planet (null = closed)
  const [info, setInfo] = useState<{ kind: 'sector' | 'planet' | 'zone'; id: string } | null>(null)

  const sector = SECTORS.find((s) => s.id === sectorId)
  const planet = sector?.planets.find((p) => p.id === planetId)

  // what the host has set for every planet: in play or restricted, battlezone counts, and whether those are revealed
  const planetInfo = useMemo(() => {
    const out: Record<string, PlanetInfo> = {}
    for (const s of SECTORS) {
      for (const p of s.planets) {
        const v = viewOf(p)
        const zonesHidden = events.infoForPlayer(p.id, EMPTY_INFO).zonesHidden
        // who holds the planet (see holders.ts). A restricted planet, or one whose battlezones are not revealed, shows no holder.
        const holder = v.enabled && !zonesHidden ? holderOf(v.tables.map((t) => t.id), claims.winnerOf)?.team ?? null : null
        out[p.id] = { enabled: v.enabled, open: openCount(v.tables), total: v.tables.length, zonesHidden, holder }
      }
    }
    return out
  }, [SECTORS, events.infoOverrides, events.hostPreview, claims.claims]) // eslint-disable-line react-hooks/exhaustive-deps

  // how many planets each team holds, as seen on the map (a locked sector shows no planets, so it shows no holders either)
  const held = { A: 0, B: 0 }
  for (const s of SECTORS) {
    if (isLocked(s.id)) continue
    for (const p of s.planets) {
      const team = planetInfo[p.id]?.holder
      if (team) held[team]++
    }
  }

  // what is picked has to still be there: a sector the host has locked, or a planet the host has hidden, since it was picked
  useEffect(() => {
    if (sectorId && (!sector || isLocked(sectorId))) { setSectorId(null); setPlanetId(null); setTableId(null) }
    else if (planetId && !planet) { setPlanetId(null); setTableId(null) }
  }, [sector, planet, sectorId, planetId, lockedIds]) // eslint-disable-line react-hooks/exhaustive-deps
  // the battlezone row that was under the pointer is gone once something else is picked: it must not keep a reticle on the planet
  useEffect(() => { setHoverZone(null) }, [sectorId, planetId, tableId])

  const planetClosed = !!planet && !planetInfo[planet.id].enabled
  const planetZonesHidden = !!planet && planetInfo[planet.id].zonesHidden
  // a restricted planet, or one whose battlezones are not revealed, shows no battlezones
  const planetTables = planet && !planetClosed && !planetZonesHidden ? viewOf(planet).tables : []
  const table = planetTables.find((t) => t.id === tableId)
  // battlezones a team has captured get a void shield
  const shieldOn = !!planet
  const shieldZones = shieldOn ? planetTables.filter((t) => winnerOf(t.id)).map((t) => { const w = winnerOf(t.id)!; return { id: t.id, name: t.name, team: w.team, at: w.at } }) : []
  // a team holds a MAJORITY of the planet's battlezones: a shield covers the whole planet (since its Nth capture, N = the majority)
  const majority = (() => {
    // decided only once EVERY battlezone has been picked: until then the planet shield stays neutral. The team with more of them controls
    // the planet (a tie is not decided).
    if (!shieldOn || planetTables.length === 0 || shieldZones.length < planetTables.length) return null
    const a = shieldZones.filter((z) => z.team === 'A')
    const b = shieldZones.filter((z) => z.team === 'B')
    if (a.length === b.length) return null
    const team: 'A' | 'B' = a.length > b.length ? 'A' : 'B'
    return { team, at: Math.max(...shieldZones.map((z) => z.at)), count: Math.max(a.length, b.length) }
  })()
  const heldBy = shieldOn && shieldZones.length === planetTables.length && planetTables.length > 0 && shieldZones.every((z) => z.team === shieldZones[0].team) ? shieldZones[0].team : null
  // the battlezone the reticle points at: the one under the pointer, or (so it also shows on a phone) the one that is open
  const zoneFx = (() => { const z = planetTables.find((t) => t.id === (hoverZone ?? tableId)); return z ? { id: z.id, name: z.name, live: isLive(z) } : null })()

  /** Battlezones counted for a sector: only planets in play whose battlezones the host has revealed. */
  const sectorCounts = (s: Sector) => {
    const live = s.planets.filter((p) => planetInfo[p.id].enabled)
    const open = live.reduce((n, p) => n + (planetInfo[p.id].zonesHidden ? 0 : planetInfo[p.id].open), 0)
    return { live: live.length, open }
  }

  // while the window is open it follows whatever the player navigates to
  const selectTable = (id: string) => { setTableId(id); setInfo((i) => (i ? { kind: 'zone', id } : i)) }
  const clearTable = () => { setTableId(null); setInfo((i) => (i && i.kind === 'zone' ? { kind: 'planet', id: planetId ?? '' } : i)) }
  const goGalaxy = () => { setSectorId(null); setPlanetId(null); setTableId(null); setHover(null); setInfo(null) }
  const goSector = (id: string) => {
    setHover(null)
    // a locked sector cannot be entered: its information window opens and that is all
    if (isLocked(id)) { setInfo({ kind: 'sector', id }); return }
    setSectorId(id); setPlanetId(null); setTableId(null); setInfo((i) => (i ? { kind: 'sector', id } : i))
  }
  const goPlanet = (sid: string, pid: string) => {
    const closed = !planetInfo[pid]?.enabled
    setSectorId(sid); setPlanetId(pid); setTableId(null); setHover(null)
    // a restricted planet can only be read about, so its information opens by itself
    setInfo((i) => (closed || i ? { kind: 'planet', id: pid } : i))
  }

  const hoverProps = (kind: 'sector' | 'planet', id: string) => ({
    onMouseEnter: () => setHover({ kind, id }),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover({ kind, id }),
    onBlur: () => setHover(null),
  })

  const infoSector = info?.kind === 'sector' ? SECTORS.find((s) => s.id === info.id) : undefined
  const infoPlanetSector = info?.kind === 'planet' ? SECTORS.find((s) => s.planets.some((p) => p.id === info.id)) : undefined
  const infoPlanet = infoPlanetSector?.planets.find((p) => p.id === info?.id)
  // a battlezone's window: find the planet that owns it
  let zoneOwner: { sector: typeof SECTORS[number]; planet: typeof SECTORS[number]['planets'][number]; zone: ReturnType<typeof viewOf>['tables'][number] } | undefined
  if (info?.kind === 'zone') {
    for (const s of SECTORS) for (const p of s.planets) {
      const z = viewOf(p).tables.find((t) => t.id === info.id)
      if (z) zoneOwner = { sector: s, planet: p, zone: z }
    }
  }
  let infoPanel: React.ReactNode = null
  if (zoneOwner) {
    const { sector: zs, planet: zp, zone: zz } = zoneOwner
    infoPanel = (
      <InfoPanel
        kind="Battlezone"
        title={zz.name}
        subtitle={`${zp.name} · ${zs.name}`}
        color={zs.color}
        content={events.infoForPlayer(zz.id, defaultZoneInfo(zz.note))}
        status={zz.status === 'open' ? 'Open for battle' : 'Battle in progress'}
        onClose={() => setInfo(null)}
      />
    )
  } else if (infoSector) {
    const { live, open } = sectorCounts(infoSector)
    const locked = isLocked(infoSector.id)
    infoPanel = (
      <InfoPanel
        kind="Sector"
        title={infoSector.name}
        subtitle={locked ? 'Locked' : `${live} planets in play`}
        color={infoSector.color}
        content={events.infoForPlayer(infoSector.id, defaultSectorInfo(infoSector.id))}
        status={locked ? 'Sector locked' : `${open} battlezones open`}
        onClose={() => setInfo(null)}
      />
    )
  } else if (infoPlanet && infoPlanetSector) {
    const pi = planetInfo[infoPlanet.id]
    const isHulk = isHulkId(infoPlanet.id)
    infoPanel = (
      <InfoPanel
        kind={isHulk ? 'Space Hulk' : 'Planet'}
        title={infoPlanet.name}
        subtitle={infoPlanetSector.name}
        color={infoPlanetSector.color}
        content={events.infoForPlayer(infoPlanet.id, defaultPlanetInfo(infoPlanet.name, era, isHulk))}
        status={!pi.enabled ? 'Access restricted' : pi.zonesHidden ? 'Battlezones classified' : `${pi.open} of ${pi.total} battlezones open`}
        onClose={() => setInfo(null)}
      />
    )
  }
  // the ⓘ button on the map shows the deepest thing selected
  const mapInfoTarget = table ? { kind: 'zone' as const, id: table.id } : planet && sector ? { kind: 'planet' as const, id: planet.id } : sector ? { kind: 'sector' as const, id: sector.id } : null
  const mapInfoOn = !!info && !!mapInfoTarget && info.kind === mapInfoTarget.kind && info.id === mapInfoTarget.id
  const toggleInfo = (t: { kind: 'sector' | 'planet' | 'zone'; id: string }) =>
    setInfo((i) => (i && i.kind === t.kind && i.id === t.id ? null : t))

  const back = table ? clearTable : planet ? () => goSector(sector!.id) : goGalaxy

  return (
    <div className={`galaxy${infoPanel ? ' info-open' : ''}`}>
      {infoPanel}
      <Galaxy3D
        sectorId={sectorId}
        planetId={planetId}
        onSelectSector={goSector}
        onSelectPlanet={goPlanet}
        onClear={goGalaxy}
        hoverSectorId={hover?.kind === 'sector' ? hover.id : null}
        hoverPlanetId={hover?.kind === 'planet' ? hover.id : null}
        hoverZone={zoneFx}
        playZones={planetTables.filter(isLive).map((t) => ({ id: t.id, name: t.name }))}
        shieldZones={shieldZones}
        shieldTotal={planetTables.length}
        shieldMajority={majority ? { team: majority.team, active: true } : null} // only once every zone is picked and one team has more
        era={era}
        sectors={SECTORS}
        viewInset={infoPanel && wide ? 380 : 0}
        lockedSectors={lockedIds}
        planetInfo={planetInfo}
      >
        {majority && planet && <div className={`shield-banner team-${majority.team}`}>VOID SHIELD ACTIVE · TEAM {majority.team} {heldBy ? 'HOLDS' : 'CONTROLS'} {planet.name.toUpperCase()}{heldBy ? '' : ` · ${majority.count} OF ${planetTables.length}`}</div>}
        <div className="era-switch" role="group" aria-label="Era">
          <button className={shownEra === '40k' ? 'on' : ''} aria-pressed={shownEra === '40k'} onClick={() => setEra('40k')}>40K</button>
          <button className={shownEra === '30k' ? 'on' : ''} aria-pressed={shownEra === '30k'} onClick={() => setEra('30k')}>30K</button>
          <span className="era-caption">{ERA_LABEL[shownEra]}</span>
        </div>
        <div className={`era-fade${fading ? ' on' : ''}`} aria-hidden="true" />
        {(held.A > 0 || held.B > 0) && (
          <div className="holder-key" role="group" aria-label="Planets held">
            <button className="holder-row a" onClick={() => onOpenHeld('A')}><i aria-hidden="true" />Team A holds {held.A}</button>
            <button className="holder-row b" onClick={() => onOpenHeld('B')}><i aria-hidden="true" />Team B holds {held.B}</button>
          </div>
        )}
        {events.hostPreview && (
          <div className="preview-banner" role="status">
            <span>Host preview: you can see everything</span>
            <button onClick={() => events.setHostPreview(false)}>Exit</button>
          </div>
        )}
        {mapInfoTarget && (
          <button
            className={`info-btn map-info-btn${mapInfoOn ? ' on' : ''}`}
            onClick={() => toggleInfo(mapInfoTarget)}
            aria-label={mapInfoOn ? 'Close information' : 'Show information'}
            aria-pressed={mapInfoOn}
          >i</button>
        )}
      </Galaxy3D>

      <aside className="sheet">
        <div className="crumbs">
          {sector && (
            <button className="back" onClick={back} aria-label="Back">‹</button>
          )}
          <button onClick={goGalaxy} className={!sector ? 'here' : ''}>Galaxy</button>
          {sector && <><span>›</span><button onClick={() => goSector(sector.id)} className={!planet ? 'here' : ''}>{sector.name.replace('Segmentum ', '')}</button></>}
          {planet && <><span>›</span><button onClick={clearTable} className={!table ? 'here' : ''}>{planet.name}</button></>}
          {table && <><span>›</span><span className="here">{table.name}</span></>}
        </div>

        <div className="sheet-body">
          {!sector && (
            <>
              <p className="hint">Tap a sector on the map, or pick one here.</p>
              <ul className="list">
                {SECTORS.map((s) => {
                  const { live, open } = sectorCounts(s)
                  const locked = isLocked(s.id)
                  return (
                    <li key={s.id} className="with-info">
                      <button onClick={() => goSector(s.id)} {...hoverProps('sector', s.id)}>
                        <span>{s.name}</span>
                        <small>{locked ? 'Locked · access restricted' : `${live} planets in play · ${open} battlezones open`}</small>
                      </button>
                      <button
                        className={`info-btn${info?.kind === 'sector' && info.id === s.id ? ' on' : ''}`}
                        onClick={() => toggleInfo({ kind: 'sector', id: s.id })}
                        aria-label={`${s.name} information`}
                      >i</button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {sector && !planet && (
            <>
              <p className="hint">Choose a planet.</p>
              <ul className="list">
                {sector.planets.map((p) => {
                  const pinfo = planetInfo[p.id]
                  return (
                    <li key={p.id} className="with-info">
                      <button
                        onClick={() => goPlanet(sector.id, p.id)}
                        className={pinfo.enabled ? '' : 'closed'}
                        {...hoverProps('planet', p.id)}
                      >
                        <span>{isHulkId(p.id) ? 'Space Hulk · ' : ''}{p.name}{p.forge ? ' ⚙' : ''}</span>
                        <small>{!pinfo.enabled ? 'Access restricted' : pinfo.zonesHidden ? 'Battlezones classified' : `${pinfo.open} of ${pinfo.total} battlezones open`}</small>
                      </button>
                      <button
                        className={`info-btn${info?.kind === 'planet' && info.id === p.id ? ' on' : ''}`}
                        onClick={() => toggleInfo({ kind: 'planet', id: p.id })}
                        aria-label={`${p.name} information`}
                      >i</button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {planet && planetClosed && (
            <p className="hint">Access to {planet.name} is restricted. Please scout or obtain intel records.</p>
          )}

          {planet && !planetClosed && planetZonesHidden && (
            <p className="hint">The event host has not yet revealed the battlezones on {planet.name}.</p>
          )}

          {planet && !planetClosed && !planetZonesHidden && !table && (
            <>
              <p className="hint">Choose a battlezone on {planet.name}.</p>
              {auth.session?.role === 'gm' && claims.resultCount(planetTables.map((t) => t.id)) > 0 && (
                <button className="ghost clear-results" onClick={() => void claims.clearResults(planetTables.map((t) => t.id))}>Clear results on {planet.name}</button>
              )}
              <ul className="list">
                {planetTables.map((t) => (
                  <li key={t.id} className="with-info">
                    <button
                      onClick={() => selectTable(t.id)}
                      onMouseEnter={() => setHoverZone(t.id)}
                      onMouseLeave={() => setHoverZone(null)}
                      onFocus={() => setHoverZone(t.id)}
                      onBlur={() => setHoverZone(null)}
                    >
                      <span>{t.name} {winnerOf(t.id) ? <em className={`badge won team-${winnerOf(t.id)!.team}`}>Team {winnerOf(t.id)!.team} won</em> : <em className={`badge ${t.status}`}>{t.status === 'open' ? 'Open' : 'In play'}</em>}</span>
                      <small>{t.note}</small>
                    </button>
                    <button
                      className={`info-btn${info?.kind === 'zone' && info.id === t.id ? ' on' : ''}`}
                      onClick={() => toggleInfo({ kind: 'zone', id: t.id })}
                      aria-label={`${t.name} information`}
                    >i</button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {planet && !table && <PlanetEvents events={calendar.events} planetId={planet.id} myId={calendar.myId} onOpen={onOpenEvent} />}

          {table && planet && (
            <div className="table-detail">
              <h3>{planet.name} · {table.name}</h3>
              {winnerOf(table.id) ? <span className={`badge won team-${winnerOf(table.id)!.team}`}>Team {winnerOf(table.id)!.team} won</span> : <span className={`badge ${table.status}`}>{table.status === 'open' ? 'Open' : 'In play'}</span>}
              <div className="layout-placeholder">Battlezone layout image goes here</div>
              <p className="muted">{table.note}</p>
              <Seats tableId={table.id} where={`${planet.name} · ${table.name}`} auth={auth} claims={claims} onView={onViewList} />
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
