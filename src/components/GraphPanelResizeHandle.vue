<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { clampGraphPanelWidth, graphPanelWidth } from '@/modalWidth'

const KEYBOARD_STEP_PX = 16

function resizeTo(width: number) {
  graphPanelWidth.value = clampGraphPanelWidth(width, window.innerWidth)
}

function panelBesideHandle(handle: HTMLElement) {
  return handle.nextElementSibling as HTMLElement
}

function startResizing(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  const startX = event.clientX
  const startWidth = panelBesideHandle(handle).getBoundingClientRect().width

  const resizeToPointer = (moveEvent: PointerEvent) => {
    const pointerTravelLeft = startX - moveEvent.clientX
    resizeTo(startWidth + pointerTravelLeft)
  }
  const stopResizing = () => {
    handle.removeEventListener('pointermove', resizeToPointer)
    handle.removeEventListener('lostpointercapture', stopResizing)
  }

  handle.setPointerCapture(event.pointerId)
  handle.addEventListener('pointermove', resizeToPointer)
  handle.addEventListener('lostpointercapture', stopResizing)
}

function resizeByKey(event: KeyboardEvent) {
  const widthChangeByKey: Record<string, number> = { ArrowLeft: KEYBOARD_STEP_PX, ArrowRight: -KEYBOARD_STEP_PX }
  const widthChange = widthChangeByKey[event.key]
  if (widthChange === undefined) return
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  const currentWidth = panelBesideHandle(handle).getBoundingClientRect().width
  resizeTo(currentWidth + widthChange)
}

function keepWithinWindow() {
  if (graphPanelWidth.value !== null) resizeTo(graphPanelWidth.value)
}

onMounted(() => window.addEventListener('resize', keepWithinWindow))
onBeforeUnmount(() => window.removeEventListener('resize', keepWithinWindow))
</script>

<template>
  <div
    class="graph-panel-resize-handle"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize side panel"
    tabindex="0"
    @pointerdown="startResizing"
    @keydown="resizeByKey"
  />
</template>
