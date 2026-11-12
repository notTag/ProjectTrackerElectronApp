<script setup lang="ts">
import { onUnmounted, watch } from 'vue'

import { useProjectsStore } from '@/stores/projects'

const NOTICE_LIFETIME_MS = 30_000

const store = useProjectsStore()

const dismissNotice = () => {
  store.notice = null
}

// Errors never get a timer: they stay until ×.
let noticeTimer: ReturnType<typeof setTimeout> | undefined

// Clearing first means an older notice's timer can never wipe a newer one.
// `immediate` covers a notice set just before switching views.
watch(
  () => store.notice,
  (notice) => {
    clearTimeout(noticeTimer)
    if (!notice) return
    noticeTimer = setTimeout(dismissNotice, NOTICE_LIFETIME_MS)
  },
  { immediate: true },
)

onUnmounted(() => clearTimeout(noticeTimer))
</script>

<template>
  <section class="message-row">
    <Transition name="fade">
      <div v-if="store.error" class="message error" role="alert">
        <span class="message-text">{{ store.error }}</span>
        <button class="icon-button message-dismiss" title="Dismiss" @click="store.error = null">×</button>
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="store.notice" class="message notice" role="status">
        <span class="message-text">{{ store.notice }}</span>
        <button class="icon-button message-dismiss" title="Dismiss" @click="dismissNotice">×</button>
      </div>
    </Transition>
  </section>
</template>
