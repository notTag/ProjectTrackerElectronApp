<script setup lang="ts">
import { useProjectsStore } from '@/stores/projects'

// Render only. The notice auto-dismiss timer lives in App.vue so it survives
// route changes; errors never get one and stay until ×.
const store = useProjectsStore()

const dismissError = () => {
  store.error = null
}
const dismissNotice = () => {
  store.notice = null
}
</script>

<template>
  <section class="message-row">
    <Transition name="fade">
      <div v-if="store.error" class="message error" role="alert">
        <span class="message-text">{{ store.error }}</span>
        <button class="icon-button message-dismiss" title="Dismiss" @click="dismissError">×</button>
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
