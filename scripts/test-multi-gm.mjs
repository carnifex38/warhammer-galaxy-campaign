// Several gamemasters editing one event at the same time. Starts a throw-away server, runs N gamemaster "browsers" that do random work
// (toggles, battlezone counts, locks, team names, and long texts typed key by key) on a mix of their own items and shared ones, and then
// checks that nothing was lost and that everyone ends up seeing the same setup.
//   node scripts/test-multi-gm.mjs [gamemasters=4] [seconds=8] [seed=1]
// Each simulated browser follows the same rules as src/galaxy/eventConfig.ts: keep a base (the server's last setup), send only the
// difference to it, and when the server's setup arrives put its own unsaved changes on top.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { applyOps, diffSetup } from '../server/statePatch.mjs'

const N = Number(process.argv[2] ?? 4)
const SECONDS = Number(process.argv[3] ?? 8)
let seed = Number(process.argv[4] ?? 1)
const OLD = process.argv[5] === 'old' // for comparison: how the app behaved before (whole setup saved, no live updates for gamemasters)
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 } // repeatable
const pick = (a) => a[Math.floor(rnd() * a.length)]
const clone = (v) => JSON.parse(JSON.stringify(v))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// a port nobody else is using (several runs of this test can go at once)
const PORT = await new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const PASSWORD = 'multi-gm-test'
const dir = mkdtempSync(join(tmpdir(), 'multi-gm-'))
const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dir, GM_PASSWORD: PASSWORD, DIST_DIR: join(dir, 'none') }, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
const URL = `http://127.0.0.1:${PORT}`
const stop = () => { server.kill(); try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp folder */ } }
process.on('exit', stop)

for (let i = 0; i < 50; i++) { try { if ((await fetch(`${URL}/api/state`)).ok) break } catch { /* not up yet */ } await sleep(100) }
const token = (await (await fetch(`${URL}/api/gm-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })).json()).token
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const getStamped = async () => (await fetch(`${URL}/api/state`, { headers: auth, cache: 'no-store' })).json()
const getState = async () => (await getStamped()).state
const patch = async (ops) => { const r = await fetch(`${URL}/api/state`, { method: 'PUT', headers: auth, body: JSON.stringify({ patch: ops }) }); if (!r.ok) throw new Error(`patch ${r.status}`); return r.json() }

const EMPTY = { config: {}, hulks: {}, info: {}, locked: [], teams: null }
const SECTORS = Array.from({ length: 16 }, (_, i) => `sector-${i}`) // enough for each gamemaster to have its own
const WORDS = 'the legion marches upon a dying world while its defenders hold the bridge and the sky burns'.split(' ')

class Gamemaster {
  constructor(id) {
    this.id = id
    this.base = clone(EMPTY)
    this.mine = clone(EMPTY)
    this.latest = { epoch: '', version: -1 }
    this.timer = null
    this.saving = false
    this.sent = 0
    this.errors = []
    this.typed = {} // what this gamemaster typed into each text it owns: the final text must survive
  }
  async start() {
    await this.pull()
    if (!OLD) this.stream()
    else this.abort = new AbortController()
  }
  stream() {
    // the live connection: any change anywhere makes this browser fetch the setup (as watchState does)
    this.abort = new AbortController()
    fetch(`${URL}/api/stream`, { signal: this.abort.signal }).then(async (res) => {
      const reader = res.body.getReader()
      for (;;) { const { done } = await reader.read(); if (done) break; this.pull().catch((e) => this.errors.push(`pull: ${e.message}`)) }
    }).catch(() => { /* closed at the end */ })
  }
  fresh(r) {
    if (r.epoch === this.latest.epoch && r.version < this.latest.version) return false
    this.latest = { epoch: r.epoch, version: r.version }
    return true
  }
  adopt(server, ops) {
    this.base = server
    this.mine = applyOps(server, ops)
    // anything of this gamemaster's that the server does not have goes out (in the app the sync effect does this whenever the setup changes)
    if (!OLD && !this.stopped2 && diffSetup(this.base, this.mine).length) this.edit(() => {})
  }
  async pull() {
    const got = await getStamped()
    if (!this.fresh(got)) return
    this.adopt(got.state ?? clone(EMPTY), diffSetup(this.base, this.mine))
  }
  edit(fn) {
    fn(this.mine)
    if (this.timer) return // (like the app: the timer is not restarted by every change, so a gamemaster who keeps working still saves)
    this.timer = setTimeout(() => { this.timer = null; this.save().catch((e) => this.errors.push(`save: ${e.message}`)) }, 30 + rnd() * 120) // (the app waits 400 ms)
  }
  async save() {
    const ops = diffSetup(this.base, this.mine)
    if (ops.length === 0) return
    const sent = clone(this.mine)
    this.sent += ops.length
    if (OLD) { await fetch(`${URL}/api/state`, { method: 'PUT', headers: auth, body: JSON.stringify({ state: { ...sent, teams: sent.teams ?? null } }) }); this.base = sent; return }
    const got = await patch(ops)
    if (this.fresh(got)) this.adopt(got.state, diffSetup(sent, this.mine))
  }
  // ---- what a gamemaster does ----
  own(kind) { return `${kind}-gm${this.id}-${Math.floor(rnd() * 6)}` }
  task() {
    const t = Math.floor(rnd() * 9)
    const planet = `p${Math.floor(rnd() * 8)}` // planets everyone fights over
    if (t === 0) { const id = this.own('own'); const v = rnd() < 0.5; this.edit((m) => { (m.config[id] ??= {}).visible = v }); this.lastOwn = { ...this.lastOwn, [`config.${id}.visible`]: v } }
    else if (t === 1) { const id = this.own('own'); const v = 1 + Math.floor(rnd() * 8); this.edit((m) => { (m.config[id] ??= {}).tables = v }); this.lastOwn = { ...this.lastOwn, [`config.${id}.tables`]: v } }
    else if (t === 2) { const sec = SECTORS[this.id % SECTORS.length]; const on = rnd() < 0.5; this.edit((m) => { m.locked = m.locked.filter((x) => x !== sec); if (on) m.locked.push(sec) }); this.lastOwn = { ...this.lastOwn, [`locked.${sec}`]: on } }
    else if (t === 3) { this.edit((m) => { (m.config[planet] ??= {}).enabled = rnd() < 0.5 }) } // shared: anyone, same item
    else if (t === 4) { const v = Math.floor(rnd() * 5); const sec = SECTORS[this.id % SECTORS.length]; this.edit((m) => { m.hulks[sec] = v }); this.lastOwn = { ...this.lastOwn, [`hulks.${sec}`]: v } }
    else if (t === 5) { const side = this.id % 2 ? 'A' : 'B'; const name = `${side}-name-${Math.floor(rnd() * 1000)}`; this.edit((m) => { m.teams ??= {}; (m.teams[side] ??= {}).name = name }) } // (two gamemasters share each side: checked for agreement only)
    else if (t === 6) { const side = this.id % 2 ? 'A' : 'B'; const color = `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`; this.edit((m) => { m.teams ??= {}; (m.teams[side] ??= {}).color = color }) }
    else if (t === 7) { const v = rnd() < 0.5; this.edit((m) => { (m.config[planet] ??= {}).visible = v }) } // shared again
    else this.startTyping()
  }
  // a long text typed word by word into a field of a planet; two gamemasters share each planet but each types into a different field
  startTyping() {
    if (this.typing) return
    const field = this.id % 2 ? 'summary' : 'intel'
    const planet = `brief-${Math.floor(this.id / 2)}` // gm0+gm1 write the same planet, gm2+gm3 another
    const words = 25 + Math.floor(rnd() * 25)
    this.typing = true
    let n = 0
    const step = () => {
      if (n >= words || this.stopped) { this.typing = false; return }
      const word = pick(WORDS)
      this.typed[`info.${planet}.${field}`] = (this.typed[`info.${planet}.${field}`] ?? '') + word + ' '
      const text = this.typed[`info.${planet}.${field}`]
      this.edit((m) => { (m.info[planet] ??= {})[field] = text })
      n++
      setTimeout(step, 15 + rnd() * 40)
    }
    step()
  }
}

const gms = Array.from({ length: N }, (_, i) => new Gamemaster(i))
await Promise.all(gms.map((g) => g.start()))
const t0 = Date.now()
await Promise.all(gms.map(async (g) => {
  while (Date.now() - t0 < SECONDS * 1000) { g.task(); await sleep(20 + rnd() * 100) }
  g.stopped = true
}))
while (gms.some((g) => g.typing)) await sleep(50)
await sleep(2000) // everything settles: saves finish, the last changes reach everyone
for (const g of gms) { g.abort.abort(); g.stopped2 = true; if (!OLD) { await g.pull(); await g.save().catch((e) => g.errors.push(e.message)) } }
await sleep(200)
for (const g of gms) await g.pull()

// ---- checks ----
const server_ = await getState()
const problems = []
const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)
for (const g of gms) {
  for (const e of g.errors) problems.push(`gm${g.id}: ${e}`)
  // 1. nothing this gamemaster did on its own items was lost (and later work on the same item is what stands)
  for (const [path, want] of Object.entries(g.lastOwn ?? {})) {
    const [top, ...rest] = path.split('.')
    if (top === 'locked') { if (server_.locked.includes(rest[0]) !== want) problems.push(`gm${g.id}: ${path} should be ${want}`) }
    else if (get(server_, path) !== want) problems.push(`gm${g.id}: ${path} is ${JSON.stringify(get(server_, path))}, it should be ${JSON.stringify(want)}`)
  }
  // 2. every long text survived whole, though other gamemasters changed the same planet's other fields meanwhile
  for (const [path, text] of Object.entries(g.typed)) {
    const got = get(server_, path)
    if (got !== text) problems.push(`gm${g.id}: text ${path} lost ${text.length - (got?.length ?? 0)} of ${text.length} characters`)
  }
  // 3. everyone sees what the server has
  const left = diffSetup(server_, g.mine)
  if (left.length) problems.push(`gm${g.id}: still differs from the server in ${left.length} place(s): ${JSON.stringify(left.slice(0, 2))}`)
}
if (process.env.DEBUG_TEAMS) { console.log('server teams', JSON.stringify(server_.teams)); for (const g of gms) console.log('gm' + g.id, JSON.stringify(g.mine.teams), 'base', JSON.stringify(g.base.teams)) }
// the gamemasters of the same side share the team items: one of their values must stand
console.log(`${N} gamemasters, ${SECONDS} s, ${gms.reduce((a, g) => a + g.sent, 0)} changes sent`)
console.log(`typed texts: ${gms.reduce((a, g) => a + Object.keys(g.typed).length, 0)}, characters: ${gms.reduce((a, g) => a + Object.values(g.typed).reduce((x, t) => x + t.length, 0), 0)}`)
if (problems.length) { console.log('FAILED'); for (const p of problems.slice(0, 20)) console.log('  ' + p); if (serverLog.trim()) console.log(serverLog.slice(-500)); process.exitCode = 1 } else console.log('PASSED: nothing lost, everyone ends up with the same setup')
stop()
