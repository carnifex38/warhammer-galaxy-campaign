import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// The site can live in a sub-folder (GitHub Pages serves it at /<repo-name>/), so the build reads its base path from BASE_PATH.
const base = process.env.BASE_PATH ?? '/'

// The version shown in the app: the short git hash of the commit being built (from .git, or from GIT_HASH when the build has no .git).
function gitHash(): string {
  if (process.env.GIT_HASH) return process.env.GIT_HASH.slice(0, 7)
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'unknown' }
}

const APP_VERSION = gitHash()

// https://vite.dev/config/
export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  // `npm run dev` proxies /api to the live-event server (`npm run serve`)
  server: { host: true, proxy: { '/api': 'http://localhost:3000', '/media': 'http://localhost:3000' } },
  plugins: [
    react(),
    // dist/version.txt: the server announces it to open pages, so a page from an older build knows to update (src/updateReady.ts)
    { name: 'version-file', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.txt', source: APP_VERSION }) } },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Galaxy Campaign',
        short_name: 'Campaign',
        description: 'Army lists and sector tables for tabletop events',
        theme_color: '#0b0e1a',
        background_color: '#0b0e1a',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,jpg}'],
        navigateFallbackDenylist: [/^\/api\//], // the service worker must never answer API calls with index.html
        // the army builder's rules files are big and change rarely: show the saved copy at once, refresh it in the background
        runtimeCaching: [
          { urlPattern: /\/data\/[^/]+\/.*\.json$/, handler: 'StaleWhileRevalidate', options: { cacheName: 'rules-data' } },
          // uploaded pictures never change under the same name: keep them once seen, so they show offline too
          { urlPattern: /\/media\/[0-9a-f]{32}\.\w+$/, handler: 'CacheFirst', options: { cacheName: 'media', expiration: { maxEntries: 200 }, cacheableResponse: { statuses: [200] } } },
        ],
      },
      devOptions: { enabled: true },
    }),
  ],
})
