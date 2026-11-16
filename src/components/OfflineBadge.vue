<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { GITHUB_UNREACHABLE_MESSAGE } from '@/shared/projectTypes'

// ponytail: navigator.onLine tracks the network interface, so Wi-Fi off shows
// the badge but a captive portal doesn't. Drive it from GitHub failures too if
// that case matters.
const offline = ref(!navigator.onLine)
const syncOnlineState = () => {
  offline.value = !navigator.onLine
}

onMounted(() => {
  window.addEventListener('online', syncOnlineState)
  window.addEventListener('offline', syncOnlineState)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', syncOnlineState)
  window.removeEventListener('offline', syncOnlineState)
})
</script>

<template>
  <span
    v-if="offline"
    class="offline-badge"
    role="status"
    title="No network. Local boards and tickets still work; GitHub features wait for a connection."
  >
    {{ GITHUB_UNREACHABLE_MESSAGE }}
  </span>
</template>
