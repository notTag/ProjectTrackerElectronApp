<script setup lang="ts">
import { themeList } from '@nick_tag_tech/themes'
import type { ThemeId } from '@nick_tag_tech/themes'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
const { activeThemeId, confirmedThemeId } = storeToRefs(themeStore)

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const confirmedName = computed(
  () => themeList.find((theme) => theme.id === confirmedThemeId.value)?.name ?? 'Theme'
)

// Group themes by light/dark so the menu reads cleanly.
const groupedThemes = computed(() => ({
  light: themeList.filter((theme) => theme.type === 'light'),
  dark: themeList.filter((theme) => theme.type === 'dark')
}))

const toggle = () => {
  open.value = !open.value
  if (!open.value) themeStore.revertPreview()
}

const selectTheme = (id: ThemeId) => {
  themeStore.setTheme(id)
  open.value = false
}

// Live preview while hovering, reverted on leave/close.
const preview = (id: ThemeId) => themeStore.previewTheme(id)
const endPreview = () => themeStore.revertPreview()

const closeOnOutsideClick = (event: PointerEvent) => {
  if (rootRef.value?.contains(event.target as Node)) return
  if (!open.value) return
  open.value = false
  themeStore.revertPreview()
}

onMounted(() => window.addEventListener('pointerdown', closeOnOutsideClick))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeOnOutsideClick))
</script>

<template>
  <div ref="rootRef" class="theme-picker filter-menu">
    <button class="filter-trigger" :class="{ active: open }" @click="toggle">
      <span>Theme</span>
      <strong>{{ confirmedName }}</strong>
    </button>
    <div v-if="open" class="filter-popover theme-popover" @pointerleave="endPreview">
      <template v-for="(group, type) in groupedThemes" :key="type">
        <p class="theme-group">{{ type }}</p>
        <button
          v-for="theme in group"
          :key="theme.id"
          type="button"
          class="theme-option"
          :class="{ selected: theme.id === activeThemeId }"
          @pointerenter="preview(theme.id)"
          @click="selectTheme(theme.id)"
        >
          <span class="theme-swatch" :style="{ background: theme.colors.accent }" />
          <span class="theme-name">{{ theme.name }}</span>
          <span v-if="theme.id === confirmedThemeId" class="theme-check">✓</span>
        </button>
      </template>
    </div>
  </div>
</template>
