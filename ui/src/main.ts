/*
 * Vireo — Vue 3 edition entry.
 *
 * Imports the shared token core (styles/app.css) as the single stylesheet, then
 * mounts the SPA with Vue Router. The light/dark mode is set before the first
 * paint by the inline script in index.html.
 */
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'

// Single stylesheet: the shared --ax-* token core compiled by Tailwind v4.
import './styles/app.css'

createApp(App).use(router).mount('#app')
