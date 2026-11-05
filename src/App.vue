<script setup lang="ts">
import { useThemeEffect } from '@nick_tag_tech/themes/vue'
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, watch } from 'vue'

import { projectTrackerApi } from '@/services/projectTrackerApi'
import { useProjectsStore } from '@/stores/projects'
import { useThemeStore } from '@/stores/theme'

// Pull in writes from other processes when the window comes back to the front
// or the main process's poll sees one. Skipped while the user is typing: a
// fresh value for the field under the cursor would replace their unsaved text.
// The ticket modal refreshes on field focus, before any typing starts.
const projectsStore = useProjectsStore()
const userIsTyping = () => document.activeElement?.matches('input, textarea, select, [contenteditable]') ?? false
const refreshUnlessTyping = () => {
  if (!userIsTyping()) void projectsStore.refresh()
}
const stopExternalChangeListener = projectTrackerApi.onExternalChange(refreshUnlessTyping)
window.addEventListener('focus', refreshUnlessTyping)
onBeforeUnmount(() => {
  stopExternalChangeListener()
  window.removeEventListener('focus', refreshUnlessTyping)
})

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
