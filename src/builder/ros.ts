// Exports a roster as a BattleScribe roster file (.ros, or .rosz which is the same thing zipped), the format New Recruit and
// BattleScribe open. Selections carry the ids of the BSData entries they came from, so the other app can look them up in
// its own copy of the same data and check the list again for itself.
import type { Builder } from './roster.ts'
import type { Force, Sel } from './engine.ts'

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`)
const num = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n))

export function toRos(b: Builder): string {
  const { sys, eng } = b
  const costTypes: { id: string; name: string }[] = (sys.gst.costTypes ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }))
  eng.touch()

  const costsOf = (s: Sel, mult: number) =>
    costTypes.map((t) => `<cost name="${esc(t.name)}" typeId="${t.id}" value="${num(eng.unitCost(s, t.id) * s.number * mult)}"/>`).join('')

  const categories = (s: Sel) => {
    const c = eng.categories(s)
    const out: string[] = []
    for (const id of c.all) out.push(`<category id="${uuid()}" name="${esc(sys.byId.get(id)?.name)}" entryId="${id}" primary="${c.primary === id}"/>`)
    return out.length ? `<categories>${out.join('')}</categories>` : ''
  }

  const selection = (s: Sel, mult: number): string => {
    const node = s.slot.node
    const kids = s.selections.map((c) => selection(c, mult * s.number)).join('')
    const type = node.type ?? 'upgrade'
    const name = eng.nameOf(s.slot, { self: s, parent: s.parent })
    return `<selection id="${uuid()}" name="${esc(name)}" entryId="${esc(s.slot.id)}" number="${s.number}" type="${esc(type)}"><costs>${costsOf(s, mult)}</costs>${categories(s)}${kids ? `<selections>${kids}</selections>` : ''}</selection>`
  }

  const force = (f: Force): string => {
    const cat = sys.cats.get(f.catalogueId)
    const entryId = f.link ? `${f.link.id}::${f.entry.id}` : f.entry.id
    const sels = f.selections.map((s) => selection(s, 1)).join('')
    const kids = f.forces.map(force).join('')
    const roles = [...(f.entry.categoryLinks ?? []), ...(f.link?.categoryLinks ?? [])]
      .map((cl: { targetId: string; name: string }) => `<category id="${uuid()}" name="${esc(cl.name)}" entryId="${cl.targetId}" primary="false"/>`)
      .join('')
    return `<force id="${uuid()}" name="${esc(f.link?.name ?? f.entry.name)}" entryId="${esc(entryId)}" catalogueId="${f.catalogueId}" catalogueRevision="${cat?.revision ?? 1}" catalogueName="${esc(cat?.name)}">` +
      (sels ? `<selections>${sels}</selections>` : '') + (kids ? `<forces>${kids}</forces>` : '') + (roles ? `<categories>${roles}</categories>` : '') + '<publications/></force>'
  }

  const totals = costTypes.map((t) => `<cost name="${esc(t.name)}" typeId="${t.id}" value="${num(eng.total(t.id))}"/>`).join('')
  const limits = costTypes.map((t) => `<costLimit name="${esc(t.name)}" typeId="${t.id}" value="${num(b.roster.limits[t.id] ?? -1)}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<roster id="${uuid()}" name="${esc(b.roster.name)}" battleScribeVersion="2.03" generatedBy="Galaxy Campaign" gameSystemId="${sys.gst.id}" gameSystemName="${esc(sys.gst.name)}" gameSystemRevision="${sys.gst.revision ?? 1}" xmlns="http://www.battlescribe.net/schema/rosterSchema"><costs>${totals}</costs><costLimits>${limits}</costLimits><forces>${b.roster.forces.map(force).join('')}</forces></roster>\n`
}

// ---- a minimal zip writer (no compression), enough for a .rosz ----

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export function toRosz(xml: string, fileName: string): Uint8Array {
  const name = new TextEncoder().encode(fileName)
  const data = new TextEncoder().encode(xml)
  const crc = crc32(data)
  const local = new DataView(new ArrayBuffer(30))
  local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true)
  local.setUint16(10, 0, true); local.setUint16(12, 0x21, true); local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true)
  local.setUint16(26, name.length, true); local.setUint16(28, 0, true)
  const central = new DataView(new ArrayBuffer(46))
  central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true); central.setUint16(10, 0, true)
  central.setUint16(12, 0, true); central.setUint16(14, 0x21, true); central.setUint32(16, crc, true); central.setUint32(20, data.length, true); central.setUint32(24, data.length, true)
  central.setUint16(28, name.length, true); central.setUint32(42, 0, true)
  const end = new DataView(new ArrayBuffer(22))
  const centralSize = 46 + name.length
  const centralOffset = 30 + name.length + data.length
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true); end.setUint32(12, centralSize, true); end.setUint32(16, centralOffset, true)
  const out = new Uint8Array(centralOffset + centralSize + 22)
  let o = 0
  for (const part of [new Uint8Array(local.buffer), name, data, new Uint8Array(central.buffer), name, new Uint8Array(end.buffer)]) { out.set(part, o); o += part.length }
  return out
}
