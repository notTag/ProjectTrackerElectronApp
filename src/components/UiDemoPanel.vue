<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  UI_DEMO_CONTROLS,
  applyUiDemo,
  clampValue,
  resetUiDemo,
  saveUiDemo,
  uiDemoPanelOpen,
  uiDemoPanelPosition,
  uiDemoValues,
  type UiDemoControl
} from '@/uiDemo'

const DEFAULT_OFFSET_FROM_EDGE = 24
const panel = ref<HTMLElement | null>(null)

watch(
  uiDemoValues,
  () => {
    applyUiDemo()
    saveUiDemo()
  },
  { deep: true }
)

const clampBetween = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const clampIntoViewport =(x: number, y: number) => {
  const panelWidth = panel.value?.offsetWidth ?? 0
  const panelHeight = panel.value?.offsetHeight ?? 0
  const maxX = Math.max(0, window.innerWidth - panelWidth)
  const maxY = Math.max(0, window.innerHeight - panelHeight)
  const clampedX = clampBetween(x, 0, maxX)
  const clampedY = clampBetween(y, 0, maxY)
  return { x: clampedX, y: clampedY }
}

const keepInViewport = () => {
  const current = uiDemoPanelPosition.value
  const fallbackX = window.innerWidth - (panel.value?.offsetWidth ?? 0) - DEFAULT_OFFSET_FROM_EDGE
  const start = current ?? { x: fallbackX, y: 80 }
  uiDemoPanelPosition.value = clampIntoViewport(start.x, start.y)
}

let dragOffset: { x: number; y: number } | null = null

const startDrag = (event: PointerEvent) => {
  // Buttons in the title bar (✕) keep their own click.
  const isPrimaryButton = event.button === 0
  if (!isPrimaryButton) return
  if ((event.target as HTMLElement).closest('button')) return
  const position = uiDemoPanelPosition.value ?? { x: 0, y: 0 }
  dragOffset = { x: event.clientX - position.x, y: event.clientY - position.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const drag = (event: PointerEvent) => {
  if (!dragOffset) return
  const nextX = event.clientX - dragOffset.x
  const nextY = event.clientY - dragOffset.y
  uiDemoPanelPosition.value = clampIntoViewport(nextX, nextY)
}

const endDrag = () => {
  if (!dragOffset) return
  dragOffset = null
  saveUiDemo()
}

const commitNumber = (control: UiDemoControl, event: Event) => {
  const input = event.target as HTMLInputElement
  const typed = input.value
  // Garbage in the box reverts to the current value, not the control default.
  const isNumeric = typed.trim() !== '' && Number.isFinite(Number(typed))
  const nextValue = isNumeric ? clampValue(control, typed) : uiDemoValues[control.key]
  uiDemoValues[control.key] = nextValue
  input.value = String(nextValue)
}

const setRange = (control: UiDemoControl, event: Event) => {
  uiDemoValues[control.key] = clampValue(control, (event.target as HTMLInputElement).value)
}

const setChoice = (control: UiDemoControl, event: Event) => {
  uiDemoValues[control.key] = clampValue(control, (event.target as HTMLSelectElement).value)
}

onMounted(() => {
  keepInViewport()
  window.addEventListener('resize', keepInViewport)
})

onBeforeUnmount(() => window.removeEventListener('resize', keepInViewport))
</script>

<template>
  <section
    ref="panel"
    class="ui-demo-panel"
    role="dialog"
    aria-label="UI Demo"
    :style="{ left: `${uiDemoPanelPosition?.x ?? 0}px`, top: `${uiDemoPanelPosition?.y ?? 0}px` }"
  >
    <header
      class="ui-demo-titlebar"
      @pointerdown="startDrag"
      @pointermove="drag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
    >
      <strong>🎚 UI Demo</strong>
      <button class="secondary" title="Close (Esc)" aria-label="Close UI Demo" @click="uiDemoPanelOpen = false">
        ✕
      </button>
    </header>
    <div class="ui-demo-body">
      <label v-for="control in UI_DEMO_CONTROLS" :key="control.key" class="ui-demo-row">
        <span>{{ control.label }}</span>
        <template v-if="control.kind === 'range'">
          <input
            type="range"
            :min="control.min"
            :max="control.max"
            :value="uiDemoValues[control.key]"
            @input="setRange(control, $event)"
          />
          <!-- Esc commits here, before the board's window handler unmounts the panel;
               the blur that follows doesn't fire change. -->
          <input
            type="number"
            :min="control.min"
            :max="control.max"
            :value="uiDemoValues[control.key]"
            :aria-label="`${control.label} value`"
            @change="commitNumber(control, $event)"
            @keydown.esc="commitNumber(control, $event)"
          />
        </template>
        <select v-else :value="uiDemoValues[control.key]" @change="setChoice(control, $event)">
          <option v-for="option in control.options" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <button class="secondary" @click="resetUiDemo">Reset</button>
    </div>
  </section>
</template>
