<script setup lang="ts">
import { useRouter } from 'vue-router'
import OfflineBadge from '@/components/OfflineBadge.vue'
import OpenInPicker from '@/components/OpenInPicker.vue'
import WorkflowPicker from '@/components/WorkflowPicker.vue'
import { useBoardContext } from './boardContext'

defineProps<{ projectTitle: string; githubUrl?: string; pullingIssues: boolean }>()
const emit = defineEmits<{ newTicket: []; newLane: []; openSettings: []; pullIssues: [] }>()

const router = useRouter()
const { store, openInStore, projectPath } = useBoardContext()
</script>

<template>
  <header class="titlebar">
    <div class="titlebar-lead">
      <span class="titlebar-title">{{ projectTitle }}</span>
      <div class="titlebar-actions">
        <OpenInPicker />
        <button
          class="secondary"
          :title="`Open in ${openInStore.selectedTarget.label}`"
          @click="store.openIn(projectPath, openInStore.selectedId)"
        >
          ⌁ Open
        </button>
      </div>
    </div>
    <div class="titlebar-actions">
      <OfflineBadge />
      <button class="secondary" title="Back to projects" @click="router.push('/')">← Projects</button>
      <WorkflowPicker :project-path="projectPath" />
      <button
        class="secondary"
        title="What you want to build"
        @click="emit('newTicket')"
      >
        + Ticket
      </button>
      <button
        class="secondary"
        :disabled="!githubUrl || pullingIssues"
        :title="
          !githubUrl
            ? 'This project has no linked GitHub repository'
            : 'Import open GitHub issues as tickets'
        "
        @click="emit('pullIssues')"
      >
        {{ pullingIssues ? 'Pulling…' : '⇣ Pull issues' }}
      </button>
      <button class="secondary" title="Create swim lane" @click="emit('newLane')">+ Swim lane</button>
      <button class="secondary" title="Board and UI settings" @click="emit('openSettings')">⚙ Settings</button>
    </div>
  </header>
</template>
