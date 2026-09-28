import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '@/layout/AppLayout.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', name: 'overview', component: () => import('@/pages/Overview.vue'), meta: { slug: 'overview' } },
        { path: 'incidents', name: 'incidents', component: () => import('@/pages/Incidents.vue'), meta: { slug: 'incidents' } },
        { path: 'reserves', name: 'reserves', component: () => import('@/pages/Reserves.vue'), meta: { slug: 'reserves' } },
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
