// Live-event server: serves the built app (dist/) and keeps the event state that the gamemaster edits and players read.
// No dependencies, Node 20+. Configure with environment variables:
//   GM_PASSWORD  required. The gamemaster password (checked here, never sent to browsers).
//   PORT         default 3000
//   HOST         default 0.0.0.0
//   DATA_DIR     default ./data   (state.json lives here)
//   DIST_DIR     default ./dist
import { createServer } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { extname, join, normalize, resolve, sep } from 'node:path'

const GM_PASSWORD = process.env.GM_PASSWORD
if (!GM_PASSWORD) {
  console.error('Set GM_PASSWORD before starting, e.g.  GM_PASSWORD="something" node server/index.mjs')
  process.exit(1)
}
const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'
const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data')
const DIST_DIR = resolve(process.env.DIST_DIR ?? 'dist')
const STATE_FILE = join(DATA_DIR, 'state.json')
const MAX_BODY = 1_000_000

mkdirSync(DATA_DIR, { recursive: true })

// ---- state -----------------------------------------------------------------------------------------------------
// { config, hulks, info, locked } exactly as the client's useEventConfig keeps it, or null before the gamemaster saves.
let state = null
let version = 0
try { if (existsSync(STATE_FILE)) state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch (e) { console.error('Could not read state.json, starting empty:', e.message) }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const validState = (s) => isObj(s) && isObj(s.config) && isObj(s.hulks) && isObj(s.info) && Array.isArray(s.locked)

function persist() {
  const tmp = STATE_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(state))
  renameSync(tmp, STATE_FILE)
}

/** What a player may see: the text of sections the gamemaster has hidden is removed, and so is anything about hidden planets. */
function forPlayers(s) {
  if (!s) return null
  const info = {}
  for (const [id, o] of Object.entries(s.info)) {
    if (!isObj(o) || s.config[id]?.visible === false) continue
    const c = { ...o }
    if (c.infoHidden) delete c.summary
    if (c.intelHidden) delete c.intel
    if (c.missionHidden) { delete c.objectives; delete c.rewards }
    info[id] = c
  }
  return { ...s, info }
}

// ---- auth ------------------------------------------------------------------------------------------------------
// The token is derived from the password, so it survives restarts and stops working if the password changes.
const GM_TOKEN = createHmac('sha256', GM_PASSWORD).update('gm-session-v1').digest('hex')
const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
const bearer = (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null

// ---- live updates (server-sent events) ---------------------------------------------------------------------------
const streams = new Set()
const broadcast = () => { for (const res of streams) res.write(`data: ${version}\n\n`) }
setInterval(() => { for (const res of streams) res.write(': ping\n\n') }, 25_000).unref()

// ---- http ------------------------------------------------------------------------------------------------------
const json = (res, status, body) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(text)
}

const readBody = (req) => new Promise((ok, fail) => {
  let size = 0
  const chunks = []
  req.on('data', (c) => {
    size += c.length
    if (size > MAX_BODY) { fail(new Error('too large')); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')) } catch (e) { fail(e) } })
  req.on('error', fail)
})

let failedLogins = 0
setInterval(() => { failedLogins = 0 }, 60_000).unref()

async function api(req, res, path) {
  if (path === '/api/gm-login' && req.method === 'POST') {
    if (failedLogins >= 10) return json(res, 429, { error: 'Too many attempts, wait a minute.' })
    const body = await readBody(req).catch(() => null)
    if (isObj(body) && typeof body.password === 'string' && safeEq(body.password, GM_PASSWORD)) return json(res, 200, { token: GM_TOKEN })
    failedLogins++
    return json(res, 401, { error: 'Wrong password.' })
  }

  if (path === '/api/state' && req.method === 'GET') {
    const t = bearer(req)
    if (t !== null && !safeEq(t, GM_TOKEN)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    return json(res, 200, { version, state: t === null ? forPlayers(state) : state })
  }

  if (path === '/api/state' && req.method === 'PUT') {
    const t = bearer(req)
    if (t === null || !safeEq(t, GM_TOKEN)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    const body = await readBody(req).catch(() => null)
    if (!isObj(body) || !validState(body.state)) return json(res, 400, { error: 'Bad state.' })
    state = body.state
    version++
    persist()
    broadcast()
    return json(res, 200, { version })
  }

  if (path === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(`retry: 3000\ndata: ${version}\n\n`)
    streams.add(res)
    req.on('close', () => streams.delete(res))
    return
  }

  json(res, 404, { error: 'Not found.' })
}

// ---- static files ----------------------------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.map'])
const gzCache = new Map()

async function serveStatic(req, res, path) {
  let file = normalize(join(DIST_DIR, decodeURIComponent(path)))
  if (file !== DIST_DIR && !file.startsWith(DIST_DIR + sep)) { res.writeHead(403); return res.end() }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST_DIR, 'index.html') // single-page app
  const ext = extname(file)
  const rel = file.slice(DIST_DIR.length + 1).replaceAll('\\', '/')
  const headers = { 'Content-Type': MIME[ext] ?? 'application/octet-stream' }
  // hashed build assets never change; everything else (index.html, the service worker) must be re-checked every time
  headers['Cache-Control'] = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
  let body = await readFile(file)
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    const key = `${file}:${statSync(file).mtimeMs}`
    if (!gzCache.has(key)) gzCache.set(key, gzipSync(body))
    body = gzCache.get(key)
    headers['Content-Encoding'] = 'gzip'
    headers.Vary = 'Accept-Encoding'
  }
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : body)
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (path.startsWith('/api/')) return await api(req, res, path)
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end() }
    if (!existsSync(join(DIST_DIR, 'index.html'))) { res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('Run "npm run build" first.') }
    await serveStatic(req, res, path)
  } catch (e) {
    console.error(e)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  }
})

server.listen(PORT, HOST, () => console.log(`Galaxy Campaign on http://${HOST}:${PORT}  (data: ${DATA_DIR})`))
