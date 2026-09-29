import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// The Symfony API (oraclecanary/web) runs on :8000 in development. Proxying /api keeps the
// app same-origin, exactly as in production where Symfony serves both.
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8000'
// Wallet positions come from the indexer's positions service (npm run positions), on :3001.
const POSITIONS_URL = process.env.POSITIONS_URL ?? 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5179,
    host: true,
    proxy: {
      // Listed first: more specific than /api.
      '/api/wallets': { target: POSITIONS_URL, changeOrigin: true },
      '/api': { target: API_URL, changeOrigin: true },
      // Swagger UI (at /api/docs) loads its scripts and styles from here.
      '/assets/bundles': { target: API_URL, changeOrigin: true },
    },
  },
})
