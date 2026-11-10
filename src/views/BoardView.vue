<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TicketGraph from '@/components/TicketGraph.vue'
import OpenInPicker from '@/components/OpenInPicker.vue'
import { useOpenInStore } from '@/stores/openIn'
import { useProjectsStore } from '@/stores/projects'
import { TERMINAL_TARGETS, resolveAutoRunTerminal } from '@/shared/openInTargets'
import {
  DEFAULT_LANE_WIDTH,
  GITHUB_IMPORT_LANE_ID,
  TICKET_CARD_FIELDS,
  TICKET_DESCRIPTION_TEMPLATE,
  addChecklistItem,
  agentForTicket,
  autoRunUsesWorktrees,
  availableAgents,
  buildAutoRunLaunch,
  checklistProgress,
  clampLaneWidth,
  findAgent,
  formatLabels,
  isFullAuto,
  isWebUrl,
  moveLaneInBoard,
  parseLabels,
  pullRequestLabel,
  removeChecklistItem,
  setChecklistItemDone,
  setLaneWidth,
  getUnassignedLane,
  ticketAgentPrompt,
  ticketSearchText,
  ticketShellCommand,
  ticketsToRun,
  toggleCardField,
  toggleHiddenLane,
  worktreeFolderName,
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

const agents = computed<Agent[]>(() => availableAgents(store.state))

const boardView = ref<'lanes' | 'graph'>('lanes')
const filterQuery = ref('')
const filterQueryInput = ref<HTMLInputElement | null>(null)
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
    Boolean(
      openTicketId.value ||
        openLaneId.value ||
        ticketDraft.value ||
        laneDraftName.value !== null ||
        autoRunConfirmLaneId.value
    ) || boardSettingsOpen.value
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

// Lane order is board data, shared by every user, so a move goes through the
// store rather than preferences. Only rendered lanes can be anchors; the
// helper's id anchoring keeps hidden lanes where they were.
const boardElement = ref<HTMLElement | null>(null)

// A filtered board shows one lane, so there is nothing to order it against —
// and a drop "before nothing" would send it to the end.
const laneCanMove = (laneId: string) => laneId !== UNASSIGNED_LANE_ID && !filterLaneId.value

const movableVisibleLanes = computed(() => visibleLanes.value.filter((lane) => lane.id !== UNASSIGNED_LANE_ID))

const LANE_DRAG_THRESHOLD_PX = 4

const laneDrag = ref<{
  laneId: string
  startX: number
  offsetX: number
  active: boolean
  beforeLaneId: string | null
  indicatorLeft: number | null
} | null>(null)

// A drag ends with a click on the header; two quick drags would read as a
// double-click and open a ticket draft. Remembering when the last drag ended
// lets the double-click handler tell them apart.
let lastLaneDragEndedAt = 0
const LANE_DRAG_DBLCLICK_GRACE_MS = 500

const startTicketDraftFromHeading = (laneId: string) => {
  const endedRecently = performance.now() - lastLaneDragEndedAt < LANE_DRAG_DBLCLICK_GRACE_MS
  if (!endedRecently) startTicketDraft(laneId)
}

const startLaneDrag = (lane: SwimLane, event: PointerEvent) => {
  const pressedHeaderButton = (event.target as HTMLElement).closest('button')
  if (event.button !== 0 || pressedHeaderButton || !laneCanMove(lane.id)) return
  laneDrag.value = { laneId: lane.id, startX: event.clientX, offsetX: 0, active: false, beforeLaneId: null, indicatorLeft: null }
  // Captured straight away (as the resize handle does) so a fast flick that
  // leaves the header before the threshold still arrives here.
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const laneElements = () => {
  const matches = boardElement.value?.querySelectorAll<HTMLElement>('.lane[data-lane-id]')
  return matches ? Array.from(matches) : []
}

// The first sibling whose midpoint is right of the pointer is the lane the
// dragged one lands in front of; past the last midpoint there is no anchor.
const laneAnchorAt = (pointerX: number, draggedLaneId: string) => {
  const siblings = laneElements().filter((element) => {
    const siblingId = element.dataset.laneId
    return siblingId !== draggedLaneId && siblingId !== UNASSIGNED_LANE_ID
  })
  const anchor = siblings.find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.left + rect.width / 2 > pointerX
  })
  const lastSibling = siblings.at(-1)
  // Half the 12px board gap, so the line sits centered between two lanes.
  const halfGap = 6
  let indicatorLeft: number | null = null
  if (anchor) indicatorLeft = anchor.offsetLeft - halfGap
  else if (lastSibling) indicatorLeft = lastSibling.offsetLeft + lastSibling.offsetWidth + halfGap
  return { beforeLaneId: anchor?.dataset.laneId ?? null, indicatorLeft }
}

const trackLaneDrag = (event: PointerEvent) => {
  const drag = laneDrag.value
  if (!drag) return
  drag.offsetX = event.clientX - drag.startX
  if (!drag.active && Math.abs(drag.offsetX) < LANE_DRAG_THRESHOLD_PX) return
  drag.active = true
  const { beforeLaneId, indicatorLeft } = laneAnchorAt(event.clientX, drag.laneId)
  const dropWouldMoveNothing = moveLaneInBoard(board.value, drag.laneId, beforeLaneId) === board.value
  drag.beforeLaneId = beforeLaneId
  drag.indicatorLeft = dropWouldMoveNothing ? null : indicatorLeft
}

const pointerIsOverBoard = (event: PointerEvent) => {
  const rect = boardElement.value?.getBoundingClientRect()
  if (!rect) return false
  const insideX = event.clientX >= rect.left && event.clientX <= rect.right
  const insideY = event.clientY >= rect.top && event.clientY <= rect.bottom
  return insideX && insideY
}

const cancelLaneDrag = () => {
  if (laneDrag.value?.active) lastLaneDragEndedAt = performance.now()
  laneDrag.value = null
}

// A refresh, filter or hide can unmount the dragged header mid-drag. Its
// lostpointercapture then fires at the document, not the header, so the
// drag would never end on its own.
watch(movableVisibleLanes, (lanes) => {
  const drag = laneDrag.value
  if (!drag) return
  const draggedLaneStillShown = lanes.some((lane) => lane.id === drag.laneId)
  if (!draggedLaneStillShown || !laneCanMove(drag.laneId)) cancelLaneDrag()
})

// Saved once on release, like the resize. A drop outside the board writes
// nothing; a drop into the lane's own slot is a no-op the store skips. The
// store places the lane at once and puts it back if the save fails.
const endLaneDrag = async (event: PointerEvent) => {
  const drag = laneDrag.value
  const droppedOnBoard = pointerIsOverBoard(event)
  cancelLaneDrag()
  if (!drag?.active || !droppedOnBoard) return
  await store.moveLane(projectPath.value, drag.laneId, drag.beforeLaneId)
}

const laneDragStyle = (laneId: string) => {
  const drag = laneDrag.value
  // X only: Y is never written, so the lane cannot drift vertically.
  if (drag?.active && drag.laneId === laneId) return { transform: `translateX(${drag.offsetX}px)` }
  return {}
}

const focusLaneHeading = (laneId: string) => {
  const escapedLaneId = CSS.escape(laneId)
  const headingSelector = `.lane[data-lane-id="${escapedLaneId}"] .lane-heading`
  const heading = boardElement.value?.querySelector<HTMLElement>(headingSelector)
  heading?.focus()
}

// Keyboard path for the same move: one slot per press. Moving right means
// landing before the lane two along, since the next one is the one to pass.
const moveLaneByKeyboard = async (lane: SwimLane, event: KeyboardEvent) => {
  const isLeft = event.key === 'ArrowLeft'
  const isRight = event.key === 'ArrowRight'
  // Keys bubbling up from the ▶ / ⚙ buttons inside the header aren't a lane move.
  const fromHeadingItself = event.target === event.currentTarget
  if (!fromHeadingItself || !event.altKey || !(isLeft || isRight) || !laneCanMove(lane.id)) return
  event.preventDefault()
  const lanes = movableVisibleLanes.value
  const position = lanes.findIndex((entry) => entry.id === lane.id)
  const atLeftEdge = position <= 0
  const atRightEdge = position === lanes.length - 1
  if ((isLeft && atLeftEdge) || (isRight && atRightEdge)) return
  const laneTwoToTheRight = lanes[position + 2]
  const rightAnchorId = laneTwoToTheRight?.id ?? null
  const beforeLaneId = isLeft ? lanes[position - 1].id : rightAnchorId
  // moveLane places the lane synchronously, so focus is restored after the
  // re-render rather than after the save; a quick second press still lands.
  const saving = store.moveLane(projectPath.value, lane.id, beforeLaneId)
  // The keyed v-for may re-insert the moved lane's DOM node, which drops focus.
  await nextTick()
  focusLaneHeading(lane.id)
  await saving
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

// ponytail: in-memory only — a pick for the next run, not ticket data. Persist
// it (store or board preferences) if it should survive leaving the board.
const selectedTicketIds = ref(new Set<string>())
watch(projectPath, () => selectedTicketIds.value.clear())

const toggleTicketSelected = (ticketId: string) => {
  if (selectedTicketIds.value.has(ticketId)) selectedTicketIds.value.delete(ticketId)
  else selectedTicketIds.value.add(ticketId)
}

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
  autoRunConfirmLaneId.value = null
  checklistDraft.value = ''
}

const focusTicketFilter = () => {
  filterQueryInput.value?.focus()
  filterQueryInput.value?.select()
}

const isFilterShortcut = (event: KeyboardEvent) => {
  const hasCommandModifier = event.metaKey || event.ctrlKey
  return hasCommandModifier && event.shiftKey && event.key.toLowerCase() === 'f'
}

const handleBoardKeydown = (event: KeyboardEvent) => {
  if (isFilterShortcut(event)) {
    event.preventDefault()
    if (!anyModalOpen.value) focusTicketFilter()
    return
  }
  if (event.key !== 'Escape') return
  // Claimed before anything else: an unhandled Escape leaves the board.
  if (laneDrag.value?.active) {
    cancelLaneDrag()
    event.preventDefault()
    return
  }
  if (anyModalOpen.value) {
    closeModals()
    event.preventDefault()
    return
  }
  // The shortcut lands people in the filter, so Escape there should only leave
  // the filter, not the board.
  if (event.target === filterQueryInput.value) {
    filterQueryInput.value?.blur()
    return
  }
  void router.push('/')
}

onMounted(() => {
  if (!store.state.snapshot.scannedAt) void store.load()
  window.addEventListener('keydown', handleBoardKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleBoardKeydown)
})

const startTicketDraft = (laneId = board.value.lanes[0]?.id ?? UNASSIGNED_LANE_ID) => {
  ticketDraft.value = { title: '', description: TICKET_DESCRIPTION_TEMPLATE, laneId }
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

// Live copies of the two lane fields, because both inputs only commit on blur:
// the button has to enable as soon as a prompt is typed, and has to send what
// is on screen rather than whatever state held before the blur landed.
const laneMarkdownDraft = ref({ agentPrompt: '', agentFilePath: '' })
const laneMarkdownStatus = ref<{ saving: boolean; savedMessage: string; error: string }>({
  saving: false,
  savedMessage: '',
  error: ''
})

watch(
  // Separate getters, not one getter returning an array: a fresh array on every
  // board refresh would reset the draft mid-typing.
  [() => openLane.value?.agentPrompt, () => openLane.value?.agentFilePath],
  ([agentPrompt, agentFilePath]) => {
    laneMarkdownDraft.value = { agentPrompt: agentPrompt ?? '', agentFilePath: agentFilePath ?? '' }
  },
  { immediate: true }
)
watch(openLaneId, () => {
  laneMarkdownStatus.value = { saving: false, savedMessage: '', error: '' }
})

const canSaveLaneMarkdown = computed(
  () => laneMarkdownDraft.value.agentPrompt.trim() !== '' && !laneMarkdownStatus.value.saving
)

// Electron prefixes errors thrown in main with "Error invoking remote method '<channel>': Error: ".
const ipcErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const saveLaneMarkdown = async (lane: SwimLane) => {
  const { agentPrompt, agentFilePath } = laneMarkdownDraft.value
  laneMarkdownStatus.value = { saving: true, savedMessage: '', error: '' }
  try {
    const saved = await store.saveLaneAgentMarkdown(projectPath.value, lane, agentPrompt, agentFilePath)
    const verb = saved.appended ? 'Appended to' : 'Saved to'
    laneMarkdownStatus.value = { saving: false, savedMessage: `${verb} ${saved.filePath}`, error: '' }
  } catch (error) {
    laneMarkdownStatus.value = { saving: false, savedMessage: '', error: ipcErrorMessage(error) }
  }
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

const laneName = (laneId: string) => {
  if (laneId === UNASSIGNED_LANE_ID) return UNASSIGNED_LANE_NAME
  return board.value.lanes.find((lane) => lane.id === laneId)?.name ?? laneId
}

// Picking a target arms it — the checkbox starts ticked; None clears both.
const setMoveToLane = (ticket: Ticket, laneId: string) =>
  editTicket(ticket, { moveToLaneId: laneId || undefined, moveOnComplete: Boolean(laneId) })

// A ticket's prompt is built from its own lane, so the same ticket produces a
// different instruction once it moves column.
const laneOfTicket = (ticket: Ticket) =>
  laneColumns.value.find((lane) => lane.id === ticket.laneId) ?? unassignedLane.value

const promptContext = (ticket: Ticket) => ({
  assigneeName: ticket.assigneeId ? assigneeName(ticket.assigneeId) : undefined
})

const ticketCommand = (ticket: Ticket) => {
  const agent = agentForTicket(ticket, agents.value)
  return ticketShellCommand(ticket, laneOfTicket(ticket), agent, promptContext(ticket))
}

// Runs what the lane shows: an active filter narrows the batch, so the button
// never launches tickets the user cannot see. Checked tickets narrow it further.
// An unconfigured lane follows the Open In picker when that is a terminal, so
// the first click uses a terminal the user is known to have.
const autoRunTerminal = (lane: SwimLane) => resolveAutoRunTerminal(lane.autoRunTerminalId, openInStore.selectedId)

const autoRunTickets = (lane: SwimLane) => {
  const visibleLaneTickets = ticketsInLane(lane.id)
  return ticketsToRun(visibleLaneTickets, selectedTicketIds.value)
}

const autoRunTooltip = (lane: SwimLane) => {
  const terminalLabel = autoRunTerminal(lane).label
  const agentName = findAgent(agents.value, lane.autoRunAgentId).name
  const ticketCount = autoRunTickets(lane).length
  return `Auto Run ${ticketCount} — one ${terminalLabel} tab per ticket, running ${agentName}`
}

// The button only asks; the dialog starts on the lane's defaults and lets this
// one run pick a different agent or terminal without changing the lane.
const autoRunConfirmLaneId = ref<string | null>(null)
const autoRunConfirmAgentId = ref('')
const autoRunConfirmTerminalId = ref('')
const autoRunConfirmLane = computed(() => laneColumns.value.find((lane) => lane.id === autoRunConfirmLaneId.value))

const askToAutoRunLane = (lane: SwimLane) => {
  autoRunConfirmAgentId.value = findAgent(agents.value, lane.autoRunAgentId).id
  autoRunConfirmTerminalId.value = autoRunTerminal(lane).id
  autoRunConfirmLaneId.value = lane.id
}

const confirmAutoRunLane = () => {
  const lane = autoRunConfirmLane.value
  autoRunConfirmLaneId.value = null
  if (!lane) return
  const agent = findAgent(agents.value, autoRunConfirmAgentId.value)
  const chosenTerminal = TERMINAL_TARGETS.find((target) => target.id === autoRunConfirmTerminalId.value)
  const terminal = chosenTerminal ?? autoRunTerminal(lane)
  const useWorktrees = autoRunUsesWorktrees(lane)
  const launches = autoRunTickets(lane).map((ticket) =>
    buildAutoRunLaunch(ticket, lane, agent, promptContext(ticket), useWorktrees)
  )
  if (launches.length === 0) return
  // Launched tickets are unchecked so the next Auto Run doesn't relaunch them.
  for (const { ticket } of launches) selectedTicketIds.value.delete(ticket.id)
  void store.autoRunLane(projectPath.value, lane.id, terminal.id, terminal.label, launches, useWorktrees)
}

const openTicketInShell = (ticket: Ticket) =>
  store.openIn(projectPath.value, openInStore.selectedId, ticketCommand(ticket))

// Lane-scoped: each lane has its own prompt, so a run finished in an earlier
// lane says nothing about the work in this one.
const agentFinishedInCurrentLane = (ticket: Ticket) => {
  const lastRun = ticket.agentRun
  return lastRun?.succeeded === true && lastRun.laneId === ticket.laneId
}

const runTicketAgent = (ticket: Ticket) => {
  const agent = agentForTicket(ticket, agents.value)
  const prompt = ticketAgentPrompt(ticket, laneOfTicket(ticket), promptContext(ticket))
  void store.runTicketAgent(projectPath.value, ticket, agent.id, prompt)
}
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
        title="What you want to build"
        @click="startTicketDraft()"
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
        ref="filterQueryInput"
        v-model="filterQuery"
        class="filter-query"
        aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
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
      <div class="board-view-switch" role="group" aria-label="Ticket view" :class="{ 'is-graph': boardView === 'graph' }">
        <span class="view-switch-slider" aria-hidden="true" />
        <button title="Graph view" aria-label="Graph view" :aria-pressed="boardView === 'graph'" @click="boardView = 'graph'; openTicketId = null">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 7L17 12L6 18"/><circle cx="5" cy="6" r="3"/><circle cx="19" cy="12" r="3"/><circle cx="5" cy="19" r="3"/></svg>
        </button>
        <button title="Swimlane view" aria-label="Swimlane view" :aria-pressed="boardView === 'lanes'" @click="boardView = 'lanes'; openTicketId = null">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
      </div>
    </section>

    <TicketGraph v-if="boardView === 'graph'" :project-name="projectTitle" :lanes="visibleLanes" :tickets="visibleLanes.flatMap(lane => ticketsInLane(lane.id))" :ticket-open="Boolean(openTicket)" @ticket="openTicketId = $event" @selection="openTicketId = null" />
    <section v-else-if="board.lanes.length === 0" class="board-empty">
      <p>No swim lanes yet.</p>
      <button @click="laneDraftName = ''">Create swim lane</button>
    </section>

    <section
      v-else
      ref="boardElement"
      class="board"
      :class="{ 'board-lane-dragging': laneDrag?.active }"
      aria-label="Swim lanes"
    >
      <div
        v-if="laneDrag?.active && laneDrag.indicatorLeft !== null"
        class="lane-drop-indicator"
        :style="{ left: `${laneDrag.indicatorLeft}px` }"
        aria-hidden="true"
      />
      <section
        v-for="lane in visibleLanes"
        :key="lane.id"
        class="lane"
        :data-lane-id="lane.id"
        :class="{
          'lane-unassigned': lane.id === UNASSIGNED_LANE_ID,
          'lane-dragging': laneDrag?.active && laneDrag.laneId === lane.id
        }"
        :style="{ width: `${laneWidth(lane.id)}px`, ...laneDragStyle(lane.id) }"
        @dragover.prevent
        @drop.prevent="dropOnLane(lane.id)"
      >
        <header
          class="lane-heading"
          :class="{ 'lane-heading-movable': laneCanMove(lane.id) }"
          :tabindex="laneCanMove(lane.id) ? 0 : undefined"
          :aria-keyshortcuts="laneCanMove(lane.id) ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined"
          @dblclick="startTicketDraftFromHeading(lane.id)"
          @pointerdown="startLaneDrag(lane, $event)"
          @pointermove="trackLaneDrag"
          @pointerup="endLaneDrag"
          @pointercancel="cancelLaneDrag"
          @lostpointercapture="cancelLaneDrag"
          @keydown="moveLaneByKeyboard(lane, $event)"
        >
          <h2>{{ lane.name }}</h2>
          <span class="lane-count">{{ ticketsInLane(lane.id).length }}</span>
          <button
            class="icon-button auto-run-button"
            :title="autoRunTooltip(lane)"
            :aria-label="`Auto Run ${autoRunTickets(lane).length} in ${lane.name}`"
            @click="askToAutoRunLane(lane)"
            @dblclick.stop
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 5.5v13a1 1 0 0 0 1.55.83L13 13.2V18.5a1 1 0 0 0 1.55.83l9-6.5a1 1 0 0 0 0-1.66l-9-6.5A1 1 0 0 0 13 5.5v5.3L4.55 4.67A1 1 0 0 0 3 5.5z" />
            </svg>
          </button>
          <button
            class="icon-button"
            title="How you want to build it"
            @click="openLaneId = lane.id"
            @dblclick.stop
          >
            ⚙
          </button>
        </header>

        <div class="lane-body" @dblclick.self="startTicketDraft(lane.id)">
          <article
            v-for="ticket in ticketsInLane(lane.id)"
            :key="ticket.id"
            class="ticket"
            draggable="true"
            @dragstart="draggedTicketId = ticket.id"
            @dragend="draggedTicketId = null"
            @click="openTicketId = ticket.id"
          >
            <input
              type="checkbox"
              class="ticket-select"
              :checked="selectedTicketIds.has(ticket.id)"
              :aria-label="`Select #${ticket.number} to run`"
              title="Select to run"
              @click.stop
              @change="toggleTicketSelected(ticket.id)"
            />
            <h3>
              <span
                v-if="store.agentRunning[ticket.id]"
                class="agent-status agent-status-running"
                role="img"
                aria-label="Agent running"
                title="Agent running"
              />
              <span
                v-else-if="agentFinishedInCurrentLane(ticket)"
                class="agent-status agent-status-done"
                role="img"
                aria-label="Agent finished"
                title="Agent finished"
              >✓</span>
              <span v-if="showsField('number')" class="ticket-number">#{{ ticket.number }}</span>
              {{ ticket.title }}
              <span
                v-if="isFullAuto(ticket, laneOfTicket(ticket))"
                class="full-auto-badge"
                title="Full auto: the next lane's agent starts when this one moves the ticket on"
              >auto</span>
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
                (showsField('branch') && ticket.branchName) ||
                (showsField('worktree') && ticket.worktreePath) ||
                (showsField('pullRequest') && isWebUrl(ticket.pullRequestUrl))
              "
              class="ticket-meta"
            >
              <span v-if="showsField('checklist') && ticket.checklist?.length">
                ☑ {{ checklistProgress(ticket.checklist).done }}/{{ checklistProgress(ticket.checklist).total }}
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
              <!-- .stop keeps the click from also opening the ticket modal; draggable=false keeps a drag from it a card drag. -->
              <a
                v-if="showsField('pullRequest') && isWebUrl(ticket.pullRequestUrl)"
                :href="ticket.pullRequestUrl"
                target="_blank"
                draggable="false"
                @click.stop
              >
                {{ pullRequestLabel(ticket.pullRequestUrl) }} ↗
              </a>
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

  <div v-if="openTicket" class="modal-backdrop" :class="{ 'graph-ticket-panel': boardView === 'graph' }" @click.self="closeModals">
    <!-- Refresh before editing so fields include writes from other processes. -->
    <section class="modal ticket-modal" @focusin="store.refresh()">
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
        Move to
        <select
          :value="openTicket.moveToLaneId ?? ''"
          @change="setMoveToLane(openTicket, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">None</option>
          <option :value="UNASSIGNED_LANE_ID">{{ UNASSIGNED_LANE_NAME }}</option>
          <option v-for="lane in board.lanes" :key="lane.id" :value="lane.id">{{ lane.name }}</option>
        </select>
        <span class="field-hint">Where this ticket goes when its checklist is done or ▶ Run succeeds.</span>
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
          @change="editTicket(openTicket, { branchName: ($event.target as HTMLInputElement).value.trim() || undefined })"
        />
      </label>

      <label>
        Worktree
        <input
          class="agent-file-path"
          :value="openTicket.worktreePath ?? ''"
          placeholder="/Users/me/Code/my-app-board-ticket-fields"
          @change="
            editTicket(openTicket, { worktreePath: ($event.target as HTMLInputElement).value.trim() || undefined })
          "
        />
      </label>

      <label>
        GitHub PR
        <input
          type="url"
          class="agent-file-path"
          :value="openTicket.pullRequestUrl ?? ''"
          placeholder="https://github.com/owner/repo/pull/123"
          @change="
            editTicket(openTicket, { pullRequestUrl: ($event.target as HTMLInputElement).value.trim() || undefined })
          "
        />
        <a v-if="isWebUrl(openTicket.pullRequestUrl)" class="field-hint" :href="openTicket.pullRequestUrl" target="_blank">
          Open pull request ↗
        </a>
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
            :value="agentForTicket(openTicket, agents).id"
            @change="editTicket(openTicket, { agentId: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
          </select>
        </label>
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="Boolean(openTicket.fullAuto)"
            @change="editTicket(openTicket, { fullAuto: ($event.target as HTMLInputElement).checked })"
          />
          Full auto
        </label>
        <span class="field-hint">
          In every lane: when an agent moves this ticket on, the next lane's agent starts on it.
        </span>
        <p class="agent-hint">
          The agent gets this ticket, its lane's prompt, markdown file and output location.
          Run works in the background and saves its output below — it can write files but not run
          shell commands. Run in a terminal to watch and approve each step; editors get the command on
          the clipboard to paste:
        </p>
        <pre class="agent-command">{{ ticketCommand(openTicket) }}</pre>
        <div class="agent-actions">
          <button
            :disabled="store.agentRunning[openTicket.id]"
            :title="`Run ${agentForTicket(openTicket, agents).name} in the background`"
            @click="runTicketAgent(openTicket)"
          >
            {{ store.agentRunning[openTicket.id] ? 'Running…' : '▶ Run' }}
          </button>
          <button
            class="secondary"
            :title="`Run in ${openInStore.selectedTarget.label} — terminals run it, editors get it on the clipboard`"
            @click="openTicketInShell(openTicket)"
          >
            ⌁ Run in {{ openInStore.selectedTarget.label }}
          </button>
        </div>
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

      <label v-if="openTicket.moveToLaneId" class="checkbox-label">
        <input
          type="checkbox"
          :checked="Boolean(openTicket.moveOnComplete)"
          @change="editTicket(openTicket, { moveOnComplete: ($event.target as HTMLInputElement).checked })"
        />
        Move to {{ laneName(openTicket.moveToLaneId) }} swimlane
      </label>

      <div class="modal-actions">
        <button class="secondary danger" @click="deleteTicket(openTicket)">Delete</button>
        <button class="secondary" @click="assignToMe(openTicket)">
          {{ openTicket.assigneeId === store.state.userId ? 'Unassign me' : 'Assign to me' }}
        </button>
        <button @click="closeModals">Done</button>
      </div>
    </section>
  </div>

  <div v-if="autoRunConfirmLane" class="modal-backdrop" @click.self="autoRunConfirmLaneId = null">
    <section class="modal" role="alertdialog" aria-labelledby="auto-run-confirm-question">
      <p class="eyebrow">Auto Run · {{ autoRunConfirmLane.name }}</p>
      <p id="auto-run-confirm-question" class="auto-run-question">
        Run {{ autoRunTickets(autoRunConfirmLane).length }} separate
        <select v-model="autoRunConfirmAgentId" aria-label="Agent">
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
        </select>
        agents for {{ autoRunTickets(autoRunConfirmLane).length }} tickets?
      </p>
      <p class="auto-run-question">
        Each opens in its own
        <select v-model="autoRunConfirmTerminalId" aria-label="Terminal">
          <option v-for="terminal in TERMINAL_TARGETS" :key="terminal.id" :value="terminal.id">
            {{ terminal.label }}
          </option>
        </select>
        tab.
      </p>
      <p class="field-hint">
        {{
          autoRunUsesWorktrees(autoRunConfirmLane)
            ? 'Each runs in .worktrees/tN on its own branch, cut from freshly fetched main.'
            : 'All run in the project directory, on whatever branch it has checked out.'
        }}
      </p>
      <div class="modal-actions">
        <button class="secondary" @click="autoRunConfirmLaneId = null">Cancel</button>
        <button @click="confirmAutoRunLane">Run</button>
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
          @input="laneMarkdownDraft.agentPrompt = ($event.target as HTMLTextAreaElement).value"
          @change="editLane(openLane, { agentPrompt: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>
      <button
        class="secondary save-agent-markdown"
        :disabled="!canSaveLaneMarkdown"
        @click="saveLaneMarkdown(openLane)"
      >
        {{ laneMarkdownStatus.saving ? 'Saving…' : 'Save to Agent Markdown' }}
      </button>

      <label>
        Agent markdown file
        <input
          class="agent-file-path"
          :value="openLane.agentFilePath"
          placeholder="/Users/you/Projects/thing/docs/prd-template.md"
          @input="laneMarkdownDraft.agentFilePath = ($event.target as HTMLInputElement).value"
          @change="editLane(openLane, { agentFilePath: ($event.target as HTMLInputElement).value })"
        />
        <span v-if="laneMarkdownStatus.error" class="field-hint field-error">{{ laneMarkdownStatus.error }}</span>
        <span v-else-if="laneMarkdownStatus.savedMessage" class="field-hint">{{ laneMarkdownStatus.savedMessage }}</span>
        <span v-else class="field-hint">
          Used alongside the prompt above — both are sent when both are filled in. Left empty, Save to Agent Markdown
          creates one in the project's agent-context/ folder.
        </span>
      </label>

      <label>
        Output
        <textarea
          class="agent-prompt"
          :value="openLane.outputTarget ?? ''"
          placeholder="A file, a directory, or where it goes — e.g. a new folder called PRD inside the project directory"
          @change="editLane(openLane, { outputTarget: ($event.target as HTMLTextAreaElement).value })"
        />
        <span class="field-hint">Where the agent puts its work. An existing directory is used as-is, no prompt.</span>
      </label>

      <section class="ticket-agent">
        <p class="eyebrow">Auto Run</p>
        <label>
          Agent
          <select
            :value="findAgent(agents, openLane.autoRunAgentId).id"
            @change="editLane(openLane, { autoRunAgentId: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
          </select>
        </label>
        <label>
          Terminal
          <select
            :value="autoRunTerminal(openLane).id"
            @change="editLane(openLane, { autoRunTerminalId: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="terminal in TERMINAL_TARGETS" :key="terminal.id" :value="terminal.id">
              {{ terminal.label }}
            </option>
          </select>
        </label>
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="autoRunUsesWorktrees(openLane)"
            @change="editLane(openLane, { autoRunWorktrees: ($event.target as HTMLInputElement).checked })"
          />
          Worktree and branch per ticket
        </label>
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="Boolean(openLane.fullAuto)"
            @change="editLane(openLane, { fullAuto: ($event.target as HTMLInputElement).checked })"
          />
          Full auto: start the next lane's agent when this lane's agent moves a ticket on
        </label>
        <span class="field-hint">
          The next agent starts on the board's next refresh (about 10 seconds). While you're typing in a field it
          waits until focus leaves it.
        </span>
        <span class="field-hint">
          Auto Run on this lane opens one new window with a tab per visible ticket, each running its agent command.
          With worktrees on, each ticket gets .worktrees/tN on its own branch off freshly fetched main, so parallel
          agents never share a checkout. Terminal needs Accessibility permission to open tabs.
        </span>
      </section>

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
