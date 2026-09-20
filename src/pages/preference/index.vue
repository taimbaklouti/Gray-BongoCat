<script setup lang="ts">
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Flex, Spin } from 'antdv-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import TitleBar from '@/components/title-bar/index.vue'
import UpdateApp from '@/components/update-app/index.vue'
import { useTray } from '@/composables/useTray'
import { useAppStore } from '@/stores/app'
import { useGeneralStore } from '@/stores/general'
import { useModelStore } from '@/stores/model'

import About from './components/about/index.vue'
import Cat from './components/cat/index.vue'
import General from './components/general/index.vue'
import Model from './components/model/index.vue'
import Shortcut from './components/shortcut/index.vue'

useTray()
const appStore = useAppStore()
const current = ref(0)
const { t } = useI18n()
const generalStore = useGeneralStore()
const modelStore = useModelStore()
const appWindow = getCurrentWebviewWindow()

watch(() => generalStore.appearance.language, () => {
  appWindow.setTitle(t('pages.preference.title'))
}, { immediate: true })

const menus = computed(() => [
  {
    key: 'cat',
    label: t('pages.preference.cat.title'),
    icon: 'i-solar:cat-bold',
    component: Cat,
  },
  {
    key: 'general',
    label: t('pages.preference.general.title'),
    icon: 'i-solar:settings-minimalistic-bold',
    component: General,
  },
  {
    key: 'model',
    label: t('pages.preference.model.title'),
    icon: 'i-solar:magic-stick-3-bold',
    component: Model,
  },
  {
    key: 'shortcut',
    label: t('pages.preference.shortcut.title'),
    icon: 'i-solar:keyboard-bold',
    component: Shortcut,
  },
  {
    key: 'about',
    label: t('pages.preference.about.title'),
    icon: 'i-solar:info-circle-bold',
    component: About,
  },
])
</script>

<template>
  <TitleBar
    class="z-10"
    :title="appStore.name"
  />

  <Spin
    class="max-h-unset!"
    :description="t('pages.main.hints.switching')"
    fullscreen
    size="large"
    :spinning="!modelStore.modelReady"
  />

  <Flex class="pixel-gingham pixel-frame h-[calc(100vh-40px)] overflow-hidden bg-[#fff5f7]">
    <div
      class="pixel-gingham h-full w-30 flex flex-col items-center gap-4 overflow-auto b-r-4 b-[var(--pixel-coral)] b-solid bg-[#fff5f7] pt-4"
      data-tauri-drag-region
    >
      <div class="flex flex-col items-center gap-2">
        <div class="b-1 rounded-2xl b-solid b-border-sec">
          <img
            class="size-15"
            data-tauri-drag-region
            src="/logo.png"
          >
        </div>

        <span class="font-bold">{{ appStore.name }}</span>
      </div>

      <div class="flex flex-col gap-2">
        <div
          v-for="(item, index) in menus"
          :key="item.key"
          class="size-20 flex flex-col cursor-pointer items-center justify-center gap-2 transition rounded-lg hover:bg-[#ffffff]"
          :class="{ 'bg-[#ffffff]! font-bold shadow-[0_2px_0_0_var(--pixel-coral)]': current === index }"
          @click="current = index"
        >
          <div
            class="size-8 text-[var(--pixel-maroon)]"
            :class="item.icon"
          />

          <span class="text-[var(--pixel-maroon)]">{{ item.label }}</span>
        </div>
      </div>
    </div>

    <div
      v-for="(item, index) in menus"
      v-show="current === index"
      :key="item.key"
      class="flex-1 overflow-auto bg-[#fff5f7] p-4"
      data-tauri-drag-region
    >
      <component :is="item.component" />
    </div>
  </Flex>

  <UpdateApp />
</template>
