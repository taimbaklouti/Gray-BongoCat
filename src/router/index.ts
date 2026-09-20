import type { RouteRecordRaw } from 'vue-router'

import { createRouter, createWebHashHistory } from 'vue-router'

import Main from '../pages/main/index.vue'

// S-4 : la page de préférences (lourde : masonry, modales, formulaires)
// n'est parsée qu'à la première ouverture → JS initial allégé au boot.
const Preference = () => import('../pages/preference/index.vue')

const routes: Readonly<RouteRecordRaw[]> = [
  {
    path: '/',
    component: Main,
  },
  {
    path: '/preference',
    component: Preference,
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
