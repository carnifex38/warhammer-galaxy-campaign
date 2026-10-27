import { useMemo, useState } from 'react'
import type { ClaimsApi } from './claims'
import { holderOf, type Holder, type TeamId } from './holders'
import Portrait from './Portrait'
import { isHulkId, type Planet, type Sector } from './galaxy/data'
import type { EventApi } from './galaxy/eventConfig'
import { EMPTY_INFO } from './galaxy/infoDefaults'
import type { Era } from './galaxy/planetLooks'
import { useTeams } from './teams'

// The Territory page: the planets each team holds, one team at a time (tabs). Opened from the key on the galaxy map, or from the menu.
// Tapping a planet takes the player to it in the galaxy.

const ERA_KEY = 'galaxy-era'
function currentEra(): Era {
  try { return localStorage.getItem(ERA_KEY) === '30k' ? '30k' : '40k' } catch { return '40k' }
}

interface Row extends Holder { planet: Planet; sector: Sector; total: number }

export default function TerritoryView({ events, claims, initialTeam, onBack, onOpenPlanet }: {
  events: EventApi
  claims: ClaimsApi
  initialTeam: TeamId
  onBack: () => void
  onOpenPlanet: (sectorId: string, planetId: string) => void
}) {
  const [team, setTeam] = useState<TeamId>(initialTeam)
  const [era] = useState(currentEra)
  const teams = useTeams()

  // as on the map: a locked sector, a restricted planet, or one whose battlezones are not revealed, shows no holder
  const lists = useMemo(() => {
    const out: Record<TeamId, Row[]> = { A: [], B: [] }
    for (const sector of events.visibleSectors) {
      if (events.lockedForPlayers.includes(sector.id)) continue
      for (const planet of sector.planets) {
        const v = events.planetView(planet)
        if (!v.enabled || v.tables.length === 0 || events.infoForPlayer(planet.id, EMPTY_INFO).zonesHidden) continue
        const holder = holderOf(v.tables.map((t) => t.id), claims.winnerOf)
        if (holder) out[holder.team].push({ ...holder, planet, sector, total: v.tables.length })
      }
    }
    for (const t of ['A', 'B'] as const) out[t].sort((x, y) => x.planet.name.localeCompare(y.planet.name))
    return out
  }, [events.visibleSectors, events.lockedForPlayers, events.infoOverrides, events.hostPreview, claims.claims]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = lists[team]
  const plural = (n: number) => `${n} planet${n === 1 ? '' : 's'}`

  return (
    <div className="terr">
      <button className="ghost" onClick={onBack}>‹ Back to the galaxy</button>
      <h2>Territory</h2>
      <p className="muted terr-note">A team holds a planet once every battlezone on it has a winner and the team won more of them than the other team.</p>

      <div className="terr-tabs" role="tablist" aria-label="Team">
        {(['A', 'B'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={team === t} className={`terr-tab ${t === 'A' ? 'a' : 'b'}${team === t ? ' on' : ''}`} onClick={() => setTeam(t)}>
            <i aria-hidden="true" />
            <span><strong>{teams[t].name}</strong><em>{plural(lists[t].length)}</em></span>
          </button>
        ))}
      </div>

      <ul className="cal-planets terr-list" role="tabpanel">
        {rows.length === 0 && <li className="terr-none muted">{teams[team].name} does not hold any planets yet.</li>}
        {rows.map(({ planet, sector, wins, against, total, at }) => (
          <li key={planet.id}>
            <button className="cal-planet" onClick={() => onOpenPlanet(sector.id, planet.id)} aria-label={`Open ${planet.name} in the galaxy`}>
              <Portrait planet={planet} era={era} />
              <span className="cal-planet-text">
                <strong>{isHulkId(planet.id) ? 'Space Hulk · ' : ''}{planet.name}{planet.forge ? ' ⚙' : ''}</strong>
                <span className="cal-sector" style={{ ['--c' as string]: sector.color }}><i aria-hidden="true" />{sector.name}</span>
                <span className="cal-count">
                  Won {wins} of {total} battlezones{against ? ` (${against} lost)` : ''}
                  {at > 1e11 ? ` · since ${new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
                </span>
              </span>
              <span className="cal-go" aria-hidden="true">View ›</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
