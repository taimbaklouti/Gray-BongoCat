<script setup lang="ts">
import type { FileEntry } from '@tauri-apps/plugin-fs'
import type { MotionInfo } from 'easy-live2d'

import { convertFileSrc } from '@tauri-apps/api/core'
import { PhysicalSize } from '@tauri-apps/api/dpi'
import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { sep } from '@tauri-apps/api/path'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { exists, readDir } from '@tauri-apps/plugin-fs'
import { useDebounceFn, useEventListener } from '@vueuse/core'
import { round } from 'es-toolkit'
import { nth } from 'es-toolkit/compat'
import { Ticker } from 'pixi.js'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useAppMenu } from '@/composables/useAppMenu'
import { useDevice } from '@/composables/useDevice'
import { useGamepad } from '@/composables/useGamepad'
import { useModel } from '@/composables/useModel'
import { useTauriListen } from '@/composables/useTauriListen'
import { LISTEN_KEY, WINDOW_LABEL } from '@/constants'
import { hideWindow, setAlwaysOnTop, setTaskbarVisibility, showWindow } from '@/plugins/window'
import { useCatStore } from '@/stores/cat'
import { useGeneralStore } from '@/stores/general.ts'
import { useModelStore } from '@/stores/model'
import { isImage } from '@/utils/is'
import live2d from '@/utils/live2d'
import { join, toAssetPath } from '@/utils/path'
import { isWindows } from '@/utils/platform'
import { clearObject } from '@/utils/shared'

const { startListening } = useDevice()
const appWindow = getCurrentWebviewWindow()
const { modelSize, handleLoad, handleDestroy, handleResize, handleKeyChange } = useModel()
const catStore = useCatStore()
const { getBaseMenu, getExitMenu } = useAppMenu()
const modelStore = useModelStore()
const generalStore = useGeneralStore()
const resizing = ref(false)
const backgroundImagePath = ref<string>()
const { stickActive } = useGamepad()

onMounted(startListening)

onUnmounted(handleDestroy)

const debouncedResize = useDebounceFn(async () => {
  await handleResize()

  resizing.value = false
}, 100)

useEventListener('resize', () => {
  resizing.value = true

  debouncedResize()
})

watch(() => modelStore.currentModel, async (model) => {
  if (!model) return

  // `handleLoad` gère `modelReady` lui-même (avec garde anti-race) : ce
  // watcher ne le touche plus pour ne pas débloquer l'overlay d'un switch
  // plus récent encore en cours.
  await handleLoad()

  // Switch entre-temps : les assets ci-dessous appartiennent à un modèle
  // périmé, on ne les applique pas.
  if (modelStore.currentModel?.id !== model.id) return

  const path = join(model.path, 'resources', 'background.png')
  const resourcePath = join(model.path, 'resources')
  const groups = ['left-keys', 'right-keys']

  // Lectures FS en parallèle (séquentiel avant : lent sur Windows/Defender).
  const [existed, ...groupFiles] = await Promise.all([
    exists(path),
    ...groups.map(groupName => readDir(join(resourcePath, groupName)).catch((): FileEntry[] => [])),
  ])

  if (modelStore.currentModel?.id !== model.id) return

  backgroundImagePath.value = existed ? convertFileSrc(toAssetPath(path)) : void 0

  clearObject([modelStore.supportKeys, modelStore.pressedKeys])

  groupFiles.forEach((files, index) => {
    const groupDir = join(resourcePath, groups[index])

    for (const file of files.filter(file => isImage(file.name))) {
      const fileName = file.name.split('.')[0]

      modelStore.supportKeys[fileName] = join(groupDir, file.name)
    }
  })
}, { deep: true, immediate: true })

watch([() => catStore.window.scale, modelSize], async ([scale, modelSize]) => {
  if (!modelSize) return

  if (!Number.isFinite(scale) || scale <= 0) return

  const { width, height } = modelSize

  await appWindow.setSize(
    new PhysicalSize({
      width: Math.round(width * (scale / 100)),
      height: Math.round(height * (scale / 100)),
    }),
  ).catch(() => {})
}, { immediate: true })

watch([modelStore.pressedKeys, stickActive], ([keys, stickActive]) => {
  const dirs = Object.values(keys).map((path) => {
    return nth(path.split(sep()), -2)!
  })

  const hasLeft = dirs.some(dir => dir.startsWith('left'))
  const hasRight = dirs.some(dir => dir.startsWith('right'))

  handleKeyChange(true, stickActive.left || hasLeft)
  handleKeyChange(false, stickActive.right || hasRight)
}, { deep: true })

watch(() => catStore.window.visible, async (value) => {
  try {
    if (value) {
      await showWindow()
    } else {
      await hideWindow()
    }
  } catch {}
})

function pauseRender(paused: boolean) {
  // Économise GPU/CPU/batterie : le ticker partagé pilote tout le rendu
  // (Pixi, Live2D, curseur). start/stop sont idempotents.
  if (paused) {
    Ticker.shared.stop()
  } else {
    Ticker.shared.start()
  }
}

watch(() => catStore.window.visible, value => pauseRender(!value), { immediate: true })

// Le store peut être contourné (toggle ciblé par label) : on suit aussi
// les events directs show/hide.
useTauriListen<string>(LISTEN_KEY.SHOW_WINDOW, () => pauseRender(false))

useTauriListen<string>(LISTEN_KEY.HIDE_WINDOW, () => pauseRender(true))

watch(() => catStore.window.passThrough, (value) => {
  appWindow.setIgnoreCursorEvents(value).catch(() => {})
}, { immediate: true })

watch(() => catStore.window.alwaysOnTop, setAlwaysOnTop, { immediate: true })

watch(() => generalStore.app.taskbarVisible, setTaskbarVisibility, { immediate: true })

watch(() => catStore.model.motionSound, live2d.setMotionSoundEnabled, { immediate: true })

watch(() => catStore.model.maxFPS, live2d.setMaxFPS, { immediate: true })

useTauriListen<MotionInfo>(LISTEN_KEY.START_MOTION, ({ payload }) => {
  live2d.startMotion(payload)
})

useTauriListen<number>(LISTEN_KEY.SET_EXPRESSION, ({ payload }) => {
  live2d.setExpression(payload)
})

function handleMouseDown() {
  appWindow.startDragging()
}

// Double-clic sur le chat : ouvre directement la fenêtre des paramètres.
function handleDoubleClick(event: MouseEvent) {
  event.preventDefault()

  showWindow(WINDOW_LABEL.PREFERENCE)
}

async function handleContextmenu(event: MouseEvent) {
  event.preventDefault()

  if (event.shiftKey) return

  const menu = await Menu.new({
    items: [
      ...await getBaseMenu(),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      ...await getExitMenu(),
    ],
  })

  // Temporarily disable always-on-top on Windows so the context menu is not covered
  if (isWindows && catStore.window.alwaysOnTop) {
    await setAlwaysOnTop(false).catch(() => {})
  }

  try {
    await menu.popup()
  } finally {
    // Restore always-on-top after the menu is closed, even if popup() threw
    if (isWindows && catStore.window.alwaysOnTop) {
      await setAlwaysOnTop(true).catch(() => {})
    }
  }
}

function handleMouseMove(event: MouseEvent) {
  const { buttons, shiftKey, movementX, movementY } = event

  if (buttons !== 2 || !shiftKey) return

  const delta = (movementX + movementY) * 0.5
  const nextScale = Math.max(10, Math.min(catStore.window.scale + delta, 500))

  catStore.window.scale = round(nextScale)
}
</script>

<template>
  <div
    class="relative size-screen overflow-hidden children:(absolute size-full)"
    :class="{ '-scale-x-100': catStore.model.mirror }"
    :style="{
      opacity: catStore.window.opacity / 100,
      borderRadius: `max(8px, ${catStore.window.radius}%)`,
    }"
    @contextmenu="handleContextmenu"
    @dblclick="handleDoubleClick"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
  >
    <img
      v-if="backgroundImagePath"
      class="object-cover"
      :src="backgroundImagePath"
    >

    <canvas id="live2dCanvas" />

    <img
      v-for="path in modelStore.pressedKeys"
      :key="path"
      class="object-cover"
      :src="convertFileSrc(toAssetPath(path))"
    >

    <div
      v-show="resizing || !modelStore.modelReady"
      class="flex items-center justify-center bg-black"
    >
      <span class="text-center text-[10vw] text-[#fff]">
        {{ resizing ? $t('pages.main.hints.redrawing') : $t('pages.main.hints.switching') }}
      </span>
    </div>
  </div>
</template>
