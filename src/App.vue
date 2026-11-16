<script setup lang="ts">
import { useThemeEffect } from '@nick_tag_tech/themes/vue'
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, watch } from 'vue'

import PageFind from '@/components/PageFind.vue'
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

// The first pass runs after load(); this catches tabs closed later.
const AGENT_RUN_RECONCILE_MS = 60_000
const reconcileAgentRuns = () => void projectsStore.reconcileAgentRuns().catch(() => undefined)
const reconcileTimer = setInterval(reconcileAgentRuns, AGENT_RUN_RECONCILE_MS)
const stopAgentRetryListener = projectTrackerApi.onAgentRetry((retry) => projectsStore.noteAgentRetry(retry))

// Notices clear themselves 30 s after each new one; errors stay until ×.
// The clock lives here, above <RouterView />, because each view mounts its own
// MessageBanners — a timer there would restart on every Board ↔ Dashboard switch.
// Clearing the pending timer on every change means an old timer can never wipe
// a newer notice, and × (notice → null) cancels it too.
const NOTICE_LIFETIME_MS = 30_000
let noticeTimer: ReturnType<typeof setTimeout> | undefined
const dismissNotice = () => {
  projectsStore.notice = null
}
watch(
  () => projectsStore.notice,
  (notice) => {
    clearTimeout(noticeTimer)
    if (!notice) return
    noticeTimer = setTimeout(dismissNotice, NOTICE_LIFETIME_MS)
  },
)

onBeforeUnmount(() => {
  stopExternalChangeListener()
  stopAgentRetryListener()
  clearInterval(reconcileTimer)
  window.removeEventListener('focus', refreshUnlessTyping)
  clearTimeout(noticeTimer)
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
  <PageFind />
</template>
