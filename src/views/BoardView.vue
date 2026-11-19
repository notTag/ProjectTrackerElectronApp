<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { laneModalExpanded, ticketModalExpanded } from '@/modalWidth'

import ExpandToggle from '@/components/ExpandToggle.vue'
import TicketGraph from '@/components/TicketGraph.vue'
import MetricsPanel from '@/components/MetricsPanel.vue'
import OfflineBadge from '@/components/OfflineBadge.vue'
import MessageBanners from '@/components/MessageBanners.vue'
import OpenInPicker from '@/components/OpenInPicker.vue'
import ModelField from '@/components/ModelField.vue'
import InfoTip from '@/components/InfoTip.vue'
import { useOpenInStore } from '@/stores/openIn'
import { useProjectsStore } from '@/stores/projects'
import { projectTrackerApi } from '@/services/projectTrackerApi'
import { TERMINAL_TARGETS, resolveAutoRunTerminal, type OpenInTarget } from '@/shared/openInTargets'
import {
  DEFAULT_LANE_WIDTH,
  GITHUB_IMPORT_LANE_ID,
  TICKET_CARD_FIELDS,
  normalizeSemanticVersion,
  TICKET_DESCRIPTION_TEMPLATE,
  addChecklistItem,
  addExternalLink,
  agentForTicket,
  agentRunBadge,
  canResume,
  type AgentRunBadge,
  autoRunUsesWorktrees,
  availableAgents,
  buildAutoRunLaunch,
  buildOrchestratorLaunch,
  orchestratorAgentChoice,
  orchestratorPromptMissingTokens,
  orchestratorPromptTemplate,
  type OrchestratorPromptContext,
  checklistProgress,
  clampLaneWidth,
  findAgent,
  formatLabels,
  githubErrorMessage,
  isFullAuto,
  isWebUrl,
  moveLaneInBoard,
  orchestratorPollActive,
  orchestratorPollMinutes,
  parseLabels,
  pullRequestLabel,
  pullRequestStatusLabel,
  removeChecklistItem,
  removeExternalLink,
  setChecklistItemDone,
  setLaneWidth,
  steppedOrchestratorPoll,
  getUnassignedLane,
  boardLaneColumns,
  effectiveNextLaneId,
  isReadyToMove,
  moveRulesList,
  boardLaneById,
  hasUnseenAgentResult,
  ticketAgentPrompt,
  ticketSearchText,
  ticketShellCommand,
  ticketTabTitle,
  currentLaneOf,
  ticketIdsToMove,
  carriedTicketIds,
  ticketsToRun,
  toggleCardField,
  toggleModalField,
  TICKET_MODAL_FIELDS,
  type TicketModalField,
  toggleHiddenLane,
  updateLaneInBoard,
  worktreeFolderName,
  type Agent,
  type LaneMarkdownKind,
  LANE_MARKDOWN_FILE_PATH_FIELD,
  type TicketCardField,
  type User,
  UNASSIGNED_LANE_ID,
  UNASSIGNED_LANE_NAME,
  type SwimLane,
  type Ticket,
  type TicketPatch,
  plural
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
// Empty = every lane. Read through activeFilterLaneIds, never directly.
const filterLaneIds = ref<string[]>([])
const laneFilterMenuOpen = ref(false)

const openTicketId = ref<string | null>(null)
const openLaneId = ref<string | null>(null)
const draggedTicketId = ref<string | null>(null)
const boardSettingsOpen = ref(false)

// nextLaneId stays null until the user picks one, so the field follows the
// Status lane's default as Status changes. Images wait as Files until Save,
// since their folder is keyed by a ticket id that doesn't exist yet.
const ticketDraft = ref<{
  title: string
  description: string
  laneId: string
  nextLaneId: string | null
  images: { file: File; previewUrl: string }[]
} | null>(null)
const draftImageInput = ref<HTMLInputElement | null>(null)

// Blob URLs pin their File in memory until revoked, so a closed or replaced
// draft releases every preview it made.
watch(ticketDraft, (_draft, previousDraft) => {
  previousDraft?.images.forEach((stagedImage) => URL.revokeObjectURL(stagedImage.previewUrl))
})
const laneDraftName = ref<string | null>(null)
const checklistDraft = ref('')
const linkDraft = ref('')
const linkDraftInvalid = ref(false)
const linkInput = ref<HTMLInputElement | null>(null)
const imageError = ref<string | null>(null)
const modalFieldsMenuOpen = ref(false)
// An image error belongs to the ticket it happened on, not the next one opened.
watch(openTicketId, (ticketId) => {
  if (!ticketId) imageError.value = null
  modalFieldsMenuOpen.value = false
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
        lanePendingDeletion.value
    ) || boardSettingsOpen.value
)

// The unassigned column is prepended for rendering but kept out of board.lanes,
// so it carries its own agent prompt without ever becoming deletable.
const laneColumns = computed(() => boardLaneColumns(board.value))

const unassignedLane = computed(() => laneColumns.value[0])

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

// Display-only: ticketAgentPrompt never reads preferences, so hidden fields still reach the agent.
const hidesModalField = (field: TicketModalField) => preferences.value.hiddenModalFields.includes(field)
const toggleModalFieldVisibility = (field: TicketModalField) =>
  savePreferences(toggleModalField(preferences.value, field))

const modalFieldsMenuRef = ref<HTMLElement | null>(null)
const closeModalFieldsMenuOnOutsideClick = (event: PointerEvent) => {
  if (modalFieldsMenuRef.value?.contains(event.target as Node)) return
  modalFieldsMenuOpen.value = false
}

const laneTicketTotal = (laneId: string) =>
  board.value.tickets.filter((ticket) => ticket.laneId === laneId).length

// The columns worth a header quick-toggle chip: both arrive by import rather
// than by choice, so they are the ones a board wants out of the way. The
// Display modal lists every column instead (laneColumns).
const githubImportLane = computed(
  () => board.value.lanes.find((lane) => lane.id === GITHUB_IMPORT_LANE_ID) ?? null
)
const toggleableLanes = computed(() =>
  [unassignedLane.value, githubImportLane.value].filter((lane): lane is SwimLane => Boolean(lane))
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

const laneFilterLabel = computed(() => {
  const pickedIds = activeFilterLaneIds.value
  if (!laneFilterNarrows.value) return 'All swim lanes'
  if (pickedIds.length > 1) return `${pickedIds.length} lanes`
  return shownLanes.value.find((lane) => lane.id === pickedIds[0])?.name
})

const toggleLaneFilter = (laneId: string) => {
  const pickedIds = activeFilterLaneIds.value
  filterLaneIds.value = pickedIds.includes(laneId)
    ? pickedIds.filter((pickedId) => pickedId !== laneId)
    : [...pickedIds, laneId]
}

// The view stays mounted across boards and seeded lane ids repeat between
// projects, so a pick would otherwise carry over to the next board.
watch(projectPath, () => {
  filterLaneIds.value = []
  laneFilterMenuOpen.value = false
})

const laneFilterMenuRef = ref<HTMLElement | null>(null)
const closeLaneFilterMenuOnOutsideClick = (event: PointerEvent) => {
  if (laneFilterMenuRef.value?.contains(event.target as Node)) return
  laneFilterMenuOpen.value = false
}
// Tabbing away closes it. A null target (mousedown on a label's text, window
// blur) is left to the pointerdown handler, or it would close mid-click.
const closeLaneFilterMenuOnFocusOut = (event: FocusEvent) => {
  const focusTarget = event.relatedTarget as Node | null
  if (!focusTarget || laneFilterMenuRef.value?.contains(focusTarget)) return
  laneFilterMenuOpen.value = false
}

// Board order, not pick order.
const visibleLanes = computed(() => {
  if (!laneFilterNarrows.value) return shownLanes.value
  const pickedIds = activeFilterLaneIds.value
  return shownLanes.value.filter((lane) => pickedIds.includes(lane.id))
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

// A filtered board shows a subset of lanes, so a drop position among them is
// ambiguous against the full order — and with one lane, "before nothing" would
// send it to the end.
const laneCanMove = (laneId: string) => laneId !== UNASSIGNED_LANE_ID && !laneFilterNarrows.value

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

const filtersActive = computed(() =>
  Boolean(filterQuery.value.trim() || laneFilterNarrows.value || showOnlyMine.value)
)

const clearFilters = () => {
  filterQuery.value = ''
  filterLaneIds.value = []
  showOnlyMine.value = false
}

// Fields save on change, so Cancel can't just drop a draft. Instead each field
// keeps the value it held just before its first edit this session. Captured at
// edit time, not on open, so a write that lands from elsewhere (a background
// run, an agent, a drag) before the user touches that field is never undone.
// A field that was unset keeps its key as undefined, which clears it on restore.
const valuesBeforeEdit = new Map<keyof TicketPatch, unknown>()

watch(openTicketId, () => valuesBeforeEdit.clear())

const rememberValuesBeforeEdit = (ticket: Ticket, patch: TicketPatch) => {
  const editedFields = Object.keys(patch) as (keyof TicketPatch)[]
  for (const field of editedFields) {
    if (valuesBeforeEdit.has(field)) continue
    const currentValue = toRaw(ticket[field])
    valuesBeforeEdit.set(field, structuredClone(currentValue))
  }
}

const cancelTicketEdits = () => {
  const ticketId = openTicketId.value
  const restorePatch: TicketPatch = Object.fromEntries(valuesBeforeEdit)
  closeModals()
  if (ticketId && valuesBeforeEdit.size > 0) void store.updateTicket(projectPath.value, ticketId, restorePatch)
}

const ticketPendingDeletion = ref<Ticket | null>(null)
const deleteConfirmCancelButton = ref<HTMLButtonElement | null>(null)

// The ticket can vanish underneath the confirm (agent, poll); drop the stale question.
watch(openTicket, (ticket) => {
  if (!ticket) ticketPendingDeletion.value = null
})

// Focus lands on Cancel so a stray Enter can't delete the ticket.
const askToDeleteTicket = async (ticket: Ticket) => {
  ticketPendingDeletion.value = ticket
  await nextTick()
  deleteConfirmCancelButton.value?.focus()
}

const confirmDeleteTicket = async () => {
  const ticket = ticketPendingDeletion.value
  ticketPendingDeletion.value = null
  if (ticket) await deleteTicket(ticket)
}

const pullIssues = () => store.pullGithubIssues(projectPath.value)

const pullRequestRefreshing = ref(false)
const pullRequestError = ref<string | null>(null)

const refreshOpenTicketPullRequest = async () => {
  const ticket = openTicket.value
  if (!ticket) return
  pullRequestRefreshing.value = true
  pullRequestError.value = null
  try {
    await store.refreshPullRequest(projectPath.value, ticket)
  } catch (error) {
    pullRequestError.value = githubErrorMessage(error)
  } finally {
    pullRequestRefreshing.value = false
  }
}

const versionInvalid = ref(false)

// An invalid value is kept in the input with an error instead of being saved.
// A valid one is written back so "v1.4.0" shows as the "1.4.0" it saved as,
// even when that equals the stored value and Vue sees nothing to re-render.
const editTicketVersion = (ticket: Ticket, input: HTMLInputElement) => {
  const version = normalizeSemanticVersion(input.value)
  versionInvalid.value = version === null
  if (version === null) return
  input.value = version ?? ''
  editTicket(ticket, { version })
}

// A version written from outside (an agent's sqlite3 UPDATE) replaces whatever
// invalid text the error was about.
watch(() => openTicket.value?.version, () => {
  versionInvalid.value = false
})

watch(openTicketId, (ticketId) => {
  pullRequestError.value = null
  versionInvalid.value = false
  if (ticketId) void refreshOpenTicketPullRequest()
})

// A new URL points at a different PR, so the cached state is dropped rather
// than shown against it until the refresh lands.
const overridePullRequestUrl = async (ticket: Ticket, rawUrl: string) => {
  await store.updateTicket(projectPath.value, ticket.id, {
    pullRequestUrl: rawUrl.trim() || undefined,
    pullRequestState: undefined,
    pullRequestMergedAt: undefined
  })
  await refreshOpenTicketPullRequest()
}

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

const closeModals = () => {
  openTicketId.value = null
  openLaneId.value = null
  ticketDraft.value = null
  laneDraftName.value = null
  boardSettingsOpen.value = false
  autoRunConfirmLaneId.value = null
  ticketPendingDeletion.value = null
  lanePendingDeletionId.value = null
  checklistDraft.value = ''
  linkDraft.value = ''
  linkDraftInvalid.value = false
  imageError.value = null
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
  // Like the delete confirm below: Escape closes the fields menu, not the modal under it.
  if (modalFieldsMenuOpen.value) {
    modalFieldsMenuOpen.value = false
    event.preventDefault()
    return
  }
  // The delete confirm sits on top of the ticket modal; Escape backs out of it alone.
  if (ticketPendingDeletion.value) {
    ticketPendingDeletion.value = null
    event.preventDefault()
    return
  }
  if (lanePendingDeletion.value) {
    lanePendingDeletionId.value = null
    event.preventDefault()
    return
  }
  if (anyModalOpen.value) {
    closeModals()
    event.preventDefault()
    return
  }
  if (laneFilterMenuOpen.value) {
    laneFilterMenuOpen.value = false
    event.preventDefault()
    return
  }
  // The shortcut lands people in the filter, so Escape there should only leave
  // the filter, not the board.
  if (event.target === filterQueryInput.value) {
    // A search input's default Escape action clears its value; keep the text.
    event.preventDefault()
    filterQueryInput.value?.blur()
    return
  }
  void router.push('/')
}

onMounted(() => {
  if (!store.state.snapshot.scannedAt) void store.load()
  window.addEventListener('keydown', handleBoardKeydown)
  window.addEventListener('pointerdown', closeModalFieldsMenuOnOutsideClick)
  window.addEventListener('pointerdown', closeLaneFilterMenuOnOutsideClick)
})

// Trailing "+" zone: shown on hover, lingers after the pointer leaves so it
// doesn't vanish mid-reach. Re-entering just cancels the pending hide.
const ADD_ZONE_HIDE_DELAY_MS = 3000
const addZoneShown = ref(false)
let addZoneHideTimer: ReturnType<typeof setTimeout> | undefined

const showAddZone = () => {
  clearTimeout(addZoneHideTimer)
  addZoneShown.value = true
}

const hideAddZoneNow = () => {
  clearTimeout(addZoneHideTimer)
  addZoneShown.value = false
}

const hideAddZoneLater = () => {
  clearTimeout(addZoneHideTimer)
  addZoneHideTimer = setTimeout(hideAddZoneNow, ADD_ZONE_HIDE_DELAY_MS)
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleBoardKeydown)
  window.removeEventListener('pointerdown', closeModalFieldsMenuOnOutsideClick)
  window.removeEventListener('pointerdown', closeLaneFilterMenuOnOutsideClick)
  clearTimeout(addZoneHideTimer)
  ticketDraft.value?.images.forEach((stagedImage) => URL.revokeObjectURL(stagedImage.previewUrl))
})

const startTicketDraft = (laneId = board.value.lanes[0]?.id ?? UNASSIGNED_LANE_ID) => {
  ticketDraft.value = { title: '', description: TICKET_DESCRIPTION_TEMPLATE, laneId, nextLaneId: null, images: [] }
}

const stageDraftImages = (files: File[]) => {
  const draft = ticketDraft.value
  if (!draft) return
  const stagedImages = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))
  draft.images.push(...stagedImages)
}

const pickDraftImages = (input: HTMLInputElement) => {
  stageDraftImages(imageFilesOf(input))
  input.value = ''
}

const pasteDraftImages = (event: ClipboardEvent) => {
  if (isTextFieldPaste(event)) return
  const files = imageFilesOf(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  stageDraftImages(files)
}

const dropDraftImages = (event: DragEvent) => {
  stageDraftImages(imageFilesOf(event.dataTransfer))
}

const unstageDraftImage =(index: number) => {
  const removed = ticketDraft.value?.images.splice(index, 1) ?? []
  removed.forEach((stagedImage) => URL.revokeObjectURL(stagedImage.previewUrl))
}

const laneNextLaneId = (laneId: string) => boardLaneById(board.value, laneId)?.nextLaneId ?? ''

const draftNextLaneId = computed(() => {
  const draft = ticketDraft.value
  if (!draft) return ''
  // A pick made before Status changed to that same lane would be a no-op target.
  const pickIsStatusLane = draft.nextLaneId === draft.laneId
  if (draft.nextLaneId === null || pickIsStatusLane) return laneNextLaneId(draft.laneId)
  return draft.nextLaneId
})

const saveTicketDraft = async () => {
  const draft = ticketDraft.value
  if (!draft || !draft.title.trim()) return
  const description = draft.description.trim()
  const templateWasLeftUntouched = description === TICKET_DESCRIPTION_TEMPLATE.trim()
  const resolvedNextLaneId = draftNextLaneId.value
  // Matching the lane default is stored as no override, so the ticket keeps
  // inheriting if the lane's Next Lane changes later.
  const overridesLaneDefault = resolvedNextLaneId !== laneNextLaneId(draft.laneId)
  const completion = {
    moveToLaneId: overridesLaneDefault && resolvedNextLaneId ? resolvedNextLaneId : undefined,
    moveOnComplete: Boolean(resolvedNextLaneId)
  }
  ticketDraft.value = null
  const ticketId = await store.addTicket(
    projectPath.value,
    draft.laneId,
    draft.title.trim(),
    templateWasLeftUntouched ? '' : description,
    completion
  )
  const stagedFiles = draft.images.map((stagedImage) => stagedImage.file)
  if (!ticketId || !stagedFiles.length) return
  await saveImageFiles({ id: ticketId }, stagedFiles)
  // The draft modal is gone, so show an upload failure on the ticket it belongs to.
  if (imageError.value) openTicketId.value = ticketId
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

// Stored by id and looked up live, so a rename shows in the question and a lane
// removed underneath (poll, other window) drops the confirm by itself.
const lanePendingDeletionId = ref<string | null>(null)
const lanePendingDeletion = computed(
  () => laneColumns.value.find((lane) => lane.id === lanePendingDeletionId.value) ?? null
)
const laneDeleteConfirmCancelButton = ref<HTMLButtonElement | null>(null)

const pendingLaneTicketCount = computed(() => {
  const pendingLane = lanePendingDeletion.value
  if (!pendingLane) return 0
  return board.value.tickets.filter((ticket) => ticket.laneId === pendingLane.id).length
})

// Focus lands on Cancel so a stray Enter can't delete the lane.
const askToDeleteLane = async (lane: SwimLane) => {
  lanePendingDeletionId.value = lane.id
  await nextTick()
  laneDeleteConfirmCancelButton.value?.focus()
}

const confirmDeleteLane = async () => {
  const lane = lanePendingDeletion.value
  lanePendingDeletionId.value = null
  if (lane) await deleteLane(lane)
}

const deleteTicket = async (ticket: Ticket) => {
  openTicketId.value = null
  await store.removeTicket(projectPath.value, ticket.id)
}

const editTicket = (ticket: Ticket, patch: TicketPatch) => {
  const editsOpenTicket = ticket.id === openTicketId.value
  if (editsOpenTicket) rememberValuesBeforeEdit(ticket, patch)
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

// Invalid input keeps its text so it can be fixed; a duplicate clears, since
// that link is already listed above.
const addLinkDraft = (ticket: Ticket) => {
  const url = linkDraft.value.trim()
  if (!url) return
  linkInput.value?.focus()
  if (!isWebUrl(url)) {
    linkDraftInvalid.value = true
    return
  }
  linkDraft.value = ''
  const isAlreadyListed = ticket.externalLinks?.includes(url)
  if (!isAlreadyListed) editTicketLinks(ticket, (links) => addExternalLink(links, url))
}

const dropExternalLink = (ticket: Ticket, link: string) =>
  editTicketLinks(ticket, (links = []) => removeExternalLink(links, links.indexOf(link)))

// Store state only refreshes after the IPC save returns, so the new list is
// computed inside the queued mutate from the latest saved links: two quick
// adds or removes in a row would otherwise overwrite each other.
const editTicketLinks = (ticket: Ticket, change: (links?: string[]) => string[]) => {
  const updatedAt = new Date().toISOString()
  void store.updateBoard(projectPath.value, (board) => ({
    ...board,
    tickets: board.tickets.map((current) => {
      if (current.id !== ticket.id) return current
      const links = change(current.externalLinks)
      return { ...current, externalLinks: links.length ? links : undefined, updatedAt }
    })
  }))
}

// Same queued-mutate reasoning as editTicketLinks.
const editTicketImages = (ticket: Pick<Ticket, 'id'>, change: (images: string[]) => string[]) => {
  const updatedAt = new Date().toISOString()
  return store.updateBoard(projectPath.value, (board) => ({
    ...board,
    tickets: board.tickets.map((current) => {
      if (current.id !== ticket.id) return current
      const images = change(current.images ?? [])
      return { ...current, images: images.length ? images : undefined, updatedAt }
    })
  }))
}

const ticketImageUrl = (imagePath: string) => projectTrackerApi.ticketImageUrl(imagePath)

// Electron prefixes errors thrown in main with "Error invoking remote method '<channel>': Error: ".
const ipcErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

// Files are written before the ticket lists them, so a failed save leaves at
// worst an orphan file, never a listed path that doesn't exist. Settled one by
// one: a bad file in a drop must not keep the good ones off the ticket.
const attachImages = async (ticket: Pick<Ticket, 'id'>, pendingSaves: Promise<string[]>[]) => {
  imageError.value = null
  const results = await Promise.allSettled(pendingSaves)
  const addedPaths = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) imageError.value = ipcErrorMessage(failure.reason)
  if (!addedPaths.length) return
  try {
    await editTicketImages(ticket, (images) => [...images, ...addedPaths])
  } catch (error) {
    imageError.value = ipcErrorMessage(error)
  }
}

const pickTicketImages = (ticket: Ticket) => attachImages(ticket, [projectTrackerApi.pickTicketImages(ticket.id)])

const imageFilesOf = (source: DataTransfer | HTMLInputElement | null) =>
  [...(source?.files ?? [])].filter((file) => file.type.startsWith('image/'))

const saveImageFile = async (ticket: Pick<Ticket, 'id'>, file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const imagePath = await projectTrackerApi.saveTicketImageBytes(ticket.id, bytes, file.type)
  return [imagePath]
}

// Paste and drop both send bytes: clipboard images have no file path at all.
const saveImageFiles = (ticket: Pick<Ticket, 'id'>, files: File[]) =>
  attachImages(ticket, files.map((file) => saveImageFile(ticket, file)))

// Rich text copied from Notes/Word/Sheets carries a PNG rendering alongside the
// text, so a paste into a text field with text on the clipboard stays a text paste.
const isTextFieldPaste = (event: ClipboardEvent) => {
  const target = event.target
  const isIntoTextField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  const hasText = event.clipboardData?.types.includes('text/plain') ?? false
  return isIntoTextField && hasText
}

const pasteTicketImages = (ticket: Ticket, event: ClipboardEvent) => {
  if (isTextFieldPaste(event)) return
  const files = imageFilesOf(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  void saveImageFiles(ticket, files)
}

const dropTicketImages = (ticket: Ticket, event: DragEvent) => {
  const files = imageFilesOf(event.dataTransfer)
  if (files.length) void saveImageFiles(ticket, files)
}

// The ticket stops listing the image before its file goes.
const removeTicketImage = async (ticket: Ticket, imagePath: string) => {
  imageError.value = null
  try {
    await editTicketImages(ticket, (images) => images.filter((existingPath) => existingPath !== imagePath))
    await projectTrackerApi.removeTicketImage(ticket.id, imagePath)
  } catch (error) {
    imageError.value = ipcErrorMessage(error)
  }
}

const openTicketImage = (imagePath: string) =>
  projectTrackerApi.openTicketImage(imagePath).catch((error) => {
    imageError.value = ipcErrorMessage(error)
  })

const editLane = (lane: SwimLane, patch: Partial<Omit<SwimLane, 'id'>>) => {
  void store.updateLane(projectPath.value, lane.id, patch)
}

const editOrchestratorPollMinutes = (lane: SwimLane, input: HTMLInputElement) => {
  const minutes = input.valueAsNumber
  const isWholeMinutes = Number.isInteger(minutes) && minutes >= 1
  if (!isWholeMinutes) {
    input.value = String(orchestratorPollMinutes(lane))
    return
  }
  editLane(lane, { orchestratorPollMinutes: minutes })
}

// Steps inside the queued mutate, not from the view's lane: the view only sees
// a click's result once its write lands, so fast clicks would repeat a step.
const stepOrchestratorPoll = (laneId: string, step: -1 | 1) => {
  void store.updateBoard(projectPath.value, (board) => {
    const currentLane = boardLaneById(board, laneId)
    const patch = currentLane && steppedOrchestratorPoll(currentLane, step)
    return patch ? updateLaneInBoard(board, laneId, patch) : board
  })
}

const orchestratorPollTooltip = (lane: SwimLane): string => {
  if (!orchestratorPollActive(lane)) return 'Off: Auto Run launches no Orchestrator agent for this lane.'
  const pollInterval = plural(orchestratorPollMinutes(lane), 'minute')
  return `The Orchestrator agent will poll running agents every ${pollInterval}.`
}

const visibleTickets = computed(() => visibleLanes.value.flatMap((lane) => ticketsInLane(lane.id)))

const carriedIds = computed(() => {
  const ticketId = draggedTicketId.value
  if (!ticketId) return new Set<string>()
  return new Set(carriedTicketIds(ticketId, selectedTicketIds.value, visibleTickets.value))
})

const isCarriedBehind = (ticketId: string) => carriedIds.value.has(ticketId) && ticketId !== draggedTicketId.value

const MAX_STACK_LAYERS = 3
// Matches .ticket-drag-stack padding in styles.css.
const STACK_GHOST_PADDING = 8

// setDragImage snapshots the element when called, so the ghost must be in the
// DOM and painted (off-screen, not display:none); it is removed a frame later.
const buildStackGhost = (card: HTMLElement, carriedCount: number): HTMLElement => {
  const ghost = document.createElement('div')
  ghost.className = 'ticket-drag-stack'
  ghost.style.width = `${card.offsetWidth}px`
  const layersBehind = Math.min(carriedCount, MAX_STACK_LAYERS) - 1
  for (let depth = layersBehind; depth >= 1; depth--) {
    const layer = document.createElement('div')
    layer.className = 'ticket-drag-layer'
    layer.style.setProperty('--stack-depth', String(depth))
    ghost.append(layer)
  }
  const frontCard = card.cloneNode(true) as HTMLElement
  frontCard.classList.add('ticket-drag-front')
  const countBadge = document.createElement('span')
  countBadge.className = 'ticket-drag-count'
  countBadge.textContent = String(carriedCount)
  ghost.append(frontCard, countBadge)
  return ghost
}

const startTicketDrag = (event: DragEvent, ticketId: string) => {
  draggedTicketId.value = ticketId
  const carriedCount = carriedIds.value.size
  const card = event.currentTarget as HTMLElement
  if (carriedCount < 2 || !event.dataTransfer) return
  const ghost = buildStackGhost(card, carriedCount)
  document.body.append(ghost)
  const cardBounds = card.getBoundingClientRect()
  const pointerX = event.clientX - cardBounds.left + STACK_GHOST_PADDING
  const pointerY = event.clientY - cardBounds.top + STACK_GHOST_PADDING
  event.dataTransfer.setDragImage(ghost, pointerX, pointerY)
  requestAnimationFrame(() => ghost.remove())
}

const dropOnLane = async (laneId: string) => {
  const ticketId = draggedTicketId.value
  draggedTicketId.value = null
  if (!ticketId) return
  const ticketIds = ticketIdsToMove(ticketId, selectedTicketIds.value, visibleTickets.value, laneId)
  await store.moveTickets(projectPath.value, ticketIds, laneId)
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
  if (laneId === UNASSIGNED_LANE_ID) return unassignedLane.value.name
  return board.value.lanes.find((lane) => lane.id === laneId)?.name ?? laneId
}

const readyLaneNameByTicketId = computed(() => {
  const names = new Map<string, string>()
  for (const ticket of board.value.tickets) {
    const targetLaneId = isReadyToMove(ticket, board.value)
    if (targetLaneId) names.set(ticket.id, laneName(targetLaneId))
  }
  return names
})

const openTicketNextLaneId = computed(() => {
  const ticket = openTicket.value
  if (!ticket) return undefined
  return effectiveNextLaneId(ticket, boardLaneById(board.value, ticket.laneId))
})

// '' = inherit. A stale override naming the ticket's own lane shows as inherit
// too, matching how effectiveNextLaneId resolves it.
const openTicketOverrideId = computed(() => {
  const ticket = openTicket.value
  if (!ticket?.moveToLaneId || ticket.moveToLaneId === ticket.laneId) return ''
  return ticket.moveToLaneId
})

const openTicketLaneDefaultLabel = computed(() => {
  const ticket = openTicket.value
  const laneDefaultId = ticket ? laneNextLaneId(ticket.laneId) : ''
  return laneDefaultId ? `Lane default: ${laneName(laneDefaultId)}` : 'None'
})

// Next Lane targets for a ticket: No status and every lane, minus the lane the
// ticket is in (moving to it is a no-op).
const nextLaneOptionsFor = (currentLaneId: string) =>
  laneColumns.value.filter((lane) => lane.id !== currentLaneId)

// Picking a lane arms it — the checkbox starts ticked. Picking the lane default
// (or the lane it already inherits) drops the override, so the ticket follows
// later changes to its lane's Next Lane; it stays armed only if there is one.
const setMoveToLane = (ticket: Ticket, laneId: string) => {
  const laneDefaultId = laneNextLaneId(ticket.laneId)
  const overridesLaneDefault = laneId !== '' && laneId !== laneDefaultId
  if (overridesLaneDefault) {
    editTicket(ticket, { moveToLaneId: laneId, moveOnComplete: true })
    return
  }
  editTicket(ticket, { moveToLaneId: undefined, moveOnComplete: Boolean(laneDefaultId) })
}

// A ticket's prompt is built from its own lane, so the same ticket produces a
// different instruction once it moves column.
const laneOfTicket = (ticket: Ticket) => currentLaneOf(board.value, ticket)

const promptContext = (ticket: Ticket) => ({
  assigneeName: ticket.assigneeId ? assigneeName(ticket.assigneeId) : undefined,
  projectPath: projectPath.value
})

const ticketCommand = (ticket: Ticket) => {
  const agent = agentForTicket(ticket, agents.value)
  return ticketShellCommand(ticket, laneOfTicket(ticket), agent, promptContext(ticket), ticket.model)
}

const trimmedInputValue = (event: Event) => (event.target as HTMLInputElement).value.trim() || undefined

// A model id belongs to one CLI ('opus' means nothing to Codex), so switching
// the agent clears it rather than handing the new CLI a model it can't run.
// An orchestrator left on "Same as ticket agent" follows the ticket agent, so
// its model is cleared along with it.
const changeLaneAutoRunAgent = (lane: SwimLane, autoRunAgentId: string) => {
  const orchestratorFollowsTicketAgent = !lane.orchestratorAgentId
  const orchestratorModelPatch = orchestratorFollowsTicketAgent ? { orchestratorModel: undefined } : {}
  editLane(lane, { autoRunAgentId, autoRunModel: undefined, ...orchestratorModelPatch })
}

const changeAutoRunConfirmAgent = () => {
  const agent = findAgent(agents.value, autoRunConfirmAgentId.value)
  autoRunConfirmModel.value = agent.defaultModel ?? ''
  if (!autoRunConfirmOrchestratorAgentId.value) autoRunConfirmOrchestratorModel.value = ''
}

// Runs what the lane shows: an active filter narrows the batch, so the button
// never launches tickets the user cannot see. Checked tickets narrow it further.
// An unconfigured lane follows the Open In picker when that is a terminal, so
// the first click uses a terminal the user is known to have.
const autoRunTerminal = (lane: SwimLane) => resolveAutoRunTerminal(lane.autoRunTerminalId, openInStore.selectedId)

const orchestratorContextFor = (terminal: OpenInTarget): OrchestratorPromptContext => ({
  projectPath: projectPath.value,
  lanes: [...board.value.lanes, getUnassignedLane(board.value)],
  terminalId: terminal.id,
  terminalLabel: terminal.label
})

const openLaneOrchestratorTemplate = computed(() => {
  const lane = openLane.value
  if (!lane) return ''
  const context = orchestratorContextFor(autoRunTerminal(lane))
  return orchestratorPromptTemplate(lane, context)
})

// Blank counts as no override, the same as at launch.
const openLaneOrchestratorOverride = computed(() => {
  const override = openLane.value?.orchestratorPromptOverride ?? ''
  return override.trim() ? override : ''
})

const openLaneMissingOrchestratorTokens = computed(() => {
  const override = openLaneOrchestratorOverride.value
  return override ? orchestratorPromptMissingTokens(override) : []
})

// Saving the untouched template, or clearing the box, keeps the lane on the
// generated prompt, so app updates to it still arrive and the old extras stay.
// An edit folds the extras into the override, since they are already part of
// the text the user just saved.
const orchestratorPromptPatch = (text: string): Partial<Omit<SwimLane, 'id'>> => {
  const trimmedText = text.trim()
  const isUnchangedTemplate = trimmedText === openLaneOrchestratorTemplate.value.trim()
  if (!trimmedText || isUnchangedTemplate) return { orchestratorPromptOverride: '' }
  return { orchestratorPromptOverride: text, orchestratorPrompt: '' }
}


// Live copies of each prompt + markdown file pair, because the inputs only
// commit on blur: autosave has to write what is on screen, not what state held
// before the blur.
type LaneMarkdownStatus = { savedMessage: string; error: string }
const idleMarkdownStatus = (): LaneMarkdownStatus => ({ savedMessage: '', error: '' })
const laneMarkdownDraft = ref<Record<LaneMarkdownKind, { prompt: string; filePath: string }>>({
  agent: { prompt: '', filePath: '' },
  orchestrator: { prompt: '', filePath: '' }
})
const laneMarkdownStatus = ref<Record<LaneMarkdownKind, LaneMarkdownStatus>>({
  agent: idleMarkdownStatus(),
  orchestrator: idleMarkdownStatus()
})

// The orchestrator box shows the full prompt (override or generated), so that
// is what its file gets.
const laneMarkdownSources: Record<LaneMarkdownKind, { prompt: () => string; filePath: () => string }> = {
  agent: {
    prompt: () => openLane.value?.agentPrompt ?? '',
    filePath: () => openLane.value?.agentFilePath ?? ''
  },
  orchestrator: {
    prompt: () => openLaneOrchestratorOverride.value || openLaneOrchestratorTemplate.value,
    filePath: () => openLane.value?.orchestratorFilePath ?? ''
  }
}

for (const kind of ['agent', 'orchestrator'] as const) {
  const source = laneMarkdownSources[kind]
  // One watch per field, not one getter returning an array: a fresh array on
  // every board refresh would reset the draft mid-typing, and the path an
  // autosave stores must not reset the prompt being typed.
  watch(source.prompt, (prompt) => (laneMarkdownDraft.value[kind].prompt = prompt), { immediate: true })
  watch(source.filePath, (filePath) => (laneMarkdownDraft.value[kind].filePath = filePath), { immediate: true })
}

// Autosave once typing pauses. 1s sits in the usual 1-2s autosave range: long
// enough not to write mid-word, short enough to land before the modal closes.
const MARKDOWN_AUTOSAVE_DELAY_MS = 1000

type PendingMarkdownSave = { timer: ReturnType<typeof setTimeout>; run: () => void }
const pendingMarkdownSaves: Partial<Record<LaneMarkdownKind, PendingMarkdownSave>> = {}
// What each lane's file last got from us, so main can tell our copy from a hand edit.
const lastSavedMarkdown = new Map<string, string>()
// One write at a time, in order: a slow save must not land after a newer one.
let markdownSaveQueue = Promise.resolve()

const flushMarkdownSaves = () => {
  for (const pending of Object.values(pendingMarkdownSaves)) {
    clearTimeout(pending.timer)
    pending.run()
  }
}

type LanePromptPatch = Partial<Omit<SwimLane, 'id'>>
// Typed text not stored on the lane yet. Blur stores it; closing or switching
// lanes without a blur (Escape) stores it here, so the lane never lags its file.
// The patch is built while its lane is open: the orchestrator one compares
// against that lane's template.
const uncommittedPrompts: Partial<Record<LaneMarkdownKind, { lane: SwimLane; patch: LanePromptPatch }>> = {}

const lanePromptPatch = (kind: LaneMarkdownKind, text: string): LanePromptPatch =>
  kind === 'agent' ? { agentPrompt: text } : orchestratorPromptPatch(text)

const commitTypedPrompts = () => {
  for (const kind of ['agent', 'orchestrator'] as const) {
    const uncommitted = uncommittedPrompts[kind]
    if (!uncommitted) continue
    delete uncommittedPrompts[kind]
    editLane(uncommitted.lane, uncommitted.patch)
  }
}

watch(openLaneId, () => {
  flushMarkdownSaves()
  commitTypedPrompts()
  laneMarkdownStatus.value = { agent: idleMarkdownStatus(), orchestrator: idleMarkdownStatus() }
  // The source watches only fire on a changed value, so two lanes storing the
  // same prompt would otherwise hand one lane's typed text to the next.
  for (const kind of ['agent', 'orchestrator'] as const) {
    const source = laneMarkdownSources[kind]
    laneMarkdownDraft.value[kind] = { prompt: source.prompt(), filePath: source.filePath() }
  }
})
onBeforeUnmount(() => {
  flushMarkdownSaves()
  commitTypedPrompts()
})

// Only the file (and its path, the first time) is written here. The prompt
// itself is stored on blur, as before: storing it mid-typing would re-render
// the box under the cursor.
const saveLaneMarkdown = async (lane: SwimLane, kind: LaneMarkdownKind, prompt: string, filePath: string) => {
  const savedKey = `${lane.id}:${kind}`
  const previousPrompt = lastSavedMarkdown.get(savedKey) ?? ''
  const setStatus = (status: LaneMarkdownStatus) => {
    // The modal may have switched lanes mid-save; don't show this lane's result on another.
    if (openLaneId.value === lane.id) laneMarkdownStatus.value[kind] = status
  }
  try {
    const saved = await store.saveLaneMarkdown(projectPath.value, lane, kind, prompt, previousPrompt, filePath)
    // Recorded even if the lane update failed: the file holds this text now.
    lastSavedMarkdown.set(savedKey, prompt)
    if (saved.laneUpdated) setStatus({ savedMessage: `Saved to ${saved.filePath}`, error: '' })
    else setStatus({ savedMessage: '', error: 'Saved the file but could not store its path on the lane.' })
  } catch (error) {
    setStatus({ savedMessage: '', error: ipcErrorMessage(error) })
  }
}

// Everything is captured now, not when the timer fires: by then the modal may
// show another lane.
const scheduleLaneMarkdownSave = (lane: SwimLane, kind: LaneMarkdownKind) => {
  const savedKey = `${lane.id}:${kind}`
  // Before the first save the file should hold the stored prompt: the lane
  // keeps it until blur commits the new text.
  if (!lastSavedMarkdown.has(savedKey)) lastSavedMarkdown.set(savedKey, laneMarkdownSources[kind].prompt())
  const { prompt, filePath } = laneMarkdownDraft.value[kind]
  const run = () => {
    delete pendingMarkdownSaves[kind]
    markdownSaveQueue = markdownSaveQueue.then(() => saveLaneMarkdown(lane, kind, prompt, filePath))
  }
  const existing = pendingMarkdownSaves[kind]
  if (existing) clearTimeout(existing.timer)
  pendingMarkdownSaves[kind] = { timer: setTimeout(run, MARKDOWN_AUTOSAVE_DELAY_MS), run }
}

const onLaneMarkdownPromptInput = (lane: SwimLane, kind: LaneMarkdownKind, event: Event) => {
  const text = (event.target as HTMLTextAreaElement).value
  laneMarkdownDraft.value[kind].prompt = text
  uncommittedPrompts[kind] = { lane, patch: lanePromptPatch(kind, text) }
  scheduleLaneMarkdownSave(lane, kind)
}

const storeTypedPrompts = () => {
  commitTypedPrompts()
  flushMarkdownSaves()
}

// A new path gets the current text, unless there is none: linking an existing
// guide with an empty prompt must not try to write over it.
const onLaneMarkdownPathChange = (lane: SwimLane, kind: LaneMarkdownKind, event: Event) => {
  const filePath = (event.target as HTMLInputElement).value
  editLane(lane, { [LANE_MARKDOWN_FILE_PATH_FIELD[kind]]: filePath })
  if (laneMarkdownDraft.value[kind].prompt.trim()) scheduleLaneMarkdownSave(lane, kind)
}

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
const autoRunConfirmModel = ref('')
// '' = same as the ticket agent, matching an absent lane.orchestratorAgentId.
const autoRunConfirmOrchestratorAgentId = ref('')
const autoRunConfirmOrchestratorModel = ref('')
const autoRunConfirmTerminalId = ref('')
const autoRunConfirmLane = computed(() => laneColumns.value.find((lane) => lane.id === autoRunConfirmLaneId.value))

const askToAutoRunLane = (lane: SwimLane) => {
  const agent = findAgent(agents.value, lane.autoRunAgentId)
  autoRunConfirmAgentId.value = agent.id
  autoRunConfirmModel.value = lane.autoRunModel || agent.defaultModel || ''
  autoRunConfirmOrchestratorAgentId.value = lane.orchestratorAgentId ?? ''
  autoRunConfirmOrchestratorModel.value = lane.orchestratorModel ?? ''
  autoRunConfirmTerminalId.value = autoRunTerminal(lane).id
  autoRunConfirmLaneId.value = lane.id
}

const confirmAutoRunLane = () => {
  const lane = autoRunConfirmLane.value
  autoRunConfirmLaneId.value = null
  if (!lane) return
  const agent = findAgent(agents.value, autoRunConfirmAgentId.value)
  const model = autoRunConfirmModel.value
  const chosenTerminal = TERMINAL_TARGETS.find((target) => target.id === autoRunConfirmTerminalId.value)
  const terminal = chosenTerminal ?? autoRunTerminal(lane)
  const useWorktrees = autoRunUsesWorktrees(lane)
  const launches = autoRunTickets(lane).map((ticket) =>
    buildAutoRunLaunch(ticket, lane, agent, promptContext(ticket), useWorktrees, model)
  )
  if (launches.length === 0) return
  // Launched tickets are unchecked so the next Auto Run doesn't relaunch them.
  for (const { ticket } of launches) selectedTicketIds.value.delete(ticket.id)
  const orchestratorContext = orchestratorContextFor(terminal)
  const orchestratorSettings = {
    orchestratorAgentId: autoRunConfirmOrchestratorAgentId.value || undefined,
    orchestratorModel: autoRunConfirmOrchestratorModel.value
  }
  const orchestratorChoice = orchestratorAgentChoice(orchestratorSettings, { agent, model }, agents.value)
  const orchestrator = buildOrchestratorLaunch(
    lane,
    launches,
    orchestratorChoice.agent,
    orchestratorContext,
    orchestratorChoice.model
  )
  void store.autoRunLane(projectPath.value, lane.id, terminal.id, terminal.label, launches, useWorktrees, orchestrator)
}

const openTicketInShell = (ticket: Ticket) => {
  const command = ticketCommand(ticket)
  const tabTitle = ticketTabTitle(ticket, laneOfTicket(ticket))
  return store.openIn(projectPath.value, openInStore.selectedId, command, tabTitle)
}

// Glyphs, not just colour, tell success from failure.
const AGENT_BADGES: Record<AgentRunBadge, { className: string; label: string; glyph?: string }> = {
  running: { className: 'agent-status-running', label: 'Agent running' },
  succeeded: { className: 'agent-status-done', label: 'Agent succeeded', glyph: '✓' },
  failed: { className: 'agent-status-failed', label: 'Agent failed', glyph: '✕' },
  interrupted: { className: 'agent-status-interrupted', label: 'Interrupted', glyph: '⏸' }
}

const cardAgentBadge = (ticket: Ticket) => {
  const running = Boolean(store.agentRunning[ticket.id])
  const badge = agentRunBadge(ticket, running)
  return badge ? AGENT_BADGES[badge] : null
}

// A re-running ticket shows the running dot, not its old result, so the lane
// count leaves it out too.
const showsUnseenResult = (ticket: Ticket) => !store.agentRunning[ticket.id] && hasUnseenAgentResult(ticket)
const unseenAgentResultCount = (laneId: string) => ticketsInLane(laneId).filter(showsUnseenResult).length

// Watching the open ticket (not the card click) also covers opening from the
// graph view, and a run that finishes while its modal is already open.
// Only unseen runs are written, so reopening a ticket doesn't touch it.
watch(
  () => openTicket.value?.agentRun,
  (agentRun) => {
    const ticket = openTicket.value
    if (!ticket || !agentRun || agentRun.seenAt !== undefined) return
    void store.markAgentRunSeen(projectPath.value, ticket.id, agentRun.at)
  },
  { immediate: true }
)

// The run's own agent, not the ticket's current pick: only the CLI that
// started a session can resume it.
const ticketCanResume = (ticket: Ticket) => {
  const runAgent = findAgent(agents.value, ticket.agentRun?.agentId ?? ticket.agentId)
  return canResume(ticket, runAgent)
}

const resumeTicketAgent = (ticket: Ticket) => void store.resumeTicketAgent(projectPath.value, ticket)

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
      <OfflineBadge />
      <button class="secondary" title="Back to projects" @click="router.push('/')">← Projects</button>
      <MetricsPanel :project-paths="[projectPath]" scope="board" />
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
    <MessageBanners />

    <section class="board-filters">
      <input
        ref="filterQueryInput"
        v-model="filterQuery"
        type="search"
        class="filter-query"
        aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
        :class="{ active: filterQuery }"
        placeholder="Filter tickets…"
      />
      <div ref="laneFilterMenuRef" class="filter-menu" @focusout="closeLaneFilterMenuOnFocusOut">
        <button
          type="button"
          class="filter-trigger"
          :class="{ active: laneFilterNarrows }"
          aria-haspopup="true"
          :aria-expanded="laneFilterMenuOpen"
          @click="laneFilterMenuOpen = !laneFilterMenuOpen"
        >
          {{ laneFilterLabel }}
        </button>
        <div v-if="laneFilterMenuOpen" class="filter-popover" role="group" aria-label="Swim lanes shown">
          <label v-for="lane in shownLanes" :key="lane.id">
            <input
              type="checkbox"
              :checked="activeFilterLaneIds.includes(lane.id)"
              @change="toggleLaneFilter(lane.id)"
            />
            <span>{{ lane.name }}</span>
          </label>
        </div>
      </div>
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

    <TicketGraph v-if="boardView === 'graph'" :project-name="projectTitle" :lanes="visibleLanes" :board-lanes="laneColumns" :tickets="visibleLanes.flatMap(lane => ticketsInLane(lane.id))" :ticket-open="Boolean(openTicket)" @ticket="openTicketId = $event" @selection="openTicketId = null" @edit-lane="editLane" />
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
        @dblclick.self="startTicketDraft(lane.id)"
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
          <h2 :title="lane.name">{{ lane.name }}</h2>
          <span class="lane-count">{{ ticketsInLane(lane.id).length }}</span>
          <span
            v-if="unseenAgentResultCount(lane.id) > 0"
            class="lane-unseen-count"
            role="img"
            :aria-label="`${unseenAgentResultCount(lane.id)} unseen agent results`"
            title="Agent results you haven't opened yet"
          >{{ unseenAgentResultCount(lane.id) }}</span>
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
            :class="{ 'ticket-carried': isCarriedBehind(ticket.id) }"
            draggable="true"
            @dragstart="startTicketDrag($event, ticket.id)"
            @dragend="draggedTicketId = null"
            @click="openTicketId = ticket.id"
          >
            <input
              type="checkbox"
              class="ticket-select"
              :checked="selectedTicketIds.has(ticket.id)"
              :aria-label="`Select #${ticket.number} (run / move)`"
              title="Select (run / move)"
              @click.stop
              @change="toggleTicketSelected(ticket.id)"
            />
            <h3>
              <span
                v-if="cardAgentBadge(ticket)"
                :class="['agent-status', cardAgentBadge(ticket)?.className]"
                role="img"
                :aria-label="cardAgentBadge(ticket)?.label"
                :title="cardAgentBadge(ticket)?.label"
              >{{ cardAgentBadge(ticket)?.glyph }}</span>
              <span v-if="showsField('number')" class="ticket-number">#{{ ticket.number }}</span>
              {{ ticket.title }}
              <span
                v-if="isFullAuto(ticket, laneOfTicket(ticket))"
                class="full-auto-badge"
                title="Full auto: the next lane's agent starts when this one moves the ticket on"
              >auto</span>
              <span
                v-if="readyLaneNameByTicketId.has(ticket.id)"
                class="full-auto-badge ready-badge"
                :title="`Move rules and checklist pass; ready to move to ${readyLaneNameByTicketId.get(ticket.id)}`"
              >ready → {{ readyLaneNameByTicketId.get(ticket.id) }}</span>
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
                (showsField('version') && ticket.version) ||
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

      <!-- Kept (inert) during a lane drag: removing its box would re-center
           every lane under "safe center" the moment the drag starts.
           Unmounting under the pointer fires no mouseleave → reset on unmount. -->
      <div
        v-if="!laneFilterNarrows"
        class="lane-add-zone"
        :class="{ shown: addZoneShown }"
        :inert="laneDrag?.active"
        :style="{ width: `${DEFAULT_LANE_WIDTH}px` }"
        @mouseenter="showAddZone"
        @mouseleave="hideAddZoneLater"
        @vue:before-unmount="hideAddZoneNow"
      >
        <button class="lane-add-button" aria-label="Add swim lane" title="Add swim lane" @click="laneDraftName = ''">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg>
        </button>
      </div>
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
        <li v-for="lane in laneColumns" :key="lane.id">
          <label>
            <input
              type="checkbox"
              :checked="!laneIsHidden(lane.id)"
              @change="toggleLaneVisibility(lane.id)"
            />
            {{ lane.name }} ({{ laneTicketTotal(lane.id) }})
          </label>
        </li>
      </ul>

      <div class="modal-actions">
        <button @click="boardSettingsOpen = false">Done</button>
      </div>
    </section>
  </div>

  <div v-if="ticketDraft" class="modal-backdrop" @click.self="ticketDraft = null">
    <section class="modal ticket-modal" :class="{ expanded: ticketModalExpanded }" @paste="pasteDraftImages">
      <div class="ticket-modal-header">
        <p class="eyebrow">New ticket</p>
        <ExpandToggle v-model="ticketModalExpanded" />
      </div>
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
        Next Lane
        <select :value="draftNextLaneId" @change="ticketDraft.nextLaneId = ($event.target as HTMLSelectElement).value">
          <option value="">None</option>
          <option v-for="lane in nextLaneOptionsFor(ticketDraft.laneId)" :key="lane.id" :value="lane.id">
            {{ lane.name }}
          </option>
        </select>
        <span class="field-hint">Defaults to the Status lane's Next Lane.</span>
      </label>

      <label>
        Description
        <textarea v-model="ticketDraft.description" placeholder="Details, acceptance criteria, links..." />
      </label>

      <section class="ticket-images" @dragover.prevent @drop.prevent="dropDraftImages">
        <p class="eyebrow">Images</p>
        <input
          ref="draftImageInput"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          @change="pickDraftImages($event.target as HTMLInputElement)"
        />
        <button type="button" class="image-dropzone" @click="draftImageInput?.click()">
          <span>Drag or paste images here</span>
          <span class="image-dropzone-plus" aria-hidden="true">+</span>
        </button>
        <ul v-if="ticketDraft.images.length">
          <li v-for="(stagedImage, index) in ticketDraft.images" :key="stagedImage.previewUrl">
            <span class="ticket-image-thumb" :title="stagedImage.file.name">
              <img :src="stagedImage.previewUrl" alt="Staged image" decoding="async" />
            </span>
            <button class="icon-button" title="Remove image" @click="unstageDraftImage(index)">×</button>
          </li>
        </ul>
      </section>

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
    <section
      class="modal ticket-modal"
      :class="{ expanded: ticketModalExpanded && boardView !== 'graph' }"
      @focusin="store.refresh()"
      @paste="pasteTicketImages(openTicket, $event)"
    >
      <div class="ticket-modal-header">
        <p class="eyebrow">
          #{{ openTicket.number }} · Created {{ formatDate(openTicket.createdAt) }}
          <template v-if="openTicket.updatedAt"> · Updated {{ formatDateTime(openTicket.updatedAt) }}</template>
        </p>
        <ExpandToggle v-if="boardView !== 'graph'" v-model="ticketModalExpanded" />
        <div ref="modalFieldsMenuRef" class="filter-menu">
          <button
            type="button"
            class="icon-button"
            title="Ticket fields"
            aria-label="Ticket fields"
            aria-haspopup="true"
            :aria-expanded="modalFieldsMenuOpen"
            @click="modalFieldsMenuOpen = !modalFieldsMenuOpen"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <div v-if="modalFieldsMenuOpen" class="filter-popover" role="group" aria-label="Shown ticket fields">
            <label v-for="field in TICKET_MODAL_FIELDS" :key="field.id">
              <input
                type="checkbox"
                :checked="!hidesModalField(field.id)"
                @change="toggleModalFieldVisibility(field.id)"
              />
              <span>{{ field.label }}</span>
            </label>
          </div>
        </div>
      </div>
      <input
        class="ticket-title-input"
        :value="openTicket.title"
        @change="editTicket(openTicket, { title: ($event.target as HTMLInputElement).value })"
      />

      <label v-if="!hidesModalField('status')">
        Status
        <select
          :value="openTicket.laneId"
          @change="editTicket(openTicket, { laneId: ($event.target as HTMLSelectElement).value })"
        >
          <option :value="UNASSIGNED_LANE_ID">{{ UNASSIGNED_LANE_NAME }}</option>
          <option v-for="lane in board.lanes" :key="lane.id" :value="lane.id">{{ lane.name }}</option>
        </select>
      </label>

      <label v-if="!hidesModalField('assignee')">
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

      <label v-if="!hidesModalField('description')">
        Description
        <textarea
          :value="openTicket.description"
          placeholder="Details, acceptance criteria, links..."
          @change="editTicket(openTicket, { description: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>

      <label v-if="!hidesModalField('labels')">
        Labels
        <input
          :value="formatLabels(openTicket.labels)"
          placeholder="bug, ui, needs-design"
          @change="editTicketLabels(openTicket, ($event.target as HTMLInputElement).value)"
        />
        <span class="field-hint">Comma separated. Searchable from the filter box.</span>
      </label>

      <label v-if="!hidesModalField('branch')">
        Branch
        <input
          class="agent-file-path"
          :value="openTicket.branchName ?? ''"
          placeholder="feat/board-ticket-fields"
          @change="editTicket(openTicket, { branchName: trimmedInputValue($event) })"
        />
      </label>

      <label v-if="!hidesModalField('worktree')">
        Worktree
        <input
          class="agent-file-path"
          :value="openTicket.worktreePath ?? ''"
          placeholder="/Users/me/Code/my-app-board-ticket-fields"
          @change="
            editTicket(openTicket, { worktreePath: trimmedInputValue($event) })
          "
        />
      </label>

      <label v-if="!hidesModalField('version')">
        Version
        <input
          class="agent-file-path"
          :value="openTicket.version ?? ''"
          placeholder="1.4.0"
          @change="editTicketVersion(openTicket, $event.target as HTMLInputElement)"
        />
        <span v-if="versionInvalid" class="field-hint field-error">Use MAJOR.MINOR.PATCH, like 1.4.0</span>
      </label>

      <section v-if="!hidesModalField('pullRequest')" class="ticket-pull-request">
        <p class="eyebrow">Merge Request</p>
        <p class="pull-request-status">
          <span class="pull-request-pill" :data-state="openTicket.pullRequestState ?? 'none'">
            {{ pullRequestStatusLabel(openTicket.pullRequestState) }}
          </span>
          <span v-if="openTicket.pullRequestState === 'merged' && openTicket.pullRequestMergedAt" class="field-hint">
            Merged {{ formatDateTime(openTicket.pullRequestMergedAt) }}
          </span>
          <a v-if="isWebUrl(openTicket.pullRequestUrl)" :href="openTicket.pullRequestUrl" target="_blank">
            {{ pullRequestLabel(openTicket.pullRequestUrl) }} ↗
          </a>
          <button
            class="icon-button"
            title="Refresh from GitHub"
            :disabled="pullRequestRefreshing || !githubUrl"
            @click="refreshOpenTicketPullRequest"
          >
            ↻
          </button>
        </p>
        <span v-if="pullRequestError" class="field-hint field-error">{{ pullRequestError }}</span>
        <label>
          PR URL override
          <input
            type="url"
            class="agent-file-path"
            :value="openTicket.pullRequestUrl ?? ''"
            placeholder="Found from the branch; paste https://github.com/owner/repo/pull/123 to override"
            @change="overridePullRequestUrl(openTicket, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </section>

      <section v-if="!hidesModalField('externalLinks')" class="ticket-checklist ticket-links">
        <p class="eyebrow">External Links</p>
        <ul v-if="openTicket.externalLinks?.length">
          <li v-for="(link, index) in openTicket.externalLinks" :key="index">
            <a v-if="isWebUrl(link)" :href="link" :title="link" target="_blank" rel="noreferrer">{{ link }}</a>
            <span v-else :title="link">{{ link }}</span>
            <button class="icon-button" title="Remove link" @click="dropExternalLink(openTicket, link)">×</button>
          </li>
        </ul>
        <div class="ticket-links-add">
          <input
            ref="linkInput"
            v-model="linkDraft"
            type="url"
            placeholder="https://…"
            @input="linkDraftInvalid = false"
            @keyup.enter="addLinkDraft(openTicket)"
          />
          <button type="button" @click="addLinkDraft(openTicket)">Add</button>
        </div>
        <span v-if="linkDraftInvalid" class="field-hint field-error">Use an http(s) URL</span>
      </section>

      <section
        v-if="!hidesModalField('images') || imageError"
        class="ticket-images"
        @dragover.prevent
        @drop.prevent="dropTicketImages(openTicket, $event)"
      >
        <p class="eyebrow">Images</p>
        <button type="button" class="image-dropzone" @click="pickTicketImages(openTicket)">
          <span>Drag or paste images here</span>
          <span class="image-dropzone-plus" aria-hidden="true">+</span>
        </button>
        <ul v-if="openTicket.images?.length">
          <li v-for="imagePath in openTicket.images" :key="imagePath">
            <button type="button" class="ticket-image-thumb" :title="imagePath" @click="openTicketImage(imagePath)">
              <img :src="ticketImageUrl(imagePath)" alt="Attached image" loading="lazy" decoding="async" />
            </button>
            <button class="icon-button" title="Remove image" @click="removeTicketImage(openTicket, imagePath)">×</button>
          </li>
        </ul>
        <span v-if="imageError" class="field-hint field-error">{{ imageError }}</span>
      </section>

      <section v-if="!hidesModalField('checklist')" class="ticket-checklist">
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
        <label v-if="!hidesModalField('agent')">
          Agent
          <select
            :value="agentForTicket(openTicket, agents).id"
            @change="editTicket(openTicket, { agentId: ($event.target as HTMLSelectElement).value, model: undefined })"
          >
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
          </select>
        </label>
        <label v-if="!hidesModalField('model')">
          Model
          <ModelField
            :model-value="openTicket.model ?? ''"
            :agent="findAgent(agents, openTicket.agentId)"
            placeholder="CLI default"
            @update:model-value="editTicket(openTicket, { model: $event || undefined })"
          />
        </label>
        <label v-if="!hidesModalField('fullAuto')" class="checkbox-label">
          <input
            type="checkbox"
            :checked="Boolean(openTicket.fullAuto)"
            @change="editTicket(openTicket, { fullAuto: ($event.target as HTMLInputElement).checked })"
          />
          Full auto
          <InfoTip text="Same as a lane's Full auto, but for this ticket in every lane it enters." />
        </label>
        <span v-if="!hidesModalField('fullAuto')" class="field-hint">
          In every lane: when an agent moves this ticket on, the next lane's agent starts on it.
        </span>
        <label v-if="!hidesModalField('nextLane')">
          Next Lane
          <select
            :value="openTicketOverrideId"
            @change="setMoveToLane(openTicket, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ openTicketLaneDefaultLabel }}</option>
            <option v-for="lane in nextLaneOptionsFor(openTicket.laneId)" :key="lane.id" :value="lane.id">
              {{ lane.name }}
            </option>
          </select>
          <span class="field-hint">
            Where this ticket goes when its checklist is done or ▶ Run succeeds. Defaults to the lane's Next Lane.
          </span>
        </label>
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
            v-if="ticketCanResume(openTicket)"
            class="secondary"
            :disabled="store.agentRunning[openTicket.id]"
            title="Resume the interrupted session in a terminal tab, in the directory it started in"
            @click="resumeTicketAgent(openTicket)"
          >
            ⏯ Resume
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

      <section v-if="openTicket.agentRun && !hidesModalField('lastAgentRun')" class="ticket-agent-run">
        <p class="eyebrow">
          Last agent run · {{ laneName(openTicket.agentRun.laneId) }} · {{ formatDateTime(openTicket.agentRun.at) }}
        </p>
        <pre>{{ openTicket.agentRun.output }}</pre>
      </section>

      <a v-if="openTicket.externalUrl" class="ticket-external" :href="openTicket.externalUrl" target="_blank">
        View on GitHub ({{ openTicket.externalId?.replace('github:', '#') }})
      </a>

      <label v-if="openTicketNextLaneId && !hidesModalField('nextLane')" class="checkbox-label">
        <input
          type="checkbox"
          :checked="Boolean(openTicket.moveOnComplete)"
          @change="editTicket(openTicket, { moveOnComplete: ($event.target as HTMLInputElement).checked })"
        />
        Move to Next Lane: {{ laneName(openTicketNextLaneId) }}
      </label>

      <label v-if="openTicketNextLaneId || openTicket.moveRules">
        Move rules
        <textarea
          :value="openTicket.moveRules ?? ''"
          placeholder="One rule per line, e.g. PR merged; no open questions"
          @change="editTicket(openTicket, { moveRules: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>

      <label v-if="moveRulesList(openTicket).length" class="checkbox-label">
        <input
          type="checkbox"
          :checked="openTicket.moveRulesPassedLaneId === openTicket.laneId"
          @change="
            editTicket(openTicket, {
              moveRulesPassedLaneId: ($event.target as HTMLInputElement).checked ? openTicket.laneId : undefined
            })
          "
        />
        Move rules pass
      </label>

      <div class="modal-actions">
        <button
          class="secondary danger ticket-delete"
          title="Delete ticket"
          aria-label="Delete ticket"
          @click="askToDeleteTicket(openTicket)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
        </button>
        <button class="secondary" @click="cancelTicketEdits">Cancel</button>
        <button @click="closeModals">Done</button>
      </div>
    </section>
  </div>

  <div v-if="ticketPendingDeletion" class="modal-backdrop" @click.self="ticketPendingDeletion = null">
    <section class="modal" role="alertdialog" aria-labelledby="delete-ticket-question">
      <p class="eyebrow">Delete ticket</p>
      <p id="delete-ticket-question">
        Are you sure you want to delete ticket #{{ ticketPendingDeletion.number }}?
      </p>
      <div class="modal-actions">
        <button ref="deleteConfirmCancelButton" class="secondary" @click="ticketPendingDeletion = null">Cancel</button>
        <button class="secondary danger" @click="confirmDeleteTicket">Delete</button>
      </div>
    </section>
  </div>

  <div v-if="autoRunConfirmLane" class="modal-backdrop" @click.self="autoRunConfirmLaneId = null">
    <section class="modal" role="alertdialog" aria-labelledby="auto-run-confirm-question">
      <p class="eyebrow">Auto Run · {{ autoRunConfirmLane.name }}</p>
      <p id="auto-run-confirm-question" class="auto-run-question">
        Run {{ autoRunTickets(autoRunConfirmLane).length }} separate
        <select v-model="autoRunConfirmAgentId" aria-label="Agent" @change="changeAutoRunConfirmAgent">
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
        </select>
        agents with
        <ModelField
          v-model="autoRunConfirmModel"
          :agent="findAgent(agents, autoRunConfirmAgentId)"
          placeholder="CLI default"
        />
        for {{ autoRunTickets(autoRunConfirmLane).length }} tickets?
      </p>
      <section v-if="orchestratorPollActive(autoRunConfirmLane)" class="auto-run-orchestrator">
        <p class="eyebrow">Orchestrator</p>
        <div class="auto-run-orchestrator-fields">
          <label>
            Agent
            <select v-model="autoRunConfirmOrchestratorAgentId" @change="autoRunConfirmOrchestratorModel = ''">
              <option value="">Same as ticket agent</option>
              <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
            </select>
          </label>
          <label>
            Model
            <ModelField
              v-model="autoRunConfirmOrchestratorModel"
              :agent="findAgent(agents, autoRunConfirmOrchestratorAgentId || autoRunConfirmAgentId)"
              :placeholder="autoRunConfirmOrchestratorAgentId ? 'CLI default' : 'Same as ticket model'"
            />
          </label>
        </div>
      </section>
      <p class="auto-run-question">
        Each opens in its own
        <select v-model="autoRunConfirmTerminalId" aria-label="Shell">
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
    <section class="modal lane-modal" :class="{ expanded: laneModalExpanded }">
      <div class="ticket-modal-header">
        <p class="eyebrow">Swim lane</p>
        <ExpandToggle v-model="laneModalExpanded" />
      </div>
      <input
        class="ticket-title-input"
        :value="openLane.name"
        @change="editLane(openLane, { name: ($event.target as HTMLInputElement).value })"
      />

      <label for="lane-agent-prompt">
        <span class="label-with-tip">
          Agent prompt
          <InfoTip text="Instructions sent to the agent when a ticket enters this lane. Autosaves as markdown to the Agent markdown file below (default SwimlaneAgentPrompt/<lane>/)." />
        </span>
        <textarea
          id="lane-agent-prompt"
          class="agent-prompt"
          :value="laneMarkdownDraft.agent.prompt"
          placeholder="Instructions for the agent that handles tickets in this lane — format, required sections, clarifying questions to ask..."
          @input="onLaneMarkdownPromptInput(openLane, 'agent', $event)"
          @change="storeTypedPrompts"
        />
      </label>

      <label>
        Agent markdown file
        <input
          class="agent-file-path"
          :value="openLane.agentFilePath"
          placeholder="/Users/you/Projects/thing/docs/agent-prompt.md"
          @input="laneMarkdownDraft.agent.filePath = ($event.target as HTMLInputElement).value"
          @change="onLaneMarkdownPathChange(openLane, 'agent', $event)"
        />
        <span v-if="laneMarkdownStatus.agent.error" class="field-hint field-error">{{ laneMarkdownStatus.agent.error }}</span>
        <span v-else-if="laneMarkdownStatus.agent.savedMessage" class="field-hint">{{ laneMarkdownStatus.agent.savedMessage }}</span>
        <span v-else class="field-hint">
          The prompt above autosaves here. Left empty it's SwimlaneAgentPrompt/&lt;lane&gt;/AgentPrompt.md. With no
          prompt typed, the agent is pointed at this file instead.
        </span>
      </label>

      <label>
        Output
        <textarea
          class="agent-prompt"
          :value="openLane.outputTarget ?? ''"
          placeholder="A file, a directory, or where it goes — e.g. a new folder inside the project directory"
          @change="editLane(openLane, { outputTarget: ($event.target as HTMLTextAreaElement).value })"
        />
        <span class="field-hint">Where the agent puts its work. An existing directory is used as-is, no prompt.</span>
      </label>

      <label for="lane-orchestrator-prompt">
        <span class="label-with-tip">
          Orchestrator prompt
          <InfoTip text="Instructions for this lane's orchestrator session, which dispatches and monitors ticket agents. Leave empty to use the generated default template." />
        </span>
        <textarea
          id="lane-orchestrator-prompt"
          class="agent-prompt orchestrator-prompt"
          :value="laneMarkdownDraft.orchestrator.prompt"
          spellcheck="false"
          @input="onLaneMarkdownPromptInput(openLane, 'orchestrator', $event)"
          @change="storeTypedPrompts"
        />
        <span v-pre class="field-hint">
          Sent to the Auto Run orchestrator (runs on every Auto Run while the poll checkbox is on). {{tickets}}, {{ticket_numbers}},
          {{lanes}}, {{terminal}} are filled in at launch.
        </span>
        <span v-if="openLaneMissingOrchestratorTokens.length" class="field-hint field-error">
          Missing {{ openLaneMissingOrchestratorTokens.join(', ') }}: the orchestrator won't know which tickets to watch.
        </span>
      </label>
      <button
        v-if="openLaneOrchestratorOverride"
        class="secondary lane-prompt-reset"
        type="button"
        @click="editLane(openLane, { orchestratorPromptOverride: '' })"
      >
        Reset to default
      </button>

      <label>
        Agent Orchestrator markdown file
        <input
          class="agent-file-path"
          :value="openLane.orchestratorFilePath ?? ''"
          placeholder="/Users/you/Projects/thing/docs/orchestrator.md"
          @input="laneMarkdownDraft.orchestrator.filePath = ($event.target as HTMLInputElement).value"
          @change="onLaneMarkdownPathChange(openLane, 'orchestrator', $event)"
        />
        <span v-if="laneMarkdownStatus.orchestrator.error" class="field-hint field-error">
          {{ laneMarkdownStatus.orchestrator.error }}
        </span>
        <span v-else-if="laneMarkdownStatus.orchestrator.savedMessage" class="field-hint">
          {{ laneMarkdownStatus.orchestrator.savedMessage }}
        </span>
        <span v-else class="field-hint">
          The prompt above autosaves here, for versioning or review. Left empty it's
          SwimlaneAgentPrompt/&lt;lane&gt;/AgentOrchestratorPrompt.md.
        </span>
      </label>

      <!-- Caption uses for=, not a wrapping label: a <button> is labelable, so
           clicking a wrapping caption would fire − and switch the lane off. -->
      <div class="orchestrator-poll-row">
        <label
          id="orchestrator-poll-caption"
          :for="orchestratorPollActive(openLane) ? 'orchestrator-poll-minutes' : undefined"
        >Orchestrator poll (minutes)</label>
        <div
          class="poll-stepper"
          role="group"
          aria-labelledby="orchestrator-poll-caption"
          :title="orchestratorPollTooltip(openLane)"
        >
          <button
            type="button"
            aria-label="Decrease orchestrator poll"
            :aria-disabled="!orchestratorPollActive(openLane)"
            @click="stepOrchestratorPoll(openLane.id, -1)"
          >−</button>
          <span class="poll-stepper-value">
            <input
              v-if="orchestratorPollActive(openLane)"
              id="orchestrator-poll-minutes"
              type="number"
              min="1"
              step="1"
              :value="orchestratorPollMinutes(openLane)"
              @change="editOrchestratorPollMinutes(openLane, $event.target as HTMLInputElement)"
            />
            <span v-else role="img" aria-label="Orchestrator off">∞</span>
          </span>
          <span class="poll-stepper-status" aria-live="polite">{{
            orchestratorPollActive(openLane) ? plural(orchestratorPollMinutes(openLane), 'minute') : 'Orchestrator off'
          }}</span>
          <button
            type="button"
            aria-label="Increase orchestrator poll"
            @click="stepOrchestratorPoll(openLane.id, 1)"
          >+</button>
        </div>
      </div>

      <section class="ticket-agent">
        <p class="eyebrow">Auto Run</p>
        <div class="auto-run-pickers">
          <label>
            Agent
            <select
              :value="findAgent(agents, openLane.autoRunAgentId).id"
              @change="changeLaneAutoRunAgent(openLane, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
            </select>
          </label>
          <label>
            Shell
            <select
              :value="autoRunTerminal(openLane).id"
              @change="editLane(openLane, { autoRunTerminalId: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="terminal in TERMINAL_TARGETS" :key="terminal.id" :value="terminal.id">
                {{ terminal.label }}
              </option>
            </select>
          </label>
        </div>
        <label>
          Model
          <ModelField
            :model-value="openLane.autoRunModel ?? ''"
            :agent="findAgent(agents, openLane.autoRunAgentId)"
            placeholder="CLI default"
            @update:model-value="editLane(openLane, { autoRunModel: $event || undefined })"
          />
        </label>
        <label>
          Orchestrator agent
          <select
            :value="openLane.orchestratorAgentId ?? ''"
            @change="
              editLane(openLane, {
                orchestratorAgentId: ($event.target as HTMLSelectElement).value || undefined,
                orchestratorModel: undefined
              })
            "
          >
            <option value="">Same as ticket agent</option>
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
          </select>
        </label>
        <label>
          Orchestrator model
          <ModelField
            :model-value="openLane.orchestratorModel ?? ''"
            :agent="findAgent(agents, openLane.orchestratorAgentId ?? openLane.autoRunAgentId)"
            :placeholder="openLane.orchestratorAgentId ? 'CLI default' : 'Same as ticket model'"
            @update:model-value="editLane(openLane, { orchestratorModel: $event || undefined })"
          />
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
          <InfoTip text="When this lane's agent moves a ticket on, the next lane's agent starts on it automatically." />
          Full auto: start the next lane's agent when this lane's agent moves a ticket on
        </label>
        <label>
          Next Lane
          <select
            :value="openLane.nextLaneId ?? ''"
            @change="editLane(openLane, { nextLaneId: ($event.target as HTMLSelectElement).value || undefined })"
          >
            <option value="">None</option>
            <option v-if="openLane.id !== UNASSIGNED_LANE_ID" :value="UNASSIGNED_LANE_ID">
              {{ UNASSIGNED_LANE_NAME }}
            </option>
            <option
              v-for="lane in board.lanes.filter((candidate) => candidate.id !== openLane?.id)"
              :key="lane.id"
              :value="lane.id"
            >
              {{ lane.name }}
            </option>
          </select>
          <span class="field-hint">Where this lane's tickets go on completion unless a ticket sets its own.</span>
        </label>
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="Boolean(openLane.waitsForPullRequestMerge)"
            @change="editLane(openLane, { waitsForPullRequestMerge: ($event.target as HTMLInputElement).checked })"
          />
          Wait for PR merge before moving on
        </label>
        <span class="field-hint">Armed tickets here move to the Next Lane when their PR merges, not when their checklist completes.</span>
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="Boolean(openLane.agentSetsVersion)"
            @change="editLane(openLane, { agentSetsVersion: ($event.target as HTMLInputElement).checked })"
          />
          Agent sets semantic version
        </label>
        <span class="field-hint">This lane's agent decides whether the ticket needs a version and writes it.</span>
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="Boolean(openLane.closesTicket)"
            @change="editLane(openLane, { closesTicket: ($event.target as HTMLInputElement).checked })"
          />
          Counts as closed: tickets entering this lane count as closed in Metrics
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
          @click="askToDeleteLane(openLane)"
        >
          Delete lane
        </button>
        <span v-else class="field-hint">This column always exists — it holds tickets with no status.</span>
        <button @click="openLaneId = null">Done</button>
      </div>
    </section>
  </div>

  <div v-if="lanePendingDeletion" class="modal-backdrop" @click.self="lanePendingDeletionId = null">
    <section class="modal" role="alertdialog" aria-labelledby="delete-lane-question">
      <p class="eyebrow">Delete lane</p>
      <p id="delete-lane-question">Are you sure you want to delete the {{ lanePendingDeletion.name }} lane?</p>
      <p v-if="pendingLaneTicketCount" class="field-hint">
        Its {{ pendingLaneTicketCount }} {{ pendingLaneTicketCount === 1 ? 'ticket' : 'tickets' }} will move to
        {{ UNASSIGNED_LANE_NAME }}.
      </p>
      <div class="modal-actions">
        <button ref="laneDeleteConfirmCancelButton" class="secondary" @click="lanePendingDeletionId = null">Cancel</button>
        <button class="secondary danger" @click="confirmDeleteLane">Delete</button>
      </div>
    </section>
  </div>
</template>
