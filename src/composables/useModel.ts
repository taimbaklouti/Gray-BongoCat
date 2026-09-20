import type { PhysicalPosition } from '@tauri-apps/api/dpi'

import { LogicalSize } from '@tauri-apps/api/dpi'
import { resolveResource, sep } from '@tauri-apps/api/path'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { message } from 'antdv-next'
import { isNil, round } from 'es-toolkit'
import { findKey, nth } from 'es-toolkit/compat'
import { Ticker } from 'pixi.js'
import { ref } from 'vue'

import { useCatStore } from '@/stores/cat'
import { useModelStore } from '@/stores/model'
import { getCursorMonitor } from '@/utils/monitor'
import { perfMark } from '@/utils/perf'
import { isMac } from '@/utils/platform'

import live2d from '../utils/live2d'

const digitKeys = '1234567890'.split('') as readonly string[]
const letterKeys = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('') as readonly string[]

function getAppWindow() {
  return getCurrentWebviewWindow()
}

/**
 * Génération du chargement en cours, partagée entre toutes les instances du
 * composable : si l'utilisateur switch deux fois vite (A → B), le chargement
 * A, plus lent, ne doit ni écraser les motions de B ni toucher `modelReady`.
 */
let loadGeneration = 0

export interface ModelSize {
  width: number
  height: number
}

export function useModel() {
  const modelStore = useModelStore()
  const catStore = useCatStore()
  const modelSize = ref<ModelSize>()

  function getBehaviorShortcut(index: number) {
    const primary = isMac ? 'Command' : 'Control'

    const modifierGroups = [
      [primary],
      [primary, 'Shift'],
      [primary, 'Alt'],
      [primary, 'Shift', 'Alt'],
    ]

    const tiers = [
      ...modifierGroups.map(modifiers => ({ modifiers, keys: digitKeys })),
      ...modifierGroups.map(modifiers => ({ modifiers, keys: letterKeys })),
    ]

    let nextIndex = index

    for (const tier of tiers) {
      if (nextIndex < tier.keys.length) {
        return [...tier.modifiers, tier.keys[nextIndex]].join('+')
      }

      nextIndex -= tier.keys.length
    }

    return ''
  }

  function getMotionShortcutId(modelId: string, groupName: string, index: number) {
    return `${modelId}:motion:${groupName}:${index}`
  }

  function getExpressionShortcutId(modelId: string, index: number) {
    return `${modelId}:expression:${index}`
  }

  async function handleLoad() {
    const model = modelStore.currentModel

    if (!model) return

    const generation = ++loadGeneration
    const modelId = model.id

    const isStale = () => generation !== loadGeneration || modelStore.currentModel?.id !== modelId

    const reapplyHiddenPause = () => {
      // Le chargement a forcé le ticker (frames requises pour `ready`) :
      // si le chat est censé être caché, on rendort le rendu aussitôt.
      if (!catStore.window.visible) {
        Ticker.shared.stop()
      }
    }

    // W-6 × timeout : `model.ready` ne se résout que sur une frame rendue ;
    // le ticker DOIT tourner pendant le chargement, même fenêtre cachée.
    // (Start idempotent ; l'état "caché" est réappliqué en fin de chargement.)
    Ticker.shared.start()
    perfMark(`load start ${modelId.slice(0, 8)}`)

    try {
      const { path } = model

      await resolveResource(path)

      const { width, height, motions, expressions } = await live2d.load(path)

      // Switch plus récent entre-temps : on jette ce résultat périmé
      // (ni motions écrasées, ni overlay touché).
      if (isStale()) return

      const nextMotions = Object.entries(motions)

      modelSize.value = { width, height }
      modelStore.currentMotions = nextMotions
      modelStore.currentExpressions = expressions

      handleResize()

      const behaviorIds: string[] = []

      for (const [groupName, items] of nextMotions) {
        for (const [index] of items.entries()) {
          behaviorIds.push(getMotionShortcutId(modelId, groupName, index))
        }
      }

      for (const [index] of expressions.entries()) {
        behaviorIds.push(getExpressionShortcutId(modelId, index))
      }

      for (const [index, id] of behaviorIds.entries()) {
        if (modelStore.shortcuts[id]) continue

        const shortcut = getBehaviorShortcut(index)

        if (!shortcut) continue

        modelStore.shortcuts[id] = shortcut
      }

      modelStore.modelReady = true
      perfMark(`load done ${modelId.slice(0, 8)}`)
    } catch (error) {
      // Périmé : le switch en cours gère déjà l'overlay.
      if (isStale()) {
        reapplyHiddenPause()

        return
      }

      message.error(String(error))

      // Déblocage systématique : on libère l'overlay "Switching..."
      // (l'ancien modèle ayant été détruit, la scène peut rester vide,
      // mais l'UI ne reste jamais bloquée).
      modelStore.modelReady = true
      perfMark(`load error ${modelId.slice(0, 8)}`)
    }

    reapplyHiddenPause()
  }

  function handleDestroy() {
    live2d.destroy()
  }

  async function handleResize() {
    if (!modelSize.value) return

    live2d.resizeModel(modelSize.value)

    const { width, height } = modelSize.value

    if (round(innerWidth / innerHeight, 1) !== round(width / height, 1)) {
      // Taille logique ici (voir main/index.vue : taille physique =
      // logique × scale/100) : on ne touche pas à la sémantique, on
      // évite juste de laisser une erreur IPC casser le redimensionnement.
      await getAppWindow().setSize(
        new LogicalSize({
          width: innerWidth,
          height: Math.ceil(innerWidth * (height / width)),
        }),
      ).catch(() => {})
    }

    const size = await getAppWindow().size().catch(() => null)

    if (!size || !size.width) return

    const nextScale = round((size.width / width) * 100)

    if (Number.isFinite(nextScale) && nextScale > 0) {
      catStore.window.scale = nextScale
    }
  }

  const handlePress = (key: string) => {
    const path = modelStore.supportKeys[key]

    if (!path) return

    const dirName = nth(path.split(sep()), -2)!
    const prevKey = findKey(modelStore.pressedKeys, (value) => {
      return value.includes(dirName)
    })

    if (prevKey) {
      handleRelease(prevKey)
    }

    modelStore.pressedKeys[key] = path
  }

  const handleRelease = (key: string) => {
    delete modelStore.pressedKeys[key]
  }

  function handleKeyChange(isLeft = true, pressed = true) {
    const id = isLeft ? 'CatParamLeftHandDown' : 'CatParamRightHandDown'

    live2d.setParameterValue(id, pressed)
  }

  function handleMouseChange(key: string, pressed = true) {
    const id = key === 'Left' ? 'ParamMouseLeftDown' : 'ParamMouseRightDown'

    live2d.setParameterValue(id, pressed)
  }

  async function handleMouseMove(cursorPoint: PhysicalPosition) {
    const monitor = await getCursorMonitor(cursorPoint)

    if (!monitor) return

    const { size, position } = monitor

    const xRatio = (cursorPoint.x - position.x) / size.width
    const yRatio = (cursorPoint.y - position.y) / size.height

    for (const id of [
      'ParamMouseX',
      'ParamMouseY',
      'ParamAngleX',
      'ParamAngleY',
      'ParamAngleZ',
      'ParamEyeBallX',
      'ParamEyeBallY',
    ]) {
      const range = live2d.getParameterValueRange(id)

      if (!range) continue

      const { min, max } = range

      if (isNil(min) || isNil(max)) continue

      const isXAxis = id.endsWith('X')
      const isYAxis = id.endsWith('Y')
      const isZAxis = id.endsWith('Z')

      let value: number

      if (isZAxis) {
        const dragX = 1 - 2 * xRatio
        const dragY = 1 - 2 * yRatio

        value = dragX * dragY * min
      } else {
        const ratio = isXAxis ? xRatio : yRatio

        value = max - ratio * (max - min)
      }

      if (!isYAxis && catStore.model.mouseMirror) {
        value *= -1
      }

      live2d.setParameterValue(id, value)
    }
  }

  async function handleAxisChange(id: string, value: number) {
    const range = live2d.getParameterValueRange(id)

    if (!range) return

    const { min, max } = range

    live2d.setParameterValue(id, Math.max(min, value * max))
  }

  return {
    modelSize,
    handlePress,
    handleRelease,
    handleLoad,
    handleDestroy,
    handleResize,
    handleKeyChange,
    handleMouseChange,
    handleMouseMove,
    handleAxisChange,
  }
}
