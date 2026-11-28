<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import TicketGraph from '@/components/TicketGraph.vue'
import MessageBanners from '@/components/MessageBanners.vue'
import MetricsPanel from '@/components/MetricsPanel.vue'
import UiSettingsPanel from '@/components/UiSettingsPanel.vue'
import AutoRunConfirmModal, { type AutoRunPicks } from '@/components/board/AutoRunConfirmModal.vue'
import BoardFilters from '@/components/board/BoardFilters.vue'
import BoardLanes from '@/components/board/BoardLanes.vue'
import BoardTitlebar from '@/components/board/BoardTitlebar.vue'
import WorkflowsModal from '@/components/WorkflowsModal.vue'
import ConfirmDeleteModal from '@/components/board/ConfirmDeleteModal.vue'
import DisplaySettings from '@/components/board/DisplaySettings.vue'
import LaneSettingsModal from '@/components/board/LaneSettingsModal.vue'
import NewTicketModal, { type TicketDraft, type TicketDraftSave } from '@/components/board/NewTicketModal.vue'
import TicketModal from '@/components/board/TicketModal.vue'
import { useBoardContext } from '@/components/board/boardContext'
import { copyImagesToTicket, saveImageFiles } from '@/components/board/ticketImages'
import { uiDemoPanelOpen } from '@/uiDemo'
import { TERMINAL_TARGETS } from '@/shared/openInTargets'
import {
  autoRunUsesWorktrees,
  buildAutoRunLaunch,
  buildOrchestratorLaunch,
  findAgent,
  groupTicketsByLane,
  joinNotices,
  orchestratorAgentChoice,
  skippedRunsNotice,
  splitRunnable,
  ticketSearchText,
  ticketsToRun,
  TICKET_DESCRIPTION_TEMPLATE,
  UNASSIGNED_LANE_ID,
  UNASSIGNED_LANE_NAME,
  type BoardFilterControl,
  type GraphPosition,
  type SwimLane,
  type Ticket
} from '@/shared/projectTypes'

const router = useRouter()
const {
  store,
  projectPath,
  project,
  board,
  laneColumns,
  agents,
  laneIsHidden,
  editLane,
  promptContext,
  autoRunTerminal,
  orchestratorContextFor
} = useBoardContext()

const projectTitle = computed(() => project.value?.name ?? projectPath.value.split('/').pop() ?? 'Board')
const githubUrl = computed(() => project.value?.githubUrl)
const pullingIssues = computed(() => Boolean(store.githubLoading[projectPath.value]))

const boardView = ref<'lanes' | 'graph'>('lanes')
const filterQuery = ref('')
const showOnlyMine = ref(false)
// Empty = every lane. Read through activeFilterLaneIds, never directly.
const filterLaneIds = ref<string[]>([])

const filtersComponent = ref<InstanceType<typeof BoardFilters> | null>(null)
const lanesComponent = ref<InstanceType<typeof BoardLanes> | null>(null)
const ticketModalComponent = ref<InstanceType<typeof TicketModal> | null>(null)
const laneSettingsComponent = ref<InstanceType<typeof LaneSettingsModal> | null>(null)

const openTicketId = ref<string | null>(null)
const openLaneId = ref<string | null>(null)
const workflowsModalOpen = ref(false)

const ticketDraft = ref<TicketDraft | null>(null)
// Set when a new ticket's staged images fail to upload: shown on that ticket's
// modal only, even if another ticket was open when the upload failed.
const newTicketImageError = ref<{ ticketId: string; message: string } | null>(null)
watch(openTicketId, (ticketId) => {
  if (!ticketId) newTicketImageError.value = null
})
const openTicketImageError = computed(() => {
  const uploadError = newTicketImageError.value
  return uploadError?.ticketId === openTicketId.value ? uploadError.message : null
})

// Blob URLs pin their File in memory until revoked, so a closed or replaced
// draft releases every preview it made.
watch(ticketDraft, (_draft, previousDraft) => {
  previousDraft?.images.forEach((stagedImage) => URL.revokeObjectURL(stagedImage.previewUrl))
})
const laneDraftName = ref<string | null>(null)
// Set when the graph's "+ Add swim lane" opened the prompt: where the new node lands.
const laneDraftGraphPosition = ref<GraphPosition>()
watch(laneDraftName, (name) => {
  if (name === null) laneDraftGraphPosition.value = undefined
})

const openTicket = computed(() => board.value.tickets.find((ticket) => ticket.id === openTicketId.value) ?? null)
const openLane = computed(() => laneColumns.value.find((lane) => lane.id === openLaneId.value) ?? null)
const anyModalOpen = computed(
  () =>
    Boolean(
      openTicketId.value ||
        openLaneId.value ||
        ticketDraft.value ||
        laneDraftName.value !== null ||
        autoRunConfirmLaneId.value ||
        ticketPendingDeletion.value ||
        lanePendingDeletion.value ||
        workflowsModalOpen.value
    )
)

// Lanes the Display toggles hide are not offered: picking only those would
// leave the board with no columns.
const shownLanes = computed(() => laneColumns.value.filter((lane) => !laneIsHidden(lane.id)))

// A deleted or hidden lane leaves its id behind; dropping it here keeps a
// stale pick from blanking the board.
const activeFilterLaneIds = computed(() =>
  filterLaneIds.value.filter((laneId) => shownLanes.value.some((lane) => lane.id === laneId))
)

// Every lane picked shows the whole board, so it counts as no filter.
const laneFilterNarrows = computed(() => {
  const pickedCount = activeFilterLaneIds.value.length
  return pickedCount > 0 && pickedCount < shownLanes.value.length
})

// The view stays mounted across boards and seeded lane ids repeat between
// projects, so a pick would otherwise carry over to the next board.
watch(projectPath, () => {
  filterLaneIds.value = []
})

// Board order, not pick order.
const visibleLanes = computed(() => {
  if (!laneFilterNarrows.value) return shownLanes.value
  const pickedIds = activeFilterLaneIds.value
  return shownLanes.value.filter((lane) => pickedIds.includes(lane.id))
})

const matchesAssignee = (ticket: Ticket) =>
  !showOnlyMine.value || ticket.assigneeId === store.state.userId

const matchesQuery = (ticket: Ticket) => {
  const query = filterQuery.value.trim().toLowerCase()
  if (!query) return true
  return ticketSearchText(ticket).includes(query)
}

const ticketsByLane = computed(() =>
  groupTicketsByLane(board.value.tickets, (ticket) => matchesQuery(ticket) && matchesAssignee(ticket))
)
const NO_TICKETS: Ticket[] = []
const ticketsInLane = (laneId: string) => ticketsByLane.value.get(laneId) ?? NO_TICKETS

const visibleTickets = computed(() => visibleLanes.value.flatMap((lane) => ticketsInLane(lane.id)))

// ponytail: in-memory only — a pick for the next run, not ticket data. Persist
// it (store or board preferences) if it should survive leaving the board.
const selectedTicketIds = ref(new Set<string>())
watch(projectPath, () => selectedTicketIds.value.clear())

const toggleTicketSelected = (ticketId: string) => {
  if (selectedTicketIds.value.has(ticketId)) selectedTicketIds.value.delete(ticketId)
  else selectedTicketIds.value.add(ticketId)
}

const filtersActive = computed(() =>
  Boolean(filterQuery.value || laneFilterNarrows.value || showOnlyMine.value)
)

const clearFilters = () => {
  filterQuery.value = ''
  filterLaneIds.value = []
  showOnlyMine.value = false
}

const clearFilterOf = (control: BoardFilterControl) => {
  if (control === 'query') filterQuery.value = ''
  if (control === 'lanes') filterLaneIds.value = []
  if (control === 'mine') showOnlyMine.value = false
}

const switchBoardView = (view: 'lanes' | 'graph') => {
  boardView.value = view
  openTicketId.value = null
}

const ticketPendingDeletion = ref<Ticket | null>(null)

// The ticket can vanish underneath the confirm (agent, poll); drop the stale question.
watch(openTicket, (ticket) => {
  if (!ticket) ticketPendingDeletion.value = null
})

const confirmDeleteTicket = async () => {
  const ticket = ticketPendingDeletion.value
  ticketPendingDeletion.value = null
  if (!ticket) return
  openTicketId.value = null
  await store.removeTicket(projectPath.value, ticket.id)
}

const pullIssues = () => store.pullGithubIssues(projectPath.value)

// Once per board per visit; githubUrl is in the source so a board opened before
// state finished loading still gets its refresh when the project arrives.
const boardsWithRefreshedPullRequests = new Set<string>()
watch(
  [projectPath, githubUrl],
  ([path, url]) => {
    if (!url || boardsWithRefreshedPullRequests.has(path)) return
    boardsWithRefreshedPullRequests.add(path)
    void store.refreshBoardPullRequests(path)
  },
  { immediate: true }
)

// Keyed on githubUrl too: on a deep link the project isn't loaded yet, so the
// pull waits for the url to show up instead of seeing "no repo" and skipping.
// The board route is reused across projects, hence a watch, not onMounted.
watch(
  [projectPath, githubUrl],
  ([path, url]) => {
    if (url) void store.autoPullGithubIssues(path)
  },
  { immediate: true }
)

// Unmounting a modal drops its own drafts and menus, so only the open flags reset here.
const closeModals = () => {
  openTicketId.value = null
  openLaneId.value = null
  ticketDraft.value = null
  laneDraftName.value = null
  workflowsModalOpen.value = false
  autoRunConfirmLaneId.value = null
  ticketPendingDeletion.value = null
  lanePendingDeletionId.value = null
}

const isFilterShortcut = (event: KeyboardEvent) => {
  const hasCommandModifier = event.metaKey || event.ctrlKey
  return hasCommandModifier && event.shiftKey && event.key.toLowerCase() === 'f'
}

// The one Escape listener for the board and its children. Priority lives here,
// in order, rather than in listener registration order across components.
const handleBoardKeydown = (event: KeyboardEvent) => {
  if (isFilterShortcut(event)) {
    event.preventDefault()
    if (!anyModalOpen.value) filtersComponent.value?.focus()
    return
  }
  if (event.key !== 'Escape') return
  const claimEscape = () => event.preventDefault()
  // Claimed before anything else: an unhandled Escape leaves the board.
  if (lanesComponent.value?.cancelDragOnEscape()) return claimEscape()
  if (ticketModalComponent.value?.closeMenuOnEscape()) return claimEscape()
  if (laneSettingsComponent.value?.closeMenuOnEscape()) return claimEscape()
  // The delete confirm sits on top of the ticket modal; Escape backs out of it alone.
  if (ticketPendingDeletion.value) {
    ticketPendingDeletion.value = null
    return claimEscape()
  }
  if (lanePendingDeletion.value) {
    lanePendingDeletionId.value = null
    return claimEscape()
  }
  if (anyModalOpen.value) {
    closeModals()
    return claimEscape()
  }
  if (filtersComponent.value?.closeMenuOnEscape()) return claimEscape()
  if (uiDemoPanelOpen.value) {
    uiDemoPanelOpen.value = false
    return claimEscape()
  }
  // The shortcut lands people in the filter, so Escape there should only leave
  // the filter, not the board. A search input's default Escape action clears
  // its value; preventDefault keeps the text.
  if (filtersComponent.value?.blurInputOnEscape(event.target)) return claimEscape()
  void router.push('/')
}

onMounted(() => {
  if (!store.state.snapshot.scannedAt) void store.load()
  window.addEventListener('keydown', handleBoardKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleBoardKeydown)
  ticketDraft.value?.images.forEach((stagedImage) => URL.revokeObjectURL(stagedImage.previewUrl))
})

const startTicketDraft = (laneId = board.value.lanes[0]?.id ?? UNASSIGNED_LANE_ID) => {
  ticketDraft.value = { title: '', description: TICKET_DESCRIPTION_TEMPLATE, laneId, nextLaneId: null, images: [] }
}

const saveTicketDraft = async (draft: TicketDraftSave) => {
  // Staged Files are handed over in `draft`, so the previews can be revoked now.
  ticketDraft.value = null
  const ticketId = await store.addTicket(projectPath.value, draft.laneId, draft.title, draft.description, draft.completion)
  if (!ticketId || !draft.files.length) return
  const imageError = await saveImageFiles(projectPath.value, { id: ticketId }, draft.files)
  // The draft modal is gone, so show an upload failure on the ticket it belongs to.
  if (!imageError) return
  newTicketImageError.value = { ticketId, message: imageError }
  openTicketId.value = ticketId
}

let cloneInFlight = false

const cloneTicket = async (source: Ticket) => {
  if (cloneInFlight) return
  cloneInFlight = true
  try {
    const cloneId = await store.cloneTicket(projectPath.value, source.id)
    if (!cloneId) return
    if (source.images?.length) {
      const imageError = await copyImagesToTicket(projectPath.value, { id: cloneId }, source.images)
      if (imageError) newTicketImageError.value = { ticketId: cloneId, message: imageError }
    }
    const sourceStillOpen = openTicketId.value === source.id
    if (sourceStillOpen) openTicketId.value = cloneId
  } finally {
    cloneInFlight = false
  }
}

const startLaneDraftAt = (graphPosition: GraphPosition) => {
  laneDraftGraphPosition.value = graphPosition
  laneDraftName.value = ''
}

const saveLaneDraft = async () => {
  const name = (laneDraftName.value ?? '').trim()
  if (!name) return
  const graphPosition = laneDraftGraphPosition.value
  laneDraftName.value = null
  await store.addLane(projectPath.value, name, graphPosition ? { graphPosition } : {})
}

// Stored by id and looked up live, so a rename shows in the question and a lane
// removed underneath (poll, other window) drops the confirm by itself.
const lanePendingDeletionId = ref<string | null>(null)
const lanePendingDeletion = computed(
  () => laneColumns.value.find((lane) => lane.id === lanePendingDeletionId.value) ?? null
)

const pendingLaneTicketCount = computed(() => {
  const pendingLane = lanePendingDeletion.value
  if (!pendingLane) return 0
  return board.value.tickets.filter((ticket) => ticket.laneId === pendingLane.id).length
})

const confirmDeleteLane = async () => {
  const lane = lanePendingDeletion.value
  lanePendingDeletionId.value = null
  if (!lane) return
  openLaneId.value = null
  await store.removeLane(projectPath.value, lane.id)
}

// Runs what the lane shows: an active filter narrows the batch, so the button
// never launches tickets the user cannot see. Checked tickets narrow it further.
const autoRunSplit = (lane: SwimLane) => {
  const visibleLaneTickets = ticketsInLane(lane.id)
  const candidates = ticketsToRun(visibleLaneTickets, selectedTicketIds.value)
  return splitRunnable(candidates, lane.id, selectedTicketIds.value)
}

const runnableCountByLaneId = computed(
  () => new Map(laneColumns.value.map((lane) => [lane.id, autoRunSplit(lane).runnable.length]))
)
const autoRunTicketCount = (lane: SwimLane) => runnableCountByLaneId.value.get(lane.id) ?? autoRunSplit(lane).runnable.length

const autoRunConfirmLaneId = ref<string | null>(null)
const autoRunConfirmLane = computed(() => laneColumns.value.find((lane) => lane.id === autoRunConfirmLaneId.value))

const confirmAutoRunLane = async (picks: AutoRunPicks) => {
  const lane = autoRunConfirmLane.value
  autoRunConfirmLaneId.value = null
  if (!lane) return
  const agent = findAgent(agents.value, picks.agentId)
  const model = picks.model
  const chosenTerminal = TERMINAL_TARGETS.find((target) => target.id === picks.terminalId)
  const terminal = chosenTerminal ?? autoRunTerminal(lane)
  const useWorktrees = autoRunUsesWorktrees(lane)
  const { runnable, skipped } = autoRunSplit(lane)
  const skippedNotice = skippedRunsNotice(skipped, lane.name)
  if (runnable.length === 0) {
    if (skippedNotice) store.notice = skippedNotice
    return
  }
  // Launched tickets are unchecked so the next Auto Run doesn't relaunch them.
  for (const ticket of runnable) selectedTicketIds.value.delete(ticket.id)
  const boardPath = projectPath.value
  const generatedContext = orchestratorContextFor(terminal)
  const [agentFileContext, additionalContext, lanesWithAgentFileText] = await Promise.all([
    store.readLaneMarkdownContext(boardPath, lane, 'agent'),
    store.readLaneMarkdownContext(boardPath, lane, 'orchestrator'),
    store.lanesWithAgentFileText(boardPath, generatedContext.lanes)
  ])
  const launches = runnable.map((ticket) => {
    const ticketPromptContext = { ...promptContext(ticket), agentFileContext }
    return buildAutoRunLaunch(ticket, lane, agent, ticketPromptContext, useWorktrees, model)
  })
  const orchestratorContext = { ...generatedContext, additionalContext, lanesWithAgentFileText }
  const orchestratorSettings = {
    orchestratorAgentId: picks.orchestratorAgentId || undefined,
    orchestratorModel: picks.orchestratorModel
  }
  const orchestratorChoice = orchestratorAgentChoice(orchestratorSettings, { agent, model }, agents.value)
  const orchestrator = buildOrchestratorLaunch(
    lane,
    launches,
    orchestratorChoice.agent,
    orchestratorContext,
    orchestratorChoice.model
  )
  const launch = store.autoRunLane(
    boardPath,
    lane.id,
    terminal.id,
    terminal.label,
    launches,
    useWorktrees,
    orchestrator
  )
  // Shown whether or not the launch went ahead: a refused second Auto Run is the case this notice is for.
  void launch.then(() => {
    if (skippedNotice) store.notice = joinNotices(store.notice, skippedNotice)
  })
}
</script>

<template>
  <BoardTitlebar
    :project-title="projectTitle"
    :github-url="githubUrl"
    :pulling-issues="pullingIssues"
    @new-ticket="startTicketDraft()"
    @new-lane="laneDraftName = ''"
    @toggle-settings="uiDemoPanelOpen = !uiDemoPanelOpen"
    @pull-issues="pullIssues"
  />

  <UiSettingsPanel v-if="uiDemoPanelOpen">
    <template #metrics>
      <MetricsPanel :project-paths="[projectPath]" scope="board" inline />
    </template>
    <template #display>
      <DisplaySettings @filter-control-hidden="clearFilterOf" />
    </template>
  </UiSettingsPanel>

  <main class="app-shell board-shell">
    <MessageBanners />

    <BoardFilters
      ref="filtersComponent"
      v-model:query="filterQuery"
      v-model:only-mine="showOnlyMine"
      v-model:filter-lane-ids="filterLaneIds"
      :shown-lanes="shownLanes"
      :active-filter-lane-ids="activeFilterLaneIds"
      :lane-filter-narrows="laneFilterNarrows"
      :visible-ticket-count="visibleTickets.length"
      :filters-active="filtersActive"
      :board-view="boardView"
      @clear="clearFilters"
      @switch-view="switchBoardView"
      @open-workflows="workflowsModalOpen = true"
    />

    <TicketGraph
      v-if="boardView === 'graph'"
      :project-name="projectTitle"
      :lanes="visibleLanes"
      :board-lanes="laneColumns"
      :tickets="visibleTickets"
      :ticket-open="Boolean(openTicket)"
      @selection="openTicketId = null"
      @edit-lane="editLane"
      @add-lane="startLaneDraftAt"
    />
    <section v-else-if="board.lanes.length === 0" class="board-empty">
      <p>No swim lanes yet.</p>
      <button @click="laneDraftName = ''">Create swim lane</button>
    </section>

    <BoardLanes
      v-else
      ref="lanesComponent"
      :visible-lanes="visibleLanes"
      :visible-tickets="visibleTickets"
      :tickets-in-lane="ticketsInLane"
      :auto-run-ticket-count="autoRunTicketCount"
      :lane-filter-narrows="laneFilterNarrows"
      :selected-ticket-ids="selectedTicketIds"
      @open-ticket="openTicketId = $event"
      @open-lane="openLaneId = $event"
      @auto-run="autoRunConfirmLaneId = $event.id"
      @new-ticket="startTicketDraft"
      @new-lane="laneDraftName = ''"
      @toggle-selected="toggleTicketSelected"
    />
  </main>

  <WorkflowsModal v-if="workflowsModalOpen" :project-path="projectPath" @close="workflowsModalOpen = false" />

  <NewTicketModal v-if="ticketDraft" :draft="ticketDraft" @close="ticketDraft = null" @save="saveTicketDraft" />

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

  <TicketModal
    v-if="openTicket"
    ref="ticketModalComponent"
    :ticket="openTicket"
    :board-view="boardView"
    :initial-image-error="openTicketImageError"
    @close="closeModals"
    @delete="ticketPendingDeletion = $event"
    @clone="cloneTicket"
  />

  <ConfirmDeleteModal
    v-if="ticketPendingDeletion"
    eyebrow="Delete ticket"
    question-id="delete-ticket-question"
    @cancel="ticketPendingDeletion = null"
    @confirm="confirmDeleteTicket"
  >
    <p id="delete-ticket-question">
      Are you sure you want to delete ticket #{{ ticketPendingDeletion.number }}?
    </p>
  </ConfirmDeleteModal>

  <AutoRunConfirmModal
    v-if="autoRunConfirmLane"
    :lane="autoRunConfirmLane"
    :ticket-count="autoRunTicketCount(autoRunConfirmLane)"
    @close="autoRunConfirmLaneId = null"
    @confirm="confirmAutoRunLane"
  />

  <LaneSettingsModal
    v-if="openLane"
    ref="laneSettingsComponent"
    :lane="openLane"
    @close="openLaneId = null"
    @delete="lanePendingDeletionId = $event.id"
  />

  <ConfirmDeleteModal
    v-if="lanePendingDeletion"
    eyebrow="Delete lane"
    question-id="delete-lane-question"
    @cancel="lanePendingDeletionId = null"
    @confirm="confirmDeleteLane"
  >
    <p id="delete-lane-question">Are you sure you want to delete the {{ lanePendingDeletion.name }} lane?</p>
    <p v-if="pendingLaneTicketCount" class="field-hint">
      Its {{ pendingLaneTicketCount }} {{ pendingLaneTicketCount === 1 ? 'ticket' : 'tickets' }} will move to
      {{ UNASSIGNED_LANE_NAME }}.
    </p>
  </ConfirmDeleteModal>
</template>
