import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://<user>.github.io/time-to-spare/, so every asset URL needs
// that prefix. Locally `vite dev` sets its own base, so keep it conditional.
const base = process.env.GITHUB_ACTIONS ? '/time-to-spare/' : '/';

export default defineConfig({
  base,
  // The harness assigns a port; Vite would otherwise sit on 5173 and collide
  // with the habit tracker's dev server.
  server: { port: Number(process.env.PORT) || 5174 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Registration is done by src/lib/pwa.js so updates land in one reload.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Time to Spare',
        short_name: 'Time',
        description: 'A calendar for planning a week deliberately.',
        theme_color: '#2F5C96',
        background_color: '#EFE9D8',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
