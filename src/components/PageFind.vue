<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { pageFindActive } from '@/pageFind'
import type { PageFindResult } from '@/shared/bridgeApi'

const OWN_INPUT_MATCH_ORDINAL = 1

const route = useRoute()
const visible = ref(false)
const query = ref('')
const input = ref<HTMLInputElement | null>(null)
const result = ref({ activeMatchOrdinal: 0, matches: 0 })
let unsubscribe: (() => void) | undefined
let previousFocus: HTMLElement | null = null
let searchTimer: ReturnType<typeof setTimeout> | undefined
let lastSearchForward = true

function cancelPendingSearch() {
  clearTimeout(searchTimer)
  searchTimer = undefined
}

function search(forward = true, newSession = true) {
  cancelPendingSearch()
  lastSearchForward = forward
  if (!query.value) {
    result.value = { activeMatchOrdinal: 0, matches: 0 }
    void window.projectTracker?.stopFindInPage?.()
    return
  }
  void window.projectTracker?.findInPage?.(query.value, forward, newSession)
}
function showResult({ activeMatchOrdinal, matches, finalUpdate }: PageFindResult) {
  const newerQueryPending = searchTimer !== undefined
  if (!visible.value || !query.value || newerQueryPending) return
  const landedOnOwnInput = finalUpdate && activeMatchOrdinal === OWN_INPUT_MATCH_ORDINAL
  const hasPageMatches = matches > 1
  if (landedOnOwnInput && hasPageMatches) {
    search(lastSearchForward, false)
    return
  }
  result.value = {
    activeMatchOrdinal: Math.max(activeMatchOrdinal - 1, 0),
    matches: Math.max(matches - 1, 0)
  }
  if (finalUpdate) input.value?.focus({ preventScroll: true })
}
function continueFromActiveMatch() {
  input.value?.blur()
  window.getSelection()?.removeAllRanges()
}
function step(forward: boolean) {
  const queryChangedSinceLastSearch = searchTimer !== undefined
  if (!queryChangedSinceLastSearch) continueFromActiveMatch()
  search(forward, queryChangedSinceLastSearch)
}
function close() {
  cancelPendingSearch()
  if (!visible.value) return
  visible.value = false
  void window.projectTracker?.stopFindInPage?.()
  previousFocus?.focus()
}
async function keydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'f') {
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
  searchTimer = setTimeout(() => search(), 100)
})
watch(() => route.fullPath, close)
watch(
  () => visible.value && Boolean(query.value),
  (active) => {
    pageFindActive.value = active
  }
)
onMounted(() => {
  window.addEventListener('keydown', keydown, true)
  unsubscribe = window.projectTracker?.onFindResult?.(showResult)
})
onBeforeUnmount(() => {
  pageFindActive.value = false
  cancelPendingSearch()
  window.removeEventListener('keydown', keydown, true)
  unsubscribe?.()
  void window.projectTracker?.stopFindInPage?.()
})
</script>

<template>
  <section v-if="visible" class="page-find" role="search" aria-label="Find on page">
    <input ref="input" v-model="query" aria-label="Find on page" placeholder="Find on page…" @keydown.enter.prevent="step(!$event.shiftKey)" />
    <span aria-live="polite">{{ query ? `${result.activeMatchOrdinal} of ${result.matches}` : '' }}</span>
    <button class="secondary" title="Previous match (Shift+Enter)" aria-label="Previous match" :disabled="!result.matches" @click="step(false)">↑</button>
    <button class="secondary" title="Next match (Enter)" aria-label="Next match" :disabled="!result.matches" @click="step(true)">↓</button>
    <button class="secondary" title="Close (Escape)" aria-label="Close search" @click="close">×</button>
  </section>
</template>
