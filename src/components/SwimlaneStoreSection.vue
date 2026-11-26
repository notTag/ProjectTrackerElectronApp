<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { useRowConfirm, type RowAction } from '@/components/rowConfirm'
import type { LaneStoreEntry } from '@/shared/projectTypes'
import { useProjectsStore } from '@/stores/projects'

const props = defineProps<{ projectPath: string }>()

const store = useProjectsStore()
const entries = computed(() => store.laneStoreEntries)
const boardLaneIds = computed(() => new Set(store.board(props.projectPath).lanes.map((lane) => lane.id)))
const agentsRunning = computed(() => store.boardAgentsRunning(props.projectPath))
const { start, cancel, pendingActionOf } = useRowConfirm()
const confirmButtonRef = ref<HTMLButtonElement[]>([])
const error = ref('')

// Same rule as a workflow swap: lanes don't change under a running agent.
const addBlockedReason = (entry: LaneStoreEntry): string => {
  if (boardLaneIds.value.has(entry.laneId)) return 'Already in this workflow'
  if (agentsRunning.value) return 'An agent or orchestrator is running on this board. Lanes can be added once it finishes.'
  return ''
}

const askToConfirm = async (entry: LaneStoreEntry, action: RowAction) => {
  error.value = ''
  start(entry.id, action)
  await nextTick()
  confirmButtonRef.value[0]?.focus()
}

const confirm = async (entry: LaneStoreEntry, action: RowAction) => {
  cancel()
  const done =
    action === 'delete'
      ? await store.deleteLaneStoreEntry(entry.id)
      : await store.addLaneFromStore(props.projectPath, entry.id)
  if (!done) error.value = store.error ?? 'That did not work.'
}

// Blur alone misses a click that moves no focus (the window isn't focused).
const cancelOnOutsidePointer = (event: PointerEvent) => {
  const onConfirmButton = confirmButtonRef.value.some((button) => button.contains(event.target as Node))
  if (!onConfirmButton) cancel()
}

onBeforeUnmount(() => window.removeEventListener('pointerdown', cancelOnOutsidePointer))
onMounted(() => {
  window.addEventListener('pointerdown', cancelOnOutsidePointer)
  store.loadLaneStore().catch((loadError: unknown) => {
    error.value = loadError instanceof Error ? loadError.message : String(loadError)
  })
})
</script>

<template>
  <section class="swimlane-store" aria-labelledby="swimlane-store-title">
    <h3 id="swimlane-store-title">Swimlane Store</h3>
    <p v-if="entries.length === 0" class="field-hint">
      No saved swimlanes yet. Use "Save to Store" in a swimlane's settings.
    </p>
    <ul v-else class="swimlane-store-list">
      <li v-for="entry in entries" :key="entry.id" class="swimlane-store-row">
        <span class="swimlane-store-name">{{ entry.name }}</span>
        <template v-if="pendingActionOf(entry.id)">
          <button
            ref="confirmButtonRef"
            class="secondary swimlane-store-button"
            :class="{ danger: pendingActionOf(entry.id) === 'delete' }"
            :aria-label="pendingActionOf(entry.id) === 'delete' ? `Confirm delete ${entry.name}` : `Confirm add ${entry.name}`"
            :title="pendingActionOf(entry.id) === 'delete' ? 'Delete from the store' : 'Add to this workflow'"
            @click="confirm(entry, pendingActionOf(entry.id)!)"
            @blur="cancel"
            @keydown.escape.stop="cancel"
          >
            ✓
          </button>
        </template>
        <template v-else>
          <button
            class="secondary swimlane-store-button"
            :aria-label="`Delete ${entry.name} from the store`"
            title="Delete from the store"
            @click="askToConfirm(entry, 'delete')"
          >
            −
          </button>
          <button
            class="secondary swimlane-store-button"
            :aria-label="`Add ${entry.name} to this workflow`"
            :title="addBlockedReason(entry) || 'Add to this workflow'"
            :disabled="Boolean(addBlockedReason(entry))"
            @click="askToConfirm(entry, 'add')"
          >
            +
          </button>
        </template>
      </li>
    </ul>
    <span v-if="error" class="field-hint field-error">{{ error }}</span>
  </section>
</template>
