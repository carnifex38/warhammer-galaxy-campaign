// Who holds a planet: the team that won more of its battlezones, once every battlezone on it has a winner. A tie is not decided, and a
// planet with any battlezone still undecided is held by nobody. The galaxy map (the rings, the key) and the Territory page both use this.

export type TeamId = 'A' | 'B'

export interface Holder {
  team: TeamId
  /** battlezones the holding team won */
  wins: number
  /** battlezones the other team won */
  against: number
  /** when the last battlezone was decided (the moment the planet became held) */
  at: number
}

/** The holder of a planet with these battlezones, or null. `winnerOf` says who won a battlezone (null while it has no winner). */
export function holderOf(tableIds: string[], winnerOf: (tableId: string) => { team: TeamId; at: number } | null): Holder | null {
  if (tableIds.length === 0) return null
  const won = tableIds.map((id) => winnerOf(id))
  if (won.some((w) => !w)) return null
  const a = won.filter((w) => w?.team === 'A').length
  const b = won.length - a
  if (a === b) return null
  return { team: a > b ? 'A' : 'B', wins: Math.max(a, b), against: Math.min(a, b), at: Math.max(...won.map((w) => w?.at ?? 0)) }
}
