<script setup lang="ts">
const expanded = defineModel<boolean>({ required: true })

// A dragged (resize: horizontal) width is an inline style that beats .modal.expanded.
function toggle(event: MouseEvent) {
  const button = event.currentTarget as HTMLElement
  const modal = button.closest<HTMLElement>('.modal')
  modal?.style.removeProperty('width')
  expanded.value = !expanded.value
}
</script>

<template>
  <button
    type="button"
    class="icon-button"
    :title="expanded ? 'Collapse' : 'Expand'"
    :aria-label="expanded ? 'Collapse' : 'Expand'"
    :aria-pressed="expanded"
    @click="toggle"
  >
    <svg v-if="expanded" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
    <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  </button>
</template>
