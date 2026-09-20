import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { cursorPosition } from '@tauri-apps/api/window'
import { info as logInfo, warn as logWarn } from '@tauri-apps/plugin-log'
import { isNil } from 'es-toolkit'
import { Ticker } from 'pixi.js'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useAppStore } from '@/stores/app'
import { useCatStore } from '@/stores/cat'
import { useModelStore } from '@/stores/model'
import { inBetween } from '@/utils/is'
import { isMac, isWindows } from '@/utils/platform'

import { INVOKE_KEY, LISTEN_KEY, WINDOW_LABEL } from '../constants'
import { useModel } from './useModel'
import { useTauriListen } from './useTauriListen'

interface MouseButtonEvent {
  kind: 'MousePress' | 'MouseRelease'
  value: string
}

export interface CursorPoint {
  x: number
  y: number
}

interface MouseMoveEvent {
  kind: 'MouseMove'
  value: CursorPoint
}

interface KeyboardEvent {
  kind: 'KeyboardPress' | 'KeyboardRelease'
  value: string
}

type DeviceEvent = MouseButtonEvent | MouseMoveEvent | KeyboardEvent

const DAMPING_DECAY = 0.75

function getAppWindow() {
  return getCurrentWebviewWindow()
}

export function useDevice() {
  const modelStore = useModelStore()
  const releaseTimers = new Map<string, NodeJS.Timeout>()
  const appStore = useAppStore()
  const catStore = useCatStore()
  const latestCursorPoint = ref<CursorPoint>()
  const smoothedCursorPoint = ref<CursorPoint>()
  const scaleFactor = ref(1)
  const { handlePress, handleRelease, handleMouseChange, handleMouseMove } = useModel()

  const tickerCallback = (ticker: Ticker) => {
    const destination = latestCursorPoint.value

    if (!destination) return

    const current = smoothedCursorPoint.value ?? destination

    const alpha = 1 - DAMPING_DECAY ** (ticker.deltaMS / (1000 / 60))

    const interpolated = {
      x: current.x + (destination.x - current.x) * alpha,
      y: current.y + (destination.y - current.y) * alpha,
    }

    if (Math.hypot(destination.x - interpolated.x, destination.y - interpolated.y) < 0.5) {
      smoothedCursorPoint.value = { ...destination }

      latestCursorPoint.value = void 0
    } else {
      smoothedCursorPoint.value = interpolated
    }

    void handleCursorMove(smoothedCursorPoint.value)
  }

  onMounted(async () => {
    try {
      scaleFactor.value = isMac ? await getAppWindow().scaleFactor() : 1
    } catch {
      scaleFactor.value = 1
    }

    try {
      getAppWindow().onScaleChanged(({ payload }) => {
        if (!isMac) return

        scaleFactor.value = payload.scaleFactor
      })
    } catch {}
  })

  onUnmounted(() => {
    Ticker.shared.remove(tickerCallback)

    for (const timer of releaseTimers.values()) {
      clearTimeout(timer)
    }

    releaseTimers.clear()
  })

  watch(() => catStore.model.ignoreMouse, (value) => {
    if (value) {
      return Ticker.shared.remove(tickerCallback)
    }

    return Ticker.shared.add(tickerCallback)
  }, { immediate: true })

  const startListening = () => {
    // Erreur (permissions, backend indisponible) loggée, jamais propagée :
    // le chat doit rester visible même si l'écoute échoue.
    return invoke(INVOKE_KEY.START_DEVICE_LISTENING).catch(() => {})
  }

  const getSupportedKey = (key: string) => {
    let nextKey = key

    const unsupportedKey = !modelStore.supportKeys[nextKey]

    if (key.startsWith('F') && unsupportedKey) {
      nextKey = key.replace(/F(\d+)/, 'Fn')
    }

    for (const item of ['Meta', 'Shift', 'Alt', 'Control']) {
      if (key.startsWith(item) && unsupportedKey) {
        const regex = new RegExp(`^(${item}).*`)
        nextKey = key.replace(regex, '$1')
      }
    }

    return nextKey
  }

  // P1 : si le hit-test par événements diverge (cache windowState périmé,
  // scaling HiDPI faux), `body.opacity` restait à '0' pour toujours → chat
  // invisible alors que tout est chargé. Le watchdog réévalue avec la
  // position curseur + rect fenêtre LIVE et restaure si besoin.
  const HIDE_WATCHDOG_MS = 2000

  const onHideOnHover = (() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setInterval> | undefined
    let wasInWindow = false

    const stopWatchdog = () => {
      if (watchdog) {
        clearInterval(watchdog)

        watchdog = void 0
      }
    }

    const setHidden = (hidden: boolean, source: string) => {
      if (hidden) {
        document.body.style.setProperty('opacity', '0')

        getAppWindow().setIgnoreCursorEvents(true).catch(() => {})
      } else {
        document.body.style.setProperty('opacity', 'unset')

        getAppWindow().setIgnoreCursorEvents(catStore.window.passThrough).catch(() => {})
      }

      logInfo(`[hide-on-hover] ${hidden ? 'masqué' : 'restauré'} (${source})`).catch(() => {})
    }

    const restoreVisible = (source: string) => {
      stopWatchdog()

      wasInWindow = false

      setHidden(false, source)
    }

    const armWatchdog = () => {
      stopWatchdog()

      watchdog = setInterval(async () => {
        try {
          const pos = await cursorPosition().catch(() => null)

          if (!pos) return

          const rect = await liveRect()

          if (!rect) return

          if (!inBetween(pos.x, rect.x, rect.x + rect.width)
            || !inBetween(pos.y, rect.y, rect.y + rect.height)) {
            logWarn(`[hide-on-hover] watchdog : curseur hors fenêtre (${pos.x},${pos.y}), restauration forcée`).catch(() => {})

            restoreVisible('watchdog')
          }
        } catch {}
      }, HIDE_WATCHDOG_MS)
    }

    // Rect fenêtre LIVE (jamais le cache windowState, périmé après
    // déplacement/redimensionnement ou faux sous scaling Windows).
    const liveRect = async () => {
      const [pos, size] = await Promise.all([
        getAppWindow().outerPosition().catch(() => null),
        getAppWindow().outerSize().catch(() => null),
      ])

      if (!pos || !size || !size.width || !size.height) {
        const cached = appStore.windowState[WINDOW_LABEL.MAIN] ?? {}

        if (isNil(cached.x) || isNil(cached.y) || isNil(cached.width) || isNil(cached.height)) return null

        return { x: cached.x, y: cached.y, width: cached.width, height: cached.height }
      }

      return { x: pos.x, y: pos.y, width: size.width, height: size.height }
    }

    const fn = Object.assign(async (x: number, y: number) => {
      const rect = await liveRect()

      if (!rect) return

      const isInWindow = inBetween(x, rect.x, rect.x + rect.width)
        && inBetween(y, rect.y, rect.y + rect.height)

      if (isInWindow) {
        // Déjà caché ou masquage déjà armé : rien à faire.
        if (wasInWindow || timer) return

        timer = setTimeout(() => {
          timer = void 0

          wasInWindow = true

          setHidden(true, 'hover')

          armWatchdog()
        }, catStore.window.hideOnHoverDelay * 1000)
      } else {
        // Sortie avant la fin du délai : on désarme sans restaurer
        // (le chat n'a jamais été masqué).
        if (timer) {
          clearTimeout(timer)

          timer = void 0
        }

        if (!wasInWindow) return

        restoreVisible('hover-leave')
      }
    }, { stopWatchdog })

    return fn
  })()

  // Le watchdog tourne après un masquage : on l'arrête à la destruction.
  onUnmounted(() => {
    onHideOnHover.stopWatchdog()
  })

  const handleCursorMove = async (cursorPoint: CursorPoint) => {
    try {
      const x = cursorPoint.x * scaleFactor.value
      const y = cursorPoint.y * scaleFactor.value

      await handleMouseMove(new PhysicalPosition(x, y))

      if (!catStore.window.hideOnHover) return

      await onHideOnHover(x, y)
    } catch {}
  }

  const handleAutoRelease = (key: string, delay = 100) => {
    handlePress(key)

    if (releaseTimers.has(key)) {
      clearTimeout(releaseTimers.get(key))
    }

    const timer = setTimeout(() => {
      handleRelease(key)

      releaseTimers.delete(key)
    }, delay)

    releaseTimers.set(key, timer)
  }

  useTauriListen<DeviceEvent>(LISTEN_KEY.DEVICE_CHANGED, ({ payload }) => {
    const { kind, value } = payload

    if (kind === 'KeyboardPress' || kind === 'KeyboardRelease') {
      const nextValue = getSupportedKey(value)

      if (!nextValue) return

      if (nextValue === 'CapsLock') {
        return handleAutoRelease(nextValue)
      }

      if (kind === 'KeyboardPress') {
        if (isWindows) {
          const delay = catStore.model.autoReleaseDelay * 1000

          return handleAutoRelease(nextValue, delay)
        }

        return handlePress(nextValue)
      }

      return handleRelease(nextValue)
    }

    switch (kind) {
      case 'MousePress':
        return handleMouseChange(value)
      case 'MouseRelease':
        return handleMouseChange(value, false)
      case 'MouseMove':
        return latestCursorPoint.value = value
    }
  })

  return {
    startListening,
  }
}
