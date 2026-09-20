<script setup lang="ts">
import { HappyProvider } from '@antdv-next/happy-work-theme'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { error } from '@tauri-apps/plugin-log'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEventListener } from '@vueuse/core'
import { ConfigProvider, theme } from 'antdv-next'
import { isString } from 'es-toolkit'
import isURL from 'is-url'
import { onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView } from 'vue-router'

import { useTauriListen } from './composables/useTauriListen'
import { useWindowState } from './composables/useWindowState'
import { LANGUAGE, LISTEN_KEY, WINDOW_LABEL } from './constants'
import { getAntdLocale } from './locales/index.ts'
import { hideWindow, showWindow } from './plugins/window'
import { useAppStore } from './stores/app'
import { useCatStore } from './stores/cat'
import { useGeneralStore } from './stores/general'
import { useModelStore } from './stores/model'
import { useShortcutStore } from './stores/shortcut.ts'
import live2d from './utils/live2d'
import { perfMark } from './utils/perf'

const appStore = useAppStore()
const modelStore = useModelStore()
const catStore = useCatStore()
const generalStore = useGeneralStore()
const shortcutStore = useShortcutStore()
const appWindow = getCurrentWebviewWindow()
const { restoreState } = useWindowState()
const { defaultAlgorithm } = theme
const { locale } = useI18n()

// S-2 : la fenêtre main démarre MASQUÉE (visible:false dans tauri.conf)
// pendant restore + premier rendu → zéro flash. Affichage dès la première
// frame du canvas, avec filet temporel si le chargement échoue.
let bootShown = false
let bootFallbackTimer: ReturnType<typeof setTimeout> | undefined

async function showBootWindow(source: string) {
  if (bootShown) return

  bootShown = true

  if (bootFallbackTimer) clearTimeout(bootFallbackTimer)

  perfMark(`fenêtre affichée (${source})`)

  try {
    await showWindow()
  } catch {}
}

onMounted(async () => {
  perfMark('app montée')

  // S-3 : précharge les assets du modèle standard en tâche de fond,
  // en parallèle des inits (non bloquant, erreurs ignorées).
  // Fenêtre main uniquement : inutile dans la webview preference.
  if (appWindow.label === WINDOW_LABEL.MAIN) {
    live2d.prefetchDefault().catch(() => {})
  }

  // S-1 : stores indépendants → inits en parallèle. Chacune reste isolée :
  // l'échec de l'une ne bloque ni les autres ni l'affichage.
  await Promise.all([
    (async () => {
      await appStore.$tauri.start().catch(() => {})
      await appStore.init().catch(() => {})
    })(),
    (async () => {
      await modelStore.$tauri.start().catch(() => {})
      await modelStore.init().catch(() => {})
    })(),
    (async () => {
      await catStore.$tauri.start().catch(() => {})

      try {
        catStore.init()
      } catch {}
    })(),
    (async () => {
      await generalStore.$tauri.start().catch(() => {})
      await generalStore.init().catch(() => {})
    })(),
    shortcutStore.$tauri.start().catch(() => {}),
  ])

  perfMark('stores prêts')

  try {
    await restoreState()
  } catch {}

  perfMark('fenêtre restaurée')

  // P2 : ce boot visuel ne concerne que la fenêtre main. Le même App.vue
  // tourne dans la webview preference : sans ce garde, son filet 6s
  // affichait la fenêtre des réglages à chaque lancement.
  if (appWindow.label === WINDOW_LABEL.MAIN) {
    live2d.onFirstFrame(() => showBootWindow('première frame'))

    // Filet : même en échec de chargement, l'app ne reste jamais invisible.
    bootFallbackTimer = setTimeout(() => showBootWindow('filet 6s'), 6000)
  }
})

watch(() => generalStore.appearance.language, (value) => {
  locale.value = value ?? LANGUAGE.EN_US
})

useTauriListen(LISTEN_KEY.SHOW_WINDOW, ({ payload }) => {
  if (appWindow.label !== payload) return

  showWindow()
})

useTauriListen(LISTEN_KEY.HIDE_WINDOW, ({ payload }) => {
  if (appWindow.label !== payload) return

  hideWindow()
})

useEventListener('unhandledrejection', ({ reason }) => {
  let message: string

  if (isString(reason)) {
    message = reason
  } else {
    try {
      message = JSON.stringify(reason)
    } catch {
      message = String(reason)
    }
  }

  error(message)
})

useEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest('a')

  if (!link) return

  const { href, target } = link

  if (target === '_blank') return

  event.preventDefault()

  if (!isURL(href)) return

  openUrl(href)
})
</script>

<template>
  <HappyProvider
    v-slot="{ wave }"
    enabled
  >
    <ConfigProvider
      :locale="getAntdLocale(generalStore.appearance.language)"
      :theme="{
        // Le thème est verrouillé en mode clair (indépendamment de l'OS)
        algorithm: defaultAlgorithm,
        token: {
          fontFamily: 'Pixelify Sans, Press Start 2P, monospace',
          colorBgContainer: '#ffffff',
          colorBgLayout: '#fff5f7',
        },
      }"
      :wave="wave"
    >
      <RouterView />
    </ConfigProvider>
  </HappyProvider>
</template>
