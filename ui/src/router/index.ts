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
        { path: 'app', name: 'overview', component: () => import('@/pages/Overview.vue'), meta: { slug: 'overview' } },
        { path: 'incidents', name: 'incidents', component: () => import('@/pages/Incidents.vue'), meta: { slug: 'incidents' } },
        { path: 'reserves', name: 'reserves', component: () => import('@/pages/Reserves.vue'), meta: { slug: 'reserves' } },
        { path: 'switchboard', name: 'switchboard', component: () => import('@/pages/Switchboard.vue'), meta: { slug: 'switchboard' } },
        { path: 'positions', name: 'positions', component: () => import('@/pages/Positions.vue'), meta: { slug: 'positions' } },
        { path: 'how-it-works', name: 'how-it-works', component: () => import('@/pages/HowItWorks.vue'), meta: { slug: 'how-it-works' } },
        { path: 'vaults', name: 'vaults', component: () => import('@/pages/Vaults.vue'), meta: { slug: 'vaults' } },
        {
          path: 'vaults/:address',
          name: 'vault',
          component: () => import('@/pages/VaultDetail.vue'),
          props: true,
          meta: { slug: 'vaults' },
        },
        {
          path: 'reserves/:address',
          name: 'reserve',
          component: () => import('@/pages/ReserveDetail.vue'),
          props: true,
          meta: { slug: 'reserves' },
        },
        { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('@/pages/NotFound.vue') },
      ],
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
