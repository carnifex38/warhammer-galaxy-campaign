import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The site can live in a sub-folder (GitHub Pages serves it at /<repo-name>/), so the build reads its base path from BASE_PATH.
const base = process.env.BASE_PATH ?? '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  // `npm run dev` proxies /api to the live-event server (`npm run serve`)
  server: { host: true, proxy: { '/api': 'http://localhost:3000' } },
  plugins: [
    react(),
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
      },
      devOptions: { enabled: true },
    }),
  ],
})
