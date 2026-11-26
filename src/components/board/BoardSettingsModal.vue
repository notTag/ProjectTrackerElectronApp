<script setup lang="ts">
import MetricsPanel from '@/components/MetricsPanel.vue'
import EyeOffIcon from '@/components/icons/EyeOffIcon.vue'
import { useBoardContext } from './boardContext'

// Display and the UI panel replace this modal rather than opening over it;
// BoardView does the swap.
const emit = defineEmits<{ close: []; openDisplay: []; openUiPanel: [] }>()

const { projectPath } = useBoardContext()
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal lane-modal settings-modal">
      <p class="eyebrow">Board Settings</p>
      <MetricsPanel :project-paths="[projectPath]" scope="board" />
      <button class="secondary button-with-icon" title="Choose what ticket cards show" @click="emit('openDisplay')">
        <EyeOffIcon /> Display
      </button>
      <hr />
      <p class="eyebrow">UI Settings</p>
      <button class="secondary" title="Live-tune radii, opacity and card alignment" @click="emit('openUiPanel')">
        🎚 UI Settings
      </button>
      <div class="modal-actions">
        <button @click="emit('close')">Done</button>
      </div>
    </section>
  </div>
</template>
