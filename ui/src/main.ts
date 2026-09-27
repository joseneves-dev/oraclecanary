/*
 * Imports the shared token core (styles/app.css) as the single stylesheet, boots
 * the theme runtime (re-sync from storage + live system-theme listener — the
 * BLOCKING first-paint copy lives inline in index.html's <head>), then mounts
 * the SPA with Vue Router.
 */
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { bootTheme } from './lib/theme'

// Single stylesheet: the shared --ax-* token core compiled by Tailwind v4.
import './styles/app.css'

// Non-blocking theme re-sync + system listener (first paint already done by the
// inline anti-flash IIFE in index.html). Run before mount so attributes settle.
bootTheme()

createApp(App).use(router).mount('#app')
