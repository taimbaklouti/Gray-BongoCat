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
import { LANGUAGE, LISTEN_KEY } from './constants'
import { getAntdLocale } from './locales/index.ts'
import { hideWindow, showWindow } from './plugins/window'
import { useAppStore } from './stores/app'
import { useCatStore } from './stores/cat'
import { useGeneralStore } from './stores/general'
import { useModelStore } from './stores/model'
import { useShortcutStore } from './stores/shortcut.ts'

const appStore = useAppStore()
const modelStore = useModelStore()
const catStore = useCatStore()
const generalStore = useGeneralStore()
const shortcutStore = useShortcutStore()
const appWindow = getCurrentWebviewWindow()
const { isRestored, restoreState } = useWindowState()
const { defaultAlgorithm } = theme
const { locale } = useI18n()
onMounted(async () => {
  // Chaque init est isolée : l'échec de l'une ne doit jamais bloquer
  // les suivantes ni empêcher l'affichage (isRestored).
  await appStore.$tauri.start().catch(() => {})
  await appStore.init().catch(() => {})
  await modelStore.$tauri.start().catch(() => {})
  await modelStore.init().catch(() => {})
  await catStore.$tauri.start().catch(() => {})
  try {
    catStore.init()
  } catch {}
  await generalStore.$tauri.start().catch(() => {})
  await generalStore.init().catch(() => {})
  await shortcutStore.$tauri.start().catch(() => {})
  try {
    await restoreState()
  } catch {}
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
      <RouterView v-if="isRestored" />
    </ConfigProvider>
  </HappyProvider>
</template>
