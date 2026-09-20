<script setup lang="ts">
import { Flex } from 'antdv-next'

const { title } = defineProps<{
  title: string
}>()
</script>

<template>
  <Flex
    class="not-last:mb-4"
    gap="small"
    vertical
  >
    <div
      class="text-4 text-[var(--pixel-maroon)] font-medium"
      data-tauri-drag-region
    >
      {{ title }}
    </div>

    <Flex
      gap="middle"
      vertical
    >
      <slot />
    </Flex>
  </Flex>
</template>
