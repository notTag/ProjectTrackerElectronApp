<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import OpenInPicker from '@/components/OpenInPicker.vue'
import { useOpenInStore } from '@/stores/openIn'
import { useProjectsStore } from '@/stores/projects'
import {
  DEFAULT_LANE_WIDTH,
  GITHUB_IMPORT_LANE_ID,
  TICKET_CARD_FIELDS,
  TICKET_DESCRIPTION_TEMPLATE,
  addChecklistItem,
  checklistProgress,
  clampLaneWidth,
  formatLabels,
  parseLabels,
  removeChecklistItem,
  setChecklistItemDone,
  setLaneWidth,
  getUnassignedLane,
  ticketSearchText,
  ticketShellCommand,
  toggleCardField,
  toggleHiddenLane,
  type Agent,
  type TicketCardField,
  type User,
  UNASSIGNED_LANE_ID,
  UNASSIGNED_LANE_NAME,
  type SwimLane,
  type Ticket
} from '@/shared/projectTypes'

const route = useRoute()
const router = useRouter()
const store = useProjectsStore()
const openInStore = useOpenInStore()

const projectPath = computed(() => decodeURIComponent(String(route.params.projectPath)))
const project = computed(() => store.projects.find((entry) => entry.path === projectPath.value))
const projectTitle = computed(() => project.value?.name ?? projectPath.value.split('/').pop() ?? 'Board')
const board = computed(() => store.board(projectPath.value))
const githubUrl = computed(() => project.value?.githubUrl)
const pullingIssues = computed(() => Boolean(store.githubLoading[projectPath.value]))

const users = computed<User[]>(() => store.state.users ?? [])
const assigneeName = (assigneeId?: string) =>
  users.value.find((user) => user.id === assigneeId)?.name ?? 'Unassigned'

// Empty until something writes agents into state, which nothing does yet — the
// picker says so rather than pretending to offer a choice.
const agents = computed<Agent[]>(() => store.state.agents ?? [])

const filterQuery = ref('')
const showOnlyMine = ref(false)
const filterLaneId = ref('')

const openTicketId = ref<string | null>(null)
const openLaneId = ref<string | null>(null)
const draggedTicketId = ref<string | null>(null)
const boardSettingsOpen = ref(false)

const ticketDraft = ref<{ title: string; description: string; laneId: string } | null>(null)
const laneDraftName = ref<string | null>(null)
const checklistDraft = ref('')

const openTicket = computed(() => board.value.tickets.find((ticket) => ticket.id === openTicketId.value) ?? null)
const openLane = computed(() => laneColumns.value.find((lane) => lane.id === openLaneId.value) ?? null)
const anyModalOpen = computed(
  () =>
    Boolean(openTicketId.value || openLaneId.value || ticketDraft.value || laneDraftName.value !== null) ||
    boardSettingsOpen.value
)

// The unassigned column is prepended for rendering but kept out of board.lanes,
// so it carries its own agent prompt without ever becoming deletable.
const unassignedLane = computed(() => getUnassignedLane(board.value))

const laneColumns = computed(() => [unassignedLane.value, ...board.value.lanes])

// Widths, hidden columns and card fields are this user's view of a shared
// board, so they persist alongside the board rather than in component state.
const preferences = computed(() => store.boardPreferences(projectPath.value))

const savePreferences = (next: ReturnType<typeof store.boardPreferences>) =>
  store.saveBoardPreferences(projectPath.value, next)

const hiddenLaneIds = computed(() => new Set(preferences.value.hiddenLaneIds))
const laneIsHidden = (laneId: string) => hiddenLaneIds.value.has(laneId)
const toggleLaneVisibility = (laneId: string) => savePreferences(toggleHiddenLane(preferences.value, laneId))

const showsField = (field: TicketCardField) => preferences.value.cardFields.includes(field)
const toggleField = (field: TicketCardField) => savePreferences(toggleCardField(preferences.value, field))

const laneTicketTotal = (laneId: string) =>
  board.value.tickets.filter((ticket) => ticket.laneId === laneId).length

// The columns worth an explicit show/hide chip: both arrive by import rather
// than by choice, so they are the ones a board wants out of the way.
const githubImportLane = computed(
  () => board.value.lanes.find((lane) => lane.id === GITHUB_IMPORT_LANE_ID) ?? null
)
const toggleableLanes = computed(() =>
  [unassignedLane.value, githubImportLane.value].filter((lane): lane is SwimLane => Boolean(lane))
)

const visibleLanes = computed(() => {
  const shownLanes = laneColumns.value.filter((lane) => !laneIsHidden(lane.id))
  return filterLaneId.value ? shownLanes.filter((lane) => lane.id === filterLaneId.value) : shownLanes
})

// Held as one object so a drag reads its own start point rather than a set of
// refs that can fall out of sync when a second pointer arrives.
const laneResize = ref<{ laneId: string; startX: number; startWidth: number; width: number } | null>(null)

const laneWidth = (laneId: string) => {
  if (laneResize.value?.laneId === laneId) return laneResize.value.width
  return preferences.value.laneWidths[laneId] ?? DEFAULT_LANE_WIDTH
}

const startLaneResize = (lane: SwimLane, event: PointerEvent) => {
  const startWidth = laneWidth(lane.id)
  laneResize.value = { laneId: lane.id, startX: event.clientX, startWidth, width: startWidth }
  // Capture keeps move and up events on the handle even when the pointer runs
  // ahead of it, so a fast drag never strands the lane mid-resize.
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const trackLaneResize = (event: PointerEvent) => {
  const resize = laneResize.value
  if (!resize) return
  resize.width = clampLaneWidth(resize.startWidth + event.clientX - resize.startX)
}

// Saved once on release rather than on every move: a drag is one width change,
// not a hundred writes to disk.
const endLaneResize = async () => {
  const resize = laneResize.value
  laneResize.value = null
  if (!resize || resize.width === resize.startWidth) return
  await savePreferences(setLaneWidth(preferences.value, resize.laneId, resize.width))
}

const matchesAssignee = (ticket: Ticket) =>
  !showOnlyMine.value || ticket.assigneeId === store.state.userId

const matchesQuery = (ticket: Ticket) => {
  const query = filterQuery.value.trim().toLowerCase()
  if (!query) return true
  return ticketSearchText(ticket).includes(query)
}

const ticketsInLane = (laneId: string) =>
  board.value.tickets.filter(
    (ticket) => ticket.laneId === laneId && matchesQuery(ticket) && matchesAssignee(ticket)
  )

const visibleTicketCount = computed(() =>
  visibleLanes.value.reduce((total, lane) => total + ticketsInLane(lane.id).length, 0)
)

const filtersActive = computed(() => Boolean(filterQuery.value.trim() || filterLaneId.value || showOnlyMine.value))

const clearFilters = () => {
  filterQuery.value = ''
  filterLaneId.value = ''
  showOnlyMine.value = false
}

const assignToMe = (ticket: Ticket) => {
  const nextAssigneeId = ticket.assigneeId === store.state.userId ? undefined : store.state.userId
  editTicket(ticket, { assigneeId: nextAssigneeId })
}

const pullIssues = () => store.pullGithubIssues(projectPath.value)

const closeModals = () => {
  openTicketId.value = null
  openLaneId.value = null
  ticketDraft.value = null
  laneDraftName.value = null
  boardSettingsOpen.value = false
  checklistDraft.value = ''
}

const handleEscapeKey = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  if (anyModalOpen.value) {
    closeModals()
    event.preventDefault()
    return
  }
  void router.push('/')
}

onMounted(() => {
  if (!store.state.snapshot.scannedAt) void store.load()
  window.addEventListener('keydown', handleEscapeKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscapeKey)
})

const startTicketDraft = () => {
  const defaultLaneId = board.value.lanes[0]?.id ?? UNASSIGNED_LANE_ID
  ticketDraft.value = { title: '', description: TICKET_DESCRIPTION_TEMPLATE, laneId: defaultLaneId }
}

const saveTicketDraft = async () => {
  const draft = ticketDraft.value
  if (!draft || !draft.title.trim()) return
  const description = draft.description.trim()
  const templateWasLeftUntouched = description === TICKET_DESCRIPTION_TEMPLATE.trim()
  ticketDraft.value = null
  await store.addTicket(
    projectPath.value,
    draft.laneId,
    draft.title.trim(),
    templateWasLeftUntouched ? '' : description
  )
}

const saveLaneDraft = async () => {
  const name = (laneDraftName.value ?? '').trim()
  if (!name) return
  laneDraftName.value = null
  await store.addLane(projectPath.value, name)
}

const deleteLane = async (lane: SwimLane) => {
  openLaneId.value = null
  await store.removeLane(projectPath.value, lane.id)
}

const deleteTicket = async (ticket: Ticket) => {
  openTicketId.value = null
  await store.removeTicket(projectPath.value, ticket.id)
}

const editTicket = (ticket: Ticket, patch: Partial<Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'>>) => {
  void store.updateTicket(projectPath.value, ticket.id, patch)
}

const editTicketLabels = (ticket: Ticket, value: string) => editTicket(ticket, { labels: parseLabels(value) })

const addChecklistDraft = (ticket: Ticket) => {
  const text = checklistDraft.value.trim()
  if (!text) return
  checklistDraft.value = ''
  editTicket(ticket, { checklist: addChecklistItem(ticket.checklist, text) })
}

const toggleChecklistItem = (ticket: Ticket, index: number, done: boolean) =>
  editTicket(ticket, { checklist: setChecklistItemDone(ticket.checklist, index, done) })

const dropChecklistItem = (ticket: Ticket, index: number) =>
  editTicket(ticket, { checklist: removeChecklistItem(ticket.checklist, index) })

const editLane = (lane: SwimLane, patch: Partial<Omit<SwimLane, 'id'>>) => {
  void store.updateLane(projectPath.value, lane.id, patch)
}

const dropOnLane = async (laneId: string) => {
  const ticketId = draggedTicketId.value
  draggedTicketId.value = null
  if (!ticketId) return
  const ticket = board.value.tickets.find((entry) => entry.id === ticketId)
  if (!ticket || ticket.laneId === laneId) return
  await store.updateTicket(projectPath.value, ticketId, { laneId })
}

const formatDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

const formatDateTime = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const laneName = (laneId: string) => board.value.lanes.find((lane) => lane.id === laneId)?.name ?? laneId

// A ticket's prompt is built from its own lane, so the same ticket produces a
// different instruction once it moves column.
const laneOfTicket = (ticket: Ticket) =>
  laneColumns.value.find((lane) => lane.id === ticket.laneId) ?? unassignedLane.value

const ticketCommand = (ticket: Ticket) => ticketShellCommand(ticket, laneOfTicket(ticket))

const openTicketInShell = (ticket: Ticket) =>
  store.openIn(projectPath.value, openInStore.selectedId, ticketCommand(ticket))
</script>

<template>
  <header class="titlebar">
    <span class="titlebar-title">{{ projectTitle }}</span>
    <div class="titlebar-actions">
      <button class="secondary" title="Back to projects" @click="router.push('/')">← Projects</button>
      <OpenInPicker />
      <button
        class="secondary"
        :title="`Open in ${openInStore.selectedTarget.label}`"
        @click="store.openIn(projectPath, openInStore.selectedId)"
      >
        ⌁ Open
      </button>
      <button
        class="secondary"
        title="Create ticket"
        @click="startTicketDraft"
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
        @click="pullIssues"
      >
        {{ pullingIssues ? 'Pulling…' : '⇣ Pull issues' }}
      </button>
      <button class="secondary" title="Create swim lane" @click="laneDraftName = ''">+ Swim lane</button>
      <button class="secondary" title="Choose what ticket cards show" @click="boardSettingsOpen = true">
        ⚙ Display
      </button>
    </div>
  </header>

  <main class="app-shell board-shell">
    <section v-if="store.error || store.notice" class="message-row">
      <div v-if="store.error" class="message error">
        {{ store.error }}
        <button class="icon-button message-dismiss" title="Dismiss" @click="store.error = null">×</button>
      </div>
      <div v-if="store.notice" class="message notice">
        {{ store.notice }}
        <button class="icon-button message-dismiss" title="Dismiss" @click="store.notice = null">×</button>
      </div>
    </section>

    <section class="board-filters">
      <input
        v-model="filterQuery"
        class="filter-query"
        :class="{ active: filterQuery }"
        placeholder="Filter tickets…"
      />
      <select v-model="filterLaneId" :class="{ active: filterLaneId }">
        <option value="">All swim lanes</option>
        <option v-for="lane in laneColumns" :key="lane.id" :value="lane.id">{{ lane.name }}</option>
      </select>
      <button
        class="secondary"
        :class="{ active: showOnlyMine }"
        title="Show only tickets assigned to me"
        @click="showOnlyMine = !showOnlyMine"
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
      <button v-if="filtersActive" class="secondary" @click="clearFilters">Clear</button>
    </section>

    <section v-if="board.lanes.length === 0" class="board-empty">
      <p>No swim lanes yet.</p>
      <button @click="laneDraftName = ''">Create swim lane</button>
    </section>

    <section v-else class="board" aria-label="Swim lanes">
      <section
        v-for="lane in visibleLanes"
        :key="lane.id"
        class="lane"
        :class="{ 'lane-unassigned': lane.id === UNASSIGNED_LANE_ID }"
        :style="{ width: `${laneWidth(lane.id)}px` }"
        @dragover.prevent
        @drop.prevent="dropOnLane(lane.id)"
      >
        <header class="lane-heading">
          <h2>{{ lane.name }}</h2>
          <span class="lane-count">{{ ticketsInLane(lane.id).length }}</span>
          <button
            class="icon-button"
            :title="`Configure ${lane.name}`"
            @click="openLaneId = lane.id"
          >
            ⚙
          </button>
        </header>

        <div class="lane-body">
          <article
            v-for="ticket in ticketsInLane(lane.id)"
            :key="ticket.id"
            class="ticket"
            draggable="true"
            @dragstart="draggedTicketId = ticket.id"
            @dragend="draggedTicketId = null"
            @click="openTicketId = ticket.id"
          >
            <h3>
              <span v-if="showsField('number')" class="ticket-number">#{{ ticket.number }}</span>
              {{ ticket.title }}
            </h3>
            <p v-if="showsField('description') && ticket.description" class="ticket-preview">
              {{ ticket.description }}
            </p>
            <p v-if="showsField('assignee') && ticket.assigneeId" class="ticket-assignee">
              {{ assigneeName(ticket.assigneeId) }}
            </p>
            <ul v-if="showsField('labels') && ticket.labels?.length" class="ticket-labels">
              <li v-for="label in ticket.labels" :key="label">{{ label }}</li>
            </ul>
            <p
              v-if="
                (showsField('checklist') && ticket.checklist?.length) ||
                (showsField('branch') && ticket.branchName)
              "
              class="ticket-meta"
            >
              <span v-if="showsField('checklist') && ticket.checklist?.length">
                ☑ {{ checklistProgress(ticket.checklist).done }}/{{ checklistProgress(ticket.checklist).total }}
              </span>
              <span v-if="showsField('branch') && ticket.branchName" class="ticket-branch">
                ⑂ {{ ticket.branchName }}
              </span>
            </p>
          </article>
        </div>

        <div
          class="lane-resize-handle"
          role="separator"
          aria-orientation="vertical"
          :title="`Drag to resize ${lane.name}`"
          @pointerdown.prevent="startLaneResize(lane, $event)"
          @pointermove="trackLaneResize"
          @pointerup="endLaneResize"
          @pointercancel="endLaneResize"
        />
      </section>
    </section>
  </main>

  <div v-if="boardSettingsOpen" class="modal-backdrop" @click.self="boardSettingsOpen = false">
    <section class="modal lane-modal">
      <p class="eyebrow">Ticket card display</p>
      <span class="field-hint">The title always shows. Everything else is up to you.</span>
      <ul class="card-field-list">
        <li v-for="field in TICKET_CARD_FIELDS" :key="field.id">
          <label>
            <input type="checkbox" :checked="showsField(field.id)" @change="toggleField(field.id)" />
            {{ field.label }}
          </label>
        </li>
      </ul>

      <p class="eyebrow">Columns</p>
      <ul class="card-field-list">
        <li v-for="lane in toggleableLanes" :key="lane.id">
          <label>
            <input
              type="checkbox"
              :checked="!laneIsHidden(lane.id)"
              @change="toggleLaneVisibility(lane.id)"
            />
            {{ lane.name }}
          </label>
        </li>
      </ul>

      <div class="modal-actions">
        <button @click="boardSettingsOpen = false">Done</button>
      </div>
    </section>
  </div>

  <div v-if="ticketDraft" class="modal-backdrop" @click.self="ticketDraft = null">
    <section class="modal ticket-modal">
      <p class="eyebrow">New ticket</p>
      <input
        v-model="ticketDraft.title"
        class="ticket-title-input"
        placeholder="Title"
        @keyup.enter="saveTicketDraft"
      />

      <label>
        Status
        <select v-model="ticketDraft.laneId">
          <option :value="UNASSIGNED_LANE_ID">{{ UNASSIGNED_LANE_NAME }}</option>
          <option v-for="lane in board.lanes" :key="lane.id" :value="lane.id">{{ lane.name }}</option>
        </select>
      </label>

      <label>
        Description
        <textarea v-model="ticketDraft.description" placeholder="Details, acceptance criteria, links..." />
      </label>

      <div class="modal-actions">
        <button class="secondary" @click="ticketDraft = null">Cancel</button>
        <button :disabled="!ticketDraft.title.trim()" @click="saveTicketDraft">Save</button>
      </div>
    </section>
  </div>

  <div v-if="laneDraftName !== null" class="modal-backdrop" @click.self="laneDraftName = null">
    <section class="modal lane-modal">
      <p class="eyebrow">New swim lane</p>
      <input v-model="laneDraftName" class="ticket-title-input" placeholder="Name" @keyup.enter="saveLaneDraft" />
      <div class="modal-actions">
        <button class="secondary" @click="laneDraftName = null">Cancel</button>
        <button :disabled="!laneDraftName.trim()" @click="saveLaneDraft">Add lane</button>
      </div>
    </section>
  </div>

  <div v-if="openTicket" class="modal-backdrop" @click.self="closeModals">
    <section class="modal ticket-modal">
      <p class="eyebrow">
        #{{ openTicket.number }} · Created {{ formatDate(openTicket.createdAt) }}
        <template v-if="openTicket.updatedAt"> · Updated {{ formatDateTime(openTicket.updatedAt) }}</template>
      </p>
      <input
        class="ticket-title-input"
        :value="openTicket.title"
        @change="editTicket(openTicket, { title: ($event.target as HTMLInputElement).value })"
      />

      <label>
        Status
        <select
          :value="openTicket.laneId"
          @change="editTicket(openTicket, { laneId: ($event.target as HTMLSelectElement).value })"
        >
          <option :value="UNASSIGNED_LANE_ID">{{ UNASSIGNED_LANE_NAME }}</option>
          <option v-for="lane in board.lanes" :key="lane.id" :value="lane.id">{{ lane.name }}</option>
        </select>
      </label>

      <label>
        Assignee
        <select
          :value="openTicket.assigneeId ?? ''"
          @change="
            editTicket(openTicket, {
              assigneeId: ($event.target as HTMLSelectElement).value || undefined
            })
          "
        >
          <option value="">Unassigned</option>
          <option v-for="user in users" :key="user.id" :value="user.id">{{ user.name }}</option>
        </select>
      </label>

      <label>
        Description
        <textarea
          :value="openTicket.description"
          placeholder="Details, acceptance criteria, links..."
          @change="editTicket(openTicket, { description: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>

      <label>
        Labels
        <input
          :value="formatLabels(openTicket.labels)"
          placeholder="bug, ui, needs-design"
          @change="editTicketLabels(openTicket, ($event.target as HTMLInputElement).value)"
        />
        <span class="field-hint">Comma separated. Searchable from the filter box.</span>
      </label>

      <label>
        Branch
        <input
          class="agent-file-path"
          :value="openTicket.branchName ?? ''"
          placeholder="feat/board-ticket-fields"
          @change="editTicket(openTicket, { branchName: ($event.target as HTMLInputElement).value.trim() })"
        />
      </label>

      <section class="ticket-checklist">
        <p class="eyebrow">
          Checklist
          <span v-if="openTicket.checklist?.length">
            {{ checklistProgress(openTicket.checklist).done }}/{{ checklistProgress(openTicket.checklist).total }}
          </span>
        </p>
        <ul v-if="openTicket.checklist?.length">
          <li v-for="(item, index) in openTicket.checklist" :key="index">
            <input
              type="checkbox"
              :checked="item.done"
              @change="toggleChecklistItem(openTicket, index, ($event.target as HTMLInputElement).checked)"
            />
            <span :class="{ 'checklist-done': item.done }">{{ item.text }}</span>
            <button class="icon-button" title="Remove item" @click="dropChecklistItem(openTicket, index)">×</button>
          </li>
        </ul>
        <input
          v-model="checklistDraft"
          placeholder="Add an item, then press Enter"
          @keyup.enter="addChecklistDraft(openTicket)"
        />
      </section>

      <section class="ticket-agent">
        <p class="eyebrow">Agent completion</p>
        <label>
          Agent
          <select
            :value="openTicket.agentId ?? ''"
            @change="
              editTicket(openTicket, {
                agentId: ($event.target as HTMLSelectElement).value || undefined
              })
            "
          >
            <option value="">{{ agents.length ? 'No agent' : 'No agents configured' }}</option>
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
          </select>
        </label>
        <p class="agent-hint">
          Or hand the ticket to a shell. Opening copies this command to your clipboard:
        </p>
        <pre class="agent-command">{{ ticketCommand(openTicket) }}</pre>
        <button
          class="secondary"
          :title="`Open ${projectTitle} in ${openInStore.selectedTarget.label} with this command copied`"
          @click="openTicketInShell(openTicket)"
        >
          ⌁ Open in {{ openInStore.selectedTarget.label }}
        </button>
      </section>

      <section v-if="openTicket.agentRun" class="ticket-agent-run">
        <p class="eyebrow">
          Last agent run · {{ laneName(openTicket.agentRun.laneId) }} · {{ formatDateTime(openTicket.agentRun.at) }}
        </p>
        <pre>{{ openTicket.agentRun.output }}</pre>
      </section>

      <a v-if="openTicket.externalUrl" class="ticket-external" :href="openTicket.externalUrl" target="_blank">
        View on GitHub ({{ openTicket.externalId?.replace('github:', '#') }})
      </a>

      <div class="modal-actions">
        <button class="secondary danger" @click="deleteTicket(openTicket)">Delete</button>
        <button class="secondary" @click="assignToMe(openTicket)">
          {{ openTicket.assigneeId === store.state.userId ? 'Unassign me' : 'Assign to me' }}
        </button>
        <button @click="closeModals">Done</button>
      </div>
    </section>
  </div>

  <div v-if="openLane" class="modal-backdrop" @click.self="openLaneId = null">
    <section class="modal lane-modal">
      <p class="eyebrow">Swim lane</p>
      <input
        class="ticket-title-input"
        :value="openLane.name"
        @change="editLane(openLane, { name: ($event.target as HTMLInputElement).value })"
      />

      <label>
        Agent prompt
        <textarea
          class="agent-prompt"
          :value="openLane.agentPrompt"
          placeholder="Instructions for the agent that handles tickets in this lane — format, required sections, clarifying questions to ask..."
          @change="editLane(openLane, { agentPrompt: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>

      <label>
        Agent markdown file
        <input
          class="agent-file-path"
          :value="openLane.agentFilePath"
          placeholder="/Users/you/Projects/thing/docs/prd-template.md"
          @change="editLane(openLane, { agentFilePath: ($event.target as HTMLInputElement).value })"
        />
        <span class="field-hint">Used alongside the prompt above — both are sent when both are filled in.</span>
      </label>

      <div class="modal-actions">
        <button
          v-if="openLane.id !== UNASSIGNED_LANE_ID"
          class="secondary danger"
          :title="`Delete ${openLane.name} — its tickets move to ${UNASSIGNED_LANE_NAME}`"
          @click="deleteLane(openLane)"
        >
          Delete lane
        </button>
        <span v-else class="field-hint">This column always exists — it holds tickets with no status.</span>
        <button @click="openLaneId = null">Done</button>
      </div>
    </section>
  </div>
</template>
