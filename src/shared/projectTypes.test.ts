import { describe, expect, it, vi } from 'vitest'

import {
  GITHUB_UNREACHABLE_MESSAGE,
  githubErrorMessage,
  isGithubUnreachableError,
  normalizeSemanticVersion,
  boardWrites,
  graphPositionRightOf,
  keepParkedLaneIds,
  laneGraphPosition,
  shellQuote,
  agentRunBadge,
  hasUnseenAgentResult,
  buildAutoRunLaunch,
  buildOrchestratorLaunch,
  orchestratorAgentChoice,
  agentShellCommand,
  orchestratorPrompt,
  orchestratorPromptMissingTokens,
  orchestratorPromptTemplate,
  defaultOrchestratorPrompt,
  APP_ORCHESTRATOR_PROMPT_PATCH,
  orchestratorPromptTokenHelp,
  ORCHESTRATOR_PROMPT_TOKENS,
  orchestratorTabTitle,
  TRACKER_DATABASE_PATH,
  completionMoves,
  isReadyToMove,
  effectiveNextLaneId,
  createUnassignedLane,
  laneTransitions,
  fullAutoHandoffs,
  isFullAuto,
  autoRunUsesWorktrees,
  syncGithubIssuesToBoard,
  githubSyncNotice,
  oldestImportedCreatedAt,
  type GithubClosedIssue,
  laneFolderName,
  promptRules,
  rulesToPrompt,
  addScanDirectory,
  addTicketToBoard,
  mergeScannedProjects,
  removeScanDirectory,
  type ProjectRecord,
  createDefaultBoard,
  createSeedState,
  getBoard,
  moveLaneInBoard,
  removeLaneFromBoard,
  workflowNameProblem,
  getUnassignedLane,
  boardLaneColumns,
  normalizeBoard,
  nextTicketNumber,
  updateLaneInBoard,
  UNASSIGNED_LANE_ID,
  addChecklistItem,
  compareLaneOrder,
  groupTicketsByLane,
  placeTicketsInLane,
  clearStaleLanePositions,
  carriedTicketIds,
  ticketsToRun,
  splitRunnable,
  skippedRunsNotice,
  joinNotices,
  agentForTicket,
  availableAgents,
  DEFAULT_AGENT,
  ticketAgentPrompt,
  ticketBranchName,
  ticketTabTitle,
  ticketSessionName,
  laneTitleToken,
  currentLaneOf,
  ticketShellCommand,
  type SwimLane,
  type Ticket,
  checklistProgress,
  parseLabels,
  removeChecklistItem,
  addExternalLink,
  removeExternalLink,
  setChecklistItemDone,
  ticketSearchText,
  GITHUB_IMPORT_LANE_ID,
  createDefaultBoardPreferences,
  getBoardPreferences,
  setLaneWidth,
  toggleCardField,
  toggleModalField,
  toggleFilterControl,
  toggleLaneModalField,
  toggleLaneModalFieldInLane,
  toggleHiddenLane,
  MAX_LANE_WIDTH,
  MIN_LANE_WIDTH,
  TICKET_CARD_FIELDS,
  LANE_MODAL_FIELDS,
  isWebUrl,
  pullRequestLabel,
  isPullRequestSettled,
  pullRequestStatusLabel,
  toPullRequestStatus,
  worktreeFolderName,
  steppedOrchestratorPoll,
  type BoardPreferences,
  type ProjectTrackerState,
  type GithubIssue,
  type ProjectBoard
} from './projectTypes'

const boardWithTickets = (): ProjectBoard => ({
  lanes: [
    { id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '' },
    { id: 'prd', name: 'PRD', agentPrompt: 'Write a PRD with goals and acceptance criteria.', agentFilePath: '' }
  ],
  tickets: [
    { id: 'a', number: 1, laneId: 'idea', title: 'A', description: '', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', number: 2, laneId: 'prd', title: 'B', description: '', createdAt: '2026-01-01T00:00:00.000Z' }
  ]
})

describe('removeLaneFromBoard', () => {
  it('moves the deleted lane\'s tickets to the unassigned column, keeping the rest put', () => {
    const board = removeLaneFromBoard(boardWithTickets(), 'idea')
    expect(board.lanes.map((lane) => lane.id)).toEqual(['prd'])
    expect(board.tickets.map((ticket) => ticket.laneId)).toEqual([UNASSIGNED_LANE_ID, 'prd'])
  })

  it('keeps the tickets when the last lane is removed', () => {
    const single: ProjectBoard = {
      lanes: [{ id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '' }],
      tickets: [
        { id: 'a', number: 1, laneId: 'idea', title: 'A', description: '', createdAt: '2026-01-01T00:00:00.000Z' }
      ]
    }
    const board = removeLaneFromBoard(single, 'idea')
    expect(board.lanes).toEqual([])
    expect(board.tickets.map((ticket) => ticket.laneId)).toEqual([UNASSIGNED_LANE_ID])
  })

  it('leaves lanes and tickets alone when the id matches nothing', () => {
    const board = boardWithTickets()
    expect(removeLaneFromBoard(board, 'nope')).toEqual(board)
  })
})

describe('moveLaneInBoard', () => {
  const lane = (id: string): SwimLane => ({ id, name: id, agentPrompt: '', agentFilePath: '' })
  const boardOf = (...laneIds: string[]): ProjectBoard => ({
    lanes: laneIds.map(lane),
    tickets: [
      { id: 't', number: 1, laneId: 'c', title: 'T', description: '', createdAt: '2026-01-01T00:00:00.000Z' }
    ]
  })
  const laneOrder = (board: ProjectBoard) => board.lanes.map((entry) => entry.id)

  it('moves a lane left, before an earlier lane', () => {
    expect(laneOrder(moveLaneInBoard(boardOf('a', 'b', 'c'), 'c', 'a'))).toEqual(['c', 'a', 'b'])
  })

  it('moves a lane right, before a later lane', () => {
    expect(laneOrder(moveLaneInBoard(boardOf('a', 'b', 'c', 'd'), 'a', 'c'))).toEqual(['b', 'a', 'c', 'd'])
  })

  it('moves a lane to the end when there is no anchor', () => {
    expect(laneOrder(moveLaneInBoard(boardOf('a', 'b', 'c'), 'a', null))).toEqual(['b', 'c', 'a'])
  })

  it('keeps a hidden lane in its slot when the view only sees the others', () => {
    // The view sees [a, b, c]; gh is hidden. Dropping c before a must not
    // displace gh, which an index-based move would.
    expect(laneOrder(moveLaneInBoard(boardOf('gh', 'a', 'b', 'c'), 'c', 'a'))).toEqual(['gh', 'c', 'a', 'b'])
  })

  it('puts the lane first when dropped before No status', () => {
    expect(laneOrder(moveLaneInBoard(boardOf('a', 'b', 'c'), 'c', UNASSIGNED_LANE_ID))).toEqual(['c', 'a', 'b'])
  })

  it('returns the same board when nothing would move', () => {
    const board = boardOf('a', 'b', 'c')
    expect(moveLaneInBoard(board, 'b', 'b')).toBe(board)
    expect(moveLaneInBoard(board, 'b', 'c')).toBe(board)
    expect(moveLaneInBoard(board, 'c', null)).toBe(board)
    expect(moveLaneInBoard(board, 'nope', 'a')).toBe(board)
    expect(moveLaneInBoard(board, UNASSIGNED_LANE_ID, 'a')).toBe(board)
  })

  it('leaves tickets where they are', () => {
    const board = boardOf('a', 'b', 'c')
    expect(moveLaneInBoard(board, 'c', 'a').tickets).toBe(board.tickets)
  })
})

describe('getBoard', () => {
  it('returns default lanes for a project that has no board yet', () => {
    const board = getBoard(createSeedState(), '/Users/example/Projects/sample-app')
    expect(board.lanes.map((lane) => lane.name)).toEqual(createDefaultBoard().lanes.map((lane) => lane.name))
    expect(board.tickets).toEqual([])
  })
})


describe("syncGithubIssuesToBoard", () => {
  const issues: GithubIssue[] = [
    { number: 1, title: 'Fix login', body: 'Steps to reproduce', htmlUrl: 'https://github.com/o/r/issues/1' },
    { number: 2, title: 'Add export', body: '', htmlUrl: 'https://github.com/o/r/issues/2' }
  ]

  it('creates the import lane at the far left and files every issue in it', () => {
    const { board, added } = syncGithubIssuesToBoard(boardWithTickets(), { open: issues, closed: [] })
    expect(added).toBe(2)
    expect(board.lanes[0].id).toBe(GITHUB_IMPORT_LANE_ID)
    const imported = board.tickets.filter((ticket) => ticket.externalId)
    expect(imported.map((ticket) => ticket.title)).toEqual(['Fix login', 'Add export'])
    expect(imported.every((ticket) => ticket.laneId === GITHUB_IMPORT_LANE_ID)).toBe(true)
  })

  it('reuses the existing import lane on later pulls', () => {
    const first = syncGithubIssuesToBoard(boardWithTickets(), { open: issues, closed: [] })
    const second = syncGithubIssuesToBoard(first.board, { open: issues, closed: [] })
    expect(second.added).toBe(0)
    expect(second.board.lanes.filter((lane) => lane.id === GITHUB_IMPORT_LANE_ID)).toHaveLength(1)
    expect(second.board.tickets).toHaveLength(first.board.tickets.length)
  })
})


describe('syncing imported tickets with closed GitHub issues', () => {
  const lanes = [
    { id: 'github-issues', name: 'GitHub Issues', agentPrompt: '', agentFilePath: '' },
    { id: 'in-dev', name: 'In Dev', agentPrompt: '', agentFilePath: '', closesTicket: true },
    { id: 'in-production', name: 'In Prod Env', agentPrompt: '', agentFilePath: '', closesTicket: true }
  ]
  const importedTicket = (issueNumber: number, extra: Partial<Ticket> = {}): Ticket => ({
    id: `t${issueNumber}`,
    number: issueNumber,
    laneId: 'github-issues',
    title: `Issue ${issueNumber}`,
    description: '',
    createdAt: '2026-02-01T00:00:00.000Z',
    externalId: `github:${issueNumber}`,
    ...extra
  })
  const closed = (issueNumber: number, stateReason: string | null): GithubClosedIssue => ({
    number: issueNumber,
    title: 'From GitHub',
    body: '',
    htmlUrl: `https://github.com/o/r/issues/${issueNumber}`,
    stateReason
  })
  const boardOf = (...tickets: Ticket[]): ProjectBoard => ({ lanes, tickets })

  it('moves a completed issue to the rightmost closing lane', () => {
    const board = boardOf(importedTicket(1))
    const issues = { open: [], closed: [closed(1, 'completed')] }
    vi.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z'), toFake: ['Date'] })
    let result
    try {
      result = syncGithubIssuesToBoard(board, issues)
    } finally {
      vi.useRealTimers()
    }
    expect(result.moved).toBe(1)
    expect(result.board.tickets[0].laneId).toBe('in-production')
    expect(result.board.tickets[0].updatedAt).toBe('2030-01-01T00:00:00.000Z')
  })

  it('removes tickets closed as not planned, duplicate, or with no reason', () => {
    const board = boardOf(importedTicket(1), importedTicket(2), importedTicket(3))
    const closedIssues = [closed(1, 'not_planned'), closed(2, 'duplicate'), closed(3, null)]
    const result = syncGithubIssuesToBoard(board, { open: [], closed: closedIssues })
    expect(result.removed).toBe(3)
    expect(result.board.tickets).toEqual([])
  })

  it('keeps a not-planned ticket that has local work and counts it', () => {
    const withWork = importedTicket(1, { worktreePath: '/wt/t1' })
    const withPullRequest = importedTicket(2, { pullRequestUrl: 'https://github.com/o/r/pull/9' })
    const closedIssues = [closed(1, 'not_planned'), closed(2, 'not_planned')]
    const result = syncGithubIssuesToBoard(boardOf(withWork, withPullRequest), { open: [], closed: closedIssues })
    expect(result.keptWithWork).toBe(2)
    expect(result.removed).toBe(0)
    expect(result.board.tickets).toHaveLength(2)
  })

  it('does not re-move a ticket already in production', () => {
    const ticket = importedTicket(1, { laneId: 'in-production' })
    const result = syncGithubIssuesToBoard(boardOf(ticket), { open: [], closed: [closed(1, 'completed')] })
    expect(result.moved).toBe(0)
    expect(result.board.tickets[0]).toBe(ticket)
  })

  it('leaves a completed ticket in place when no lane closes tickets', () => {
    const board: ProjectBoard = { lanes: [lanes[0]], tickets: [importedTicket(1)] }
    const result = syncGithubIssuesToBoard(board, { open: [], closed: [closed(1, 'completed')] })
    expect(result.moved).toBe(0)
    expect(result.board.tickets[0].laneId).toBe('github-issues')
  })

  it('never clobbers local edits to a still-open issue', () => {
    const edited = importedTicket(1, { title: 'Renamed locally', laneId: 'in-dev' })
    const openIssue = { number: 1, title: 'GitHub title', body: 'GitHub body', htmlUrl: 'https://github.com/o/r/issues/1' }
    const result = syncGithubIssuesToBoard(boardOf(edited), { open: [openIssue], closed: [] })
    expect(result.board.tickets).toEqual([edited])
    expect(result.added + result.moved + result.removed).toBe(0)
  })

  it('leaves a reopened issue in production untouched', () => {
    const shipped = importedTicket(1, { laneId: 'in-production' })
    const openIssue = { number: 1, title: 'Reopened', body: '', htmlUrl: 'https://github.com/o/r/issues/1' }
    const result = syncGithubIssuesToBoard(boardOf(shipped), { open: [openIssue], closed: [] })
    expect(result.board.tickets).toEqual([shipped])
  })

  it('starts the closed fetch at the oldest imported ticket, or skips it', () => {
    const older = importedTicket(1, { createdAt: '2026-01-05T00:00:00.000Z' })
    expect(oldestImportedCreatedAt(boardOf(importedTicket(2), older))).toBe('2026-01-05T00:00:00.000Z')
    expect(oldestImportedCreatedAt(boardWithTickets())).toBeUndefined()
  })

  it('reports every non-zero count in the notice', () => {
    const context = (openCount: number) => ({ openCount, productionLaneName: 'In Prod Env', projectName: 'app' })
    const result = { board: boardOf(), added: 2, moved: 1, removed: 1, keptWithWork: 1 }
    expect(githubSyncNotice(result, context(2))).toBe(
      'Imported 2 issues into app, moved 1 to In Prod Env, removed 1 closed, kept 1 closed with local work.'
    )
    const unchanged = { board: boardOf(), added: 0, moved: 0, removed: 0, keptWithWork: 0 }
    expect(githubSyncNotice(unchanged, context(3))).toBe('Imported 0 issues into app (3 already on the board).')
    const syncOnly = { board: boardOf(), added: 0, moved: 1, removed: 0, keptWithWork: 0 }
    expect(githubSyncNotice(syncOnly, context(0))).toBe('app: Moved 1 to In Prod Env.')
  })
})


describe('createDefaultBoard', () => {
  it('gives the same lane ids on every call so unsaved boards stay stable', () => {
    expect(createDefaultBoard().lanes.map((lane) => lane.id)).toEqual(
      createDefaultBoard().lanes.map((lane) => lane.id)
    )
  })
})

describe('normalizeBoard', () => {
  it('re-homes tickets whose lane no longer exists', () => {
    const orphaned: ProjectBoard = {
      lanes: [{ id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '' }],
      tickets: [
        { id: 'a', number: 1, laneId: 'gone', title: 'A', description: '', createdAt: '2026-01-01T00:00:00.000Z' }
      ]
    }
    expect(normalizeBoard(orphaned).tickets[0].laneId).toBe(UNASSIGNED_LANE_ID)
  })

  it('parks a deleted lane’s tickets when another workflow may still hold the lane', () => {
    const board: ProjectBoard = {
      lanes: [{ id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '' }],
      tickets: [{ id: 'a', number: 1, laneId: 'idea', title: 'A', description: '', createdAt: '2026-01-01T00:00:00.000Z' }]
    }
    const withWorkflows = { ...board, workflows: [{ id: 'default', name: 'Development Workflow' }, { id: 'w2', name: 'Hotfix' }] }
    expect(removeLaneFromBoard(board, 'idea').tickets[0].laneId).toBe(UNASSIGNED_LANE_ID)
    expect(removeLaneFromBoard(withWorkflows, 'idea').tickets[0].laneId).toBe('idea')
  })

  it('requires a workflow name that no other workflow uses, ignoring case and spaces', () => {
    const existing = [{ id: 'default', name: 'Development Workflow' }]
    expect(workflowNameProblem('  ', existing)).toBe('Name the workflow.')
    expect(workflowNameProblem(' development workflow ', existing)).toBe('A workflow with that name already exists.')
    expect(workflowNameProblem('Hotfix', existing)).toBe('')
  })

  it('writes no lane change for a ticket parked in another workflow’s lane', () => {
    const parked: ProjectBoard = {
      lanes: [{ id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '' }],
      tickets: [
        { id: 'a', number: 1, laneId: 'qa', title: 'A', description: '', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'b', number: 2, laneId: 'qa', title: 'B', description: '', createdAt: '2026-01-01T00:00:00.000Z' }
      ]
    }
    const normalized = normalizeBoard(parked)
    const edited = {
      ...normalized,
      tickets: normalized.tickets.map((ticket) => (ticket.id === 'a' ? { ...ticket, title: 'A2' } : { ...ticket, laneId: 'idea' }))
    }
    const kept = keepParkedLaneIds(parked, edited)
    expect(kept.tickets.map((ticket) => ticket.laneId)).toEqual(['qa', 'idea'])
    expect(boardWrites(parked, kept).map((write) => write.kind === 'ticket:update' && write.patch)).toEqual([
      { title: 'A2', updatedAt: undefined },
      { laneId: 'idea', updatedAt: undefined }
    ])
  })

  it('leaves a board whose tickets all have real lanes untouched', () => {
    const board = boardWithTickets()
    expect(normalizeBoard(board)).toBe(board)
  })
})


const removeLaneByReference = (board: ProjectBoard, lane: { id: string }) => removeLaneFromBoard(board, lane.id)

describe('pulling issues onto a board with every lane deleted', () => {
  it('recreates the import lane and re-imports every issue', () => {
    const emptied = boardWithTickets().lanes.reduce(removeLaneByReference, boardWithTickets())
    expect(emptied.lanes).toEqual([])
    // Deleting every lane strands the tickets in the unassigned column; none are lost.
    expect(emptied.tickets.map((ticket) => ticket.laneId)).toEqual([UNASSIGNED_LANE_ID, UNASSIGNED_LANE_ID])

    const issues: GithubIssue[] = [
      { number: 7, title: 'Fix login', body: '', htmlUrl: 'https://github.com/o/r/issues/7' }
    ]
    const { board, added } = syncGithubIssuesToBoard(emptied, { open: issues, closed: [] })
    expect(added).toBe(1)
    expect(board.lanes.map((lane) => lane.id)).toEqual([GITHUB_IMPORT_LANE_ID])
    expect(board.tickets.at(-1)?.laneId).toBe(GITHUB_IMPORT_LANE_ID)
    expect(getBoard({ ...createSeedState(), boards: { '/p': board } }, '/p').tickets).toHaveLength(3)
  })
})

describe('ticket numbering', () => {
  it('hands the next number to each new ticket', () => {
    const board = addTicketToBoard(boardWithTickets(), { laneId: 'idea', title: 'C', description: '' })
    expect(board.tickets.at(-1)?.number).toBe(3)
    expect(nextTicketNumber(board)).toBe(4)
  })

  it('stores a new ticket\'s Next Lane override and armed state', () => {
    const input = { laneId: 'idea', title: 'C', description: '', moveToLaneId: 'prd', moveOnComplete: true }
    const board = addTicketToBoard(boardWithTickets(), input)
    expect(board.tickets.at(-1)).toMatchObject({ moveToLaneId: 'prd', moveOnComplete: true })
  })

  it('numbers imported issues sequentially after existing tickets', () => {
    const issues: GithubIssue[] = [
      { number: 90, title: 'One', body: '', htmlUrl: 'https://github.com/o/r/issues/90' },
      { number: 91, title: 'Two', body: '', htmlUrl: 'https://github.com/o/r/issues/91' }
    ]
    const { board } = syncGithubIssuesToBoard(boardWithTickets(), { open: issues, closed: [] })
    expect(board.tickets.map((ticket) => ticket.number)).toEqual([1, 2, 3, 4])
  })

  it('backfills numbers on tickets saved before numbering existed', () => {
    const legacy = {
      lanes: [{ id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '' }],
      tickets: [
        { id: 'a', laneId: 'idea', title: 'A', description: '', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'b', number: 5, laneId: 'idea', title: 'B', description: '', createdAt: '2026-01-01T00:00:00.000Z' }
      ]
    } as unknown as ProjectBoard
    expect(normalizeBoard(legacy).tickets.map((ticket) => ticket.number)).toEqual([6, 5])
  })
})

describe('parseLabels', () => {
  it('trims, drops empties, and dedupes', () => {
    expect(parseLabels(' bug , ui,, bug ,')).toEqual(['bug', 'ui'])
  })

  it('returns nothing for an empty input', () => {
    expect(parseLabels('   ')).toEqual([])
  })
})

describe('checklist helpers', () => {
  it('adds, toggles, and removes without mutating the original', () => {
    const original = addChecklistItem(undefined, 'write test')
    const withSecond = addChecklistItem(original, 'ship it')
    const toggled = setChecklistItemDone(withSecond, 0, true)

    expect(original).toEqual([{ text: 'write test', done: false }])
    expect(toggled.map((item) => item.done)).toEqual([true, false])
    expect(checklistProgress(toggled)).toEqual({ done: 1, total: 2 })
    expect(removeChecklistItem(toggled, 0)).toEqual([{ text: 'ship it', done: false }])
  })

  it('treats a ticket with no checklist as empty', () => {
    expect(checklistProgress(undefined)).toEqual({ done: 0, total: 0 })
  })
})

describe('external link helpers', () => {
  it('appends a trimmed http(s) link, treating no links as empty', () => {
    const first = addExternalLink(undefined, '  https://figma.com/file/1  ')
    expect(first).toEqual(['https://figma.com/file/1'])
    expect(addExternalLink(first, 'http://example.com')).toEqual(['https://figma.com/file/1', 'http://example.com'])
  })

  it('returns the same list for invalid or duplicate links', () => {
    const links = ['https://a.dev']
    for (const rejected of ['ftp://a.dev', 'javascript:alert(1)', 'a.dev', '   ', ' https://a.dev ']) {
      expect(addExternalLink(links, rejected)).toBe(links)
    }
  })

  it('removes by index and keeps the rest in order', () => {
    expect(removeExternalLink(['https://a', 'https://b', 'https://c'], 1)).toEqual(['https://a', 'https://c'])
  })
})

describe('ticketSearchText', () => {
  it('matches on number, labels, and branch as well as prose', () => {
    const ticket = {
      ...boardWithTickets().tickets[0],
      title: 'Fix drag',
      labels: ['ui'],
      branchName: 'fix/drag-drop'
    }
    const searchText = ticketSearchText(ticket)
    for (const term of ['#1', 'fix drag', 'ui', 'fix/drag-drop']) expect(searchText).toContain(term)
  })
})


describe('boardLaneColumns', () => {
  const columnIds = (board: ProjectBoard) => boardLaneColumns(board).map((lane) => lane.id)

  it('lists No status first, then every lane in board order', () => {
    const board = boardWithTickets()
    const laneIds = board.lanes.map((lane) => lane.id)
    expect(columnIds(board)).toEqual([UNASSIGNED_LANE_ID, ...laneIds])
  })

  it('includes a lane added to the board, last', () => {
    const board = boardWithTickets()
    const addedLane = { ...board.lanes[0], id: 'added', name: 'Added' }
    const grown = { ...board, lanes: [...board.lanes, addedLane] }
    expect(columnIds(grown).at(-1)).toBe('added')
  })

  it('still starts with No status when the board never stored one', () => {
    const board = { ...boardWithTickets(), unassignedLane: undefined }
    expect(columnIds(board)[0]).toBe(UNASSIGNED_LANE_ID)
  })
})

describe('updateLaneInBoard', () => {
  it('stores the unassigned column\'s prompt without adding it to lanes', () => {
    const board = updateLaneInBoard(boardWithTickets(), UNASSIGNED_LANE_ID, { agentPrompt: 'Triage this.' })
    expect(board.lanes.map((lane) => lane.id)).toEqual(['idea', 'prd'])
    expect(getUnassignedLane(board).agentPrompt).toBe('Triage this.')
  })

  it('survives a delete-every-lane round trip', () => {
    const configured = updateLaneInBoard(boardWithTickets(), UNASSIGNED_LANE_ID, { agentPrompt: 'Triage this.' })
    const emptied = configured.lanes.reduce(removeLaneByReference, configured)
    expect(getUnassignedLane(emptied).agentPrompt).toBe('Triage this.')
  })

  it('patches a normal lane in place', () => {
    const board = updateLaneInBoard(boardWithTickets(), 'prd', { agentFilePath: '/tmp/prd.md' })
    expect(board.lanes[1].agentFilePath).toBe('/tmp/prd.md')
    expect(board.unassignedLane).toBeUndefined()
  })
})

describe('board preferences', () => {
  const stateWith = (preferences: Partial<BoardPreferences>): ProjectTrackerState => ({
    ...createSeedState(),
    boardPreferences: { '/repo': preferences as BoardPreferences }
  })

  it('fills in fields missing from preferences saved before they existed', () => {
    const preferences = getBoardPreferences(stateWith({ hiddenLaneIds: ['github-issues'] }), '/repo')
    expect(preferences.hiddenLaneIds).toEqual(['github-issues'])
    expect(preferences.laneWidths).toEqual({})
    expect(preferences.cardFields).toContain('description')
  })

  it('defaults an unknown project to every card field visible and nothing hidden', () => {
    const preferences = getBoardPreferences(createSeedState(), '/never-opened')
    expect(preferences.hiddenLaneIds).toEqual([])
    expect(preferences.cardFields).toHaveLength(TICKET_CARD_FIELDS.length)
  })

  it('shows card fields added since the preferences were saved, keeping ones switched off', () => {
    const savedBeforeTracking = getBoardPreferences(stateWith({ cardFields: ['number', 'branch'] }), '/repo')
    expect(savedBeforeTracking.cardFields).toEqual(['number', 'branch', 'worktree', 'pullRequest', 'version'])

    const switchedOffAfterTracking = toggleCardField(savedBeforeTracking, 'worktree')
    const reread = getBoardPreferences(stateWith(switchedOffAfterTracking), '/repo')
    expect(reread.cardFields).not.toContain('worktree')
    expect(reread.cardFields).toContain('pullRequest')
  })

  it('shows the version field on preferences saved before it shipped', () => {
    const savedBeforeVersion = stateWith({
      cardFields: ['number'],
      knownCardFields: ['number', 'description', 'assignee', 'labels', 'checklist', 'branch', 'worktree', 'pullRequest']
    })
    expect(getBoardPreferences(savedBeforeVersion, '/repo').cardFields).toEqual(['number', 'version'])
  })

  it('toggles a lane out of view and back', () => {
    const hidden = toggleHiddenLane(createDefaultBoardPreferences(), 'github-issues')
    expect(hidden.hiddenLaneIds).toEqual(['github-issues'])
    expect(toggleHiddenLane(hidden, 'github-issues').hiddenLaneIds).toEqual([])
  })

  it('toggles a card field off without touching the others', () => {
    const preferences = toggleCardField(createDefaultBoardPreferences(), 'description')
    expect(preferences.cardFields).not.toContain('description')
    expect(preferences.cardFields).toContain('number')
  })

  it('reads preferences saved before modal fields could be hidden as all shown', () => {
    const savedBeforeModalFields = getBoardPreferences(stateWith({ hiddenLaneIds: [] }), '/repo')
    expect(savedBeforeModalFields.hiddenModalFields).toEqual([])
  })

  it('hides a modal field and shows it again', () => {
    const original = createDefaultBoardPreferences()
    const hidden = toggleModalField(original, 'labels')
    expect(hidden.hiddenModalFields).toEqual(['labels'])
    expect(toggleModalField(hidden, 'labels').hiddenModalFields).toEqual(original.hiddenModalFields)
  })

  it('reads preferences saved before lane settings fields could be hidden as all shown', () => {
    const savedBeforeLaneFields = getBoardPreferences(stateWith({ hiddenLaneIds: [] }), '/repo')
    expect(savedBeforeLaneFields.hiddenLaneModalFields).toEqual([])
    expect(savedBeforeLaneFields.hiddenLaneModalFieldsByLane).toEqual({})
  })

  it('hides a filter bar control and shows it again', () => {
    const original = createDefaultBoardPreferences()
    const hidden = toggleFilterControl(original, 'mine')
    expect(hidden.hiddenFilterControls).toEqual(['mine'])
    expect(toggleFilterControl(hidden, 'mine').hiddenFilterControls).toEqual([])
  })

  it('reads preferences saved before filter controls could be hidden as all shown', () => {
    const savedBeforeFilterControls = getBoardPreferences(stateWith({ hiddenLaneIds: [] }), '/repo')
    expect(savedBeforeFilterControls.hiddenFilterControls).toEqual([])
  })

  it('hides a lane settings field on the whole board and shows it again', () => {
    const original = createDefaultBoardPreferences()
    const hidden = toggleLaneModalField(original, 'output')
    expect(hidden.hiddenLaneModalFields).toEqual(['output'])
    expect(toggleLaneModalField(hidden, 'output').hiddenLaneModalFields).toEqual([])
  })

  it('hides a lane settings field in one lane only and shows it again', () => {
    const original = createDefaultBoardPreferences()
    const hiddenInIdea = toggleLaneModalFieldInLane(original, 'idea', 'agentPrompt')
    const alsoHiddenInDone = toggleLaneModalFieldInLane(hiddenInIdea, 'done', 'nextLane')
    expect(alsoHiddenInDone.hiddenLaneModalFieldsByLane).toEqual({ idea: ['agentPrompt'], done: ['nextLane'] })
    expect(alsoHiddenInDone.hiddenLaneModalFields).toEqual([])

    const shownAgainInIdea = toggleLaneModalFieldInLane(alsoHiddenInDone, 'idea', 'agentPrompt')
    expect(shownAgainInIdea.hiddenLaneModalFieldsByLane).toEqual({ idea: [], done: ['nextLane'] })
  })

  it('clamps a lane width dragged past either limit', () => {
    expect(setLaneWidth(createDefaultBoardPreferences(), 'idea', 10).laneWidths.idea).toBe(MIN_LANE_WIDTH)
    expect(setLaneWidth(createDefaultBoardPreferences(), 'idea', 9999).laneWidths.idea).toBe(MAX_LANE_WIDTH)
    expect(setLaneWidth(createDefaultBoardPreferences(), 'idea', 320.4).laneWidths.idea).toBe(320)
  })
})

describe('ticketShellCommand', () => {
  const lane = (overrides: Partial<SwimLane> = {}): SwimLane => ({
    id: 'in-development',
    name: 'In Development',
    agentPrompt: '',
    agentFilePath: '',
    ...overrides
  })

  const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
    id: 'ticket-1',
    number: 7,
    laneId: 'in-development',
    title: 'Add the thing',
    description: 'Make it work.',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  })

  it('leads with the lane prompt, then the ticket', () => {
    const command = ticketShellCommand(ticket(), lane({ agentPrompt: 'Ship small diffs.' }))
    expect(command).toBe(
      "claude --name '7-In-Development' 'Ship small diffs.\n\nTicket #7: Add the thing\nStatus: In Development\n\nMake it work.'"
    )
  })

  it('puts an agent\'s prompt flags between the CLI and the prompt', () => {
    const hermes = availableAgents({}).find((agent) => agent.id === 'hermes')
    const command = ticketShellCommand(ticket({ description: '' }), lane(), hermes)
    expect(command).toBe("hermes chat -q 'Ticket #7: Add the thing\nStatus: In Development'")
  })

  it('hands opencode its TUI prompt on --prompt, not as the project-dir positional', () => {
    const opencode = availableAgents({}).find((agent) => agent.id === 'opencode')
    const command = ticketShellCommand(ticket({ description: '' }), lane(), opencode)
    expect(command).toBe("opencode --prompt 'Ticket #7: Add the thing\nStatus: In Development'")
  })

  it('leaves agents with no session-name flag unnamed', () => {
    const codex = availableAgents({}).find((agent) => agent.id === 'codex')
    const command = ticketShellCommand(ticket({ description: '' }), lane(), codex)
    expect(command).toBe("codex 'Ticket #7: Add the thing\nStatus: In Development'")
  })

  it('shell-quotes a session name the same way as the prompt', () => {
    expect(agentShellCommand(DEFAULT_AGENT, 'go', { sessionName: "Bob's run" })).toBe("claude --name 'Bob'\\''s run' 'go'")
    expect(agentShellCommand(DEFAULT_AGENT, 'go', { model: 'opus', sessionName: 'Ticket #7' })).toBe("claude --model 'opus' --name 'Ticket #7' 'go'")
    expect(agentShellCommand(DEFAULT_AGENT, 'go')).toBe("claude 'go'")
  })

  it('defaults Claude Code to Opus 5.5, one of its listed models', () => {
    expect(DEFAULT_AGENT.defaultModel).toBe('claude-opus-5-5')
    expect(DEFAULT_AGENT.models).toContain('claude-opus-5-5')
    const defaultModelCommand = agentShellCommand(DEFAULT_AGENT, 'go', { model: DEFAULT_AGENT.defaultModel })
    expect(defaultModelCommand).toBe("claude --model 'claude-opus-5-5' 'go'")
  })

  it('omits an empty lane prompt and description rather than leaving blank gaps', () => {
    const command = ticketShellCommand(ticket({ description: '   ' }), lane())
    expect(command).toBe("claude --name '7-In-Development' 'Ticket #7: Add the thing\nStatus: In Development'")
  })

  it('never starts the prompt with "-", which a CLI would parse as an option', () => {
    const bulletLane = lane({ agentPrompt: '- Create a PRD.\n- Add it to the ticket.' })
    const prompt = ticketAgentPrompt(ticket(), bulletLane)
    expect(prompt).toBe(
      'Instructions:\n- Create a PRD.\n- Add it to the ticket.\n\nTicket #7: Add the thing\nStatus: In Development\n\nMake it work.'
    )
    const flagLikeLane = lane({ agentPrompt: '--dry-run first.' })
    expect(ticketAgentPrompt(ticket(), flagLikeLane)).toMatch(/^Instructions:\n--dry-run first\./)
  })

  it('leaves a prompt that does not start with "-" unchanged', () => {
    const prompt = ticketAgentPrompt(ticket(), lane({ agentPrompt: 'Ship it.' }))
    expect(prompt).toBe('Ship it.\n\nTicket #7: Add the thing\nStatus: In Development\n\nMake it work.')
  })

  it('carries every filled-in ticket field as context', () => {
    const richTicket = ticket({
      labels: ['ui', 'bug'],
      branchName: 'feat/thing',
      worktreePath: '/code/app-thing',
      pullRequestUrl: 'https://github.com/o/r/pull/4',
      externalUrl: 'https://github.com/o/r/issues/3',
      checklist: [
        { text: 'spec', done: true },
        { text: 'build', done: false }
      ]
    })
    const prompt = ticketAgentPrompt(richTicket, lane(), { assigneeName: 'Local' })
    expect(prompt).toContain('Assignee: Local')
    expect(prompt).toContain('Labels: ui, bug')
    expect(prompt).toContain('Branch: feat/thing')
    expect(prompt).toContain('Worktree: /code/app-thing')
    expect(prompt).toContain('Pull request: https://github.com/o/r/pull/4')
    expect(prompt).toContain('Source: https://github.com/o/r/issues/3')
    expect(prompt).toContain('Checklist:\n- [x] spec\n- [ ] build')
  })

  // Hiding modal fields is display-only: ticketAgentPrompt takes no preferences, so
  // a hidden field with a value still reaches the agent and an empty one never does.
  it('sends filled fields and drops empty ones', () => {
    const filledTicket = ticket({ description: 'Make it pop', labels: ['ui'], branchName: 'feat/pop', version: undefined })
    const prompt = ticketAgentPrompt(filledTicket, lane())
    expect(prompt).toContain('Make it pop')
    expect(prompt).toContain('Labels: ui')
    expect(prompt).toContain('Branch: feat/pop')
    expect(prompt).not.toContain('Version:')
  })

  // Hiding lane settings fields is display-only too (#115): the prompt is built from
  // the lane itself, so a hidden lane prompt still reaches the agent.
  it('sends the same prompt whatever lane settings fields are hidden', () => {
    const promptLane = lane({ agentPrompt: 'Ship it.' })
    const promptBefore = ticketAgentPrompt(ticket(), promptLane)

    const everyFieldHidden = LANE_MODAL_FIELDS.reduce(
      (preferences, field) => {
        const hiddenOnBoard = toggleLaneModalField(preferences, field.id)
        return toggleLaneModalFieldInLane(hiddenOnBoard, promptLane.id, field.id)
      },
      createDefaultBoardPreferences()
    )
    expect(everyFieldHidden.hiddenLaneModalFields).toHaveLength(LANE_MODAL_FIELDS.length)
    expect(everyFieldHidden.hiddenLaneModalFieldsByLane[promptLane.id]).toHaveLength(LANE_MODAL_FIELDS.length)

    const promptAfter = ticketAgentPrompt(ticket(), promptLane)
    expect(promptAfter).toBe(promptBefore)
    expect(promptAfter).toContain('Ship it.')

    const promptlessLane = lane({ agentPrompt: '' })
    const promptWithoutInstructions = ticketAgentPrompt(ticket(), promptlessLane)
    expect(promptWithoutInstructions).not.toContain('Instructions')
  })

  // #136: pins each field's section + order so the Display list, closed-eye list and lane modal stay in sync.
  it('puts every lane settings field in the Agent, Orchestrator or Auto Run section', () => {
    const fieldIdsIn = (section: string) =>
      LANE_MODAL_FIELDS.filter((field) => field.section === section).map((field) => field.id)

    expect(fieldIdsIn('agent')).toEqual(['agentPrompt', 'agentFile', 'output'])
    expect(fieldIdsIn('orchestrator')).toEqual([
      'orchestratorPrompt',
      'orchestratorFile',
      'orchestratorPoll',
      'orchestratorAgent',
      'orchestratorModel'
    ])
    expect(fieldIdsIn('autoRun')).toEqual([
      'autoRunAgent',
      'autoRunShell',
      'autoRunModel',
      'worktrees',
      'fullAuto',
      'nextLane',
      'agentSetsVersion',
      'closesTicket'
    ])
    const sectionedFieldCount = ['agent', 'orchestrator', 'autoRun'].flatMap(fieldIdsIn).length
    expect(sectionedFieldCount).toBe(LANE_MODAL_FIELDS.length)
  })

  it('lists external links only when the ticket has some', () => {
    const linkedTicket = ticket({ externalLinks: ['https://figma.com/f', 'https://slack.com/t'] })
    expect(ticketAgentPrompt(linkedTicket, lane())).toContain('Links:\n- https://figma.com/f\n- https://slack.com/t')
    expect(ticketAgentPrompt(ticket(), lane())).not.toContain('Links:')
    expect(ticketAgentPrompt(ticket({ externalLinks: [] }), lane())).not.toContain('Links:')
  })

  it('lists attached image paths only when the ticket has some', () => {
    const imageTicket = ticket({ images: ['/data/attachments/t1/a.png', '/data/attachments/t1/b.jpg'] })
    expect(ticketAgentPrompt(imageTicket, lane())).toContain(
      'Images (open each path to view it):\n- /data/attachments/t1/a.png\n- /data/attachments/t1/b.jpg'
    )
    expect(ticketAgentPrompt(ticket(), lane())).not.toContain('Images')
    expect(ticketAgentPrompt(ticket({ images: [] }), lane())).not.toContain('Images')
  })

  it('ends with the lane output target and permission to reuse an existing location', () => {
    const prompt = ticketAgentPrompt(ticket(), lane({ outputTarget: 'a new folder called PRD' }))
    const outputSection = prompt.split('\n\n').at(-1)
    expect(outputSection).toContain('Output: a new folder called PRD')
    expect(outputSection).toContain('use it as-is without asking')
  })

  it('suggests models per agent, and a saved agent brings its own', () => {
    const builtInAgents = availableAgents({})
    const modelsOf = (agents: typeof builtInAgents, agentId: string) =>
      agents.find((agent) => agent.id === agentId)?.models
    expect(modelsOf(builtInAgents, 'claude-code')).toEqual(expect.arrayContaining(['fable', 'opus', 'claude-opus-5-5']))
    expect(modelsOf(builtInAgents, 'codex')?.length).toBeGreaterThan(0)
    expect(modelsOf(builtInAgents, 'opencode')?.every((model) => model.includes('/'))).toBe(true)
    expect(modelsOf(builtInAgents, 'hermes')).toBeUndefined()

    const savedCodex = { id: 'codex', name: 'My Codex', command: 'codex', headlessArgs: [], modelArgs: ['-m'], models: ['my-model'] }
    expect(modelsOf(availableAgents({ agents: [savedCodex] }), 'codex')).toEqual(['my-model'])
  })

  it("runs the ticket's chosen agent, falling back to the default", () => {
    const aider = { id: 'aider', name: 'Aider', command: 'aider', headlessArgs: ['--yes'] }
    const agents = availableAgents({ agents: [aider] })
    expect(agentForTicket(ticket({ agentId: 'aider' }), agents)).toBe(aider)
    expect(agentForTicket(ticket(), agents)).toBe(DEFAULT_AGENT)
    expect(ticketShellCommand(ticket(), lane(), aider)).toMatch(/^aider '/)
    expect(agents.map((agent) => agent.id)).toEqual(['claude-code', 'codex', 'hermes', 'opencode', 'aider'])

    const savedCodex = { id: 'codex', name: 'My Codex', command: '/opt/bin/codex', headlessArgs: [] }
    const withSavedCodex = availableAgents({ agents: [savedCodex] })
    expect(withSavedCodex.filter((agent) => agent.id === 'codex')).toEqual([savedCodex])

    const savedOpencode = {
      id: 'opencode',
      name: 'opencode (yolo)',
      command: 'opencode',
      headlessArgs: ['run', '--dangerously-skip-permissions'],
      promptArgs: ['--prompt']
    }
    const withSavedOpencode = availableAgents({ agents: [savedOpencode] })
    expect(withSavedOpencode.filter((agent) => agent.id === 'opencode')).toEqual([savedOpencode])
  })

  it('names the lane markdown file when the lane has one', () => {
    const command = ticketShellCommand(ticket({ description: '' }), lane({ agentFilePath: 'docs/dev.md' }))
    expect(command).toContain('Follow the guidance in docs/dev.md.')
  })

  it('sends a typed prompt once, without also pointing at its autosaved file', () => {
    const command = ticketShellCommand(ticket(), lane({ agentPrompt: 'Write a PRD.', agentFilePath: 'docs/dev.md' }))
    expect(command).toContain('Write a PRD.')
    expect(command).not.toContain('docs/dev.md')
  })

  it("escapes a description's own single quotes so the shell string stays closed", () => {
    const command = ticketShellCommand(ticket({ description: "don't break" }), lane())
    expect(command).toBe("claude --name '7-In-Development' 'Ticket #7: Add the thing\nStatus: In Development\n\ndon'\\''t break'")
  })
  it("uses a ticket's own branch, else a short one from its number and first title words", () => {
    expect(ticketBranchName(ticket({ branchName: 'feat/mine' }))).toBe('feat/mine')
    expect(ticketBranchName(ticket({ number: 31, title: 'Cmd+Shift+F will bring focus to the filter' }))).toBe(
      't31-cmd-shift-f'
    )
    expect(ticketBranchName(ticket({ number: 9, title: '  "Go"!  ' }))).toBe('t9-go')
    expect(ticketBranchName(ticket({ number: 9, title: '???' }))).toBe('t9')
  })
})

describe('scan directory removal', () => {
  const projectAt = (path: string, notes = ''): ProjectRecord => ({
    path,
    name: path.split('/').pop()!,
    status: 'active',
    priority: 'high',
    notes,
    source: 'first-party',
    hasGit: true,
    hasPackageJson: false,
    hasReadme: false,
    lastScannedAt: '2026-01-01T00:00:00.000Z'
  })

  const stateWith = (scanDirectories: string[], projectPaths: string[]): ProjectTrackerState => ({
    ...createSeedState(),
    scanDirectories,
    hiddenPaths: ['/code/a/secret'],
    thirdPartyPaths: ['/code/a/lib'],
    snapshot: { projects: projectPaths.map((path) => projectAt(path, `notes for ${path}`)), failures: [] }
  })

  it('archives the removed directory\'s projects instead of dropping them', () => {
    const state = removeScanDirectory(stateWith(['/code/a', '/code/b'], ['/code/a/app', '/code/b/app']), '/code/a')
    expect(state.scanDirectories).toEqual(['/code/b'])
    expect(state.snapshot.projects.map((project) => [project.path, Boolean(project.archived)])).toEqual([
      ['/code/a/app', true],
      ['/code/b/app', false]
    ])
    expect(state.snapshot.projects[0].notes).toBe('notes for /code/a/app')
    expect(state.hiddenPaths).toEqual(['/code/a/secret'])
    expect(state.thirdPartyPaths).toEqual(['/code/a/lib'])
  })

  it('keeps projects still covered by a nested scan directory', () => {
    const state = removeScanDirectory(stateWith(['/code', '/code/a'], ['/code/a/app']), '/code')
    expect(state.snapshot.projects.map((project) => project.path)).toEqual(['/code/a/app'])
    expect(state.snapshot.projects[0].archived).toBeUndefined()
  })

  it('restores archived projects, notes intact, when their directory is added back', () => {
    const archived = removeScanDirectory(stateWith(['/code/a'], ['/code/a/app']), '/code/a')
    const restored = addScanDirectory(archived, '/code/a')
    expect(restored.scanDirectories).toEqual(['/code/a'])
    expect(restored.snapshot.projects[0]).toMatchObject({ archived: false, notes: 'notes for /code/a/app', priority: 'high' })
  })

  it('carries archived projects through a scan that cannot see them', () => {
    const archived = removeScanDirectory(stateWith(['/code/a', '/code/b'], ['/code/a/app', '/code/b/app']), '/code/a')
    const merged = mergeScannedProjects(archived, [projectAt('/code/b/app')], [])
    expect(merged.snapshot.projects.map((project) => project.path)).toEqual(['/code/b/app', '/code/a/app'])
    expect(merged.snapshot.projects[1].archived).toBe(true)
  })

  const unknownAt = (path: string): ProjectRecord => ({ ...projectAt(path), status: 'unknown' })
  const statusesOf = (state: ProjectTrackerState) => state.snapshot.projects.map((project) => project.status)

  it('makes the first project ever added active and leaves later ones unknown', () => {
    const seedState = createSeedState()
    const firstScanResults = [unknownAt('/code/a/one'), unknownAt('/code/a/two')]
    const firstScan = mergeScannedProjects(seedState, firstScanResults, [])
    expect(statusesOf(firstScan)).toEqual(['active', 'unknown'])

    const pausedProjects = firstScan.snapshot.projects.map((project) => ({ ...project, status: 'paused' as const }))
    const userEdited = { ...firstScan, snapshot: { ...firstScan.snapshot, projects: pausedProjects } }
    const rescanResults = [...firstScanResults, unknownAt('/code/a/three')]
    const rescan = mergeScannedProjects(userEdited, rescanResults, [])
    expect(statusesOf(rescan)).toEqual(['paused', 'paused', 'unknown'])
  })

  it('skips third-party projects when picking the first one to make active', () => {
    const thirdParty: ProjectRecord = { ...unknownAt('/code/a/lib'), source: 'third-party' }
    const firstScanResults = [thirdParty, unknownAt('/code/a/one')]
    const firstScan = mergeScannedProjects(createSeedState(), firstScanResults, [])
    expect(statusesOf(firstScan)).toEqual(['unknown', 'active'])
  })

  it('makes nothing active once projects are known, even with no scan time saved', () => {
    const emptySnapshot = { scannedAt: '2026-01-01T00:00:00.000Z', projects: [], failures: [] }
    const emptiedAfterScan = { ...stateWith(['/code/a'], []), snapshot: emptySnapshot }
    const afterEmptiedList = mergeScannedProjects(emptiedAfterScan, [unknownAt('/code/a/one')], [])
    expect(statusesOf(afterEmptiedList)).toEqual(['unknown'])

    const legacyWithoutScanTime = stateWith(['/code/a'], ['/code/a/one'])
    const legacyScanResults = [unknownAt('/code/a/new'), unknownAt('/code/a/one')]
    const legacyRescan = mergeScannedProjects(legacyWithoutScanTime, legacyScanResults, [])
    expect(statusesOf(legacyRescan)).toEqual(['unknown', 'active'])
  })

  it('carries hidden projects through a scan, since the scanner skips their folders', () => {
    const state = stateWith(['/code/a'], ['/code/a/app', '/code/a/secret'])
    const merged = mergeScannedProjects(state, [projectAt('/code/a/app')], [])
    expect(merged.snapshot.projects.map((project) => project.path)).toEqual(['/code/a/app', '/code/a/secret'])
    expect(merged.snapshot.projects[1].notes).toBe('notes for /code/a/secret')
  })
})

describe('ticket card labels', () => {
  it('shows the last folder of a worktree path', () => {
    expect(worktreeFolderName('/code/electron-app-ticket-fields')).toBe('electron-app-ticket-fields')
    expect(worktreeFolderName('/code/electron-app-ticket-fields/')).toBe('electron-app-ticket-fields')
  })

  it('names a GitHub PR by number, falling back to a bare label', () => {
    expect(pullRequestLabel('https://github.com/o/r/pull/35')).toBe('PR #35')
    expect(pullRequestLabel('https://github.com/o/r/pull/35/files')).toBe('PR #35')
    expect(pullRequestLabel('https://gitlab.com/o/r/-/merge_requests/9')).toBe('PR')
  })

  it('labels each merge request state, and a ticket with none', () => {
    expect(pullRequestStatusLabel('open')).toBe('Open')
    expect(pullRequestStatusLabel('draft')).toBe('Draft')
    expect(pullRequestStatusLabel('merged')).toBe('Merged')
    expect(pullRequestStatusLabel('closed')).toBe('Closed')
    expect(pullRequestStatusLabel(undefined)).toBe('No merge request')
  })

  it('reads a merge request state from the GitHub payload', () => {
    const githubPullRequest = { html_url: 'https://github.com/o/r/pull/5', number: 5 }
    const stateOf = (fields: { state: 'open' | 'closed'; draft?: boolean; merged_at?: string | null }) =>
      toPullRequestStatus({ ...githubPullRequest, ...fields }).state

    expect(stateOf({ state: 'open', draft: false, merged_at: null })).toBe('open')
    expect(stateOf({ state: 'open', draft: true, merged_at: null })).toBe('draft')
    expect(pullRequestStatusLabel(stateOf({ state: 'open', draft: true }))).toBe('Draft')
    expect(stateOf({ state: 'closed', draft: false, merged_at: null })).toBe('closed')
    // A merged PR that was a draft once is still just merged.
    expect(stateOf({ state: 'closed', draft: true, merged_at: '2026-01-04T00:00:00Z' })).toBe('merged')
    expect(
      toPullRequestStatus({ ...githubPullRequest, state: 'closed', merged_at: '2026-01-04T00:00:00Z' })
    ).toEqual({ url: 'https://github.com/o/r/pull/5', number: 5, state: 'merged', mergedAt: '2026-01-04T00:00:00Z' })
  })

  it('treats only a merged PR as settled, since a closed one can reopen', () => {
    expect(isPullRequestSettled('merged')).toBe(true)
    expect(isPullRequestSettled('closed')).toBe(false)
    expect(isPullRequestSettled('open')).toBe(false)
    expect(isPullRequestSettled(undefined)).toBe(false)
  })

  it('links only absolute http(s) URLs', () => {
    expect(isWebUrl('https://github.com/o/r/pull/35')).toBe(true)
    expect(isWebUrl('github.com/o/r/pull/35')).toBe(false)
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
    expect(isWebUrl(undefined)).toBe(false)
  })
})

describe('ticketsToRun', () => {
  const tickets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Ticket[]

  it('runs only the checked tickets', () => {
    const ticketsRun = ticketsToRun(tickets, new Set(['a', 'c']))
    const runIds = ticketsRun.map((ticket) => ticket.id)
    expect(runIds).toEqual(['a', 'c'])
  })

  it('runs every ticket when none are checked', () => {
    expect(ticketsToRun(tickets, new Set())).toEqual(tickets)
  })

  it('runs every ticket when the only checks are in another lane', () => {
    expect(ticketsToRun(tickets, new Set(['z']))).toEqual(tickets)
  })
})

describe('splitRunnable', () => {
  const runIn = (id: string, laneId: string, status: string) =>
    ({ id, number: id.length, agentRun: { laneId, status } }) as unknown as Ticket
  const idsOf = (tickets: Ticket[]) => tickets.map((ticket) => ticket.id)

  it('skips a ticket whose agent is already running in this lane', () => {
    const { runnable, skipped } = splitRunnable([runIn('a', 'in-pr', 'running'), { id: 'b' } as Ticket], 'in-pr')
    expect(idsOf(skipped)).toEqual(['a'])
    expect(idsOf(runnable)).toEqual(['b'])
  })

  it('runs a checked ticket even when its agent shows running', () => {
    const { runnable, skipped } = splitRunnable([runIn('a', 'in-pr', 'running')], 'in-pr', new Set(['a']))
    expect(idsOf(runnable)).toEqual(['a'])
    expect(skipped).toEqual([])
  })

  it('runs a ticket whose running agent belongs to another lane', () => {
    const { runnable } = splitRunnable([runIn('a', 'in-dev', 'running')], 'in-pr')
    expect(idsOf(runnable)).toEqual(['a'])
  })

  it('runs tickets whose agent run has ended', () => {
    const ended = ['done', 'failed', 'interrupted'].map((status) => runIn(status, 'in-pr', status))
    const { runnable } = splitRunnable(ended, 'in-pr')
    expect(idsOf(runnable)).toEqual(['done', 'failed', 'interrupted'])
  })

  it('names every skipped ticket in the notice', () => {
    const skipped = [{ number: 102 }, { number: 106 }] as Ticket[]
    expect(skippedRunsNotice(skipped, 'Merge Request')).toBe('Skipped #102, #106: agent already running in Merge Request')
  })

  it('has no notice when nothing was skipped', () => {
    expect(skippedRunsNotice([], 'Merge Request')).toBeNull()
  })

  it('joins only the notices that are set', () => {
    expect(joinNotices(null, 'Skipped #102')).toBe('Skipped #102')
    expect(joinNotices('Auto Run opened 2 tabs.', 'Skipped #102')).toBe('Auto Run opened 2 tabs. Skipped #102')
    expect(joinNotices(null, null)).toBeNull()
  })
})

describe('lane order', () => {
  const ticket = (id: string, number: number, laneId: string, placement: Partial<Ticket> = {}) =>
    ({ id, number, laneId, ...placement }) as Ticket
  const idsOf = (tickets: Ticket[]) => tickets.map((entry) => entry.id)
  const laneIds = (tickets: Ticket[], laneId: string) =>
    idsOf(tickets.filter((entry) => entry.laneId === laneId).sort(compareLaneOrder))
  const placed = (lanePosition: number, lanePositionLaneId: string) => ({ lanePosition, lanePositionLaneId })

  it('sorts placed tickets by slot ahead of unplaced ones by number', () => {
    const tickets = [ticket('a', 1, 'dev'), ticket('b', 2, 'dev', placed(2, 'dev')), ticket('c', 3, 'dev', placed(1, 'dev'))]
    expect(idsOf([...tickets].sort(compareLaneOrder))).toEqual(['c', 'b', 'a'])
  })

  it('treats a slot from another lane as unplaced', () => {
    const tickets = [ticket('a', 2, 'dev', placed(1, 'idea')), ticket('b', 1, 'dev')]
    expect(idsOf([...tickets].sort(compareLaneOrder))).toEqual(['b', 'a'])
  })

  it('groups each lane in lane order', () => {
    const tickets = [ticket('a', 1, 'dev'), ticket('b', 2, 'dev', placed(1, 'dev'))]
    expect(idsOf(groupTicketsByLane(tickets, () => true).get('dev') ?? [])).toEqual(['b', 'a'])
  })

  const board = () => [ticket('a', 1, 'dev'), ticket('b', 2, 'dev'), ticket('c', 3, 'dev'), ticket('d', 4, 'idea'), ticket('e', 5, 'prd')]

  it('inserts a ticket at an index within its own lane, numbering the lane 1..n', () => {
    const tickets = placeTicketsInLane(board(), ['c'], 'dev', { beforeTicketId: 'a', afterTicketId: null })
    expect(laneIds(tickets, 'dev')).toEqual(['c', 'a', 'b'])
    const positions = tickets.filter((entry) => entry.laneId === 'dev').map((entry) => [entry.id, entry.lanePosition])
    expect(Object.fromEntries(positions)).toEqual({ a: 2, b: 3, c: 1 })
  })

  it('lands a ticket from another lane at the anchor', () => {
    const tickets = placeTicketsInLane(board(), ['d'], 'dev', { beforeTicketId: null, afterTicketId: 'a' })
    expect(laneIds(tickets, 'dev')).toEqual(['a', 'd', 'b', 'c'])
    expect(tickets.find((entry) => entry.id === 'd')).toMatchObject({ laneId: 'dev', lanePositionLaneId: 'dev' })
  })

  it('keeps a block from two lanes together in its carried order', () => {
    const tickets = placeTicketsInLane(board(), ['d', 'e', 'a'], 'dev', { beforeTicketId: 'c', afterTicketId: null })
    expect(laneIds(tickets, 'dev')).toEqual(['b', 'd', 'e', 'a', 'c'])
  })

  it('places relative to the visible neighbour, keeping hidden tickets in order', () => {
    const beforeVisible = placeTicketsInLane(board(), ['d'], 'dev', { beforeTicketId: 'c', afterTicketId: null })
    expect(laneIds(beforeVisible, 'dev')).toEqual(['a', 'b', 'd', 'c'])
    const afterVisible = placeTicketsInLane(board(), ['d'], 'dev', { beforeTicketId: null, afterTicketId: 'a' })
    expect(laneIds(afterVisible, 'dev')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('goes to the bottom of a visibly empty lane, or when the anchor is gone', () => {
    const emptyLane = placeTicketsInLane(board(), ['a'], 'done', { beforeTicketId: null, afterTicketId: null })
    expect(emptyLane.find((entry) => entry.id === 'a')).toMatchObject({ laneId: 'done', lanePosition: 1 })
    const goneAnchor = placeTicketsInLane(board(), ['d'], 'dev', { beforeTicketId: 'missing', afterTicketId: null })
    expect(laneIds(goneAnchor, 'dev')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns the same ticket objects for a drop that changes nothing', () => {
    const once = placeTicketsInLane(board(), ['a'], 'dev', { beforeTicketId: 'b', afterTicketId: null })
    const twice = placeTicketsInLane(once, ['a'], 'dev', { beforeTicketId: 'b', afterTicketId: null })
    expect(twice.every((entry, index) => entry === once[index])).toBe(true)
  })

  it('clears only slots left behind in another lane', () => {
    const stale = ticket('a', 1, 'dev', placed(3, 'idea'))
    const current = ticket('b', 2, 'dev', placed(1, 'dev'))
    const cleared = clearStaleLanePositions({ lanes: [], tickets: [stale, current] })
    expect(cleared.tickets[0]).toEqual({ id: 'a', number: 1, laneId: 'dev' })
    expect(cleared.tickets[1]).toBe(current)
    const untouched = { lanes: [], tickets: [current] }
    expect(clearStaleLanePositions(untouched)).toBe(untouched)
  })
})

describe('carriedTicketIds', () => {
  const tickets = [
    { id: 'a', laneId: 'idea' },
    { id: 'b', laneId: 'prd' },
    { id: 'c', laneId: 'idea' },
    { id: 'd', laneId: 'dev' }
  ] as Ticket[]

  it('carries only the dragged card when it is unchecked', () => {
    expect(carriedTicketIds('a', new Set(['b', 'c']), tickets)).toEqual(['a'])
  })

  it('carries every checked visible ticket when the dragged card is checked', () => {
    expect(carriedTicketIds('a', new Set(['a', 'b', 'c']), tickets)).toEqual(['a', 'b', 'c'])
  })

  it('leaves out a checked ticket that is not visible', () => {
    const visibleTickets = tickets.filter((ticket) => ticket.id !== 'b')
    expect(carriedTicketIds('a', new Set(['a', 'b']), visibleTickets)).toEqual(['a'])
  })

  it('keeps tickets in every lane, since the target is unknown at dragstart', () => {
    expect(carriedTicketIds('a', new Set(['a', 'c', 'd']), tickets)).toEqual(['a', 'c', 'd'])
  })
})

describe('ticketTabTitle', () => {
  const sessionId = '1234abcd-0000-4000-8000-000000000000'

  // #124: two runs of one ticket in one lane must not share a title.
  it('appends the first 8 chars of the session id, outside the title budget', () => {
    const lane = { id: 'prd', name: 'PRD' }
    expect(ticketTabTitle({ number: 33, title: 'Short title' }, lane, sessionId)).toBe('33-PRD-Short title · 1234abcd')
    const longTitle = ticketTabTitle({ number: 33, title: 'Auto-run should attempt to set a title per new tab created.' }, lane)
    const longWithSession = ticketTabTitle({ number: 33, title: 'Auto-run should attempt to set a title per new tab created.' }, lane, sessionId)
    expect(longWithSession).toBe(`${longTitle} · 1234abcd`)
    const emojiTicket = { number: 1, title: `${'a'.repeat(33)}🚀tail` }
    const emojiAtCut = ticketTabTitle(emojiTicket, lane)
    const emojiAtCutWithSession = ticketTabTitle(emojiTicket, lane, sessionId)
    expect(emojiAtCutWithSession).toBe(`${emojiAtCut} · 1234abcd`)
  })

  it('keeps the old title without a session id', () => {
    const lane = { id: 'prd', name: 'PRD' }
    expect(ticketTabTitle({ number: 33, title: 'Short title' }, lane, undefined)).toBe('33-PRD-Short title')
    expect(ticketTabTitle({ number: 33, title: 'Short title' }, lane, '')).toBe('33-PRD-Short title')
  })

  const prd = { id: 'prd', name: 'PRD' }

  it('leads with the ticket number and lane', () => {
    expect(ticketTabTitle({ number: 33, title: 'Short title' }, prd)).toBe('33-PRD-Short title')
  })

  it('cuts only the title, keeping the whole within 40 code points plus an ellipsis', () => {
    const title = ticketTabTitle({ number: 33, title: 'Auto-run should attempt to set a title per new tab created.' }, prd)
    expect(title).toBe('33-PRD-Auto-run should attempt to set a…')
    expect(Array.from(title).length).toBeLessThanOrEqual(41)
  })

  it('never splits an emoji at the cut', () => {
    const title = ticketTabTitle({ number: 1, title: `${'a'.repeat(34)}🚀🚀` }, prd)
    expect(title).toBe(`1-PRD-${'a'.repeat(34)}…`)
    const atCut = ticketTabTitle({ number: 1, title: `${'a'.repeat(33)}🚀tail` }, prd)
    expect(atCut).toBe(`1-PRD-${'a'.repeat(33)}🚀…`)
  })

  it('strips newlines and terminal control characters', () => {
    expect(ticketTabTitle({ number: 7, title: 'one\n two\u001b]0;pwn\u0007\tend' }, prd)).toBe('7-PRD-one two ]0;pwn end')
  })

  it('dashes a multi-word lane name and keeps its case', () => {
    expect(ticketTabTitle({ number: 5, title: 'Fix' }, { id: 'in-pr', name: 'Merge  Request' })).toBe('5-Merge-Request-Fix')
  })

  it('names the unassigned lane Unassigned whatever it is called', () => {
    expect(ticketTabTitle({ number: 5, title: 'Fix' }, { id: UNASSIGNED_LANE_ID, name: 'No status' })).toBe('5-Unassigned-Fix')
  })

  it('has no trailing dash for an empty title', () => {
    expect(ticketTabTitle({ number: 5, title: ' \n ' }, prd)).toBe('5-PRD')
  })

  it('drops the title when the prefix fills the budget', () => {
    expect(ticketTabTitle({ number: 5, title: 'Fix' }, { id: 'x', name: 'L'.repeat(40) })).toBe(`5-${'L'.repeat(40)}`)
  })
})

describe('laneTitleToken', () => {
  it('sanitizes control characters and tabs in a lane name', () => {
    expect(laneTitleToken({ id: 'dev', name: '\tIn\u001b Dev\n' })).toBe('In-Dev')
  })

  it('falls back to the lane id for an empty name', () => {
    expect(laneTitleToken({ id: 'dev', name: ' \u0007 ' })).toBe('dev')
  })
})

describe('ticketSessionName', () => {
  it('is the ticket number and lane', () => {
    expect(ticketSessionName({ number: 99 }, { id: 'prd', name: 'PRD' })).toBe('99-PRD')
  })
})

describe('currentLaneOf', () => {
  it('treats a lane id naming no lane as unassigned', () => {
    const board = { lanes: [{ id: 'prd', name: 'PRD' }], tickets: [] } as unknown as ProjectBoard
    expect(currentLaneOf(board, { laneId: 'prd' }).name).toBe('PRD')
    expect(currentLaneOf(board, { laneId: 'gone' }).id).toBe(UNASSIGNED_LANE_ID)
  })
})

describe('full auto', () => {
  const lane = (id: string, overrides: Partial<SwimLane> = {}): SwimLane => ({
    id,
    name: id.toUpperCase(),
    agentPrompt: `Do the ${id} work.`,
    agentFilePath: '',
    ...overrides
  })

  const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
    id: 'ticket-1',
    number: 7,
    laneId: 'prd',
    title: 'Add the thing',
    description: 'Make it work.',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  })

  const FULL_AUTO_SECTION = 'Full auto is on.'

  it('is on when either the lane or the ticket says so', () => {
    expect(isFullAuto(ticket(), lane('prd'))).toBe(false)
    expect(isFullAuto(ticket(), lane('prd', { fullAuto: true }))).toBe(true)
    expect(isFullAuto(ticket({ fullAuto: true }), lane('prd'))).toBe(true)
    expect(isFullAuto(ticket({ fullAuto: true }), lane('prd', { fullAuto: true }))).toBe(true)
  })

  it('adds the full auto section before the output only when on, and leaves the off prompt unchanged', () => {
    const outputLane = lane('prd', { outputTarget: 'docs/prd/' })
    const offPrompt = ticketAgentPrompt(ticket(), outputLane)
    expect(offPrompt).not.toContain(FULL_AUTO_SECTION)
    expect(ticketAgentPrompt(ticket({ fullAuto: false }), outputLane)).toBe(offPrompt)

    const onPrompt = ticketAgentPrompt(ticket({ fullAuto: true }), outputLane)
    const sections = onPrompt.split('\n\n')
    expect(sections.at(-2)).toMatch(/^Full auto is on\. /)
    expect(sections.at(-1)).toMatch(/^Output: docs\/prd\//)
    const onPromptWithoutSection = sections.filter((section) => !section.startsWith(FULL_AUTO_SECTION)).join('\n\n')
    expect(onPromptWithoutSection).toBe(offPrompt)
  })

  it('only lets a full auto agent exit when no open questions remain', () => {
    const outputLane = lane('prd', { outputTarget: 'docs/prd/' })
    const onPrompt = ticketAgentPrompt(ticket({ fullAuto: true }), outputLane)
    const fullAutoSection = onPrompt.split('\n\n').at(-2)
    expect(fullAutoSection).toMatch(
      /Exit only when nothing waits on the user \(your final footer shows `Open Questions: 0`\); otherwise stop with the open questions as the last thing on screen and leave the session open\./
    )
  })

  // #106: a done message sent before the move lets the orchestrator close the
  // tab while the ticket is still in this lane, which marks the run interrupted.
  it('makes messaging the orchestrator the last step, after the move and the footer', () => {
    const agentPrompt = ticketAgentPrompt(ticket({ fullAuto: true }), lane('prd'))
    const fullAutoSection = agentPrompt.split('\n\n').at(-1) ?? ''
    const moveAt = fullAutoSection.indexOf('Finish in this order: move the ticket')
    const footerAt = fullAutoSection.indexOf('print your final footer', moveAt)
    const messageAt = fullAutoSection.indexOf('then message the orchestrator, if one is watching this lane, as your very last action', footerAt)
    expect(moveAt).toBeGreaterThan(-1)
    expect(footerAt).toBeGreaterThan(moveAt)
    expect(messageAt).toBeGreaterThan(footerAt)
    expect(fullAutoSection).toMatch(/Nothing but exiting comes after that message\.$/)
  })

  const boardWith = (tickets: Ticket[], prdOverrides: Partial<SwimLane> = {}): ProjectBoard => ({
    lanes: [lane('prd', prdOverrides), lane('dev'), lane('empty', { agentPrompt: '  ' })],
    tickets
  })

  const handoffTicketNumbers = (before: ProjectBoard, after: ProjectBoard) =>
    fullAutoHandoffs(before, after).map((handoff) => `${handoff.ticket.number}:${handoff.fromLane.id}->${handoff.toLane.id}`)

  it('hands off a ticket moved out of a full auto lane', () => {
    const before = boardWith([ticket()], { fullAuto: true })
    const after = boardWith([ticket({ laneId: 'dev' })], { fullAuto: true })
    expect(handoffTicketNumbers(before, after)).toEqual(['7:prd->dev'])
  })

  it('hands off a full auto ticket moved out of any lane', () => {
    const before = boardWith([ticket({ fullAuto: true })])
    const after = boardWith([ticket({ fullAuto: true, laneId: 'dev' })])
    const [handoff] = fullAutoHandoffs(before, after)
    expect(handoff.ticket).toBe(after.tickets[0])
    expect(handoff.toLane.name).toBe('DEV')
  })

  it('does not hand off when full auto is off, the target has no prompt, or the target is unassigned', () => {
    const offBefore = boardWith([ticket()])
    const offAfter = boardWith([ticket({ laneId: 'dev' })])
    expect(handoffTicketNumbers(offBefore, offAfter)).toEqual([])

    const onBefore = boardWith([ticket({ fullAuto: true })])
    expect(handoffTicketNumbers(onBefore, boardWith([ticket({ fullAuto: true, laneId: 'empty' })]))).toEqual([])
    const toUnassigned = boardWith([ticket({ fullAuto: true, laneId: UNASSIGNED_LANE_ID })])
    toUnassigned.unassignedLane = lane(UNASSIGNED_LANE_ID)
    expect(handoffTicketNumbers(onBefore, toUnassigned)).toEqual([])
  })

  it('does not hand off an unmoved ticket or one new in the next board', () => {
    const before = boardWith([ticket({ fullAuto: true })])
    expect(handoffTicketNumbers(before, boardWith([ticket({ fullAuto: true, title: 'Renamed' })]))).toEqual([])
    const newTicket = ticket({ id: 'new', number: 8, fullAuto: true, laneId: 'dev' })
    expect(handoffTicketNumbers(before, boardWith([ticket({ fullAuto: true }), newTicket]))).toEqual([])
  })

  describe('completionMoves', () => {
    const steps = (...done: boolean[]) => done.map((isDone, index) => ({ text: `step ${index}`, done: isDone }))
    const armed = (overrides: Partial<Ticket> = {}) =>
      ticket({ moveToLaneId: 'dev', moveOnComplete: true, checklist: steps(true, false), ...overrides })
    const completed = (overrides: Partial<Ticket> = {}) => armed({ checklist: steps(true, true), ...overrides })
    const movesBetween = (before: Ticket, after: Ticket, alsoCompletedIds: string[] = [], at?: string) =>
      completionMoves(boardWith([before]), boardWith([after]), alsoCompletedIds, at)

    it('moves a ticket whose checklist just went all-done, disarms it and clears the spent override', () => {
      const { board, moves } = movesBetween(armed(), completed(), [], '2026-02-02T00:00:00.000Z')
      expect(moves.map((move) => `${move.ticket.number}->${move.toLane.name}`)).toEqual(['7->DEV'])
      expect(board.tickets[0]).toMatchObject({
        laneId: 'dev',
        moveToLaneId: undefined,
        moveOnComplete: false,
        updatedAt: '2026-02-02T00:00:00.000Z'
      })
    })

    it('moves on a completion the caller reports, with no checklist at all', () => {
      const noChecklist = armed({ checklist: undefined })
      expect(movesBetween(noChecklist, noChecklist, ['ticket-1']).moves).toHaveLength(1)
      expect(movesBetween(noChecklist, noChecklist).moves).toEqual([])
    })

    it('does not move a ticket already all-done before, or one with the checkbox off', () => {
      const alreadyDone = movesBetween(completed(), completed({ title: 'Renamed' }))
      expect(alreadyDone.moves).toEqual([])
      expect(alreadyDone.board.tickets[0].laneId).toBe('prd')

      const unchecked = movesBetween(armed({ moveOnComplete: false }), completed({ moveOnComplete: false }))
      expect(unchecked.moves).toEqual([])
      expect(unchecked.board.tickets[0].laneId).toBe('prd')
    })

    it('does not move when the target lane is gone or is the current lane, but still disarms', () => {
      const deletedTarget = movesBetween(armed({ moveToLaneId: 'gone' }), completed({ moveToLaneId: 'gone' }))
      expect(deletedTarget.moves).toEqual([])
      expect(deletedTarget.board.tickets[0]).toMatchObject({ laneId: 'prd', moveOnComplete: false })

      const sameLane = movesBetween(armed({ moveToLaneId: 'prd' }), completed({ moveToLaneId: 'prd' }))
      expect(sameLane.moves).toEqual([])
      expect(sameLane.board.tickets[0]).toMatchObject({ laneId: 'prd', moveOnComplete: false })
    })

    it('ignores PR state: completion alone moves an armed ticket', () => {
      const openInPr = { pullRequestState: 'open' as const, laneId: 'in-pr' }
      const inPrBoard = (entry: Ticket): ProjectBoard => ({ lanes: [lane('in-pr'), lane('dev')], tickets: [entry] })
      const completedMoves = completionMoves(inPrBoard(armed(openInPr)), inPrBoard(completed(openInPr)), [])
      expect(completedMoves.moves).toHaveLength(1)
      const mergedOnlyMoves = completionMoves(inPrBoard(armed(openInPr)), inPrBoard(armed({ ...openInPr, pullRequestState: 'merged' })), [])
      expect(mergedOnlyMoves.moves).toEqual([])
    })

    it('returns the next board itself when nothing completed', () => {
      const after = boardWith([armed({ title: 'Renamed' })])
      expect(completionMoves(boardWith([armed()]), after).board).toBe(after)
    })

    it('can move to the No status column', () => {
      const toUnassigned = { moveToLaneId: UNASSIGNED_LANE_ID }
      const { moves } = movesBetween(armed(toUnassigned), completed(toUnassigned))
      expect(moves[0].toLane.id).toBe(UNASSIGNED_LANE_ID)
    })

    it('clears Move to on tickets targeting a deleted lane', () => {
      const board = removeLaneFromBoard(boardWith([armed()]), 'dev')
      expect(board.tickets[0]).toMatchObject({ moveToLaneId: undefined, moveOnComplete: false, laneId: 'prd' })
    })

    it('moves an armed ticket with no override to its lane\'s Next Lane; an override wins', () => {
      const inheriting = { moveToLaneId: undefined }
      const before = completionMoves(
        boardWith([armed(inheriting)], { nextLaneId: 'empty' }),
        boardWith([completed(inheriting)], { nextLaneId: 'empty' })
      )
      expect(before.moves.map((move) => move.toLane.id)).toEqual(['empty'])

      const overridden = completionMoves(
        boardWith([armed()], { nextLaneId: 'empty' }),
        boardWith([completed()], { nextLaneId: 'empty' })
      )
      expect(overridden.moves.map((move) => move.toLane.id)).toEqual(['dev'])
    })

    it('does not move an unarmed ticket even when its lane has a Next Lane', () => {
      const unarmed = { moveToLaneId: undefined, moveOnComplete: false }
      const { moves } = completionMoves(
        boardWith([armed(unarmed)], { nextLaneId: 'dev' }),
        boardWith([completed(unarmed)], { nextLaneId: 'dev' })
      )
      expect(moves).toEqual([])
    })

    describe('move rules', () => {
      const withRules = { moveRules: '- PR merged\n- no open questions' }
      const rulesPassed = { ...withRules, moveRulesPassedLaneId: 'prd' }

      it('holds a done checklist until the rules pass, then moves and resets the rules pass', () => {
        const checklistDone = movesBetween(armed(withRules), completed(withRules))
        expect(checklistDone.moves).toEqual([])
        expect(checklistDone.board.tickets[0].laneId).toBe('prd')

        const { board, moves } = movesBetween(completed(withRules), completed(rulesPassed))
        expect(moves.map((move) => move.toLane.id)).toEqual(['dev'])
        expect(board.tickets[0]).toMatchObject({ laneId: 'dev', moveRulesPassedLaneId: undefined })
      })

      it('ignores a rules pass confirmed in an earlier lane', () => {
        const staleRules = { ...withRules, moveRulesPassedLaneId: 'idea' }
        expect(movesBetween(armed(staleRules), completed(staleRules)).moves).toEqual([])
      })

      it('completes with an empty checklist once the rules pass', () => {
        const noChecklist = { checklist: undefined }
        expect(movesBetween(armed({ ...withRules, ...noChecklist }), armed({ ...rulesPassed, ...noChecklist })).moves)
          .toHaveLength(1)
      })

      it('voids a rules pass when the ticket is dragged out and back', () => {
        const draggedAway = completed({ ...rulesPassed, laneId: 'dev' })
        const draggedBack = completed(rulesPassed)
        const { board, moves } = movesBetween(draggedAway, draggedBack)
        expect(moves).toEqual([])
        expect(board.tickets[0]).toMatchObject({ laneId: 'prd', moveRulesPassedLaneId: undefined })
      })

      it('voids a rules pass when the rules text changes', () => {
        const editedRules = completed({ ...rulesPassed, moveRules: '- PR merged\n- QA sign-off' })
        const { board, moves } = movesBetween(armed(rulesPassed), editedRules)
        expect(moves).toEqual([])
        expect(board.tickets[0].moveRulesPassedLaneId).toBeUndefined()
      })

      it('needs the rules for a reported ▶ Run completion too', () => {
        expect(movesBetween(armed(withRules), armed(withRules), ['ticket-1']).moves).toEqual([])
      })
    })

    describe('ready to move', () => {
      const unarmed = { moveToLaneId: undefined, moveOnComplete: false }
      const nextLane = { nextLaneId: 'dev' }

      it('stamps an unarmed completion and labels it with the target lane', () => {
        const { board } = completionMoves(
          boardWith([armed(unarmed)], nextLane),
          boardWith([completed(unarmed)], nextLane)
        )
        expect(board.tickets[0].readyLaneId).toBe('prd')
        expect(isReadyToMove(board.tickets[0], board)).toBe('dev')
      })

      it('clears the stamp once the gate stops passing', () => {
        const stamped = completed({ ...unarmed, readyLaneId: 'prd' })
        const reopened = armed({ ...unarmed, readyLaneId: 'prd' })
        const previousBoard = boardWith([stamped], nextLane)
        const nextBoard = boardWith([reopened], nextLane)
        const { board } = completionMoves(previousBoard, nextBoard)
        expect(board.tickets[0].readyLaneId).toBeUndefined()
      })

      it('has no label without a resolvable next lane, or once the ticket left the stamped lane', () => {
        const stamped = completed({ ...unarmed, readyLaneId: 'prd' })
        expect(isReadyToMove(stamped, boardWith([stamped]))).toBeUndefined()
        const movedOn = { ...stamped, laneId: 'dev', moveToLaneId: 'empty' }
        expect(isReadyToMove(movedOn, boardWith([movedOn]))).toBeUndefined()
        expect(isReadyToMove({ ...movedOn, readyLaneId: 'dev' }, boardWith([movedOn]))).toBe('empty')
      })

      it('reads the gate live for tickets with rules, so an outside confirm shows', () => {
        const confirmed = completed({ ...unarmed, moveRules: 'PR merged', moveRulesPassedLaneId: 'prd' })
        expect(isReadyToMove(confirmed, boardWith([confirmed], nextLane))).toBe('dev')
        const unconfirmed = { ...confirmed, moveRulesPassedLaneId: undefined }
        expect(isReadyToMove(unconfirmed, boardWith([unconfirmed], nextLane))).toBeUndefined()
      })
    })
  })

  it('ticketAgentPrompt lists move rules with the confirm write only when the ticket has rules', () => {
    const prdLane = lane('prd')
    const withRules = ticketAgentPrompt(ticket({ moveRules: '- PR merged' }), prdLane)
    expect(withRules).toContain('move this ticket only when every rule below and every checklist item pass')
    expect(withRules).toContain('- PR merged')
    // shellQuote escapes the SQL literal's quotes inside the single-quoted argument.
    expect(withRules).toContain(`SET move_rules_passed_lane_id = '\\''prd'\\''`)
    expect(withRules).toContain(`WHERE id = '\\''ticket-1'\\'' AND lane_id = '\\''prd'\\'';`)
    expect(ticketAgentPrompt(ticket(), prdLane)).not.toContain('Move rules')
  })

  describe('effectiveNextLaneId', () => {
    const inPrd = { laneId: 'prd' }
    it('prefers the ticket, falls back to the lane, else undefined', () => {
      expect(effectiveNextLaneId({ ...inPrd, moveToLaneId: 'dev' }, lane('prd', { nextLaneId: 'qa' }))).toBe('dev')
      expect(effectiveNextLaneId(inPrd, lane('prd', { nextLaneId: 'qa' }))).toBe('qa')
      expect(effectiveNextLaneId(inPrd, lane('prd'))).toBeUndefined()
      expect(effectiveNextLaneId(inPrd, undefined)).toBeUndefined()
      const unassigned = { ...createUnassignedLane(), nextLaneId: 'idea' }
      expect(effectiveNextLaneId({ laneId: UNASSIGNED_LANE_ID }, unassigned)).toBe('idea')
    })

    it('treats an override naming the ticket\'s own lane as stale and inherits', () => {
      expect(effectiveNextLaneId({ ...inPrd, moveToLaneId: 'prd' }, lane('prd', { nextLaneId: 'dev' }))).toBe('dev')
    })
  })

  it('removeLaneFromBoard clears lane Next Lane pointers, the unassigned lane\'s included', () => {
    const board: ProjectBoard = {
      ...boardWith([], { nextLaneId: 'dev' }),
      unassignedLane: { ...createUnassignedLane(), nextLaneId: 'dev' }
    }
    const removed = removeLaneFromBoard(board, 'dev')
    expect(removed.lanes.map((each) => each.nextLaneId)).toEqual([undefined, undefined])
    expect(removed.unassignedLane?.nextLaneId).toBeUndefined()
  })

  it('removeLaneFromBoard disarms tickets whose resolved Next Lane changed, and keeps the rest armed', () => {
    const inheriting = ticket({ id: 'a', laneId: 'prd', moveOnComplete: true })
    const ownTarget = ticket({ id: 'b', laneId: 'prd', moveToLaneId: 'dev', moveOnComplete: true })
    const board: ProjectBoard = {
      ...boardWith([inheriting, ownTarget], { nextLaneId: 'dev' }),
      unassignedLane: { ...createUnassignedLane(), nextLaneId: 'empty' }
    }
    const removed = removeLaneFromBoard(board, 'prd')
    expect(removed.tickets.map((each) => each.moveOnComplete)).toEqual([false, true])
  })

  it('keeps a ticket on its existing branch and drops its worktree path from the prompt when worktrees are on', () => {
    const placedTicket = ticket({ branchName: 't7-existing', worktreePath: '/code/.worktrees/t7' })
    const { launch } = buildAutoRunLaunch(placedTicket, lane('dev'), DEFAULT_AGENT, {}, true)
    expect(launch.branchName).toBe('t7-existing')
    expect(launch.command).toContain('Branch: t7-existing')
    expect(launch.command).not.toContain('Worktree:')
    expect(launch.title).toMatch(/^7-DEV-Add the thing · [0-9a-f]{8}$/)

    const inPlace = buildAutoRunLaunch(placedTicket, lane('dev'), DEFAULT_AGENT, {}, false)
    expect(inPlace.launch.command).toContain('Worktree: /code/.worktrees/t7')
  })

  // #124
  it('titles each launch with its own session id and tells the agent both', () => {
    const first = buildAutoRunLaunch(ticket(), lane('dev'), DEFAULT_AGENT, {}, true)
    const second = buildAutoRunLaunch(ticket(), lane('dev'), DEFAULT_AGENT, {}, true)
    expect(first.launch.title).not.toBe(second.launch.title)
    expect(first.launch.title?.endsWith(` · ${first.sessionId?.slice(0, 8)}`)).toBe(true)
    expect(first.launch.command).toContain(`Your session id is ${first.sessionId}; your tab is`)
    expect(first.launch.command).toContain('Include both in every message to the orchestrator.')
  })

  it('keeps the plain title and no session line for an agent that cannot resume', () => {
    const noResume = { ...DEFAULT_AGENT, sessionArgs: undefined, resumeArgs: undefined }
    const { launch, sessionId } = buildAutoRunLaunch(ticket(), lane('dev'), noResume, {}, true)
    expect(sessionId).toBeUndefined()
    expect(launch.title).toBe('7-DEV-Add the thing')
    expect(launch.command).not.toContain('Your session id')
  })

  it('keeps worktrees on for a ticket that already has one, even when the lane has them off', () => {
    const worktreesOff = lane('dev', { autoRunWorktrees: false })
    expect(autoRunUsesWorktrees(worktreesOff)).toBe(false)
    expect(autoRunUsesWorktrees(worktreesOff, ticket({ worktreePath: '/code/.worktrees/t7' }))).toBe(true)
    expect(autoRunUsesWorktrees(lane('dev'), ticket())).toBe(true)
  })
})

describe('laneFolderName', () => {
  it('turns spaces and path separators into hyphens', () => {
    expect(laneFolderName('In Review')).toBe('In-Review')
    expect(laneFolderName('QA/Release\\Prep')).toBe('QA-Release-Prep')
  })

  it('strips characters filesystems reject', () => {
    expect(laneFolderName('a:b*c?d"e<f>g|h')).toBe('abcdefgh')
  })

  it('never yields a path separator or a leading dot from a traversal name', () => {
    const folderName = laneFolderName('../../etc/passwd')
    expect(folderName).not.toMatch(/[/\\]/)
    expect(folderName.startsWith('.')).toBe(false)
    expect(laneFolderName('.hidden')).toBe('hidden')
  })

  it('falls back when the name sanitizes to nothing', () => {
    expect(laneFolderName('  ')).toBe('lane')
    expect(laneFolderName('- -')).toBe('lane')
    expect(laneFolderName('..')).toBe('lane')
  })
})

describe('agentRunBadge', () => {
  const ticket = (agentRun?: Ticket['agentRun']): Ticket => ({
    id: 'ticket-1',
    number: 17,
    laneId: 'dev',
    title: 'Show the run result',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    agentRun
  })
  const run = (overrides: Partial<NonNullable<Ticket['agentRun']>> = {}) => ({
    at: '2026-01-02T00:00:00.000Z',
    laneId: 'dev',
    output: 'done',
    succeeded: true,
    ...overrides
  })

  it('shows running whatever run is saved', () => {
    expect(agentRunBadge(ticket(), true)).toBe('running')
    expect(agentRunBadge(ticket(run({ succeeded: false })), true)).toBe('running')
    expect(agentRunBadge(ticket(run({ seenAt: '2026-01-03T00:00:00.000Z' })), true)).toBe('running')
  })

  it('shows nothing without a recorded result', () => {
    expect(agentRunBadge(ticket(), false)).toBeNull()
    expect(agentRunBadge(ticket(run({ succeeded: undefined })), false)).toBeNull()
  })

  it('shows nothing once seen or after the ticket left the lane', () => {
    expect(agentRunBadge(ticket(run({ seenAt: '2026-01-03T00:00:00.000Z' })), false)).toBeNull()
    expect(agentRunBadge(ticket(run({ laneId: 'prd' })), false)).toBeNull()
  })

  it('shows the unseen result from this lane', () => {
    expect(agentRunBadge(ticket(run()), false)).toBe('succeeded')
    expect(agentRunBadge(ticket(run({ succeeded: false })), false)).toBe('failed')
  })

  it('counts only unseen finished runs as unseen results', () => {
    expect(hasUnseenAgentResult(ticket(run({ succeeded: false })))).toBe(true)
    expect(hasUnseenAgentResult(ticket(run({ seenAt: '2026-01-03T00:00:00.000Z' })))).toBe(false)
    expect(hasUnseenAgentResult(ticket())).toBe(false)
  })
})

describe('Auto Run orchestrator', () => {
  const lane = (id: string, name: string, agentPrompt = ''): SwimLane => ({ id, name, agentPrompt, agentFilePath: '' })
  const inDev = lane('in-dev', 'In Development', 'Build it.')
  const boardLanes = [inDev, lane('in-pr', 'Merge Request', 'Review it.'), lane('done', 'Done'), getUnassignedLane(createDefaultBoard())]

  const ticket = (number: number, title: string): Ticket => ({
    id: `ticket-${number}`,
    number,
    laneId: 'in-dev',
    title,
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z'
  })
  const entries = [ticket(12, 'First thing'), ticket(13, 'Second thing')].map((entry) =>
    buildAutoRunLaunch(entry, inDev, DEFAULT_AGENT, {}, true)
  )
  const sessionPrefix = (index: number) => (entries[index].sessionId ?? '').slice(0, 8)
  const AGENT_WITHOUT_RESUME = { ...DEFAULT_AGENT, sessionArgs: undefined, resumeArgs: undefined }
  const context = (terminalId: string, terminalLabel = terminalId) => ({
    projectPath: "/Users/me/Code/it's-mine",
    lanes: boardLanes,
    terminalId,
    terminalLabel
  })

  describe('orchestratorTabTitle', () => {
    it('upper-cases the lane name and joins whitespace runs with one hyphen', () => {
      expect(orchestratorTabTitle({ name: 'In Development' })).toBe('AUTORUN-ORCHESTRATOR-IN-DEVELOPMENT')
      expect(orchestratorTabTitle({ name: '  merge \t request\n' })).toBe('AUTORUN-ORCHESTRATOR-MERGE-REQUEST')
    })

    it('stays within what main accepts for a long lane name', () => {
      const title = orchestratorTabTitle({ name: '🚀'.repeat(300) })
      expect(title.length).toBeLessThanOrEqual(200)
      expect(title.startsWith('AUTORUN-ORCHESTRATOR-🚀')).toBe(true)
      expect(title).not.toMatch(/\p{Cc}/u)
    })

    it('never ends on a bare prefix', () => {
      expect(orchestratorTabTitle({ name: '   ' })).toBe('AUTORUN-ORCHESTRATOR-LANE')
    })
  })

  describe('orchestratorPromptTokenHelp', () => {
    it('lists every token, one per line, and marks the required ones', () => {
      const helpLines = orchestratorPromptTokenHelp().split('\n')
      expect(helpLines[0]).toBe('Variables:')
      for (const token of Object.values(ORCHESTRATOR_PROMPT_TOKENS)) {
        const tokenLine = helpLines.find((line) => line.startsWith(`${token}:`))
        const isRequired = token === ORCHESTRATOR_PROMPT_TOKENS.tickets || token === ORCHESTRATOR_PROMPT_TOKENS.ticketNumbers
        expect(tokenLine).toBeDefined()
        expect(tokenLine?.endsWith('(required)')).toBe(isRequired)
      }
    })
  })

  describe('orchestratorPromptTemplate', () => {
    const allTokens = Object.values(ORCHESTRATOR_PROMPT_TOKENS)

    it('holds every launch-time token in place of the lane name, id and poll step', () => {
      const template = orchestratorPromptTemplate(inDev, context('ghostty', 'Ghostty'))
      expect(template).toContain('"{{lane_name}}" lane')
      expect(template).toContain('still in the {{lane_id}} lane')
      expect(template).toContain('has left the {{lane_id}} lane')
      expect(template).toContain('Loop:\n{{poll_step}}\n2.')
      expect(template).not.toContain('In Development')
      expect(template).not.toContain('sleep')
      for (const token of allTokens) expect(template).toContain(token)
      expect(template).not.toContain('osascript')
    })

    it('does not require the lane or poll tokens', () => {
      expect(orchestratorPromptMissingTokens('{{tickets}} {{ticket_numbers}}')).toEqual([])
    })

    it('includes existing lane instructions', () => {
      const steered = { ...inDev, orchestratorPrompt: 'Poll every 2 minutes.' }
      const template = orchestratorPromptTemplate(steered, context('ghostty', 'Ghostty'))
      expect(template).toContain('Lane instructions')
      expect(template).toContain('Poll every 2 minutes.')
    })

    it('reports only the missing ticket tokens', () => {
      expect(orchestratorPromptMissingTokens('{{tickets}} {{ticket_numbers}}')).toEqual([])
      expect(orchestratorPromptMissingTokens('{{tickets}} {{lanes}}')).toEqual(['{{ticket_numbers}}'])
      expect(orchestratorPromptMissingTokens('nothing')).toEqual(['{{tickets}}', '{{ticket_numbers}}'])
    })
  })

  describe('orchestratorPrompt with a current prompt', () => {
    const ghostty = context('ghostty', 'Ghostty')
    const generated = orchestratorPrompt(inDev, entries, ghostty)

    it('filling the unedited template gives the generated prompt', () => {
      for (const terminalContext of [ghostty, context('warp', 'Warp')]) {
        const template = orchestratorPromptTemplate(inDev, terminalContext)
        const overridden = { ...inDev, currentAgentOrchestratorPrompt: template }
        expect(orchestratorPrompt(overridden, entries, terminalContext)).toBe(orchestratorPrompt(inDev, entries, terminalContext))
      }
    })

    it('fills known tokens with launch data and leaves unknown ones', () => {
      const override = 'Watch:\n{{tickets}}\nIN ({{ticket_numbers}})\n{{lanes}}\n{{terminal}}\n{{foo}}'
      const filled = orchestratorPrompt({ ...inDev, currentAgentOrchestratorPrompt: override }, entries, ghostty)
      expect(filled).toContain(`- #12 First thing — session ${sessionPrefix(0)} — tab "12-In-Development-First thing · ${sessionPrefix(0)}" — branch t12-first-thing`)
      expect(filled).toContain('IN (12, 13)')
      expect(filled).toContain('- done — Done — agent work: no')
      expect(filled).toContain('tell application "Ghostty" to get name of every tab of every window')
      expect(filled).toContain('{{foo}}')
      for (const token of Object.values(ORCHESTRATOR_PROMPT_TOKENS)) expect(filled).not.toContain(token)
      expect(filled).not.toContain('You report only')
    })

    it('follows the launch terminal in an edited prompt', () => {
      const lane = { ...inDev, currentAgentOrchestratorPrompt: '{{tickets}} {{ticket_numbers}}\n{{terminal}}' }
      expect(orchestratorPrompt(lane, entries, context('warp', 'Warp'))).toContain('kill -TERM <pid>')
    })

    it('does not expand a token that appears inside a ticket title', () => {
      const tricky = [ticket(14, 'About {{lanes}}'), ticket(15, 'Other')].map((entry) =>
        buildAutoRunLaunch(entry, inDev, DEFAULT_AGENT, {}, true)
      )
      const lane = { ...inDev, currentAgentOrchestratorPrompt: '{{tickets}}' }
      expect(orchestratorPrompt(lane, tricky, ghostty)).toContain('#14 About {{lanes}}')
    })

    it('uses the generated prompt for a whitespace-only current prompt', () => {
      const lane = { ...inDev, currentAgentOrchestratorPrompt: '  \n\t ' }
      expect(orchestratorPrompt(lane, entries, ghostty)).toBe(generated)
    })

    it('runs current, else default, else the generated prompt', () => {
      const withDefault = { ...inDev, defaultAgentOrchestratorPrompt: 'Default {{ticket_numbers}}' }
      const withBoth = { ...withDefault, currentAgentOrchestratorPrompt: 'Current {{ticket_numbers}}' }
      const withBlankCurrent = { ...withDefault, currentAgentOrchestratorPrompt: '  ' }
      const withBlankDefault = { ...inDev, defaultAgentOrchestratorPrompt: ' \n ' }
      expect(orchestratorPrompt(withBoth, entries, ghostty)).toBe('Current 12, 13')
      expect(orchestratorPrompt(withDefault, entries, ghostty)).toBe('Default 12, 13')
      expect(orchestratorPrompt(withBlankCurrent, entries, ghostty)).toBe('Default 12, 13')
      expect(orchestratorPrompt(withBlankDefault, entries, ghostty)).toBe(generated)
    })

    it('appends the context file after the prompt under its own header', () => {
      const lane = { ...inDev, currentAgentOrchestratorPrompt: 'Watch {{ticket_numbers}}' }
      const additionalContext = { filePath: '/code/app/notes.md', content: '\nPing me on Slack.\n' }
      const withContext = orchestratorPrompt(lane, entries, { ...ghostty, additionalContext })
      expect(withContext).toBe('Watch 12, 13\n\nAdditional context (from /code/app/notes.md):\nPing me on Slack.')
      const generatedWithContext = orchestratorPrompt(inDev, entries, { ...ghostty, additionalContext })
      expect(generatedWithContext.startsWith(generated)).toBe(true)
    })

    it('fills the lane and poll tokens at launch, so a saved prompt follows renames and the poll stepper', () => {
      const saved = '{{lane_name}} ({{lane_id}}) {{ticket_numbers}}\n{{poll_step}}'
      const polling = { ...inDev, currentAgentOrchestratorPrompt: saved, orchestratorPollActive: true, orchestratorPollMinutes: 3 }
      expect(orchestratorPrompt(polling, entries, ghostty)).toBe(
        'In Development (in-dev) 12, 13\n1. On start, then every 3 minutes (sleep 180), gather the state above.'
      )
      const renamedNeverPolls = { ...polling, name: 'Building', orchestratorPollActive: false }
      const filled = orchestratorPrompt(renamedNeverPolls, entries, ghostty)
      expect(filled.startsWith('Building (in-dev) 12, 13\n1. On start, gather the state above once.')).toBe(true)
      expect(filled).toContain('Gather the state again only when a message from a ticket agent arrives.')
      expect(filled).not.toContain('{{')
    })

    it('restoring the app default runs the generated prompt again', () => {
      const saved = { ...inDev, currentAgentOrchestratorPrompt: 'Current {{tickets}}', defaultAgentOrchestratorPrompt: 'Default {{tickets}}' }
      const restored = { ...saved, ...APP_ORCHESTRATOR_PROMPT_PATCH }
      expect(restored.defaultAgentOrchestratorPrompt).toBe('')
      expect(orchestratorPrompt(restored, entries, ghostty)).toBe(generated)
      expect(defaultOrchestratorPrompt(restored, ghostty)).toBe(orchestratorPromptTemplate(inDev, ghostty))
    })

    it('skips a blank or absent context file', () => {
      const blankContext = { filePath: '/code/app/notes.md', content: ' \n ' }
      expect(orchestratorPrompt(inDev, entries, { ...ghostty, additionalContext: blankContext })).toBe(generated)
      expect(orchestratorPrompt(inDev, entries, { ...ghostty, additionalContext: undefined })).toBe(generated)
    })
  })

  describe('defaultOrchestratorPrompt', () => {
    const ghostty = context('ghostty', 'Ghostty')

    it('is the saved default, else the generated template, and never the current prompt', () => {
      const edited = { ...inDev, currentAgentOrchestratorPrompt: 'Current {{tickets}}' }
      const withDefault = { ...edited, defaultAgentOrchestratorPrompt: 'Default {{tickets}}' }
      expect(defaultOrchestratorPrompt(withDefault, ghostty)).toBe('Default {{tickets}}')
      expect(defaultOrchestratorPrompt(edited, ghostty)).toBe(orchestratorPromptTemplate(inDev, ghostty))
    })
  })

  describe('orchestratorPrompt', () => {
    const prompt = orchestratorPrompt(inDev, entries, context('ghostty', 'Ghostty'))

    it('lists every ticket with its title, tab title and branch', () => {
      expect(prompt).toContain(`- #12 First thing — session ${sessionPrefix(0)} — tab "12-In-Development-First thing · ${sessionPrefix(0)}" — branch t12-first-thing`)
      expect(prompt).toContain(`- #13 Second thing — session ${sessionPrefix(1)} — tab "13-In-Development-Second thing · ${sessionPrefix(1)}" — branch t13-second-thing`)
      expect(prompt).not.toContain('handoff tabs "')
    })

    // #124: a handoff's session id is picked at handoff, so only its title before " · <id>" is predicted.
    it('predicts handoff tabs without their session suffix when runs have session ids', () => {
      const fullAutoEntries = [buildAutoRunLaunch({ ...ticket(14, 'Third thing'), fullAuto: true }, inDev, DEFAULT_AGENT, {}, true)]
      const fullAutoPrompt = orchestratorPrompt(inDev, fullAutoEntries, context('ghostty', 'Ghostty'))
      const ownTab = fullAutoEntries[0].launch.title
      expect(fullAutoPrompt).toContain(`tab "${ownTab}" — branch t14-third-thing — handoff tabs "14-Merge-Request-Third thing"`)
      expect(fullAutoPrompt).not.toContain('"14-In-Development-Third thing"')
      expect(fullAutoPrompt).toContain('that title followed by " · " and an 8-character session id')
      expect(fullAutoPrompt).toContain("json_extract(agent_run_json, '\\''$.tabTitle'\\'') AS tab_title, description")
    })

    it('lists the tabs a full auto ticket opens in later lanes, so they get closed too', () => {
      const fullAutoTicket = { ...ticket(14, 'Third thing'), fullAuto: true }
      const fullAutoEntries = [buildAutoRunLaunch(fullAutoTicket, inDev, AGENT_WITHOUT_RESUME, {}, true)]
      const fullAutoPrompt = orchestratorPrompt(inDev, fullAutoEntries, context('ghostty', 'Ghostty'))
      expect(fullAutoPrompt).toContain('tab "14-In-Development-Third thing" — branch t14-third-thing — handoff tabs "14-Merge-Request-Third thing"')
    })

    it('gives a read-only DB query scoped to the project, and forbids writes', () => {
      expect(prompt).toContain(`sqlite3 -readonly "${TRACKER_DATABASE_PATH}" '`)
      const scopedSql = "WHERE project_path = '/Users/me/Code/it''s-mine' AND number IN (12, 13);"
      expect(prompt).toContain(shellQuote(scopedSql).slice(1))
      expect(prompt).toContain('Never write to the database')
    })

    it('flags which lanes still have agent work, the unassigned one included', () => {
      expect(prompt).toContain('- in-pr — Merge Request — agent work: yes')
      expect(prompt).toContain('- done — Done — agent work: no')
      expect(prompt).toContain(`- ${UNASSIGNED_LANE_ID} — No status — agent work: no`)
    })

    it('asks gh for each branch\'s PRs in every state', () => {
      expect(prompt).toContain('gh pr list --head <branch> --state all')
    })

    it("carries the chosen terminal's list and close recipes", () => {
      expect(prompt).toContain('tell application "Ghostty" to get name of every tab of every window')
      expect(prompt).toContain("'close tab t'")
      const iterm = orchestratorPrompt(inDev, entries, context('iterm2'))
      expect(iterm).toContain('tell application "iTerm"')
      expect(iterm).toContain("'close s'")
      const terminal = orchestratorPrompt(inDev, entries, context('terminal'))
      expect(terminal).toContain('custom title of t is "<TAB>"')
    })

    // #106: closing on the done message alone races the agent's lane move.
    it('closes a tab only once its ticket left the lane, and never on an ambiguous title', () => {
      const steered = { ...inDev, orchestratorPrompt: 'Close the tab when the agent says it is done.' }
      for (const generatedPrompt of [prompt, orchestratorPrompt(steered, entries, context('ghostty', 'Ghostty'))]) {
        expect(generatedPrompt).toContain('Close this lane\'s tab only after the ticket query shows the ticket has left the in-dev lane')
        expect(generatedPrompt).toContain('Never close when more than one open tab matches the title.')
      }
    })

    it('guards the close recipe in an override that keeps the terminal token', () => {
      const overridden = { ...inDev, currentAgentOrchestratorPrompt: '{{tickets}} {{ticket_numbers}}\n{{terminal}}' }
      const filled = orchestratorPrompt(overridden, entries, context('ghostty', 'Ghostty'))
      expect(filled).toContain('and its handoff tabs only once the ticket is done; skip any title more than one open tab matches')
    })

    it('gives each lane of one ticket its own tab title, and lists only later lanes as handoff tabs', () => {
      const sameTicket = { number: 14, title: 'Third thing' }
      expect(ticketTabTitle(sameTicket, inDev)).not.toBe(ticketTabTitle(sameTicket, boardLanes[1]))
      const fullAutoEntries = [buildAutoRunLaunch({ ...ticket(14, 'Third thing'), fullAuto: true }, inDev, AGENT_WITHOUT_RESUME, {}, true)]
      const fullAutoPrompt = orchestratorPrompt(inDev, fullAutoEntries, context('ghostty', 'Ghostty'))
      const promptLines = fullAutoPrompt.split('\n')
      const handoffLine = promptLines.find((line) => line.includes('— handoff tabs')) ?? ''
      expect(handoffLine).toContain('14-')
      const handoffTitles = handoffLine.slice(handoffLine.indexOf('handoff tabs'))
      expect(handoffTitles).not.toContain('14-In-Development-Third thing')
    })

    it('watches and closes Warp tabs through their agent session id', () => {
      const warp = orchestratorPrompt(inDev, entries, context('warp', 'Warp'))
      expect(warp).toContain("pgrep -f -- '--(session-id|resume) <SESSION>'")
      expect(warp).toContain('kill -TERM <pid>')
      expect(warp).toContain("json_extract(agent_run_json, '\\''$.sessionId'\\'')")
      expect(warp).toContain(`First thing — session ${entries[0].sessionId} — tab `)
      expect(warp).not.toContain('by hand')
      expect(warp).not.toContain('osascript')
    })

    it('gives non-Warp ticket lines only the short session suffix and keeps non-UUIDs off Warp ones', () => {
      const ghosttyPrompt = orchestratorPrompt(inDev, entries, context('ghostty', 'Ghostty'))
      expect(ghosttyPrompt).not.toContain(`— session ${entries[0].sessionId}`)
      const forged = [{ ...entries[0], sessionId: "x'; rm -rf ~; '" }]
      expect(orchestratorPrompt(inDev, forged, context('warp', 'Warp'))).not.toContain('— session ')
    })

    it('leaves a Warp ticket with no session id to the user to close by hand', () => {
      const noSession = [{ ...entries[0], sessionId: undefined }]
      const ticketLine = orchestratorPrompt(inDev, noSession, context('warp', 'Warp'))
        .split('\n')
        .find((line) => line.startsWith('- #12 ')) ?? ''
      expect(ticketLine).toContain('no session id: report its agent as unknown and tell the user to close its tab by hand')
    })

    // Warp closes the tab when the orchestrator exits, so exiting with questions open would erase them.
    it('exits only when nothing needs the user, in every terminal', () => {
      for (const terminal of [context('warp', 'Warp'), context('ghostty', 'Ghostty')]) {
        const prompt = orchestratorPrompt(inDev, entries, terminal)
        expect(prompt).toContain('exit only when nothing needs the user')
        expect(prompt).not.toContain('Leave your own tab open')
      }
    })

    it("appends the lane's orchestrator prompt after the generated rules", () => {
      const steered = { ...inDev, orchestratorPrompt: '  Poll every 2 minutes.\n' }
      const withInstructions = orchestratorPrompt(steered, entries, context('ghostty', 'Ghostty'))
      const expectedSection = [
        'Lane instructions',
        'These override the Loop above (e.g. which tabs to close), but never the report-only rule or the rule to close a tab only after its ticket has left this lane.',
        'Poll every 2 minutes.'
      ].join('\n')
      expect(withInstructions).toBe(`${prompt}\n\n${expectedSection}`)
    })

    it('is unchanged by an empty or whitespace-only orchestrator prompt', () => {
      for (const orchestratorText of ['', '  \n\t ']) {
        const lane = { ...inDev, orchestratorPrompt: orchestratorText }
        expect(orchestratorPrompt(lane, entries, context('ghostty', 'Ghostty'))).toBe(prompt)
      }
    })

    // The file holds a copy of this prompt; if the prompt named the file, every
    // save would differ from the last and append another copy.
    it('leaves the orchestrator and ticket prompts unchanged by an orchestrator markdown file', () => {
      const linked = { ...inDev, orchestratorFilePath: 'SwimlaneAgentPrompt/In-Dev/AgentOrchestratorPrompt.md' }
      const launchContext = context('ghostty', 'Ghostty')
      expect(orchestratorPrompt(linked, entries, launchContext)).toBe(prompt)
      expect(orchestratorPromptTemplate(linked, launchContext)).toBe(orchestratorPromptTemplate(inDev, launchContext))
      expect(ticketAgentPrompt(ticket(12, 'First thing'), linked)).toBe(ticketAgentPrompt(ticket(12, 'First thing'), inDev))
    })

    it("never puts the orchestrator prompt in a ticket agent's prompt", () => {
      const steered = { ...inDev, orchestratorPrompt: 'Poll every 2 minutes.' }
      const agentPrompt = ticketAgentPrompt(ticket(12, 'First thing'), steered)
      expect(agentPrompt).toBe(ticketAgentPrompt(ticket(12, 'First thing'), inDev))
    })

    it("polls at the lane's rate, every 2 minutes by default", () => {
      expect(prompt).toContain('every 2 minutes (sleep 120)')
      expect(prompt).not.toContain('sleep 60)')
      const slower = orchestratorPrompt({ ...inDev, orchestratorPollMinutes: 5 }, entries, context('ghostty', 'Ghostty'))
      expect(slower).toContain('every 5 minutes (sleep 300)')
    })

    it('falls back to the default for a stored poll that is not whole minutes', () => {
      for (const badMinutes of [0, -3, 1.5, Number.NaN]) {
        const corrupted = { ...inDev, orchestratorPollMinutes: badMinutes }
        expect(orchestratorPrompt(corrupted, entries, context('ghostty', 'Ghostty'))).toContain('every 2 minutes (sleep 120)')
      }
    })
  })

  describe('buildOrchestratorLaunch', () => {
    it('sends an orchestrator for a one-ticket run', () => {
      const oneTicket = entries.slice(0, 1)
      const launch = buildOrchestratorLaunch(inDev, oneTicket, DEFAULT_AGENT, context('ghostty'))
      expect(launch.command).toContain('#12 First thing')
      expect(launch.command).not.toContain('#13 Second thing')
    })

    it('sends a waiting orchestrator when the lane never polls', () => {
      const neverPolls = { ...inDev, orchestratorPollActive: false, orchestratorPollMinutes: 1 }
      const launch = buildOrchestratorLaunch(neverPolls, entries, DEFAULT_AGENT, context('ghostty'))
      expect(launch.title).toBe('AUTORUN-ORCHESTRATOR-IN-DEVELOPMENT')
      expect(launch.command).toContain('do not poll, sleep, loop or schedule wake-ups')
      expect(launch.command).toContain('only when a message from a ticket agent arrives')
      expect(launch.command).not.toContain('sleep 60')
      expect(launch.command).not.toContain('every 1 minutes')
    })

    it('keeps the poll step for a polling lane', () => {
      const polling = { ...inDev, orchestratorPollActive: true, orchestratorPollMinutes: 3 }
      const launch = buildOrchestratorLaunch(polling, entries, DEFAULT_AGENT, context('ghostty'))
      expect(launch.command).toContain('every 3 minutes (sleep 180)')
      expect(launch.command).not.toContain('do not poll')
    })

    it('previews the poll step as a token, so the template is the same whatever the poll setting', () => {
      const neverPolls = { ...inDev, orchestratorPollActive: false }
      const template = orchestratorPromptTemplate(neverPolls, context('ghostty'))
      expect(template).toContain('{{poll_step}}')
      expect(template).toBe(orchestratorPromptTemplate(inDev, context('ghostty')))
    })

    it("runs the run's agent with the prompt single-quoted, under the lane's orchestrator title", () => {
      const launch = buildOrchestratorLaunch(inDev, entries, DEFAULT_AGENT, context('ghostty'))
      expect(launch.title).toBe('AUTORUN-ORCHESTRATOR-IN-DEVELOPMENT')
      expect(launch.command.startsWith("claude --name 'AUTORUN-ORCHESTRATOR-IN-DEVELOPMENT' '")).toBe(true)
      expect(launch.command).toContain("it'\\''s-mine")
    })
  })

  describe('steppedOrchestratorPoll', () => {
    const off = { ...inDev, orchestratorPollActive: false, orchestratorPollMinutes: 7 }

    it('turns an off lane on at 1 minute, and cannot step below off', () => {
      expect(steppedOrchestratorPoll(off, 1)).toEqual({ orchestratorPollActive: true, orchestratorPollMinutes: 1 })
      expect(steppedOrchestratorPoll(off, -1)).toBeUndefined()
    })

    it('turns the lane off when stepping down from 1, leaving minutes alone', () => {
      const oneMinute = { ...inDev, orchestratorPollActive: true, orchestratorPollMinutes: 1 }
      expect(steppedOrchestratorPoll(oneMinute, -1)).toEqual({ orchestratorPollActive: false })
    })

    it('steps whole minutes by one', () => {
      const fiveMinutes = { ...inDev, orchestratorPollMinutes: 5 }
      expect(steppedOrchestratorPoll(fiveMinutes, -1)).toEqual({ orchestratorPollMinutes: 4 })
      expect(steppedOrchestratorPoll(fiveMinutes, 1)).toEqual({ orchestratorPollMinutes: 6 })
    })

    it('steps a corrupted stored value from the default', () => {
      for (const badMinutes of [0, 1.5]) {
        const corrupted = { ...inDev, orchestratorPollMinutes: badMinutes }
        expect(steppedOrchestratorPoll(corrupted, 1)).toEqual({ orchestratorPollMinutes: 3 })
      }
    })
  })
})

describe('semantic version', () => {
  const lane = (overrides: Partial<SwimLane> = {}): SwimLane => ({
    id: 'in-pr',
    name: 'In PR',
    agentPrompt: '',
    agentFilePath: '',
    ...overrides
  })
  const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
    id: 'ticket-1',
    number: 7,
    laneId: 'in-pr',
    title: 'Add the thing',
    description: 'Make it work.',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  })

  it('normalizes valid versions and rejects the rest', () => {
    expect(normalizeSemanticVersion(' 1.4.0 ')).toBe('1.4.0')
    expect(normalizeSemanticVersion('v2.0.1')).toBe('2.0.1')
    expect(normalizeSemanticVersion('1.0.0-rc.1+build.5')).toBe('1.0.0-rc.1+build.5')
    expect(normalizeSemanticVersion('   ')).toBeUndefined()
    for (const invalid of ['1.2', '1.2.3.4', '01.2.3', 'v', 'latest']) {
      expect(normalizeSemanticVersion(invalid)).toBeNull()
    }
  })

  it('lists the version in ticket metadata only when set', () => {
    const withVersion = ticketAgentPrompt(ticket({ worktreePath: '/wt', version: '1.4.0' }), lane())
    expect(withVersion).toContain('Worktree: /wt\nVersion: 1.4.0')
    expect(ticketAgentPrompt(ticket(), lane())).not.toContain('Version:')
  })

  it('tells the agent how to set the version only in lanes with the toggle on', () => {
    const context = { projectPath: "/code/o'brien" }
    const unchanged = ticketAgentPrompt(ticket(), lane(), context)
    expect(unchanged).toBe('Ticket #7: Add the thing\nStatus: In PR\n\nMake it work.')

    const prompt = ticketAgentPrompt(ticket(), lane({ agentSetsVersion: true }), context)
    expect(prompt).toContain("Make it work.\n\nSemantic version: you decide whether this ticket's work needs a version")
    expect(prompt).toContain(`sqlite3 "${TRACKER_DATABASE_PATH}" 'UPDATE tickets SET version = `)
    expect(prompt).toContain("project_path = '\\''/code/o'\\'''\\''brien'\\'' AND number = 7;")
  })

  it('points the version command at a supplied database path', () => {
    // Single-quoted so a $ or quote in the path can't expand or break the command.
    const context = { projectPath: '/code/app', databasePath: '/tmp/$user "x"/project-tracker.sqlite' }
    const prompt = ticketAgentPrompt(ticket(), lane({ agentSetsVersion: true }), context)
    expect(prompt).toContain(`sqlite3 '/tmp/$user "x"/project-tracker.sqlite' 'UPDATE tickets SET version = `)
    expect(prompt).not.toContain(TRACKER_DATABASE_PATH)
  })

  it('keeps the version sentence but drops the command without a project path', () => {
    const prompt = ticketAgentPrompt(ticket(), lane({ agentSetsVersion: true }))
    expect(prompt).toContain("Leave it unset if it doesn't apply yet.")
    expect(prompt).not.toContain('sqlite3')
  })
})

describe('isGithubUnreachableError', () => {
  it('matches the unreachable message after IPC wraps it', () => {
    const wrapped = new Error(`Error invoking remote method 'project:fetch-github': Error: ${GITHUB_UNREACHABLE_MESSAGE}`)
    expect(isGithubUnreachableError(wrapped)).toBe(true)
  })

  it('ignores other GitHub failures and non-errors', () => {
    expect(isGithubUnreachableError(new Error('GitHub rate limit reached. Try again in a while.'))).toBe(false)
    expect(isGithubUnreachableError(new Error('Repository not found on GitHub.'))).toBe(false)
    expect(isGithubUnreachableError(GITHUB_UNREACHABLE_MESSAGE)).toBe(false)
    expect(isGithubUnreachableError(undefined)).toBe(false)
  })
})

describe('agent model', () => {
  const agents = availableAgents({})
  const byId = (id: string) => agents.find((agent) => agent.id === id)!
  const modelLane: SwimLane = { id: 'dev', name: 'Dev', agentPrompt: '', agentFilePath: '' }
  const modelTicket = (number: number): Ticket => ({
    id: `ticket-${number}`,
    number,
    laneId: 'dev',
    title: 'Model work',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z'
  })

  it('puts each built-in model flag before the prompt flags, model quoted', () => {
    expect(agentShellCommand(byId('claude-code'), 'p', { model: 'opus' })).toBe("claude --model 'opus' 'p'")
    expect(agentShellCommand(byId('codex'), 'p', { model: 'gpt-5' })).toBe("codex -m 'gpt-5' 'p'")
    expect(agentShellCommand(byId('opencode'), 'p', { model: 'anthropic/claude' })).toBe(
      "opencode -m 'anthropic/claude' --prompt 'p'"
    )
  })

  it('adds no flag for an empty, blank or "-"-prefixed model', () => {
    for (const model of [undefined, '', '   ', '--dangerously-skip-permissions']) {
      expect(agentShellCommand(DEFAULT_AGENT, 'p', { model })).toBe("claude 'p'")
    }
  })

  it('adds no flag for an agent that cannot take a model', () => {
    expect(agentShellCommand(byId('hermes'), 'p', { model: 'some-model' })).toBe("hermes chat -q 'p'")
  })

  it('carries the model into an Auto Run launch', () => {
    const entry = buildAutoRunLaunch(modelTicket(3), modelLane, DEFAULT_AGENT, {}, false, 'sonnet')
    expect(entry.launch.command.startsWith("claude --model 'sonnet' ")).toBe(true)
  })

  it('falls back to the ticket agent and its model when the lane names no orchestrator', () => {
    const ticketChoice = { agent: byId('codex'), model: 'gpt-5' }
    expect(orchestratorAgentChoice({}, ticketChoice, agents)).toEqual(ticketChoice)
    expect(orchestratorAgentChoice({ orchestratorModel: 'gpt-5-mini' }, ticketChoice, agents)).toEqual({
      agent: byId('codex'),
      model: 'gpt-5-mini'
    })
  })

  it('uses the lane orchestrator agent with its own model, not the ticket model', () => {
    const ticketChoice = { agent: DEFAULT_AGENT, model: 'opus' }
    const choice = orchestratorAgentChoice({ orchestratorAgentId: 'codex' }, ticketChoice, agents)
    expect(choice).toEqual({ agent: byId('codex'), model: undefined })
    const entries = [1, 2].map((number) => buildAutoRunLaunch(modelTicket(number), modelLane, DEFAULT_AGENT, {}, false))
    const context = { projectPath: '/p', lanes: [modelLane], terminalId: 'iterm2', terminalLabel: 'iTerm2' }
    const tab = buildOrchestratorLaunch(modelLane, entries, choice.agent, context, 'gpt-5-mini')!
    expect(tab.command.startsWith("codex -m 'gpt-5-mini' ")).toBe(true)
  })
})

describe('boardWrites', () => {
  const baseLane = (id: string) => ({ id, name: id, agentPrompt: '', agentFilePath: '' })
  const baseTicket = { id: 't1', number: 1, laneId: 'a', title: 'T', description: '', createdAt: '2026-01-01T00:00:00.000Z' }
  const board = { lanes: [baseLane('a'), baseLane('b')], tickets: [baseTicket] }

  it('emits nothing for an identical board', () => {
    expect(boardWrites(board, structuredClone(board))).toEqual([])
  })

  it('sends only the changed field of a ticket, plus its updatedAt', () => {
    const edited = { ...board, tickets: [{ ...baseTicket, title: 'T2' }] }
    expect(boardWrites(board, edited)).toStrictEqual([
      { kind: 'ticket:update', id: 't1', patch: { title: 'T2', updatedAt: undefined } }
    ])
  })

  it('keeps a cleared field as an explicit undefined', () => {
    const before = { ...board, tickets: [{ ...baseTicket, branchName: 'feat/x' }] }
    const [write] = boardWrites(before, board)
    expect(write).toStrictEqual({ kind: 'ticket:update', id: 't1', patch: { branchName: undefined, updatedAt: undefined } })
  })

  it('creates lanes before tickets and deletes last, tickets before lanes', () => {
    const after = {
      lanes: [baseLane('c'), baseLane('a')],
      tickets: [{ ...baseTicket, laneId: 'c' }, { ...baseTicket, id: 't2', number: 2, laneId: 'c' }]
    }
    const before = { ...board, tickets: [...board.tickets, { ...baseTicket, id: 't3', number: 3, laneId: 'b' }] }
    const kinds = boardWrites(before, after).map((write) => write.kind)
    expect(kinds).toEqual(['lane:create', 'ticket:create', 'ticket:update', 'lane:reorder', 'ticket:delete', 'lane:delete'])
  })

  it('skips the reorder when lanes are only appended or removed', () => {
    const after = { ...board, lanes: [baseLane('b'), baseLane('c')] }
    expect(boardWrites(board, after).map((write) => write.kind)).toEqual(['lane:create', 'lane:delete'])
  })

  it('updates the unassigned column by its own id', () => {
    const after = updateLaneInBoard(board, UNASSIGNED_LANE_ID, { agentPrompt: 'Triage.' })
    expect(boardWrites(board, after)).toEqual([
      { kind: 'lane:update', laneId: UNASSIGNED_LANE_ID, patch: { agentPrompt: 'Triage.' } }
    ])
  })
})

describe('laneTransitions', () => {
  const lane = (id: string, nextLaneId?: string) => ({ id, name: id, agentPrompt: '', agentFilePath: '', nextLaneId })
  const ticket = (id: string, laneId: string, moveToLaneId?: string) =>
    ({ id, number: 1, laneId, title: id, description: '', createdAt: '', updatedAt: '', moveToLaneId }) as Ticket

  it('draws one lane edge per Next Lane, forward and backward', () => {
    const lanes = [lane('dev', 'mr'), lane('mr', 'dev')]
    expect(laneTransitions(lanes, [])).toEqual([
      { from: 'dev', to: 'mr', kind: 'lane', ticketIds: [] },
      { from: 'mr', to: 'dev', kind: 'lane', ticketIds: [] }
    ])
  })

  it('merges ticket overrides by source and target, and skips inherit-only tickets', () => {
    const lanes = [lane('idea', 'prd'), lane('prd'), lane('dev')]
    const tickets = [ticket('a', 'idea', 'dev'), ticket('b', 'idea', 'dev'), ticket('c', 'idea'), ticket('d', 'idea', 'prd')]
    expect(laneTransitions(lanes, tickets)).toEqual([
      { from: 'idea', to: 'prd', kind: 'lane', ticketIds: [] },
      { from: 'idea', to: 'dev', kind: 'override', ticketIds: ['a', 'b'] }
    ])
  })

  it('drops targets that are hidden, missing, or the lane itself', () => {
    const lanes = [lane('idea', 'hidden'), lane('prd', 'prd')]
    const tickets = [ticket('a', 'idea', 'gone'), ticket('b', 'prd', 'prd'), ticket('c', 'hidden', 'idea')]
    expect(laneTransitions(lanes, tickets)).toEqual([])
  })

  it('treats the unassigned lane as a normal source', () => {
    const lanes = [lane(UNASSIGNED_LANE_ID, 'idea'), lane('idea')]
    const tickets = [ticket('a', UNASSIGNED_LANE_ID, UNASSIGNED_LANE_ID), ticket('b', UNASSIGNED_LANE_ID, 'idea')]
    expect(laneTransitions(lanes, tickets)).toEqual([{ from: UNASSIGNED_LANE_ID, to: 'idea', kind: 'lane', ticketIds: [] }])
  })
})

describe('promptRules / rulesToPrompt', () => {
  const bulletPrompt = [
    '- Fill out the missing details for the ticket in the project tracker. ',
    "- If there are no open questions move the ticket, update the ticket status to 'PRD'. ",
    '',
    '- As soon as you are done, send a message to the Orchestrator agent.'
  ].join('\n')
  const numberedPrompt = [
    '1. Verify if there is an existing worktree. 2. Use the /worktree skill for all work in this lane. ',
    '3. Upon completion of work, verify all original tasks have been completed. ',
    '5. Upon completion of steps 1-5, move the ticket.',
    '- As soon as you are done, send a message to the Orchestrator agent.'
  ].join('\n')

  it('splits bullets into rules, dropping markers, blank lines and trailing spaces', () => {
    expect(promptRules(bulletPrompt)).toEqual([
      'Fill out the missing details for the ticket in the project tracker.',
      "If there are no open questions move the ticket, update the ticket status to 'PRD'.",
      'As soon as you are done, send a message to the Orchestrator agent.'
    ])
  })

  it('keeps numbered lines as their own rules with the number intact', () => {
    const rules = promptRules(numberedPrompt)
    expect(rules).toHaveLength(4)
    expect(rules[2]).toBe('5. Upon completion of steps 1-5, move the ticket.')
    expect(rulesToPrompt(rules)).toBe(numberedPrompt.split('\n').map(line => line.trimEnd()).join('\n'))
  })

  it('joins continuation lines and treats text before the first bullet as a rule', () => {
    expect(promptRules('Intro line\n- first\n  more of first\n* second')).toEqual(['Intro line', 'first\n  more of first', 'second'])
  })

  it('round-trips through rulesToPrompt', () => {
    for (const prompt of [bulletPrompt, numberedPrompt, 'Intro\n- a\n  b\n- - dash']) {
      const rules = promptRules(prompt)
      expect(promptRules(rulesToPrompt(rules))).toEqual(rules)
    }
    expect(rulesToPrompt(promptRules(bulletPrompt))).toBe(promptRules(bulletPrompt).map(rule => `- ${rule}`).join('\n'))
  })

  it('keeps indented sub-bullets and sub-steps inside their parent rule', () => {
    const nestedPrompt = '1. Open the PR.\n   - TOF body:\n     - tabs for nesting\n   2) sub-step\n- Post the link.'
    const rules = promptRules(nestedPrompt)
    expect(rules).toEqual(['1. Open the PR.\n   - TOF body:\n     - tabs for nesting\n   2) sub-step', 'Post the link.'])
    expect(rulesToPrompt(rules)).toBe(nestedPrompt)
  })

  it('maps an empty prompt to no rules and back', () => {
    expect(promptRules('  \n\n')).toEqual([])
    expect(rulesToPrompt([])).toBe('')
  })
})

describe('githubErrorMessage', () => {
  it('shows only the offline label for a wrapped unreachable error', () => {
    const wrapped = new Error(
      `Error invoking remote method 'ticket:fetch-pull-request': Error: ${GITHUB_UNREACHABLE_MESSAGE}`
    )
    expect(githubErrorMessage(wrapped)).toBe('Offline Mode')
  })

  it('passes other errors through', () => {
    expect(githubErrorMessage(new Error('Repository not found on GitHub.'))).toBe('Repository not found on GitHub.')
    expect(githubErrorMessage('boom')).toBe('boom')
  })
})

describe('graph positions', () => {
  const lane = (id: string, graphPosition?: { x: number; y: number }) => ({ id, name: id, agentPrompt: '', agentFilePath: '', graphPosition })

  it('puts a lane with no saved position in its row slot', () => {
    expect(laneGraphPosition(lane('a'), 0)).toEqual({ x: 50, y: 70 })
    expect(laneGraphPosition(lane('c'), 2)).toEqual({ x: 490, y: 70 })
  })

  it('keeps a saved position', () => {
    expect(laneGraphPosition(lane('a', { x: 5, y: 300 }), 3)).toEqual({ x: 5, y: 300 })
  })

  it('treats a malformed saved position as unset', () => {
    const malformedPositions = [[10, 20], { x: '5', y: 5 }, { x: 5 }, null]
    for (const malformed of malformedPositions) {
      const malformedLane = { ...lane('b'), graphPosition: malformed as unknown as { x: number; y: number } }
      expect(laneGraphPosition(malformedLane, 1)).toEqual({ x: 270, y: 70 })
    }
  })

  it('places a new node one column right of the rightmost node', () => {
    expect(graphPositionRightOf([{ x: 50, y: 70 }, { x: 900, y: 400 }, { x: 270, y: 70 }])).toEqual({ x: 1120, y: 70 })
    expect(graphPositionRightOf([])).toEqual({ x: 50, y: 70 })
  })
})
