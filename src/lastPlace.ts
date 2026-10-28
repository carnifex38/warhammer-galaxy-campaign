import type { Viewing } from './claims'
import type { GalaxySelection } from './galaxy/GalaxyView'

// Where the player was: which screen, what was picked on the galaxy map, and so on. A reload (theirs, or the automatic one after a
// deploy, see updateReady.ts) puts them back there instead of on the galaxy map. Kept in sessionStorage: each browser tab has its
// own, it survives reloads, and it ends with the tab.

export interface Place {
  tab: string
  galaxy?: GalaxySelection
  territoryTeam?: 'A' | 'B'
  viewing?: Viewing | null
}

const KEY = 'galaxy-place'
const idOrNull = (v: unknown) => (typeof v === 'string' && v.length <= 80 ? v : null)

/** The place saved in this tab, or the galaxy map when there is none (or it cannot be read). */
export function loadPlace(): Place {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Partial<Place> | null
    if (!p || typeof p.tab !== 'string') return { tab: 'galaxy' }
    const g = p.galaxy
    const v = p.viewing
    return {
      tab: p.tab,
      galaxy: g ? { sector: idOrNull(g.sector), planet: idOrNull(g.planet), table: idOrNull(g.table) } : undefined,
      territoryTeam: p.territoryTeam === 'B' ? 'B' : 'A',
      viewing: v && typeof v.tableId === 'string' && typeof v.profileId === 'string' ? v : null,
    }
  } catch {
    return { tab: 'galaxy' }
  }
}

export function savePlace(p: Place) {
  try { sessionStorage.setItem(KEY, JSON.stringify(p)) } catch { /* storage blocked: a reload starts on the galaxy map */ }
}
