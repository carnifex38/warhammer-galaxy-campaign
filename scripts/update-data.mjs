// Downloads (or refreshes) the BSData rules and makes the army builder's data files:
//   npm run data
// The files go to public/data/<game>/ and are not committed: they are made again from BSData whenever you want newer rules.
// Needs git. Uses a shallow copy, so it is a small download (about 20 MB for Horus Heresy 3rd edition, about 50 MB for 40,000 11th).
//
// A game with a `pin` is built from exactly that commit, not the newest: the 40,000 data changes every day, and a list's points are
// worked out again from the data each time it opens, so unpinned rules could change a saved list in the middle of an event.
// To take newer 40,000 rules, put a newer commit of the repository in `pin` (and check a list or two afterwards).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const GAMES = [
  { key: 'hh3', repo: 'https://github.com/BSData/horus-heresy-3rd-edition.git' },
  { key: 'wh40k11e', repo: 'https://github.com/BSData/wh40k-11e.git', pin: '1f71b4b5122a6f9824539dc48fe775e3113fbc50' }, // 29 Oct 2026
]

const git = (...args) => execFileSync('git', args, { stdio: 'inherit' })
/** The commit a copy is at, or nothing for a copy that is still empty. */
const head = (dir) => { try { return execFileSync('git', ['-C', dir, 'rev-parse', '-q', '--verify', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } }

const cache = '.bsdata-cache'
mkdirSync(cache, { recursive: true })
for (const g of GAMES) {
  const dir = join(cache, g.key)
  if (g.pin) {
    if (!existsSync(dir)) { git('init', '-q', dir); git('-C', dir, 'remote', 'add', 'origin', g.repo) }
    if (head(dir) !== g.pin) {
      git('-C', dir, 'fetch', '-q', '--depth', '1', 'origin', g.pin)
      git('-C', dir, 'checkout', '-q', '--detach', 'FETCH_HEAD')
    }
  } else if (existsSync(dir)) git('-C', dir, 'pull', '--ff-only', '--depth', '1')
  else git('clone', '--depth', '1', g.repo, dir)
  const commit = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']).toString().trim()
  execFileSync('node', ['scripts/build-bsdata.mjs', dir, join('public', 'data', g.key), commit], { stdio: 'inherit' })
}
