<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'

defineProps<{ text: string }>()

const tipId = useId()
const anchorName = `--tip-${tipId}`
const dismissed = ref(false)
const hovered = ref(false)
const button = ref<HTMLButtonElement>()
const bubble = ref<HTMLElement>()

const hasKeyboardFocus = () => Boolean(button.value?.matches(':focus-visible'))
const isShowing = () => !dismissed.value && (hovered.value || hasKeyboardFocus())
const syncBubble = () => {
  if (bubble.value?.isConnected) bubble.value.togglePopover(isShowing())
}

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
  if (!hovered.value) dismissed.value = false
  syncBubble()
}

onMounted(() => window.addEventListener('keydown', dismissOnEscape, true))
onBeforeUnmount(() => window.removeEventListener('keydown', dismissOnEscape, true))
</script>

<template>
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
