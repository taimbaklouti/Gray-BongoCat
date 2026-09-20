import type { MotionInfo } from 'easy-live2d'

import { convertFileSrc } from '@tauri-apps/api/core'
import { resolveResource } from '@tauri-apps/api/path'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { Config, CubismSetting, Live2DSprite, Priority } from 'easy-live2d'
import { groupBy } from 'es-toolkit/compat'
import JSON5 from 'json5'
import { Application, Ticker } from 'pixi.js'

import type { ModelSize } from '@/composables/useModel'

import { i18n } from '@/locales'

import { join, toAssetPath } from './path'
import { perfMark } from './perf'

Config.MouseFollow = false

// Delai max de chargement d'un modèle : au-delà, on échoue proprement
// au lieu de rester bloqué sur "Switching..." (voir `load`).
const LOAD_TIMEOUT_MS = 30_000

// Delai max par fichier d'asset lors de la sonde préalable.
const ASSET_PROBE_TIMEOUT_MS = 8000

function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)

  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} (délai ${ms}ms dépassé)`)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

class Live2d {
  private app: Application | null = null
  public model: Live2DSprite | null = null
  private firstFrameCallbacks = new Set<() => void>()

  constructor() { }

  // Abonnement one-shot à la première frame rendue (sert à afficher la
  // fenêtre masquée au boot). Retourne une fonction de désabonnement.
  public onFirstFrame(callback: () => void) {
    this.firstFrameCallbacks.add(callback)

    return () => {
      this.firstFrameCallbacks.delete(callback)
    }
  }

  private emitFirstFrame(sprite: Live2DSprite) {
    // Sprite périmé (timeout puis switch) : on ignore sa frame tardive.
    if (this.model !== sprite || this.firstFrameCallbacks.size === 0) return

    const callbacks = [...this.firstFrameCallbacks]

    this.firstFrameCallbacks.clear()

    for (const callback of callbacks) {
      try {
        callback()
      } catch {}
    }
  }

  private initApp() {
    if (this.app) return

    const view = document.getElementById('live2dCanvas')

    // Fenêtre sans canvas (ex. preference) ou appel avant montage :
    // on signale proprement au lieu de crasher Application.init().
    if (!(view instanceof HTMLCanvasElement)) {
      throw new TypeError(i18n.global.t('utils.live2d.hints.notFound'))
    }

    this.app = new Application()

    // Résolution capée : au-delà de 2x (HiDPI Windows 150-200%), le framebuffer
    // d'une fenêtre transparente sature le GPU pour un gain visuel nul.
    const resolution = Math.min(window.devicePixelRatio || 1, 2)

    return this.app.init({
      view,
      resizeTo: window,
      backgroundAlpha: 0,
      autoDensity: true,
      resolution,
    })
  }

  public async load(path: string) {
    await this.initApp()

    this.destroy()

    const files = await readDir(path)

    const modelFile = files.find(file => file.name.endsWith('.model3.json'))

    if (!modelFile) {
      throw new Error(i18n.global.t('utils.live2d.hints.notFound'))
    }

    const modelPath = join(path, modelFile.name)

    const modelJSON = JSON5.parse(await readTextFile(modelPath))

    // Sonde préalable : easy-live2d charge les textures via `new Image()`
    // SANS listener d'erreur — un seul asset illisible pend `model.ready`
    // pour toujours ("Switching..." infini, typique sous Webview2/Windows).
    // On échoue vite et avec le nom du fichier fautif.
    await this.probeAssets(path, modelJSON)

    const modelSetting = new CubismSetting({
      modelJSON,
    })

    modelSetting.redirectPath(({ file }) => {
      return convertFileSrc(toAssetPath(join(path, file)))
    })

    const sprite = new Live2DSprite({
      modelSetting,
      ticker: Ticker.shared,
    })

    sprite.onLive2D('ready', () => this.emitFirstFrame(sprite))

    this.model = sprite

    this.app?.stage.addChild(this.model)

    perfMark('live2d: sprite créé, attente première frame')

    try {
      // Garde-fou global : même si le loader interne pend (texture, moc,
      // motion), on ne bloque jamais l'UI plus de LOAD_TIMEOUT_MS.
      await withTimeout(this.model.ready, LOAD_TIMEOUT_MS, `Chargement du modèle ${modelFile.name}`)

      perfMark('live2d: modèle prêt')
    } catch (error) {
      // Sprite zombie : il pourrait se résoudre plus tard et s'afficher
      // par-dessus le modèle suivant. On le détruit avant de propager.
      this.destroy()

      throw error
    }

    const { width, height } = this.model

    const motions = groupBy(this.model.getMotions(), 'group')
    const expressions = this.model.getExpressions()

    return {
      width,
      height,
      motions,
      expressions,
    }
  }

  /**
   * Vérifie que le `.moc3` et chaque texture du modèle sont lisibles via le
   * protocole `asset:` AVANT de confier le chargement à easy-live2d
   * (qui ne signale jamais les échecs de textures). Ne télécharge les corps
   * que si les headers ne permettent pas de conclure (le vrai chargement
   * suit juste après : pas de double téléchargement dans le cas courant).
   */
  private async probeAssets(path: string, modelJSON: unknown) {
    const fileReferences = (modelJSON as {
      FileReferences?: { Moc?: unknown, Textures?: unknown }
    } | null | undefined)?.FileReferences ?? {}
    const { Moc, Textures } = fileReferences
    const candidates: string[] = [
      Moc,
      ...(Array.isArray(Textures) ? Textures : []),
    ].filter((file): file is string => typeof file === 'string' && file.length > 0)

    await Promise.all(candidates.map(async (file) => {
      const url = convertFileSrc(toAssetPath(join(path, file)))

      let response: Response

      try {
        response = await fetchWithTimeout(url, ASSET_PROBE_TIMEOUT_MS)
      } catch {
        throw new Error(`Asset illisible : ${file}`)
      }

      if (!response.ok) {
        throw new Error(`Asset illisible : ${file} (HTTP ${response.status})`)
      }

      const length = response.headers.get('content-length')

      if (length === '0') {
        throw new Error(`Asset vide : ${file}`)
      }

      // Sans content-length, on lit le corps pour garantir que l'asset est
      // réellement servi (et non un 200 vide), puis on libère la réponse.
      if (length === null) {
        await response.arrayBuffer().catch(() => {
          throw new Error(`Asset illisible : ${file}`)
        })
      }
    }))

    perfMark(`live2d: sonde OK (${candidates.length} assets)`)
  }

  /**
   * Précharge (S-3) les assets du modèle preset `standard` en tâche de fond
   * pendant les inits : `readDir`/JSON/`fetch` réchauffent les caches FS et
   * HTTP pour que le vrai `load()` n'ait plus qu'à décoder. Jamais bloquant,
   * jamais d'erreur propagée.
   */
  public async prefetchDefault() {
    try {
      const modelsPath = await resolveResource('assets/models')
      const dir = join(modelsPath, 'standard')
      const files = await readDir(dir)
      const modelFile = files.find(file => file.name.endsWith('.model3.json'))

      if (!modelFile) return

      const modelJSON = JSON5.parse(await readTextFile(join(dir, modelFile.name)))

      await this.probeAssets(dir, modelJSON)

      perfMark('live2d: préchargement standard OK')
    } catch {}
  }

  public destroy() {
    if (!this.model) return

    this.model?.destroy()

    this.model = null
  }

  public resizeModel(modelSize: ModelSize) {
    if (!this.model) return

    const { width, height } = modelSize

    const scaleX = innerWidth / width
    const scaleY = innerHeight / height
    const scale = Math.min(scaleX, scaleY)

    this.model.scale.set(scale)
    this.model.x = innerWidth / 2
    this.model.y = innerHeight / 2
    this.model.anchor.set(0.5)
  }

  public startMotion(motion: MotionInfo) {
    return this.model?.startMotion({
      ...motion,
      priority: Priority.Normal,
    })
  }

  public setExpression(index: number) {
    return this.model?.setExpression({ index })
  }

  public getParameterValueRange(id: string) {
    return this.model?.getParameterValueRangeById(id)
  }

  public setParameterValue(id: string, value: number | boolean) {
    return this.model?.setParameterValueById(id, Number(value))
  }

  public setMotionSoundEnabled(enabled: boolean) {
    Config.MotionSound = enabled
  }

  public setMaxFPS(fps: number) {
    Ticker.shared.maxFPS = fps
  }
}

const live2d = new Live2d()

export default live2d
