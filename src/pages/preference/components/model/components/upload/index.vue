<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { appDataDir } from '@tauri-apps/api/path'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir } from '@tauri-apps/plugin-fs'
import { message } from 'antdv-next'
import { nanoid } from 'nanoid'
import { onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { Model, ModelMode } from '@/stores/model'

import { INVOKE_KEY } from '@/constants'
import { useModelStore } from '@/stores/model'
import { join } from '@/utils/path'

const dropRef = useTemplateRef('drop')
const dragenter = ref(false)
const selectPaths = ref<string[]>([])
const modelStore = useModelStore()
const { t } = useI18n()

onMounted(() => {
  const appWindow = getCurrentWebviewWindow()

  appWindow.onDragDropEvent(({ payload }) => {
    const { type } = payload

    if (type === 'over') {
      const { x, y } = payload.position

      if (dropRef.value) {
        const { left, right, top, bottom } = dropRef.value.getBoundingClientRect()

        const inBoundsX = x >= left && x <= right
        const inBoundsY = y >= top && y <= bottom

        dragenter.value = inBoundsX && inBoundsY
      }
    } else if (type === 'drop' && dragenter.value) {
      dragenter.value = false

      selectPaths.value = payload.paths
    } else {
      dragenter.value = false
    }
  })
})

async function handleUpload() {
  const selected = await open({ directory: true, multiple: true })

  if (!selected) return

  selectPaths.value = selected
}

watch(selectPaths, async (paths) => {
  for await (const fromPath of paths) {
    try {
      const id = nanoid()

      // (a) refus strict : un dossier sans `.model3.json` n'est pas un modèle
      // valide — on échoue AVANT la copie, rien n'est ajouté au store.
      const entries = await readDir(fromPath)

      if (!entries.some(entry => entry.name.endsWith('.model3.json'))) {
        throw new Error(`Dossier invalide (aucun .model3.json) : ${fromPath}`)
      }

      let mode: ModelMode = 'standard'

      const files = await readDir(join(fromPath, 'resources', 'right-keys')).catch(() => [])

      if (files.length > 0) {
        const fileNames = files.map(file => file.name.split('.')[0])

        if (fileNames.includes('East')) {
          mode = 'gamepad'
        } else {
          mode = 'keyboard'
        }
      }

      const toPath = join(await appDataDir(), 'custom-models', id)

      await invoke(INVOKE_KEY.COPY_DIR, {
        fromPath,
        toPath,
      })

      // (b) auto-activation immédiate : la fenêtre main recharge via son
      // watcher `currentModel` (store synchronisé inter-fenêtres).
      const nextModel: Model = {
        id,
        path: toPath,
        mode,
        isPreset: false,
      }

      modelStore.modelReady = false
      modelStore.models.push(nextModel)
      modelStore.currentModel = nextModel

      message.success(t('pages.preference.model.hints.importSuccess'))
    } catch (error) {
      message.error(String(error))
    }
  }

  // Permet de réimporter les mêmes dossiers plus tard (même sélection).
  selectPaths.value = []
})
</script>

<template>
  <div
    ref="drop"
    class="w-full flex flex-col cursor-pointer items-center justify-center gap-4 b-1 b-dashed bg-[--ant-color-fill-quaternary] transition b-border rounded-lg hover:border-primary"
    :class="{ 'border-primary': dragenter }"
    @click="handleUpload"
  >
    <div class="i-solar:upload-square-outline text-12 text-primary" />

    <span>{{ $t('pages.preference.model.hints.clickOrDragToImport') }}</span>
  </div>
</template>
