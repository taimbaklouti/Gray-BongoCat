import type { Event } from '@tauri-apps/api/event'
import type { Monitor } from '@tauri-apps/api/window'

import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { availableMonitors } from '@tauri-apps/api/window'
import { useDebounceFn } from '@vueuse/core'
import { isNumber } from 'es-toolkit/compat'
import { onMounted, ref, watch } from 'vue'

import { WINDOW_LABEL } from '@/constants'
import { useAppStore } from '@/stores/app'
import { useCatStore } from '@/stores/cat'
import { getCursorMonitor } from '@/utils/monitor'

export type WindowState = Record<string, Partial<PhysicalPosition & PhysicalSize> | undefined>

export function useWindowState() {
  const appWindow = getCurrentWebviewWindow()
  const { label } = appWindow
  const appStore = useAppStore()
  const catStore = useCatStore()
  const isRestored = ref(false)

  onMounted(() => {
    appWindow.onMoved(onChange)

    appWindow.onResized(onChange)

    appWindow.onScaleChanged(clampToMonitor)
  })

  const clampToMonitor = useDebounceFn(async () => {
    try {
      if (label !== WINDOW_LABEL.MAIN || !catStore.window.keepInScreen) return

      const monitor = await getCursorMonitor()

      if (!monitor) return

      const { position: monitorPos, size: monitorSize } = monitor
      const windowSize = await appWindow.outerSize()
      const windowPos = await appWindow.outerPosition()

      if (!windowSize.width || !windowSize.height) return

      // Fenêtre plus grande que le moniteur : on l'ancre en haut à gauche
      // au lieu de calculer des bornes inversées.
      const maxX = Math.max(monitorPos.x, monitorPos.x + monitorSize.width - windowSize.width)
      const maxY = Math.max(monitorPos.y, monitorPos.y + monitorSize.height - windowSize.height)

      const clampedX = Math.max(monitorPos.x, Math.min(windowPos.x, maxX))
      const clampedY = Math.max(monitorPos.y, Math.min(windowPos.y, maxY))

      if (Math.abs(clampedX - windowPos.x) < 1 && Math.abs(clampedY - windowPos.y) < 1) return

      await appWindow.setPosition(new PhysicalPosition(clampedX, clampedY)).catch(() => {})
    } catch {}
  }, 500)

  watch(() => catStore.window.keepInScreen, clampToMonitor)

  const onChange = async (event: Event<PhysicalPosition | PhysicalSize>) => {
    try {
      const minimized = await appWindow.isMinimized()

      if (minimized) return

      appStore.windowState[label] ??= {}

      Object.assign(appStore.windowState[label], event.payload)

      clampToMonitor()
    } catch {}
  }

  const restoreState = async () => {
    try {
      const { x, y, width, height } = appStore.windowState[label] ?? {}

      if (isNumber(x) && isNumber(y)) {
        const monitors = await availableMonitors().catch((): Monitor[] => [])

        const monitor = monitors.find((monitor) => {
          const { position, size } = monitor

          const inBoundsX = x >= position.x && x <= position.x + size.width
          const inBoundsY = y >= position.y && y <= position.y + size.height

          return inBoundsX && inBoundsY
        })

        if (monitor) {
          await appWindow.setPosition(new PhysicalPosition(x, y)).catch(() => {})
        }
        // Sinon : position sauvegardée hors écran (moniteur débranché),
        // on garde la position par défaut au lieu d'ouvrir hors champ.
      }

      if (width && height && width > 0 && height > 0) {
        await appWindow.setSize(new PhysicalSize(width, height)).catch(() => {})
      }
    } catch {} finally {
      isRestored.value = true

      clampToMonitor()
    }
  }

  return {
    isRestored,
    restoreState,
  }
}
