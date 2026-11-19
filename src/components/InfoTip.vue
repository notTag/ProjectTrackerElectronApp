<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'

defineProps<{ text: string }>()

const tipId = useId()
const dismissed = ref(false)
const wrapper = ref<HTMLElement>()
const button = ref<HTMLButtonElement>()

const isHovered = () => Boolean(wrapper.value?.matches(':hover'))
const hasKeyboardFocus = () => Boolean(button.value?.matches(':focus-visible'))
const isShowing = () => !dismissed.value && (isHovered() || hasKeyboardFocus())

// The board's window keydown handler closes the modal on Escape. Listening in the
// capture phase lets the first Escape hide just the tip, whether hover or focus
// showed it; once the tip is hidden, Escape passes through and closes the modal.
const dismissOnEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !isShowing()) return
  dismissed.value = true
  event.stopPropagation()
}

const resetOnMouseLeave = () => {
  if (!hasKeyboardFocus()) dismissed.value = false
}

const resetOnBlur = () => {
  if (!isHovered()) dismissed.value = false
}

onMounted(() => window.addEventListener('keydown', dismissOnEscape, true))
onBeforeUnmount(() => window.removeEventListener('keydown', dismissOnEscape, true))
</script>

<template>
  <!-- click.prevent: the tip sits inside field labels; a click on the bubble would
       otherwise run label activation and toggle the adjacent checkbox. -->
  <span ref="wrapper" class="info-tip" :class="{ dismissed }" @click.prevent @mouseleave="resetOnMouseLeave">
    <button
      ref="button"
      type="button"
      class="info-tip-button"
      aria-label="More info"
      :aria-describedby="tipId"
      @blur="resetOnBlur"
    >
      ⓘ
    </button>
    <span :id="tipId" role="tooltip" class="info-tip-bubble">{{ text }}</span>
  </span>
</template>
