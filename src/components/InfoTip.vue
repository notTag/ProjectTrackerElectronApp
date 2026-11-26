<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'

defineProps<{ text: string }>()

const tipId = useId()
const anchorName = `--tip-${tipId}`
const dismissed = ref(false)
const hovered = ref(false)
const button = ref<HTMLButtonElement>()
const bubble = ref<HTMLElement>()

const isHovered = () => hovered.value
const hasKeyboardFocus = () => Boolean(button.value?.matches(':focus-visible'))
const isShowing = () => !dismissed.value && (isHovered() || hasKeyboardFocus())

// The bubble is a manual popover so it renders in the top layer, above any modal's
// overflow clipping. togglePopover(force) is a no-op when already in that state.
const syncBubble = () => bubble.value?.togglePopover(isShowing())

// Capture phase so Escape always hides a showing tip, even when a handler below
// would stop the event. Escape is claimed only when the tip button has keyboard
// focus: then the first Escape hides just the tip and the modal stays open. A
// mouse-clicked button focuses without :focus-visible, so it counts as hover. A
// hover-only tip hides and lets Escape through, like a native tooltip, so inputs,
// menus, drags and the modal still get it. A defaultPrevented Escape was already
// handled by an earlier capture listener (Find bar), so the tip stays put.
const dismissOnEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !isShowing()) return
  dismissed.value = true
  syncBubble()
  if (hasKeyboardFocus()) event.stopPropagation()
}

const showOnMouseEnter = () => {
  hovered.value = true
  syncBubble()
}

const resetOnMouseLeave = () => {
  hovered.value = false
  if (!hasKeyboardFocus()) dismissed.value = false
  syncBubble()
}

const resetOnBlur = () => {
  if (!isHovered()) dismissed.value = false
  syncBubble()
}

onMounted(() => window.addEventListener('keydown', dismissOnEscape, true))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', dismissOnEscape, true)
  bubble.value?.togglePopover(false)
})
</script>

<template>
  <!-- click.prevent: the tip sits inside field labels; a click on the bubble would
       otherwise run label activation and toggle the adjacent checkbox. -->
  <span class="info-tip" @click.prevent @mouseenter="showOnMouseEnter" @mouseleave="resetOnMouseLeave">
    <button
      ref="button"
      type="button"
      class="info-tip-button"
      aria-label="More info"
      :aria-describedby="tipId"
      :style="{ anchorName }"
      @focus="syncBubble"
      @blur="resetOnBlur"
    >
      ⓘ
    </button>
    <span
      :id="tipId"
      ref="bubble"
      role="tooltip"
      popover="manual"
      class="info-tip-bubble"
      :style="{ positionAnchor: anchorName }"
      >{{ text }}</span
    >
  </span>
</template>
