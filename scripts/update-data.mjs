// Downloads (or refreshes) the BSData rules and makes the army builder's data files:
//   npm run data
// The files go to public/data/<game>/ and are not committed: they are made again from BSData whenever you want newer rules.
// Needs git. Uses a shallow copy, so it is a small download (about 20 MB for Horus Heresy 3rd edition).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const GAMES = [
  { key: 'hh3', repo: 'https://github.com/BSData/horus-heresy-3rd-edition.git' },
]

const cache = '.bsdata-cache'
mkdirSync(cache, { recursive: true })
for (const g of GAMES) {
  const dir = join(cache, g.key)
  if (existsSync(dir)) execFileSync('git', ['-C', dir, 'pull', '--ff-only', '--depth', '1'], { stdio: 'inherit' })
  else execFileSync('git', ['clone', '--depth', '1', g.repo, dir], { stdio: 'inherit' })
  const commit = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']).toString().trim()
  execFileSync('node', ['scripts/build-bsdata.mjs', dir, join('public', 'data', g.key), commit], { stdio: 'inherit' })
}
