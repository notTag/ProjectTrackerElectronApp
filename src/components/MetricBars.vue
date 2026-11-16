<script setup lang="ts">
import { computed } from 'vue'

import { barHeight, METRIC_WINDOWS } from '@/shared/metrics'
import type { MetricWindowCounts } from '@/shared/projectTypes'

const props = defineProps<{ title: string; counts: MetricWindowCounts }>()

const maxCount = computed(() => Math.max(...METRIC_WINDOWS.map((window) => props.counts[window.key])))
</script>

<template>
  <figure class="metric-bars">
    <figcaption>{{ title }}</figcaption>
    <div class="metric-bars-plot">
      <div v-for="window in METRIC_WINDOWS" :key="window.key" class="metric-bar-column">
        <span class="metric-bar-value">{{ counts[window.key] }}</span>
        <div class="metric-bar-track">
          <div class="metric-bar" :style="{ height: barHeight(counts[window.key], maxCount) }" />
        </div>
        <span class="metric-bar-label">{{ window.label }}</span>
      </div>
    </div>
  </figure>
</template>
