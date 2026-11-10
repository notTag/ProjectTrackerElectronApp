<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { projectTrackerApi } from '@/services/projectTrackerApi'
import type { MetricWindowCounts, ProjectMetrics, ProjectPrMetrics } from '@/shared/projectTypes'

const props = defineProps<{
  projectPaths: string[]
  // Which view this is, so each remembers its own open state.
  scope: 'dashboard' | 'board'
}>()

const WINDOW_COLUMNS: { key: keyof MetricWindowCounts; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7d' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' }
]

const storageKey = `metrics-panel-open:${props.scope}`
const readStoredOpen = () => {
  try {
    return localStorage.getItem(storageKey) === '1'
  } catch {
    return false
  }
}
const storeOpen = (isOpen: boolean) => {
  try {
    localStorage.setItem(storageKey, isOpen ? '1' : '0')
  } catch {
    // Remembering the panel is a convenience; losing it changes nothing else.
  }
}

const open = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)
const rows = ref<ProjectMetrics[]>([])
let latestRequest = 0

// Rows are cleared first so a slow or failed pull never leaves old numbers
// on screen looking current.
const load = async () => {
  const request = ++latestRequest
  loading.value = true
  loadError.value = null
  rows.value = []
  try {
    const metrics = await projectTrackerApi.getMetrics(props.projectPaths)
    if (request === latestRequest) rows.value = metrics
  } catch (error) {
    if (request === latestRequest) loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (request === latestRequest) loading.value = false
  }
}

const setOpen = (isOpen: boolean) => {
  open.value = isOpen
  storeOpen(isOpen)
  if (isOpen) void load()
}

// Same as the sibling titlebar pickers, so two popovers never stack open.
const rootRef = ref<HTMLElement | null>(null)
const closeOnOutsideClick = (event: PointerEvent) => {
  if (!open.value || rootRef.value?.contains(event.target as Node)) return
  setOpen(false)
}

onMounted(() => {
  window.addEventListener('pointerdown', closeOnOutsideClick)
  if (readStoredOpen()) setOpen(true)
})
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeOnOutsideClick))
watch(
  () => props.projectPaths.join('\n'),
  () => {
    if (open.value) void load()
  }
)

const prCounts = (row: ProjectMetrics): ProjectPrMetrics | undefined =>
  row.prs && 'open' in row.prs ? row.prs : undefined
const prUnavailableReason = (row: ProjectMetrics) => {
  if (!row.prs) return 'No GitHub repository'
  return 'error' in row.prs ? row.prs.error : ''
}
const projectsWithoutClosingLanes = computed(() => rows.value.filter((row) => !row.hasClosingLanes))

const sumOf = (values: number[]) => values.reduce((total, value) => total + value, 0)
const totals = computed(() => {
  const prRows = rows.value.map(prCounts).filter((prs): prs is ProjectPrMetrics => prs !== undefined)
  const sumWindows = (counts: MetricWindowCounts[]): MetricWindowCounts => ({
    today: sumOf(counts.map((count) => count.today)),
    week: sumOf(counts.map((count) => count.week)),
    month: sumOf(counts.map((count) => count.month)),
    year: sumOf(counts.map((count) => count.year))
  })
  const agentCounts = rows.value.map((row) => row.agentsRunning)
  const agentsKnown = agentCounts.every((count) => count !== null)
  // A repo that failed would make the sum look complete when it isn't. Rows
  // with no repo have nothing to count, so they don't block the total.
  const prsKnown = rows.value.every((row) => !row.prs || 'open' in row.prs)
  const prsOpen = sumOf(prRows.map((prs) => prs.open))
  const prsMerged = sumWindows(prRows.map((prs) => prs.merged))
  return {
    closed: sumWindows(rows.value.map((row) => row.closed)),
    prs: prsKnown ? { open: prsOpen, merged: prsMerged } : null,
    agentsRunning: agentsKnown ? sumOf(agentCounts as number[]) : null
  }
})
const showTotals = computed(() => props.scope === 'dashboard' && rows.value.length > 0)
</script>

<template>
  <div ref="rootRef" class="filter-menu metrics-menu">
    <button class="secondary" :class="{ active: open }" :aria-expanded="open" @click="setOpen(!open)">
      📊 Metrics
    </button>
    <section v-if="open" class="filter-popover metrics-popover" aria-label="Metrics">
      <div class="metrics-popover-header">
        <strong>Metrics</strong>
        <button class="secondary" title="Pull fresh numbers" :disabled="loading" @click="load">↻</button>
      </div>
      <p v-if="loading" class="field-hint">Loading…</p>
      <p v-else-if="loadError" class="metrics-error">{{ loadError }}</p>
      <template v-else>
        <table class="metrics-table">
          <thead>
            <tr>
              <th rowspan="2" scope="col">Project</th>
              <th colspan="4" scope="colgroup">Closed</th>
              <th rowspan="2" scope="col">PRs open</th>
              <th colspan="4" scope="colgroup">PRs merged</th>
              <th rowspan="2" scope="col">Agents</th>
            </tr>
            <tr>
              <th v-for="column in WINDOW_COLUMNS" :key="`closed-${column.key}`" scope="col">{{ column.label }}</th>
              <th v-for="column in WINDOW_COLUMNS" :key="`merged-${column.key}`" scope="col">{{ column.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.projectPath">
              <th scope="row" :title="row.projectPath">{{ row.name }}</th>
              <td v-for="column in WINDOW_COLUMNS" :key="column.key">{{ row.closed[column.key] }}</td>
              <template v-if="prCounts(row)">
                <td>{{ prCounts(row)!.open }}</td>
                <td v-for="column in WINDOW_COLUMNS" :key="column.key">{{ prCounts(row)!.merged[column.key] }}</td>
              </template>
              <td v-else colspan="5" class="metrics-unavailable" :title="prUnavailableReason(row)">—</td>
              <td :title="row.agentsRunning === null ? 'Could not list processes' : ''">
                {{ row.agentsRunning ?? '—' }}
              </td>
            </tr>
          </tbody>
          <tfoot v-if="showTotals">
            <tr>
              <th scope="row">Total</th>
              <td v-for="column in WINDOW_COLUMNS" :key="column.key">{{ totals.closed[column.key] }}</td>
              <template v-if="totals.prs">
                <td>{{ totals.prs.open }}</td>
                <td v-for="column in WINDOW_COLUMNS" :key="column.key">{{ totals.prs.merged[column.key] }}</td>
              </template>
              <td v-else colspan="5" class="metrics-unavailable" title="A repository failed to load">—</td>
              <td>{{ totals.agentsRunning ?? '—' }}</td>
            </tr>
          </tfoot>
        </table>
        <p v-for="row in projectsWithoutClosingLanes" :key="row.projectPath" class="field-hint">
          No closing lanes set on {{ row.name }} (lane ⚙ → "Counts as closed").
        </p>
      </template>
    </section>
  </div>
</template>
