<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { activeWorkflow, GITHUB_IMPORT_LANE_ID, type SwimLane } from '@/shared/projectTypes'
import { useBoardContext } from './boardContext'

const props = defineProps<{
  shownLanes: SwimLane[]
  activeFilterLaneIds: string[]
  laneFilterNarrows: boolean
  visibleTicketCount: number
  filtersActive: boolean
  boardView: 'lanes' | 'graph'
}>()
const emit = defineEmits<{ clear: []; switchView: [view: 'lanes' | 'graph'] }>()
const query = defineModel<string>('query', { required: true })
const onlyMine = defineModel<boolean>('onlyMine', { required: true })
const filterLaneIds = defineModel<string[]>('filterLaneIds', { required: true })

const { board, laneColumns, projectPath, laneIsHidden, toggleLaneVisibility, laneTicketTotal } = useBoardContext()

const activeWorkflowName = computed(() => activeWorkflow(board.value).name)
const filterQueryInput = ref<HTMLInputElement | null>(null)
const laneFilterMenuOpen = ref(false)

// The columns worth a header quick-toggle chip: both arrive by import rather
// than by choice, so they are the ones a board wants out of the way. The
// Display modal lists every column instead (laneColumns).
const githubImportLane = computed(
  () => board.value.lanes.find((lane) => lane.id === GITHUB_IMPORT_LANE_ID) ?? null
)
const toggleableLanes = computed(() =>
  [laneColumns.value[0], githubImportLane.value].filter((lane): lane is SwimLane => Boolean(lane))
)

const laneFilterLabel = computed(() => {
  const pickedIds = props.activeFilterLaneIds
  if (!props.laneFilterNarrows) return 'All swim lanes'
  if (pickedIds.length > 1) return `${pickedIds.length} lanes`
  return props.shownLanes.find((lane) => lane.id === pickedIds[0])?.name
})

const toggleLaneFilter = (laneId: string) => {
  const pickedIds = props.activeFilterLaneIds
  filterLaneIds.value = pickedIds.includes(laneId)
    ? pickedIds.filter((pickedId) => pickedId !== laneId)
    : [...pickedIds, laneId]
}

// The view stays mounted across boards; an open menu would carry over to the next board.
watch(projectPath, () => {
  laneFilterMenuOpen.value = false
})

const laneFilterMenuRef = ref<HTMLElement | null>(null)
const closeLaneFilterMenuOnOutsideClick = (event: PointerEvent) => {
  if (laneFilterMenuRef.value?.contains(event.target as Node)) return
  laneFilterMenuOpen.value = false
}
// Tabbing away closes it. A null target (mousedown on a label's text, window
// blur) is left to the pointerdown handler, or it would close mid-click.
const closeLaneFilterMenuOnFocusOut = (event: FocusEvent) => {
  const focusTarget = event.relatedTarget as Node | null
  if (!focusTarget || laneFilterMenuRef.value?.contains(focusTarget)) return
  laneFilterMenuOpen.value = false
}

onMounted(() => window.addEventListener('pointerdown', closeLaneFilterMenuOnOutsideClick))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeLaneFilterMenuOnOutsideClick))

// BoardView's single Escape handler calls these at their place in its order.
defineExpose({
  focus: () => {
    filterQueryInput.value?.focus()
    filterQueryInput.value?.select()
  },
  closeMenuOnEscape: () => {
    if (!laneFilterMenuOpen.value) return false
    laneFilterMenuOpen.value = false
    return true
  },
  blurInputOnEscape: (target: EventTarget | null) => {
    if (target !== filterQueryInput.value) return false
    filterQueryInput.value?.blur()
    return true
  }
})
</script>

<template>
  <section class="board-filters">
    <span class="workflow-label" title="Active workflow">{{ activeWorkflowName }}</span>
    <input
      ref="filterQueryInput"
      v-model="query"
      type="search"
      class="filter-query"
      aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
      :class="{ active: query }"
      placeholder="Filter tickets…"
    />
    <div ref="laneFilterMenuRef" class="filter-menu" @focusout="closeLaneFilterMenuOnFocusOut">
      <button
        type="button"
        class="filter-trigger"
        :class="{ active: laneFilterNarrows }"
        aria-haspopup="true"
        :aria-expanded="laneFilterMenuOpen"
        @click="laneFilterMenuOpen = !laneFilterMenuOpen"
      >
        {{ laneFilterLabel }}
      </button>
      <div v-if="laneFilterMenuOpen" class="filter-popover" role="group" aria-label="Swim lanes shown">
        <label v-for="lane in shownLanes" :key="lane.id">
          <input
            type="checkbox"
            :checked="activeFilterLaneIds.includes(lane.id)"
            @change="toggleLaneFilter(lane.id)"
          />
          <span>{{ lane.name }}</span>
        </label>
      </div>
    </div>
    <button
      class="secondary"
      :class="{ active: onlyMine }"
      title="Show only tickets assigned to me"
      @click="onlyMine = !onlyMine"
    >
      Assigned to me
    </button>
    <button
      v-for="lane in toggleableLanes"
      :key="lane.id"
      class="secondary"
      :class="{ active: !laneIsHidden(lane.id) }"
      :title="`${laneIsHidden(lane.id) ? 'Show' : 'Hide'} the ${lane.name} column`"
      @click="toggleLaneVisibility(lane.id)"
    >
      {{ lane.name }} ({{ laneTicketTotal(lane.id) }})
    </button>
    <span class="filter-count">{{ visibleTicketCount }} of {{ board.tickets.length }}</span>
    <button v-if="filtersActive" class="secondary" @click="emit('clear')">Clear</button>
    <div class="board-view-switch" role="group" aria-label="Ticket view" :class="{ 'is-graph': boardView === 'graph' }">
      <span class="view-switch-slider" aria-hidden="true" />
      <button title="Graph view" aria-label="Graph view" :aria-pressed="boardView === 'graph'" @click="emit('switchView', 'graph')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 7L17 12L6 18"/><circle cx="5" cy="6" r="3"/><circle cx="19" cy="12" r="3"/><circle cx="5" cy="19" r="3"/></svg>
      </button>
      <button title="Swimlane view" aria-label="Swimlane view" :aria-pressed="boardView === 'lanes'" @click="emit('switchView', 'lanes')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
    </div>
  </section>
</template>
