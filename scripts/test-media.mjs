// The media library on a throw-away server: folders, upload into a folder, listing, delete, and that nothing outside media/ is reachable.
//   node scripts/test-media.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import http from 'node:http'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PORT = await new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const dir = mkdtempSync(join(tmpdir(), 'media-test-'))
const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dir, GM_PASSWORD: 'pw', DIST_DIR: join(dir, 'none') }, stdio: 'ignore' })
const URL = `http://127.0.0.1:${PORT}`
const stop = () => { server.kill(); try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp */ } }
process.on('exit', stop)
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${URL}/api/state`)).ok) break } catch { /* not up */ } await sleep(100) }
const token = (await (await fetch(`${URL}/api/gm-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) })).json()).token
const auth = { Authorization: `Bearer ${token}` }
const png = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(String(n))])

let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) failed++ }
const call = async (method, q, body, headers = auth) => { const r = await fetch(`${URL}/api/media?${new URLSearchParams(q)}`, { method, headers, body }); return { status: r.status, body: await r.json().catch(() => null) } }

check('listing needs the gamemaster login', (await call('GET', { folder: '' }, undefined, {})).status === 401)
check('top folder lists empty', (await call('GET', { folder: '' })).body?.files.length === 0)
check('make folder', (await call('POST', { folder: '', make: 'Maps' })).status === 201)
check('same name again refused (any case)', (await call('POST', { folder: '', make: 'maps' })).status === 409)
check('make nested folder', (await call('POST', { folder: 'Maps', make: 'Round 1' })).status === 201)
for (const bad of ['..', '../x', 'a/../b', '.hidden', 'a.b', 'C:', '', ' ', 'CON', 'nul', 'com1', 'a\\b', 'a\0b', 'x'.repeat(41)])
  check(`folder name ${JSON.stringify(bad)} refused`, (await call('POST', { folder: '', make: bad })).status === 400)
for (const bad of ['Maps ', '../..', '..', 'Maps/../..', '/etc', 'Maps/Round 1/x/y/z'])
  check(`folder path ${JSON.stringify(bad)} refused`, [400, 404].includes((await call('GET', { folder: bad })).status))

const up = await call('POST', { folder: 'Maps/Round 1', name: 'Table 3 (final).PNG' }, png(1), { ...auth, 'Content-Type': 'image/png' })
check('upload into nested folder', up.status === 201 && /^\/media\/Maps\/Round 1\/table-3-final-[0-9a-f]{10}\.png$/.test(up.body?.url), JSON.stringify(up))
const up2 = await call('POST', { folder: 'Maps/Round 1', name: 'again.png' }, png(1), { ...auth, 'Content-Type': 'image/png' })
check('same picture, other name = another file, no clash', up2.status === 201 && up2.body.url !== up.body.url)
const same = await call('POST', { folder: 'Maps/Round 1', name: 'Table 3 (final).PNG' }, png(1), { ...auth, 'Content-Type': 'image/png' })
check('same picture, same name = stored once', same.body.url === up.body.url && readdirSync(join(dir, 'media', 'Maps', 'Round 1')).length === 2)
const root = await call('POST', { folder: '' }, png(2), { ...auth, 'Content-Type': 'image/png' })
check('upload without a name keeps the old hash name', /^\/media\/[0-9a-f]{32}\.png$/.test(root.body?.url), JSON.stringify(root))
check('not a picture refused', (await call('POST', { folder: '' }, Buffer.from('<svg/>'), { ...auth, 'Content-Type': 'image/svg+xml' })).status === 415)
check('upload into a missing folder refused', (await call('POST', { folder: 'Nope' }, png(3), auth)).status === 404)

const served = await fetch(`${URL}${encodeURI(up.body.url)}`)
check('picture is served to anyone (with a space in its folder)', served.status === 200 && served.headers.get('content-type') === 'image/png')
check('old flat address still served', (await fetch(`${URL}${root.body.url}`)).status === 200)
// (sent as raw paths: fetch would tidy "/media/../x" into "/x" before it left)
const rawGet = (path) => new Promise((ok) => { http.get({ host: '127.0.0.1', port: PORT, path }, (r) => { r.resume(); r.on('end', () => ok(r.statusCode)) }) })
for (const bad of ['/media/../package.json', '/media/%2e%2e/package.json', '/media/Maps/..%2f..%2fx.png', '/media/Maps/Round%201', '/media/..%5c..%5cpackage.json'])
  check(`GET ${bad} is not served`, [403, 404, 503].includes(await rawGet(bad)))

const list = await call('GET', { folder: 'Maps/Round 1' })
check('listing shows both pictures', list.body?.files.length === 2 && list.body.total.pictures === 3, JSON.stringify(list.body))
check('parent lists the folder with its count', (await call('GET', { folder: 'Maps' })).body?.folders[0]?.pictures === 2)

check('delete refuses a non-empty folder', (await call('DELETE', { folder: 'Maps/Round 1' })).status === 409)
check('delete needs the login', (await call('DELETE', { file: up.body.url }, undefined, {})).status === 401)
check('delete a picture', (await call('DELETE', { folder: '', file: up.body.url })).status === 200 && (await fetch(`${URL}${encodeURI(up.body.url)}`)).status === 404)
check('delete refuses a path outside media', (await call('DELETE', { file: '/media/../package.json' })).status === 404 && existsSync('package.json'))
check('delete the other picture', (await call('DELETE', { file: up2.body.url })).status === 200)
check('delete the empty folder', (await call('DELETE', { folder: 'Maps/Round 1' })).status === 200 && !existsSync(join(dir, 'media', 'Maps', 'Round 1')))
check('top folder cannot be deleted', (await call('DELETE', { folder: '' })).status === 400)
writeFileSync(join(dir, 'secret.txt'), 'x')
check('files outside media are not listed', !(JSON.stringify((await call('GET', { folder: '' })).body)).includes('secret'))

console.log(failed ? `${failed} FAILED` : 'PASSED')
stop()
process.exitCode = failed ? 1 : 0
