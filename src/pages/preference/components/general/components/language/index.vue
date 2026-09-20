<script setup lang="ts">
import { Select } from 'antdv-next'

import type { Language } from '@/stores/general'

import ProListItem from '@/components/pro-list-item/index.vue'
import { LANGUAGE } from '@/constants'
import { useGeneralStore } from '@/stores/general'

const generalStore = useGeneralStore()

const options: Array<{ label: string, value: Language }> = [
  { label: 'English', value: LANGUAGE.EN_US },
]
</script>

<template>
  <ProListItem :title="$t('pages.preference.general.labels.language')">
    <Select
      v-model:value="generalStore.appearance.language"
      :options="options"
    />
  </ProListItem>
</template>
