<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useTheme } from '@/composables/useTheme'
import CanaryMark from './CanaryMark.vue'

const { state, toggleTheme } = useTheme()
const open = ref(false)
const scrolled = ref(false)

function onScroll() {
  scrolled.value = window.scrollY > 8
}
onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <header class="nav" :class="{ 'nav--scrolled': scrolled, 'nav--open': open }">
    <div class="nav__inner lp-wrap">
      <RouterLink to="/" class="nav__brand" aria-label="OracleCanary home">
        <CanaryMark :size="26" />
        <span class="nav__word">Oracle<span class="wm-accent">Canary</span></span>
      </RouterLink>

      <nav id="lp-menu" class="nav__links" aria-label="Main">
        <RouterLink to="/how-it-works" @click="open = false">How it works</RouterLink>
        <RouterLink to="/how-it-works#guard" @click="open = false">Guard</RouterLink>
        <a href="/api/docs">API</a>
        <a href="https://t.me/OracleCanaryAlerts" target="_blank" rel="noopener">Alerts</a>
        <a href="https://github.com/joseneves-dev/oraclecanary" target="_blank" rel="noopener">GitHub</a>
      </nav>

      <div class="nav__actions">
        <button
          type="button"
          class="nav__icon"
          :aria-label="state.resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="toggleTheme"
        >
          <svg v-if="state.resolved === 'dark'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1 1M17.4 17.4l1 1M5.6 18.4l1-1M17.4 6.6l1-1" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
          </svg>
        </button>
        <RouterLink :to="{ name: 'overview' }" class="lp-btn lp-btn--primary nav__cta">Open app</RouterLink>
        <button
          type="button"
          class="nav__icon nav__burger"
          aria-controls="lp-menu"
          :aria-expanded="open"
          :aria-label="open ? 'Close menu' : 'Open menu'"
          @click="open = !open"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
            <path v-if="!open" d="M4 7h16M4 12h16M4 17h16" />
            <path v-else d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.nav {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid transparent;
  transition: background-color 0.25s, border-color 0.25s, backdrop-filter 0.25s;
}
.nav--scrolled,
.nav--open {
  background: color-mix(in srgb, var(--lp-bg) 82%, transparent);
  backdrop-filter: blur(14px) saturate(1.2);
  -webkit-backdrop-filter: blur(14px) saturate(1.2);
  border-bottom-color: var(--lp-line);
}
.nav__inner {
  display: flex;
  align-items: center;
  gap: 28px;
  height: 64px;
}
.nav__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--lp-ink);
  text-decoration: none;
}
.nav__word {
  font-family: var(--lp-display);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: -0.02em;
}
.wm-accent {
  color: var(--lp-accent-text);
}
.nav__links {
  display: flex;
  gap: 4px;
  margin-inline-start: 8px;
}
.nav__links a {
  color: var(--lp-ink-2);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: 8px;
  transition: color 0.15s, background-color 0.15s;
}
.nav__links a:hover {
  color: var(--lp-ink);
  background: var(--lp-fill);
}
.nav__actions {
  margin-inline-start: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.nav__icon {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--lp-line);
  background: transparent;
  color: var(--lp-ink-2);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.nav__icon:hover {
  color: var(--lp-ink);
  border-color: var(--lp-line-strong);
}
.nav__burger {
  display: none;
}
.nav__cta {
  height: 36px;
  padding-inline: 14px;
}

@media (max-width: 860px) {
  .nav__burger {
    display: inline-grid;
  }
  .nav__links {
    display: none;
    position: absolute;
    inset-inline: 0;
    top: 64px;
    flex-direction: column;
    gap: 0;
    margin: 0;
    padding: 8px 16px 16px;
    background: var(--lp-bg);
    border-bottom: 1px solid var(--lp-line);
  }
  .nav--open .nav__links {
    display: flex;
  }
  .nav__links a {
    padding: 12px 8px;
    font-size: 16px;
    border-radius: 0;
    border-bottom: 1px solid var(--lp-line);
  }
  .nav__links a:last-child {
    border-bottom: 0;
  }
}
@media (max-width: 400px) {
  .nav__inner {
    gap: 12px;
  }
  .nav__word {
    font-size: 16px;
  }
  .nav__cta {
    padding-inline: 12px;
  }
}
</style>
