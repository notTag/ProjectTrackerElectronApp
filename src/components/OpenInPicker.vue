<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { OPEN_IN_TARGETS } from '@/shared/openInTargets'
import { useOpenInStore } from '@/stores/openIn'

const openInStore = useOpenInStore()
const { selectedId, selectedTarget } = storeToRefs(openInStore)

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const toggle = () => {
  open.value = !open.value
}

const select = (id: string) => {
  openInStore.select(id)
  open.value = false
}

const closeOnOutsideClick = (event: PointerEvent) => {
  if (rootRef.value?.contains(event.target as Node)) return
  open.value = false
}

onMounted(() => window.addEventListener('pointerdown', closeOnOutsideClick))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeOnOutsideClick))
</script>

<template>
  <div ref="rootRef" class="open-in-picker filter-menu">
    <button class="filter-trigger" :class="{ active: open }" @click="toggle">
      <span>Open In</span>
      <strong>{{ selectedTarget.label }}</strong>
    </button>
    <div v-if="open" class="filter-popover">
      <button
        v-for="target in OPEN_IN_TARGETS"
        :key="target.id"
        type="button"
        class="theme-option"
        :class="{ selected: target.id === selectedId }"
        @click="select(target.id)"
      >
        <span class="theme-name">{{ target.label }}</span>
        <span v-if="target.id === selectedId" class="theme-check">✓</span>
      </button>
    </div>
  </div>
</template>
