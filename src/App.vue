<script setup lang="ts">
import { useThemeEffect } from '@nick_tag_tech/themes/vue'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'

import { useThemeStore } from '@/stores/theme'

// Applies the active theme's CSS variables + data-theme-type to <html>,
// reapplying whenever the selection (or live preview) changes.
const { currentTheme } = storeToRefs(useThemeStore())
useThemeEffect(currentTheme)

// Keep the macOS traffic-light glyphs legible by matching their light/dark
// rendering to the active theme. The strip color itself comes from CSS.
watch(
  () => currentTheme.value.type,
  (type) => void window.projectTracker?.setNativeTheme?.(type),
  { immediate: true }
)
</script>

<template>
  <RouterView />
</template>
