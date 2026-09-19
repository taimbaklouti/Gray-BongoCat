<script setup lang="ts">
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { onMounted, onUnmounted, ref } from 'vue'

import { isMac } from '@/utils/platform'

const props = withDefaults(defineProps<{
  title?: string
}>(), {
  title: 'Bongo Cat',
})

const appWindow = getCurrentWebviewWindow()

const maximized = ref(false)

async function updateMaximized() {
  maximized.value = await appWindow.isMaximized().catch(() => false)
}

onMounted(async () => {
  await updateMaximized()

  unlistenResized = await appWindow.onResized(updateMaximized)
})

let unlistenResized: () => void

onUnmounted(() => {
  unlistenResized?.()
})

async function handleMinimize() {
  await appWindow.minimize()
}

// NOTE: la fenêtre principale est configurée avec `maximizable: false`,
// on bascule donc manuellement entre maximisé / restauré.
async function handleMaximize() {
  if (maximized.value) {
    await appWindow.unmaximize()
  } else {
    await appWindow.maximize()
  }

  await updateMaximized()
}

async function handleClose() {
  // Le backend intercepte `CloseRequested` et cache la fenêtre au lieu de la détruire.
  await appWindow.close()
}
</script>

<template>
  <header
    class="pixel-titlebar"
    data-tauri-drag-region
  >
    <div
      class="pixel-titlebar__name"
      data-tauri-drag-region
    >
      <span
        aria-hidden="true"
        class="pixel-deco"
      >♥</span>

      {{ props.title }}

      <span
        aria-hidden="true"
        class="pixel-deco pixel-deco--star"
      >★</span>

      <span
        aria-hidden="true"
        class="pixel-deco"
      >♥</span>
    </div>

    <div class="pixel-titlebar__btns">
      <button
        :aria-label="$t('components.titleBar.minimize')"
        class="pixel-winbtn"
        type="button"
        @click="handleMinimize"
      >
        -
      </button>

      <button
        v-if="!isMac"
        :aria-label="$t('components.titleBar.maximize')"
        class="pixel-winbtn"
        type="button"
        @click="handleMaximize"
      >
        {{ maximized ? '❐' : '□' }}
      </button>

      <button
        :aria-label="$t('components.titleBar.close')"
        class="pixel-winbtn pixel-winbtn--close"
        type="button"
        @click="handleClose"
      >
        ✕
      </button>
    </div>
  </header>
</template>
