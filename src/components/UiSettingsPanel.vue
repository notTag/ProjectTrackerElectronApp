<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  UI_DEMO_CONTROLS,
  applyUiDemo,
  clampValue,
  resetUiDemo,
  saveUiDemo,
  selectedSettingsSection,
  uiDemoPanelOpen,
  uiDemoValues,
  type SettingsSection,
  type UiDemoControl
} from '@/uiDemo'

import InfoTip from './InfoTip.vue'

const SECTIONS: { id: SettingsSection; icon: string; label: string }[] = [
  { id: 'display', icon: '👁', label: 'Display' },
  { id: 'metrics', icon: '📊', label: 'Metrics' },
  { id: 'ui', icon: '🎨', label: 'UI Settings' }
]

const panel = ref<HTMLElement | null>(null)
// Component state, not module state: the panel opens centered every time (#145).
const position = ref({ x: 0, y: 0 })

watch(
  uiDemoValues,
  () => {
    applyUiDemo()
    saveUiDemo()
  },
  { deep: true }
)

const clampBetween = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const clampIntoViewport = (x: number, y: number) => {
  const panelWidth = panel.value?.offsetWidth ?? 0
  const panelHeight = panel.value?.offsetHeight ?? 0
  const maxX = Math.max(0, window.innerWidth - panelWidth)
  const maxY = Math.max(0, window.innerHeight - panelHeight)
  const clampedX = clampBetween(x, 0, maxX)
  const clampedY = clampBetween(y, 0, maxY)
  return { x: clampedX, y: clampedY }
}

const centerInViewport = () => {
  const panelWidth = panel.value?.offsetWidth ?? 0
  const panelHeight = panel.value?.offsetHeight ?? 0
  const centeredX = (window.innerWidth - panelWidth) / 2
  const centeredY = (window.innerHeight - panelHeight) / 2
  position.value = clampIntoViewport(centeredX, centeredY)
}

const keepInViewport = () => {
  position.value = clampIntoViewport(position.value.x, position.value.y)
}

let dragOffset: { x: number; y: number } | null = null

const startDrag = (event: PointerEvent) => {
  // Title bar buttons (✕) keep their own click; the ⓘ tip (button + bubble) isn't a drag handle.
  const isPrimaryButton = event.button === 0
  if (!isPrimaryButton) return
  if ((event.target as HTMLElement).closest('button, .info-tip')) return
  dragOffset = { x: event.clientX - position.value.x, y: event.clientY - position.value.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const drag = (event: PointerEvent) => {
  if (!dragOffset) return
  const nextX = event.clientX - dragOffset.x
  const nextY = event.clientY - dragOffset.y
  position.value = clampIntoViewport(nextX, nextY)
}

const endDrag = () => {
  dragOffset = null
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
  centerInViewport()
  window.addEventListener('resize', keepInViewport)
})

onBeforeUnmount(() => window.removeEventListener('resize', keepInViewport))
</script>

<template>
  <section
    ref="panel"
    class="ui-demo-panel"
    role="dialog"
    aria-label="Settings"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
      maxWidth: `calc(100vw - ${position.x}px)`,
      maxHeight: `calc(100vh - ${position.y}px)`
    }"
  >
    <header
      class="ui-demo-titlebar"
      @pointerdown="startDrag"
      @pointermove="drag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
    >
      <span class="label-with-tip">
        <strong>⚙ Settings</strong>
        <InfoTip text="Changes save automatically as you edit, on this machine only. Reset restores the defaults." />
      </span>
      <button class="secondary" title="Close (Esc)" aria-label="Close Settings" @click="uiDemoPanelOpen = false">
        ✕
      </button>
    </header>
    <div class="settings-layout">
      <nav class="settings-sidebar" aria-label="Settings sections">
        <button
          v-for="section in SECTIONS"
          :key="section.id"
          type="button"
          class="settings-sidebar-item"
          :class="{ selected: selectedSettingsSection === section.id }"
          :aria-current="selectedSettingsSection === section.id ? 'true' : undefined"
          @click="selectedSettingsSection = section.id"
        >
          <span class="settings-sidebar-icon" aria-hidden="true">{{ section.icon }}</span>
          {{ section.label }}
        </button>
      </nav>
      <div class="ui-demo-body">
        <slot v-if="selectedSettingsSection === 'metrics'" name="metrics" />
        <slot v-else-if="selectedSettingsSection === 'display'" name="display" />
        <template v-else>
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
        </template>
      </div>
    </div>
  </section>
</template>
