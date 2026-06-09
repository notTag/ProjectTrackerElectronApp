<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import type { ProjectPriority, ProjectStatus } from '@/shared/projectTypes'

type SortField = 'name' | 'status' | 'priority'
type SortDirection = 'asc' | 'desc'

const query = defineModel<string>('query', { required: true })
const selectedStatuses = defineModel<ProjectStatus[]>('selectedStatuses', { required: true })
const selectedPriorities = defineModel<ProjectPriority[]>('selectedPriorities', { required: true })
const sortField = defineModel<SortField>('sortField', { required: true })
const sortDirection = defineModel<SortDirection>('sortDirection', { required: true })

defineProps<{
  statusOptions: Array<{ value: ProjectStatus; label: string }>
  priorityOptions: Array<{ value: ProjectPriority; label: string }>
  hasActiveFilters: boolean
  isSortFieldActive: boolean
  isSortDirectionActive: boolean
}>()

const emit = defineEmits<{
  clearFilters: []
  filterChanged: []
}>()

const statusMenuOpen = ref(false)
const priorityMenuOpen = ref(false)
const toolbarRef = ref<HTMLElement | null>(null)

onMounted(() => {
  window.addEventListener('pointerdown', closeFilterMenusOnOutsideClick)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeFilterMenusOnOutsideClick)
})

const filterSummary = (selectedCount: number, emptyLabel: string) =>
  selectedCount === 0 ? emptyLabel : `${selectedCount} selected`

const closeFilterMenusOnOutsideClick = (event: PointerEvent) => {
  if (toolbarRef.value?.contains(event.target as Node)) return
  statusMenuOpen.value = false
  priorityMenuOpen.value = false
}

const toggleStatusFilter = (status: ProjectStatus) => {
  selectedStatuses.value = selectedStatuses.value.includes(status)
    ? selectedStatuses.value.filter((entry) => entry !== status)
    : [...selectedStatuses.value, status]
  emit('filterChanged')
}

const togglePriorityFilter = (priority: ProjectPriority) => {
  selectedPriorities.value = selectedPriorities.value.includes(priority)
    ? selectedPriorities.value.filter((entry) => entry !== priority)
    : [...selectedPriorities.value, priority]
  emit('filterChanged')
}
</script>

<template>
  <section ref="toolbarRef" class="toolbar">
    <input v-model="query" type="search" placeholder="Search projects, paths, notes" />
    <div class="filter-menu">
      <button
        class="filter-trigger"
        :class="{ active: selectedStatuses.length > 0 }"
        @click="statusMenuOpen = !statusMenuOpen"
      >
        <span>All Statuses</span>
        <strong>{{ filterSummary(selectedStatuses.length, 'Any') }}</strong>
      </button>
      <div v-if="statusMenuOpen" class="filter-popover">
        <label v-for="option in statusOptions" :key="option.value">
          <input
            type="checkbox"
            :checked="selectedStatuses.includes(option.value)"
            @change="toggleStatusFilter(option.value)"
          />
          <span>{{ option.label }}</span>
        </label>
      </div>
    </div>
    <div class="filter-menu">
      <button
        class="filter-trigger"
        :class="{ active: selectedPriorities.length > 0 }"
        @click="priorityMenuOpen = !priorityMenuOpen"
      >
        <span>All Priorities</span>
        <strong>{{ filterSummary(selectedPriorities.length, 'Any') }}</strong>
      </button>
      <div v-if="priorityMenuOpen" class="filter-popover">
        <label v-for="option in priorityOptions" :key="option.value">
          <input
            type="checkbox"
            :checked="selectedPriorities.includes(option.value)"
            @change="togglePriorityFilter(option.value)"
          />
          <span>{{ option.label }}</span>
        </label>
      </div>
    </div>
    <label class="sort-control" :class="{ active: isSortFieldActive }">
      <span>Sort</span>
      <select v-model="sortField">
        <option value="priority">Priority</option>
        <option value="name">Alphabetical</option>
        <option value="status">Status</option>
      </select>
    </label>
    <button
      class="secondary sort-direction"
      :class="{ active: isSortDirectionActive }"
      @click="sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'"
    >
      {{ sortDirection === 'asc' ? 'Asc' : 'Desc' }}
    </button>
    <button
      class="secondary clear-filters"
      :class="{ active: hasActiveFilters }"
      :disabled="!hasActiveFilters"
      @click="emit('clearFilters')"
    >
      Clear
    </button>
  </section>
</template>
