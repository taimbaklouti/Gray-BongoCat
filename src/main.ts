import { createPlugin } from '@tauri-store/pinia'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { i18n } from './locales'
import router from './router'
import { perfMark } from './utils/perf'

import 'virtual:uno.css'
import 'antdv-next/dist/reset.css'

import './assets/css/global.scss'

const pinia = createPinia()
pinia.use(createPlugin({ saveOnChange: true }))

perfMark('js parsé, montage vue')

createApp(App).use(router).use(pinia).use(i18n).mount('#app')
