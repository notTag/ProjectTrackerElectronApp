<script setup lang="ts">
import { computed } from 'vue'
import {
  agentRunBadge,
  checklistProgress,
  isWebUrl,
  pullRequestLabel,
  pullRequestStatusLabel,
  worktreeFolderName,
  type AgentRunBadge,
  type Ticket,
  type TicketCardField
} from '@/shared/projectTypes'

// Only per-ticket values come in, so opening a ticket or editing another one
// leaves this card's props unchanged and Vue skips re-rendering it (#134).
// Listeners are declared emits, which Vue leaves out of that props comparison.
const props = defineProps<{
  ticket: Ticket
  cardFields: TicketCardField[]
  selected: boolean
  carried: boolean
  agentRunning: boolean
  fullAuto: boolean
  readyLaneName?: string
  assigneeName: string
}>()

const emit = defineEmits<{
  open: [ticketId: string]
  'toggle-select': [ticketId: string]
  'drag-start': [event: DragEvent, ticketId: string]
  'drag-end': []
}>()

// Glyphs, not just colour, tell success from failure.
const AGENT_BADGES: Record<AgentRunBadge, { className: string; label: string; glyph?: string }> = {
  running: { className: 'agent-status-running', label: 'Agent running' },
  succeeded: { className: 'agent-status-done', label: 'Agent succeeded', glyph: '✓' },
  failed: { className: 'agent-status-failed', label: 'Agent failed', glyph: '✕' },
  interrupted: { className: 'agent-status-interrupted', label: 'Interrupted', glyph: '⏸' }
}

const agentBadge = computed(() => {
  const badge = agentRunBadge(props.ticket, props.agentRunning)
  return badge ? AGENT_BADGES[badge] : null
})

const checklist = computed(() => checklistProgress(props.ticket.checklist))

const showsField = (field: TicketCardField) => props.cardFields.includes(field)
</script>

<template>
  <article
    class="ticket"
    :class="{ 'ticket-carried': carried }"
    draggable="true"
    @dragstart="emit('drag-start', $event, ticket.id)"
    @dragend="emit('drag-end')"
    @click="emit('open', ticket.id)"
  >
    <input
      type="checkbox"
      class="ticket-select"
      :checked="selected"
      :aria-label="`Select #${ticket.number} (run / move)`"
      title="Select (run / move)"
      @click.stop
      @change="emit('toggle-select', ticket.id)"
    />
    <h3>
      <span
        v-if="agentBadge"
        :class="['agent-status', agentBadge.className]"
        role="img"
        :aria-label="agentBadge.label"
        :title="agentBadge.label"
      >{{ agentBadge.glyph }}</span>
      <span v-if="showsField('number')" class="ticket-number">#{{ ticket.number }}</span>
      {{ ticket.title }}
      <span
        v-if="fullAuto"
        class="full-auto-badge"
        title="Full auto: the next lane's agent starts when this one moves the ticket on"
      >auto</span>
      <span
        v-if="readyLaneName"
        class="full-auto-badge ready-badge"
        :title="`Move rules and checklist pass; ready to move to ${readyLaneName}`"
      >ready → {{ readyLaneName }}</span>
    </h3>
    <p v-if="showsField('description') && ticket.description" class="ticket-preview">
      {{ ticket.description }}
    </p>
    <p v-if="showsField('assignee') && ticket.assigneeId" class="ticket-assignee">
      {{ assigneeName }}
    </p>
    <ul v-if="showsField('labels') && ticket.labels?.length" class="ticket-labels">
      <li v-for="label in ticket.labels" :key="label">{{ label }}</li>
    </ul>
    <p
      v-if="
        (showsField('checklist') && ticket.checklist?.length) ||
        (showsField('branch') && ticket.branchName) ||
        (showsField('worktree') && ticket.worktreePath) ||
        (showsField('version') && ticket.version) ||
        (showsField('pullRequest') && isWebUrl(ticket.pullRequestUrl))
      "
      class="ticket-meta"
    >
      <span v-if="showsField('checklist') && ticket.checklist?.length">
        ☑ {{ checklist.done }}/{{ checklist.total }}
      </span>
      <span v-if="showsField('branch') && ticket.branchName" class="ticket-branch">
        ⑂ {{ ticket.branchName }}
      </span>
      <span
        v-if="showsField('worktree') && ticket.worktreePath"
        class="ticket-branch"
        :title="ticket.worktreePath"
      >
        ⌂ {{ worktreeFolderName(ticket.worktreePath) }}
      </span>
      <span v-if="showsField('version') && ticket.version" class="ticket-branch">v{{ ticket.version }}</span>
      <!-- .stop keeps the click from also opening the ticket modal; draggable=false keeps a drag from it a card drag. -->
      <a
        v-if="showsField('pullRequest') && isWebUrl(ticket.pullRequestUrl)"
        :href="ticket.pullRequestUrl"
        target="_blank"
        draggable="false"
        @click.stop
      >
        <span
          v-if="ticket.pullRequestState"
          class="pull-request-dot"
          :data-state="ticket.pullRequestState"
          :title="pullRequestStatusLabel(ticket.pullRequestState)"
        ></span>
        {{ pullRequestLabel(ticket.pullRequestUrl) }} ↗
      </a>
    </p>
  </article>
</template>
