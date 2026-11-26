import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useOpenInStore } from '@/stores/openIn'
import { useProjectsStore } from '@/stores/projects'
import { resolveAutoRunTerminal, type OpenInTarget } from '@/shared/openInTargets'
import {
  availableAgents,
  boardLaneById,
  boardLaneColumns,
  currentLaneOf,
  getUnassignedLane,
  toggleHiddenLane,
  UNASSIGNED_LANE_ID,
  type Agent,
  type OrchestratorPromptContext,
  type SwimLane,
  type Ticket,
  type User
} from '@/shared/projectTypes'

// BoardView and its children all sit on the same board route, so each reads the
// board from the route + store itself rather than having it prop-drilled down.
export const useBoardContext = () => {
  const route = useRoute()
  const store = useProjectsStore()
  const openInStore = useOpenInStore()

  const projectPath = computed(() => decodeURIComponent(String(route.params.projectPath)))
  const project = computed(() => store.projects.find((entry) => entry.path === projectPath.value))
  const board = computed(() => store.board(projectPath.value))

  // The unassigned column is prepended for rendering but kept out of board.lanes,
  // so it carries its own agent prompt without ever becoming deletable.
  const laneColumns = computed(() => boardLaneColumns(board.value))

  const users = computed<User[]>(() => store.state.users ?? [])
  const assigneeName = (assigneeId?: string) =>
    users.value.find((user) => user.id === assigneeId)?.name ?? 'Unassigned'

  const agents = computed<Agent[]>(() => availableAgents(store.state))

  // Widths, hidden columns and card fields are this user's view of a shared
  // board, so they persist alongside the board rather than in component state.
  const preferences = computed(() => store.boardPreferences(projectPath.value))

  const savePreferences = (next: ReturnType<typeof store.boardPreferences>) =>
    store.saveBoardPreferences(projectPath.value, next)

  const hiddenLaneIds = computed(() => new Set(preferences.value.hiddenLaneIds))
  const laneIsHidden = (laneId: string) => hiddenLaneIds.value.has(laneId)
  const toggleLaneVisibility = (laneId: string) => savePreferences(toggleHiddenLane(preferences.value, laneId))

  const laneTicketTotal = (laneId: string) =>
    board.value.tickets.filter((ticket) => ticket.laneId === laneId).length

  const editLane = (lane: SwimLane, patch: Partial<Omit<SwimLane, 'id'>>) => {
    void store.updateLane(projectPath.value, lane.id, patch)
  }

  const laneName = (laneId: string) => {
    if (laneId === UNASSIGNED_LANE_ID) return getUnassignedLane(board.value).name
    return board.value.lanes.find((lane) => lane.id === laneId)?.name ?? laneId
  }

  const laneNextLaneId = (laneId: string) => boardLaneById(board.value, laneId)?.nextLaneId ?? ''

  // Next Lane targets for a ticket: No status and every lane, minus the lane the
  // ticket is in (moving to it is a no-op).
  const nextLaneOptionsFor = (currentLaneId: string) =>
    laneColumns.value.filter((lane) => lane.id !== currentLaneId)

  // A ticket's prompt is built from its own lane, so the same ticket produces a
  // different instruction once it moves column.
  const laneOfTicket = (ticket: Ticket) => currentLaneOf(board.value, ticket)

  const promptContext = (ticket: Ticket) => ({
    assigneeName: ticket.assigneeId ? assigneeName(ticket.assigneeId) : undefined,
    projectPath: projectPath.value
  })

  // An unconfigured lane follows the Open In picker when that is a terminal, so
  // the first click uses a terminal the user is known to have.
  const autoRunTerminal = (lane: SwimLane) => resolveAutoRunTerminal(lane.autoRunTerminalId, openInStore.selectedId)

  const orchestratorContextFor = (terminal: OpenInTarget): OrchestratorPromptContext => ({
    projectPath: projectPath.value,
    lanes: [...board.value.lanes, getUnassignedLane(board.value)],
    terminalId: terminal.id,
    terminalLabel: terminal.label
  })

  return {
    store,
    openInStore,
    projectPath,
    project,
    board,
    laneColumns,
    users,
    assigneeName,
    agents,
    preferences,
    savePreferences,
    laneIsHidden,
    toggleLaneVisibility,
    laneTicketTotal,
    editLane,
    laneName,
    laneNextLaneId,
    nextLaneOptionsFor,
    laneOfTicket,
    promptContext,
    autoRunTerminal,
    orchestratorContextFor
  }
}
