import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '@/layout/AppLayout.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The front page has its own header and footer, outside the app's shell.
    { path: '/', name: 'landing', component: () => import('@/pages/Landing.vue') },
    { path: '/overview', redirect: '/app' },
    {
      // Pathless: every app page keeps the address Telegram alerts and old links use.
      path: '/',
      component: AppLayout,
      children: [
        { path: 'app', name: 'overview', component: () => import('@/pages/Overview.vue'), meta: { slug: 'overview', title: 'Overview' } },
        { path: 'incidents', name: 'incidents', component: () => import('@/pages/Incidents.vue'), meta: { slug: 'incidents', title: 'Incidents' } },
        { path: 'reserves', name: 'reserves', component: () => import('@/pages/Reserves.vue'), meta: { slug: 'reserves', title: 'Reserves' } },
        { path: 'switchboard', name: 'switchboard', component: () => import('@/pages/Switchboard.vue'), meta: { slug: 'switchboard', title: 'Switchboard exposure' } },
        { path: 'positions', name: 'positions', component: () => import('@/pages/Positions.vue'), meta: { slug: 'positions', title: 'My positions' } },
        { path: 'how-it-works', name: 'how-it-works', component: () => import('@/pages/HowItWorks.vue'), meta: { slug: 'how-it-works', title: 'How it works' } },
        { path: 'vaults', name: 'vaults', component: () => import('@/pages/Vaults.vue'), meta: { slug: 'vaults', title: 'Curator vaults' } },
        {
          path: 'vaults/:address',
          name: 'vault',
          component: () => import('@/pages/VaultDetail.vue'),
          props: true,
          meta: { slug: 'vaults', title: 'Vault' },
        },
        {
          path: 'reserves/:address',
          name: 'reserve',
          component: () => import('@/pages/ReserveDetail.vue'),
          props: true,
          meta: { slug: 'reserves', title: 'Reserve' },
        },
        { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('@/pages/NotFound.vue'), meta: { title: 'Page not found' } },
      ],
    },
  ],
  // A link to a section (/how-it-works#guard) lands on it, below the sticky header.
  scrollBehavior: (to) => (to.hash ? { el: to.hash, top: 80 } : { top: 0 }),
})

/** The front page keeps index.html's title; every app page is "<page> · OracleCanary". */
const SITE_TITLE = document.title
router.afterEach((to) => {
  const page = to.meta.title as string | undefined
  document.title = page ? `${page} · OracleCanary` : SITE_TITLE
})
