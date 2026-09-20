import type { ShortcutHandler } from '@tauri-apps/plugin-global-shortcut'
import type { Ref } from 'vue'

import {
  isRegistered,
  register,
  unregister,
} from '@tauri-apps/plugin-global-shortcut'
import { message } from 'antdv-next'
import { onUnmounted, ref, watch } from 'vue'

export function useKeyPress(shortcut: Ref<string | undefined, string>, callback: ShortcutHandler) {
  const oldShortcut = ref(shortcut.value)

  async function unbind() {
    if (!oldShortcut.value) return

    const registered = await isRegistered(oldShortcut.value)

    if (!registered) return

    return unregister(oldShortcut.value)
  }

  watch(shortcut, async (value) => {
    await unbind().catch(() => {})

    if (!value) return

    try {
      await register(value, (event) => {
        if (event.state === 'Released') return

        callback(event)
      })
    } catch {
      // Sur Windows, un raccourci déjà pris par le système/OS fait échouer
      // l'enregistrement : on l'explique au lieu d'une rejection silencieuse.
      message.warning(`Raccourci global non enregistré (conflit système ?) : ${value}`)

      return
    }

    oldShortcut.value = value
  }, { immediate: true })

  onUnmounted(() => unbind().catch(() => {}))
}
