import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// The Symfony API (oraclecanary/web) runs on :8000 in development. Proxying /api keeps the
// app same-origin, exactly as in production where Symfony serves both.
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8000'

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
      '/api': { target: API_URL, changeOrigin: true },
    },
  },
})
