<script setup lang="ts">
import { watch } from 'vue'

import {
  UI_DEMO_CONTROLS,
  applyUiDemo,
  clampValue,
  resetUiDemo,
  saveUiDemo,
  uiDemoValues,
  type UiDemoControl
} from '@/uiDemo'

watch(
  uiDemoValues,
  () => {
    applyUiDemo()
    saveUiDemo()
  },
  { deep: true }
)

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
</script>

<template>
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
        <!-- Esc commits here, before the board's window handler unmounts the modal;
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
</template>
