import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The FastAPI gateway listens on 8000. Proxying it through Vite means
// one HTTPS tunnel (Cloudflare / ngrok) serves both the app and the realtime room,
// so a judge's phone that scans the QR code reaches both.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['mascots/*.svg', 'data/*.json', 'icons/*.png'],
      manifest: {
        name: 'Streetwise',
        short_name: 'Streetwise',
        description: 'A voice-first walking companion for the walk home at night.',
        theme_color: '#10141C',
        background_color: '#10141C',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/walk',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/ws/],
        runtimeCaching: [
          {
            // Map tiles, fonts and sprites: cache what the demo corridor touched,
            // so a flaky venue network doesn't blank the map.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
  preview: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
});
