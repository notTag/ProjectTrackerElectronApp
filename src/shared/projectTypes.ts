export type ProjectStatus = 'active' | 'ongoing' | 'paused' | 'completed' | 'archived' | 'hidden' | 'unknown'

export type ProjectPriority = 'high' | 'medium' | 'low' | 'none'

export type ProjectSource = 'first-party' | 'third-party'

export interface ProjectGithubData {
  defaultBranch: string
  openIssues: number
  stars: number
  forks: number
  description?: string
  pushedAt?: string
  fetchedAt: string
}

export interface ProjectRecord {
  path: string
  name: string
  status: ProjectStatus
  priority: ProjectPriority
  notes: string
  source: ProjectSource
  packageManager?: string
  githubUrl?: string
  github?: ProjectGithubData
  hasGit: boolean
  hasPackageJson: boolean
  hasReadme: boolean
  lastModifiedAt?: string
  lastScannedAt: string
}

export interface ProjectSnapshot {
  projects: ProjectRecord[]
  scannedAt?: string
  failures: ScanFailure[]
}

// One local user today. Every persisted row carries a user id so multi-user is a
// matter of adding rows, not reshaping tables.
export const DEFAULT_USER_ID = 'local'
export const DEFAULT_USER_NAME = 'Local'

export interface User {
  id: string
  name: string
}

export interface ProjectTrackerState {
  // Who this app instance is acting as. Projects and tickets are shared, so this
  // identifies the assignee, not an owner of the data.
  userId: string
  users: User[]
  version: number
  updatedAt: string
  scanDirectories: string[]
  hiddenPaths: string[]
  thirdPartyPaths: string[]
  snapshot: ProjectSnapshot
  // Keyed by project path. Optional so state saved before boards existed still loads.
  boards?: Record<string, ProjectBoard>
  // Also keyed by project path, but per-user rather than shared — see BoardPreferences.
  boardPreferences?: Record<string, BoardPreferences>
  // Extra agents offered on every board beside DEFAULT_AGENT. Optional and empty
  // by default — see availableAgents.
  agents?: Agent[]
}

export interface ScanFailure {
  path: string
  message: string
}

export interface ScanResult {
  snapshot: ProjectSnapshot
  failures: ScanFailure[]
}

export const createSeedState = (): ProjectTrackerState => ({
  userId: DEFAULT_USER_ID,
  users: [{ id: DEFAULT_USER_ID, name: DEFAULT_USER_NAME }],
  version: 1,
  updatedAt: new Date().toISOString(),
  scanDirectories: [],
  hiddenPaths: [],
  thirdPartyPaths: [],
  snapshot: {
    scannedAt: undefined,
    failures: [],
    projects: [
      {
        path: '/Users/example/Projects/sample-app',
        name: 'sample-app',
        status: 'unknown',
        priority: 'none',
        notes: 'Seed project shown until your first scan succeeds.',
        source: 'first-party',
        packageManager: 'npm',
        githubUrl: 'https://github.com/example/sample-app',
        hasGit: true,
        hasPackageJson: true,
        hasReadme: true,
        lastModifiedAt: undefined,
        lastScannedAt: new Date().toISOString()
      }
    ]
  }
})

export const mergeScannedProjects = (
  previous: ProjectTrackerState,
  scannedProjects: ProjectRecord[],
  failures: ScanFailure[]
): ProjectTrackerState => {
  const existingByPath = new Map(previous.snapshot.projects.map((project) => [project.path, project]))
  const projects = scannedProjects.map((project) => {
    const existing = existingByPath.get(project.path)
    return {
      ...project,
      status: existing?.status ?? project.status,
      priority: existing?.priority ?? project.priority,
      notes: existing?.notes ?? project.notes,
      githubUrl: project.githubUrl ?? existing?.githubUrl,
      github: existing?.github ?? project.github
    }
  })

  return {
    ...previous,
    updatedAt: new Date().toISOString(),
    snapshot: {
      scannedAt: new Date().toISOString(),
      projects,
      failures
    }
  }
}

export interface SwimLane {
  id: string
  name: string
  agentPrompt: string
  // Path to a markdown file whose contents supplement agentPrompt. Both are
  // used together when the lane's agent runs; either may be empty.
  agentFilePath: string
  // Free text naming where the agent's work goes: a file, a directory, or a
  // sentence like "a new PRD folder in the project". Optional so lanes saved
  // before it existed still load.
  outputTarget?: string
}

export interface ChecklistItem {
  text: string
  done: boolean
}

// Captures what a swim lane's agent produced for a ticket. Only the most recent
// run is kept: the board is a working surface, not an audit log.
export interface TicketAgentRun {
  at: string
  laneId: string
  output: string
}

export interface Ticket {
  id: string
  // Human-facing ticket number, unique within its board and stable once assigned.
  number: number
  laneId: string
  title: string
  description: string
  createdAt: string
  // Every field below is optional so boards saved before it existed still load
  // unchanged — there is no migration step, only absent values.
  updatedAt?: string
  labels?: string[]
  branchName?: string
  // Who picked this ticket up. Absent means nobody has.
  assigneeId?: string
  checklist?: ChecklistItem[]
  // Which configured agent this ticket is earmarked for. Absent means none has
  // been chosen, which is every ticket until agents exist in state.
  agentId?: string
  agentRun?: TicketAgentRun
  // Set only on tickets imported from GitHub. Doubles as the dedupe key so
  // re-pulling issues updates nothing and duplicates nothing.
  externalId?: string
  externalUrl?: string
}

// Prefilled into a new ticket so descriptions arrive in the shape a lane's agent
// can act on. Discarded on save when left untouched, so an unused template never
// persists as noise.
export const TICKET_DESCRIPTION_TEMPLATE = `## Context

## Acceptance criteria
-

## Out of scope
`

// Labels are typed into a single comma-separated input, so parsing has to
// survive stray whitespace, empty segments, and repeats.
export const parseLabels = (value: string): string[] => {
  const segments = value.split(',')
  const trimmedSegments = segments.map((segment) => segment.trim())
  const nonEmptySegments = trimmedSegments.filter(Boolean)
  return [...new Set(nonEmptySegments)]
}

export const formatLabels = (labels: string[] = []) => labels.join(', ')

export const addChecklistItem = (checklist: ChecklistItem[] = [], text: string): ChecklistItem[] => [
  ...checklist,
  { text, done: false }
]

export const setChecklistItemDone = (
  checklist: ChecklistItem[] = [],
  index: number,
  done: boolean
): ChecklistItem[] => checklist.map((item, itemIndex) => (itemIndex === index ? { ...item, done } : item))

export const removeChecklistItem = (checklist: ChecklistItem[] = [], index: number): ChecklistItem[] =>
  checklist.filter((_, itemIndex) => itemIndex !== index)

export const checklistProgress = (checklist: ChecklistItem[] = []) => {
  const doneItems = checklist.filter((item) => item.done)
  return { done: doneItems.length, total: checklist.length }
}

// Searched as one string so a query matches a ticket by number, prose, label, or
// branch without the caller knowing which field it hit.
export const ticketSearchText = (ticket: Ticket) => {
  const labels = formatLabels(ticket.labels)
  const branchName = ticket.branchName ?? ''
  return `#${ticket.number} ${ticket.title} ${ticket.description} ${labels} ${branchName}`.toLowerCase()
}

// A coding agent a ticket can be handed to. `command` is the CLI that takes the
// prompt as its last argument and runs in the project directory; `headlessArgs`
// go before the prompt when it runs in the background with nobody watching.
export interface Agent {
  id: string
  name: string
  command: string
  headlessArgs: string[]
}

// ponytail: one built-in agent. Agents saved in state are offered alongside it,
// so adding Codex or another CLI is one entry, not a code change.
//
// acceptEdits lets a background run write its output files without a human to
// approve them, while shell commands stay denied — the run can draft, not execute.
export const DEFAULT_AGENT: Agent = {
  id: 'claude-code',
  name: 'Claude Code',
  command: 'claude',
  headlessArgs: ['-p', '--permission-mode', 'acceptEdits']
}

export const availableAgents = (state: Pick<ProjectTrackerState, 'agents'>): Agent[] => [
  DEFAULT_AGENT,
  ...(state.agents ?? []).filter((agent) => agent.id !== DEFAULT_AGENT.id)
]

// A ticket that never picked an agent still runs — with the default — so the
// hand-off works before anyone touches the picker.
export const agentForTicket = (ticket: Ticket, agents: Agent[]): Agent =>
  agents.find((agent) => agent.id === ticket.agentId) ?? DEFAULT_AGENT

export interface TicketPromptContext {
  assigneeName?: string
}

// Only fields that carry a value become lines, so a bare ticket stays a short
// prompt instead of a column of "none"s.
const ticketMetadataLines = (ticket: Ticket, lane: SwimLane, context: TicketPromptContext): string => {
  const checklistLines = (ticket.checklist ?? []).map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)
  const lines = [
    `Ticket #${ticket.number}: ${ticket.title}`,
    `Status: ${lane.name}`,
    context.assigneeName ? `Assignee: ${context.assigneeName}` : '',
    ticket.labels?.length ? `Labels: ${formatLabels(ticket.labels)}` : '',
    ticket.branchName ? `Branch: ${ticket.branchName}` : '',
    ticket.externalUrl ? `Source: ${ticket.externalUrl}` : '',
    checklistLines.length ? ['Checklist:', ...checklistLines].join('\n') : ''
  ]
  return lines.filter(Boolean).join('\n')
}

// Stated as a standing permission because the agent would otherwise stop to ask
// whether writing into an existing folder is OK — the lane already answered that.
const outputInstruction = (outputTarget: string) =>
  [
    `Output: ${outputTarget}`,
    'Put your work there. Paths are relative to the project directory unless absolute. ' +
      'If that location already exists, use it as-is without asking; otherwise create it.'
  ].join('\n')

// The lane prompt comes first because it is the standing instruction for every
// ticket in that column; the ticket is the specific work it applies to, and the
// output location closes it out as the last thing the agent reads.
export const ticketAgentPrompt = (ticket: Ticket, lane: SwimLane, context: TicketPromptContext = {}): string => {
  const lanePrompt = lane.agentPrompt.trim()
  const laneFilePath = lane.agentFilePath.trim()
  const laneFileReference = laneFilePath ? `Follow the guidance in ${laneFilePath}.` : ''
  const ticketMetadata = ticketMetadataLines(ticket, lane, context)
  const ticketDescription = ticket.description.trim()
  const outputTarget = lane.outputTarget?.trim() ?? ''
  const output = outputTarget ? outputInstruction(outputTarget) : ''
  const sections = [lanePrompt, laneFileReference, ticketMetadata, ticketDescription, output]
  return sections.filter(Boolean).join('\n\n')
}

// Single quotes are the only POSIX quoting that leaves the contents completely
// literal, so a prompt full of backticks, $ and newlines survives intact. An
// embedded quote cannot appear inside them at all — it has to close the string,
// escape itself, and reopen it.
export const shellQuote = (value: string): string => {
  const escapedQuotes = value.split("'").join(`'\\''`)
  return `'${escapedQuotes}'`
}

export const ticketShellCommand = (
  ticket: Ticket,
  lane: SwimLane,
  agent: Agent = DEFAULT_AGENT,
  context: TicketPromptContext = {}
): string => {
  const prompt = ticketAgentPrompt(ticket, lane, context)
  return `${agent.command} ${shellQuote(prompt)}`
}

export interface GithubIssue {
  number: number
  title: string
  body: string
  htmlUrl: string
}

export interface ProjectBoard {
  lanes: SwimLane[]
  tickets: Ticket[]
  // The unassigned column's own config. Held apart from `lanes` so the column
  // can carry an agent prompt like any other lane while staying undeletable —
  // it is the fallback every orphaned ticket lands in.
  unassignedLane?: SwimLane
}

const DEFAULT_LANE_NAMES = ['Idea', 'PRD', 'In Development', 'In PR', 'In Dev', 'In QA', 'In Production']

const laneIdFromName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

// Tickets with no status live under a lane id that is never stored in
// board.lanes — the board renders it as a virtual column, so it cannot be
// renamed, configured or deleted out from under its tickets.
export const UNASSIGNED_LANE_ID = 'unassigned'
export const UNASSIGNED_LANE_NAME = 'No status'

// Ids are derived from the lane name, never random: a board that has not been
// saved yet is rebuilt on every read, and random ids would hand out a different
// id each time — tickets written against one read would point at lanes that no
// longer exist by the next read.
export const createUnassignedLane = (): SwimLane => ({
  id: UNASSIGNED_LANE_ID,
  name: UNASSIGNED_LANE_NAME,
  agentPrompt: '',
  agentFilePath: ''
})

export const getUnassignedLane = (board: ProjectBoard): SwimLane =>
  board.unassignedLane ?? createUnassignedLane()

// Routes a lane edit to wherever that lane lives: the unassigned column is
// stored on its own field, every other lane in `lanes`.
export const updateLaneInBoard = (
  board: ProjectBoard,
  laneId: string,
  patch: Partial<Omit<SwimLane, 'id'>>
): ProjectBoard => {
  if (laneId === UNASSIGNED_LANE_ID) {
    return { ...board, unassignedLane: { ...getUnassignedLane(board), ...patch } }
  }
  return {
    ...board,
    lanes: board.lanes.map((lane) => (lane.id === laneId ? { ...lane, ...patch } : lane))
  }
}

export const createDefaultBoard = (): ProjectBoard => ({
  lanes: DEFAULT_LANE_NAMES.map((name) => ({
    id: laneIdFromName(name),
    name,
    agentPrompt: '',
    agentFilePath: ''
  })),
  tickets: []
})

// Comparing against undefined yields false, so tickets saved before numbering
// existed are simply skipped rather than poisoning the result with NaN.
const highestTicketNumber = (tickets: Ticket[]) =>
  tickets.reduce((highest, ticket) => (ticket.number > highest ? ticket.number : highest), 0)

export const nextTicketNumber = (board: ProjectBoard) => highestTicketNumber(board.tickets) + 1

// Repairs a board on read: tickets whose lane no longer exists fall back to the
// unassigned column rather than rendering nowhere, and tickets saved before
// numbers existed are backfilled. Saving afterwards persists the repair.
export const normalizeBoard = (board: ProjectBoard): ProjectBoard => {
  const knownLaneIds = new Set([...board.lanes.map((lane) => lane.id), UNASSIGNED_LANE_ID])
  const hasOrphans = board.tickets.some((ticket) => !knownLaneIds.has(ticket.laneId))
  const hasUnnumbered = board.tickets.some((ticket) => !(ticket.number > 0))
  if (!hasOrphans && !hasUnnumbered) return board

  let numberToAssign = nextTicketNumber(board)
  const tickets = board.tickets.map((ticket) => {
    const laneId = knownLaneIds.has(ticket.laneId) ? ticket.laneId : UNASSIGNED_LANE_ID
    const number = ticket.number > 0 ? ticket.number : numberToAssign++
    if (laneId === ticket.laneId && number === ticket.number) return ticket
    return { ...ticket, laneId, number }
  })
  return { ...board, tickets }
}

export const addTicketToBoard = (
  board: ProjectBoard,
  input: { laneId: string; title: string; description: string }
): ProjectBoard => ({
  ...board,
  tickets: [
    ...board.tickets,
    { id: crypto.randomUUID(), number: nextTicketNumber(board), createdAt: new Date().toISOString(), ...input }
  ]
})

export const getBoard = (state: ProjectTrackerState, projectPath: string): ProjectBoard =>
  normalizeBoard(state.boards?.[projectPath] ?? createDefaultBoard())

// Deleting a lane never deletes work: its tickets move to the unassigned column,
// which always exists, so this holds even when the last lane is removed.
export const removeLaneFromBoard = (board: ProjectBoard, laneId: string): ProjectBoard => ({
  ...board,
  lanes: board.lanes.filter((lane) => lane.id !== laneId),
  tickets: board.tickets.map((ticket) =>
    ticket.laneId === laneId ? { ...ticket, laneId: UNASSIGNED_LANE_ID } : ticket
  )
})

export const githubIssueExternalId = (issue: GithubIssue) => `github:${issue.number}`

export const GITHUB_IMPORT_LANE_ID = 'github-issues'
export const GITHUB_IMPORT_LANE_NAME = 'GitHub Issues'

// A GitHub issue carries no swim-lane status, so imports land in a dedicated
// lane at the far left instead of guessing. Issues already imported are skipped,
// so pulling repeatedly is safe and never clobbers edits to an imported ticket.
export const addGithubIssuesToBoard = (
  board: ProjectBoard,
  issues: GithubIssue[]
): { board: ProjectBoard; added: number } => {
  const importLaneExists = board.lanes.some((lane) => lane.id === GITHUB_IMPORT_LANE_ID)
  const lanes = importLaneExists
    ? board.lanes
    : [
        { id: GITHUB_IMPORT_LANE_ID, name: GITHUB_IMPORT_LANE_NAME, agentPrompt: '', agentFilePath: '' },
        ...board.lanes
      ]

  const importedIds = new Set(board.tickets.map((ticket) => ticket.externalId).filter(Boolean))
  const newIssues = issues.filter((issue) => !importedIds.has(githubIssueExternalId(issue)))

  const createdAt = new Date().toISOString()
  const firstNumber = nextTicketNumber(board)
  const newTickets: Ticket[] = newIssues.map((issue, index) => ({
    id: crypto.randomUUID(),
    number: firstNumber + index,
    laneId: GITHUB_IMPORT_LANE_ID,
    title: issue.title,
    description: issue.body,
    createdAt,
    externalId: githubIssueExternalId(issue),
    externalUrl: issue.htmlUrl
  }))

  return {
    board: { ...board, lanes, tickets: [...board.tickets, ...newTickets] },
    added: newTickets.length
  }
}

// What a ticket card can show on the board. Ids are persisted, so renaming one
// silently drops that field from every saved preference — add, never rename.
export const TICKET_CARD_FIELDS = [
  { id: 'number', label: 'Ticket number' },
  { id: 'description', label: 'Description' },
  { id: 'assignee', label: 'Assignee' },
  { id: 'labels', label: 'Labels' },
  { id: 'checklist', label: 'Checklist progress' },
  { id: 'branch', label: 'Branch' }
] as const

export type TicketCardField = (typeof TICKET_CARD_FIELDS)[number]['id']

export const DEFAULT_LANE_WIDTH = 260
export const MIN_LANE_WIDTH = 200
export const MAX_LANE_WIDTH = 900

// How one person looks at a shared board: column widths, which columns are
// collapsed away, what a card shows. Kept out of ProjectBoard because none of it
// is the work itself — two people can view the same board differently.
export interface BoardPreferences {
  laneWidths: Record<string, number>
  hiddenLaneIds: string[]
  cardFields: TicketCardField[]
}

export const createDefaultBoardPreferences = (): BoardPreferences => ({
  laneWidths: {},
  hiddenLaneIds: [],
  cardFields: TICKET_CARD_FIELDS.map((field) => field.id)
})

// Spread over the defaults rather than returned as-is, so preferences saved
// before a field existed read back complete instead of undefined.
export const getBoardPreferences = (
  state: ProjectTrackerState,
  projectPath: string
): BoardPreferences => ({
  ...createDefaultBoardPreferences(),
  ...state.boardPreferences?.[projectPath]
})

export const clampLaneWidth = (width: number) =>
  Math.min(MAX_LANE_WIDTH, Math.max(MIN_LANE_WIDTH, Math.round(width)))

const toggleInList = <T>(values: T[], value: T): T[] =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]

export const toggleHiddenLane = (preferences: BoardPreferences, laneId: string): BoardPreferences => ({
  ...preferences,
  hiddenLaneIds: toggleInList(preferences.hiddenLaneIds, laneId)
})

export const toggleCardField = (preferences: BoardPreferences, field: TicketCardField): BoardPreferences => ({
  ...preferences,
  cardFields: toggleInList(preferences.cardFields, field)
})

export const setLaneWidth = (
  preferences: BoardPreferences,
  laneId: string,
  width: number
): BoardPreferences => ({
  ...preferences,
  laneWidths: { ...preferences.laneWidths, [laneId]: clampLaneWidth(width) }
})
