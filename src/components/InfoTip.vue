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

// Capture phase so Escape always hides a showing tip, even when a handler below
// would stop the event. Escape is claimed only when the tip button itself has
// focus: then the first Escape hides just the tip and the modal stays open. A
// hover-only tip hides and lets Escape through, like a native tooltip, so inputs,
// menus, drags and the modal still get it. A defaultPrevented Escape was already
// handled by an earlier capture listener (Find bar), so the tip stays put.
const dismissOnEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !isShowing()) return
  dismissed.value = true
  const tipButtonIsTarget = event.target === button.value
  if (tipButtonIsTarget) event.stopPropagation()
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
