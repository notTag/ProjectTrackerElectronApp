<script setup lang="ts">
import { computed } from 'vue'

import MetricBars from '@/components/MetricBars.vue'
import { prCounts, prUnavailableReason } from '@/shared/metrics'
import type { ProjectMetrics } from '@/shared/projectTypes'

const props = defineProps<{ metrics: ProjectMetrics; fetchedAt?: Date }>()

const prs = computed(() => prCounts(props.metrics))
const prFetchFailed = computed(() => props.metrics.prs !== undefined && !prs.value)
const agentsUnknown = computed(() => props.metrics.agentsRunning === null)
</script>

<template>
  <div class="card-metrics-charts">
    <MetricBars v-if="metrics.hasClosingLanes" title="Tickets closed" :counts="metrics.closed" />
    <p v-else class="field-hint">No lane counts as closed — set one in lane settings</p>

    <MetricBars v-if="prs" title="PRs merged" :counts="prs.merged" />
    <p v-else :class="prFetchFailed ? 'metrics-error' : 'field-hint'">{{ prUnavailableReason(metrics) }}</p>
  </div>

  <div class="card-metrics-tiles">
    <div v-if="prs" class="metric-tile">
      <strong>{{ prs.open }}</strong>
      <span>PRs open</span>
    </div>
    <div class="metric-tile" :title="agentsUnknown ? 'Could not list processes' : ''">
      <strong>{{ metrics.agentsRunning ?? '—' }}</strong>
      <span>Agents running</span>
    </div>
  </div>

  <p v-if="fetchedAt" class="field-hint">Updated {{ fetchedAt.toLocaleTimeString() }}</p>
</template>
