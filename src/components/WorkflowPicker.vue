<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { activeWorkflow, boardWorkflows, workflowNameProblem } from '@/shared/projectTypes'
import { useProjectsStore } from '@/stores/projects'

const props = defineProps<{ projectPath: string }>()

const store = useProjectsStore()
const board = computed(() => store.board(props.projectPath))
const workflows = computed(() => boardWorkflows(board.value))
const active = computed(() => activeWorkflow(board.value))
const agentsRunning = computed(() => store.boardAgentsRunning(props.projectPath))

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const nameInputRef = ref<HTMLInputElement | null>(null)
// Null while the popover lists workflows; a string while naming a new one.
const draftName = ref<string | null>(null)

const trimmedDraftName = computed(() => draftName.value?.trim() ?? '')
const draftNameTaken = computed(() => Boolean(trimmedDraftName.value) && Boolean(draftProblem.value))
const draftProblem = computed(() => workflowNameProblem(trimmedDraftName.value, workflows.value))

const triggerTitle = computed(() =>
  agentsRunning.value
    ? 'An agent or orchestrator is running on this board. Workflows can be switched once it finishes.'
    : 'Switch swim lane workflow'
)

const close = () => {
  open.value = false
  draftName.value = null
}

const toggle = () => {
  if (open.value) close()
  else open.value = true
}

const select = async (workflowId: string) => {
  close()
  if (workflowId === active.value.id) return
  await store.activateWorkflow(props.projectPath, workflowId)
}

const startDraft = async () => {
  draftName.value = ''
  await nextTick()
  nameInputRef.value?.focus()
}

const submitDraft = async () => {
  if (draftProblem.value) return
  const name = trimmedDraftName.value
  close()
  await store.createWorkflow(props.projectPath, name)
}

const closeOnOutsideClick = (event: PointerEvent) => {
  if (rootRef.value?.contains(event.target as Node)) return
  close()
}

// The open list stays clickable after the trigger disables, so shut it too.
watch(agentsRunning, (running) => {
  if (running) close()
})

onMounted(() => window.addEventListener('pointerdown', closeOnOutsideClick))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeOnOutsideClick))
</script>

<template>
  <div ref="rootRef" class="workflow-picker filter-menu" @keydown.escape="close">
    <button
      class="filter-trigger"
      :class="{ active: open }"
      :disabled="agentsRunning"
      :title="triggerTitle"
      aria-haspopup="true"
      :aria-expanded="open"
      @click="toggle"
    >
      <span>Workflow</span>
      <strong>{{ active.name }}</strong>
    </button>
    <div v-if="open" class="filter-popover" role="menu" aria-label="Workflows">
      <button
        v-for="workflow in workflows"
        :key="workflow.id"
        type="button"
        role="menuitemradio"
        class="theme-option"
        :class="{ selected: workflow.id === active.id }"
        :aria-checked="workflow.id === active.id"
        @click="select(workflow.id)"
      >
        <span class="theme-name">{{ workflow.name }}</span>
        <span v-if="workflow.id === active.id" class="theme-check">✓</span>
      </button>
      <hr class="workflow-divider" />
      <form v-if="draftName !== null" class="workflow-create" @submit.prevent="submitDraft">
        <input
          ref="nameInputRef"
          v-model="draftName"
          aria-label="New workflow name"
          placeholder="Workflow name"
          :aria-invalid="draftNameTaken"
        />
        <button type="submit" :disabled="Boolean(draftProblem)" :title="draftProblem || 'Copy the current lanes into a new workflow'">
          Create
        </button>
      </form>
      <button v-else type="button" role="menuitem" class="theme-option" @click="startDraft">
        <span class="theme-name">Create new Workflow</span>
      </button>
    </div>
  </div>
</template>
