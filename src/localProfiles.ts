import type { Army, Profile, ProfileSummary } from './api'

// DEV-TOOLS: practice profiles kept in this browser only, for the developer gamemaster and dummy player (who have no server
// login). They work with no server at all, so a tester can try the profile screens anywhere. Real profiles live on the server.

const KEY = 'galaxy-dev-profiles'

function read(): Profile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Profile[]
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
function write(list: Profile[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* private mode: the practice profiles just will not be kept */ }
}
const summary = (p: Profile): ProfileSummary => ({ id: p.id, name: p.name, created: p.created, updated: p.updated, armyCount: p.armies.length })

const sampleArmies = (): Army[] => [
  { id: 'd1', name: 'Dummy Ultramarines', era: '40k', notes: ['Practice list.', 'Captain with relic blade', '10 Intercessors', '5 Hellblasters'].join('\n') },
  { id: 'd2', name: 'Dummy Legion Detachment', era: '30k', notes: ['Practice list.', 'Praetor', '20 Tactical Marines', 'Contemptor Dreadnought'].join('\n') },
]

function makeDummy(list: Profile[], id: string): Profile {
  let name = 'Dummy Player'
  for (let n = 2; list.some((p) => p.name.toLowerCase() === name.toLowerCase()); n++) name = `Dummy Player ${n}`
  const now = Date.now()
  return { id, name, created: now, updated: now, armyCount: 2, armies: sampleArmies() }
}

/** The one practice player the developer "Dummy player" role signs in as (made on first use). */
export const DEV_PLAYER_ID = 'dev-player'

export const local = {
  list: async () => read().map(summary).sort((a, b) => a.name.localeCompare(b.name)),
  get: async (id: string): Promise<Profile> => {
    const p = read().find((x) => x.id === id)
    if (!p) throw new Error('No such profile.')
    return p
  },
  save: async (id: string, armies: Army[]): Promise<Profile> => {
    const list = read()
    const p = list.find((x) => x.id === id)
    if (!p) throw new Error('No such profile.')
    p.armies = armies
    p.armyCount = armies.length
    p.updated = Date.now()
    write(list)
    return p
  },
  remove: async (id: string) => write(read().filter((x) => x.id !== id)),
  dummy: async (): Promise<Profile> => {
    const list = read()
    const p = makeDummy(list, `dev-${Math.random().toString(36).slice(2, 8)}`)
    write([...list, p])
    return p
  },
  /** The developer player's own profile, made with sample lists the first time. */
  mine: async (): Promise<Profile> => {
    const list = read()
    const have = list.find((x) => x.id === DEV_PLAYER_ID)
    if (have) return have
    const p = makeDummy(list, DEV_PLAYER_ID)
    write([...list, p])
    return p
  },
}
