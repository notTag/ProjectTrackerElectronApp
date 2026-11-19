<script setup lang="ts">
import { ref, useId } from 'vue'

defineProps<{ text: string }>()

const tipId = useId()
const dismissed = ref(false)

// The board's window keydown handler closes the modal on Escape. Stopping the
// first Escape here hides just the tip; a second one bubbles and closes the modal.
const dismissOnEscape = (event: KeyboardEvent) => {
  if (dismissed.value) return
  dismissed.value = true
  event.stopPropagation()
}

const resetDismissed = () => {
  dismissed.value = false
}
</script>

<template>
  <span class="info-tip" :class="{ dismissed }" @mouseleave="resetDismissed">
    <!-- .prevent: inside a <label>, a click would toggle the checkbox / focus the textarea. -->
    <button
      type="button"
      class="info-tip-button"
      aria-label="More info"
      :aria-describedby="tipId"
      @click.prevent
      @keydown.esc="dismissOnEscape"
      @blur="resetDismissed"
    >
      ⓘ
    </button>
    <span :id="tipId" role="tooltip" class="info-tip-bubble">{{ text }}</span>
  </span>
</template>
