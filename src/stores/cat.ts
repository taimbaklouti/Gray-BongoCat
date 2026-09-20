import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'

export interface CatStore {
  model: {
    mirror: boolean
    mouseMirror: boolean
    motionSound: boolean
    behavior: boolean
    autoReleaseDelay: number
    maxFPS: number
    ignoreMouse: boolean
  }
  window: {
    visible: boolean
    passThrough: boolean
    alwaysOnTop: boolean
    scale: number
    opacity: number
    radius: number
    hideOnHover: boolean
    hideOnHoverDelay: number
    keepInScreen: boolean
  }
}

export const useCatStore = defineStore('cat', () => {
  /* ------------ 废弃字段（后续删除） ------------ */

  /** @deprecated 请使用 `model.mirror` */
  const mirrorMode = ref(false)

  /** @deprecated 请使用 `model.mouseMirror` */
  const mouseMirror = ref(false)

  /** @deprecated 请使用 `window.passThrough` */
  const penetrable = ref(false)

  /** @deprecated 请使用 `window.alwaysOnTop` */
  const alwaysOnTop = ref(true)

  /** @deprecated 请使用 `window.scale` */
  const scale = ref(100)

  /** @deprecated 请使用 `window.opacity` */
  const opacity = ref(100)

  /** @deprecated 用于标识数据是否已迁移，后续版本将删除 */
  const migrated = ref(false)

  const model = reactive<CatStore['model']>({
    mirror: false,
    mouseMirror: false,
    motionSound: true,
    behavior: true,
    autoReleaseDelay: 3,
    maxFPS: 60,
    ignoreMouse: false,
  })

  const window = reactive<CatStore['window']>({
    visible: true,
    passThrough: false,
    // Le chat démarre toujours au premier plan par défaut.
    alwaysOnTop: true,
    scale: 100,
    opacity: 100,
    radius: 0,
    hideOnHover: false,
    hideOnHoverDelay: 0,
    keepInScreen: true,
  })

  const sanitize = () => {
    const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback

    window.scale = Math.min(500, Math.max(10, finiteOr(window.scale, 100)))
    window.opacity = Math.min(100, Math.max(0, finiteOr(window.opacity, 100)))
    window.radius = Math.min(100, Math.max(0, finiteOr(window.radius, 0)))
    window.hideOnHoverDelay = Math.max(0, finiteOr(window.hideOnHoverDelay, 0))
    model.autoReleaseDelay = Math.max(0, finiteOr(model.autoReleaseDelay, 3))
    model.maxFPS = Math.min(240, Math.max(1, finiteOr(model.maxFPS, 60)))
  }

  const init = () => {
    if (!migrated.value) {
      model.mirror = mirrorMode.value
      model.mouseMirror = mouseMirror.value

      window.visible = true
      window.passThrough = penetrable.value
      window.alwaysOnTop = alwaysOnTop.value
      window.scale = scale.value
      window.opacity = opacity.value

      migrated.value = true
    }

    // Valeurs persistées potentiellement corrompues (pinia JSON édité à
    // la main, ancienne version) : on assainit sans écraser les choix valides.
    sanitize()

    // Toujours au premier plan à chaque lancement, quelle que soit la
    // valeur persistée (l'option reste modifiable pendant la session).
    window.alwaysOnTop = true
  }

  return {
    migrated,
    model,
    window,
    init,
  }
})
