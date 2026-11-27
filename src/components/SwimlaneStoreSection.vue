<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { useRowConfirm, type RowAction } from '@/components/rowConfirm'
import { laneFolderName, type LaneStoreEntry } from '@/shared/projectTypes'
import { useProjectsStore } from '@/stores/projects'

const props = defineProps<{ projectPath: string }>()

const store = useProjectsStore()
const entries = computed(() => store.laneStoreEntries)
const boardLanes = computed(() => store.board(props.projectPath).lanes)
const boardLaneIds = computed(() => new Set(boardLanes.value.map((lane) => lane.id)))
const boardLaneFolders = computed(() => new Set(boardLanes.value.map((lane) => laneFolderName(lane.name))))
const agentsRunning = computed(() => store.boardAgentsRunning(props.projectPath))
const { start, cancel, pendingActionOf } = useRowConfirm()
const confirmButtonRef = ref<HTMLButtonElement[]>([])
const loadError = ref('')

const addBlockedReason = (entry: LaneStoreEntry): string => {
  if (boardLaneIds.value.has(entry.laneId)) return 'Already in this workflow'
  const promptFolder = laneFolderName(entry.name)
  if (boardLaneFolders.value.has(promptFolder)) return `Another lane here already uses the "${promptFolder}" prompt folder`
  if (agentsRunning.value) return 'An agent or orchestrator is running on this board. Lanes can be added once it finishes.'
  return ''
}

const askToConfirm = async (entry: LaneStoreEntry, action: RowAction) => {
  start(entry.id, action)
  await nextTick()
  confirmButtonRef.value[0]?.focus()
}

const rows = computed(() =>
  entries.value.map((entry) => {
    const pendingAction = pendingActionOf(entry.id)
    const addBlocked = addBlockedReason(entry)
    const confirmBlocked = pendingAction === 'add' ? addBlocked : ''
    return { entry, pendingAction, addBlocked, confirmBlocked }
  })
)

const confirm = async (entry: LaneStoreEntry, action: RowAction) => {
  const confirmBlocked = action === 'add' && addBlockedReason(entry)
  if (confirmBlocked) return
  cancel()
  if (action === 'delete') await store.deleteLaneStoreEntry(entry.id)
  else await store.addLaneFromStore(props.projectPath, entry.id)
}

const cancelOnOutsidePointer = (event: PointerEvent) => {
  const onConfirmButton = confirmButtonRef.value.some((button) => button.contains(event.target as Node))
  if (!onConfirmButton) cancel()
}

onBeforeUnmount(() => window.removeEventListener('pointerdown', cancelOnOutsidePointer))
onMounted(() => {
  window.addEventListener('pointerdown', cancelOnOutsidePointer)
  store.loadLaneStore().catch((failure: unknown) => {
    loadError.value = failure instanceof Error ? failure.message : String(failure)
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
      <li v-for="{ entry, pendingAction, addBlocked, confirmBlocked } in rows" :key="entry.id" class="swimlane-store-row">
        <span class="swimlane-store-name">{{ entry.name }}</span>
        <button
          v-if="pendingAction"
          ref="confirmButtonRef"
          class="secondary swimlane-store-button"
          :class="{ danger: pendingAction === 'delete' }"
          :aria-label="pendingAction === 'delete' ? `Confirm delete ${entry.name}` : `Confirm add ${entry.name}`"
          :title="confirmBlocked || (pendingAction === 'delete' ? 'Delete from the store' : 'Add to this workflow')"
          :disabled="Boolean(confirmBlocked)"
          @click="confirm(entry, pendingAction)"
          @blur="cancel"
          @keydown.escape.stop="cancel"
        >
          ✓
        </button>
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
            :title="addBlocked || 'Add to this workflow'"
            :disabled="Boolean(addBlocked)"
            @click="askToConfirm(entry, 'add')"
          >
            +
          </button>
        </template>
      </li>
    </ul>
    <span v-if="loadError" class="field-hint field-error">{{ loadError }}</span>
  </section>
</template>
