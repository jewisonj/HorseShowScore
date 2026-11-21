/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Horse Show Scorer',
        short_name: 'Show Scorer',
        description: 'Judging cards for small horse shows. Works without a signal.',
        theme_color: '#10203a',
        background_color: '#eef0f2',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache everything the cards need so a scribe can work with no signal.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The PDF renderer is only used in setup, on a computer. Phones do not need to store it.
        globIgnores: ['**/pdf*.js'],
        // Pictures of pattern book pages: keep each one the first time it is fetched, so it
        // is there with no signal. Every picture has its own address and never changes.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/pattern-pages\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pattern-pages',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
