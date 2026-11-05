<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const visible = ref(false)
const query = ref('')
const input = ref<HTMLInputElement | null>(null)
const result = ref({ activeMatchOrdinal: 0, matches: 0 })
let unsubscribe: (() => void) | undefined
let previousFocus: HTMLElement | null = null
let searchTimer: ReturnType<typeof setTimeout> | undefined

function cancelPendingSearch() {
  clearTimeout(searchTimer)
  searchTimer = undefined
}

function search(forward = true, next = false) {
  cancelPendingSearch()
  if (!query.value) {
    result.value = { activeMatchOrdinal: 0, matches: 0 }
    void window.projectTracker?.stopFindInPage()
    return
  }
  void window.projectTracker?.findInPage(query.value, forward, next)
}
function close() {
  cancelPendingSearch()
  if (!visible.value) return
  visible.value = false
  void window.projectTracker?.stopFindInPage()
  previousFocus?.focus()
}
async function keydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    event.stopPropagation()
    if (!visible.value) previousFocus = document.activeElement as HTMLElement | null
    visible.value = true
    await nextTick()
    input.value?.focus()
    input.value?.select()
    search()
  } else if (visible.value && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}
watch(query, () => {
  cancelPendingSearch()
  searchTimer = setTimeout(() => search(), 300)
})
watch(() => route.fullPath, close)
onMounted(() => {
  window.addEventListener('keydown', keydown, true)
  unsubscribe = window.projectTracker?.onFindResult(value => {
    if (visible.value && query.value) result.value = value
  })
})
onBeforeUnmount(() => {
  cancelPendingSearch()
  window.removeEventListener('keydown', keydown, true)
  unsubscribe?.()
  void window.projectTracker?.stopFindInPage()
})
</script>

<template>
  <section v-if="visible" class="page-find" role="search" aria-label="Find on page">
    <input ref="input" v-model="query" aria-label="Find on page" placeholder="Find on page…" @keydown.enter.prevent="search(!$event.shiftKey, true)" />
    <span aria-live="polite">{{ query ? `${result.activeMatchOrdinal} of ${result.matches}` : '' }}</span>
    <button class="secondary" title="Previous match (Shift+Enter)" aria-label="Previous match" :disabled="!result.matches" @click="search(false, true)">↑</button>
    <button class="secondary" title="Next match (Enter)" aria-label="Next match" :disabled="!result.matches" @click="search(true, true)">↓</button>
    <button class="secondary" title="Close (Escape)" aria-label="Close search" @click="close">×</button>
  </section>
</template>
