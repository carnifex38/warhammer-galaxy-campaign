// What a gamemaster adds under an information tab after its first text: text and pictures in any order (a story, a picture, more story...).
// Each block is its own entry with a position number, so two gamemasters changing different blocks never overwrite each other (the
// setup is shared by sending only what changed: see server/statePatch.mjs).

export interface BlockData {
  /** position: blocks are shown lowest first (equal positions: by id) */
  n: number
  t: 'text' | 'pic'
  text?: string
  /** a picture's address on the server, /media/... */
  url?: string
  caption?: string
}
export type BlockMap = Record<string, BlockData>
export interface Block extends BlockData { id: string }

/** The three tabs that take blocks, and the field each keeps them in. */
export type BlockField = 'infoBlocks' | 'intelBlocks' | 'missionBlocks'
export const BLOCK_FIELDS: readonly BlockField[] = ['infoBlocks', 'intelBlocks', 'missionBlocks']

const valid = (d: unknown): d is BlockData => d !== null && typeof d === 'object' && ((d as BlockData).t === 'text' || (d as BlockData).t === 'pic') && typeof (d as BlockData).n === 'number'

/** The blocks in the order they are shown. Pictures not on our own server are left out. */
export function sortedBlocks(map: BlockMap | undefined): Block[] {
  return Object.entries(map ?? {})
    .filter(([, d]) => valid(d) && (d.t === 'text' || (typeof d.url === 'string' && d.url.startsWith('/media/'))))
    .map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => a.n - b.n || a.id.localeCompare(b.id))
}

const newId = () => Math.random().toString(36).slice(2, 10)
const last = (map: BlockMap | undefined) => Math.max(0, ...Object.values(map ?? {}).filter(valid).map((d) => d.n))

/** The blocks with these added at the end. */
export function addBlocks(map: BlockMap | undefined, added: Omit<BlockData, 'n'>[]): BlockMap {
  const next = { ...(map ?? {}) }
  let n = last(map)
  for (const a of added) next[newId()] = { ...a, n: ++n }
  return next
}

export const changeBlock = (map: BlockMap | undefined, id: string, change: Partial<BlockData>): BlockMap => ({ ...(map ?? {}), [id]: { ...(map ?? {})[id], ...change } as BlockData })

export function removeBlock(map: BlockMap | undefined, id: string): BlockMap {
  const next = { ...(map ?? {}) }
  delete next[id]
  return next
}

/** The block moved one place earlier (by = -1) or later (by = 1). */
export function moveBlock(map: BlockMap | undefined, id: string, by: -1 | 1): BlockMap {
  const list = sortedBlocks(map)
  const i = list.findIndex((b) => b.id === id)
  const j = i + by
  if (i < 0 || j < 0 || j >= list.length) return map ?? {}
  const next = { ...(map ?? {}) }
  // numbered afresh 1, 2, 3... with the two swapped, so equal or odd positions cannot leave them in doubt
  const order = list.map((b) => b.id);
  [order[i], order[j]] = [order[j], order[i]]
  order.forEach((bid, k) => { if (next[bid].n !== k + 1) next[bid] = { ...next[bid], n: k + 1 } })
  return next
}

/** Only the pictures of a set of blocks (what is kept when the text is put back to the default), or undefined when there are none. */
export function picturesOnly(map: BlockMap | undefined): BlockMap | undefined {
  const kept = Object.fromEntries(Object.entries(map ?? {}).filter(([, d]) => valid(d) && d.t === 'pic'))
  return Object.keys(kept).length ? kept : undefined
}

/** True when the blocks hold any text. */
export const hasTextBlock = (map: BlockMap | undefined) => Object.values(map ?? {}).some((d) => valid(d) && d.t === 'text')
