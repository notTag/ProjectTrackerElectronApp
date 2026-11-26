<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

import { activeWorkflow, boardWorkflows, workflowNameProblem } from '@/shared/projectTypes'
import { useProjectsStore } from '@/stores/projects'

// Escape is handled by the board's window keydown, which closes every modal.
const props = defineProps<{ projectPath: string }>()
const emit = defineEmits<{ close: [] }>()

const store = useProjectsStore()
const board = computed(() => store.board(props.projectPath))
const workflows = computed(() => boardWorkflows(board.value))
const active = computed(() => activeWorkflow(board.value))
const agentsRunning = computed(() => store.boardAgentsRunning(props.projectPath))

const AGENTS_RUNNING_TITLE =
  'An agent or orchestrator is running on this board. Workflows can be switched once it finishes.'

const nameInputRef = ref<HTMLInputElement | null>(null)
// Null while the create tile shows; a string while naming a new workflow.
const draftName = ref<string | null>(null)
const draftProblem = computed(() => workflowNameProblem(draftName.value ?? '', workflows.value))

const workflowTitle = (workflowId: string) => {
  if (workflowId === active.value.id) return 'Active workflow'
  if (agentsRunning.value) return AGENTS_RUNNING_TITLE
  return 'Switch to this workflow'
}

const select = async (workflowId: string) => {
  if (workflowId === active.value.id || agentsRunning.value) return
  emit('close')
  await store.activateWorkflow(props.projectPath, workflowId)
}

const startDraft = async () => {
  draftName.value = ''
  await nextTick()
  nameInputRef.value?.focus()
}

const submitDraft = async () => {
  if (draftProblem.value || agentsRunning.value) return
  const name = (draftName.value ?? '').trim()
  emit('close')
  await store.createWorkflow(props.projectPath, name)
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal workflows-modal" role="dialog" aria-labelledby="workflows-modal-title">
      <h2 id="workflows-modal-title">Workflows</h2>
      <ul class="workflows-list" aria-label="Workflows">
        <li v-for="workflow in workflows" :key="workflow.id">
          <button
            type="button"
            class="theme-option"
            :class="{ selected: workflow.id === active.id }"
            :aria-current="workflow.id === active.id"
            :disabled="agentsRunning && workflow.id !== active.id"
            :title="workflowTitle(workflow.id)"
            @click="select(workflow.id)"
          >
            <span class="theme-name">{{ workflow.name }}</span>
            <span v-if="workflow.id === active.id" class="theme-check">✓</span>
          </button>
        </li>
      </ul>
      <form v-if="draftName !== null" class="workflow-create" @submit.prevent="submitDraft">
        <input
          ref="nameInputRef"
          v-model="draftName"
          aria-label="New workflow name"
          placeholder="Workflow name"
          :aria-invalid="Boolean(draftName.trim()) && Boolean(draftProblem)"
        />
        <button
          type="submit"
          :disabled="Boolean(draftProblem) || agentsRunning"
          :title="agentsRunning ? AGENTS_RUNNING_TITLE : draftProblem || 'Copy the current lanes into a new workflow'"
        >
          Create
        </button>
      </form>
      <button
        v-else
        type="button"
        class="image-dropzone create-tile"
        :disabled="agentsRunning"
        :title="agentsRunning ? AGENTS_RUNNING_TITLE : 'Copy the current lanes into a new workflow'"
        @click="startDraft"
      >
        <span class="image-dropzone-plus" aria-hidden="true">+</span>
        <span>Create new Workflow</span>
      </button>
      <div class="modal-actions">
        <button type="button" @click="emit('close')">Close</button>
      </div>
    </section>
  </div>
</template>
