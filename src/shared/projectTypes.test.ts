import { describe, expect, it } from 'vitest'

import {
  normalizeSemanticVersion,
  shellQuote,
  agentRunBadge,
  hasUnseenAgentResult,
  buildAutoRunLaunch,
  buildOrchestratorLaunch,
  orchestratorPrompt,
  orchestratorTabTitle,
  TRACKER_DATABASE_PATH,
  completionMoves,
  fullAutoHandoffs,
  isFullAuto,
  autoRunUsesWorktrees,
  addGithubIssuesToBoard,
  agentMarkdownFileName,
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
  getUnassignedLane,
  normalizeBoard,
  nextTicketNumber,
  updateLaneInBoard,
  UNASSIGNED_LANE_ID,
  addChecklistItem,
  ticketsToRun,
  agentForTicket,
  availableAgents,
  DEFAULT_AGENT,
  ticketAgentPrompt,
  ticketBranchName,
  ticketTabTitle,
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
  toggleHiddenLane,
  MAX_LANE_WIDTH,
  MIN_LANE_WIDTH,
  TICKET_CARD_FIELDS,
  isWebUrl,
  pullRequestLabel,
  isPullRequestSettled,
  pullRequestStatusLabel,
  toPullRequestStatus,
  worktreeFolderName,
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


describe('addGithubIssuesToBoard', () => {
  const issues: GithubIssue[] = [
    { number: 1, title: 'Fix login', body: 'Steps to reproduce', htmlUrl: 'https://github.com/o/r/issues/1' },
    { number: 2, title: 'Add export', body: '', htmlUrl: 'https://github.com/o/r/issues/2' }
  ]

  it('creates the import lane at the far left and files every issue in it', () => {
    const { board, added } = addGithubIssuesToBoard(boardWithTickets(), issues)
    expect(added).toBe(2)
    expect(board.lanes[0].id).toBe(GITHUB_IMPORT_LANE_ID)
    const imported = board.tickets.filter((ticket) => ticket.externalId)
    expect(imported.map((ticket) => ticket.title)).toEqual(['Fix login', 'Add export'])
    expect(imported.every((ticket) => ticket.laneId === GITHUB_IMPORT_LANE_ID)).toBe(true)
  })

  it('reuses the existing import lane on later pulls', () => {
    const first = addGithubIssuesToBoard(boardWithTickets(), issues)
    const second = addGithubIssuesToBoard(first.board, issues)
    expect(second.added).toBe(0)
    expect(second.board.lanes.filter((lane) => lane.id === GITHUB_IMPORT_LANE_ID)).toHaveLength(1)
    expect(second.board.tickets).toHaveLength(first.board.tickets.length)
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
    const { board, added } = addGithubIssuesToBoard(emptied, issues)
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

  it('numbers imported issues sequentially after existing tickets', () => {
    const issues: GithubIssue[] = [
      { number: 90, title: 'One', body: '', htmlUrl: 'https://github.com/o/r/issues/90' },
      { number: 91, title: 'Two', body: '', htmlUrl: 'https://github.com/o/r/issues/91' }
    ]
    const { board } = addGithubIssuesToBoard(boardWithTickets(), issues)
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
    expect(searchText).toContain('#1')
    expect(searchText).toContain('ui')
    expect(searchText).toContain('fix/drag-drop')
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
      "claude 'Ship small diffs.\n\nTicket #7: Add the thing\nStatus: In Development\n\nMake it work.'"
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

  it('omits an empty lane prompt and description rather than leaving blank gaps', () => {
    const command = ticketShellCommand(ticket({ description: '   ' }), lane())
    expect(command).toBe("claude 'Ticket #7: Add the thing\nStatus: In Development'")
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

  it('lists external links only when the ticket has some', () => {
    const linkedTicket = ticket({ externalLinks: ['https://figma.com/f', 'https://slack.com/t'] })
    expect(ticketAgentPrompt(linkedTicket, lane())).toContain('Links:\n- https://figma.com/f\n- https://slack.com/t')
    expect(ticketAgentPrompt(ticket(), lane())).not.toContain('Links:')
    expect(ticketAgentPrompt(ticket({ externalLinks: [] }), lane())).not.toContain('Links:')
  })

  it('ends with the lane output target and permission to reuse an existing location', () => {
    const prompt = ticketAgentPrompt(ticket(), lane({ outputTarget: 'a new folder called PRD' }))
    const outputSection = prompt.split('\n\n').at(-1)
    expect(outputSection).toContain('Output: a new folder called PRD')
    expect(outputSection).toContain('use it as-is without asking')
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

  it("escapes a description's own single quotes so the shell string stays closed", () => {
    const command = ticketShellCommand(ticket({ description: "don't break" }), lane())
    expect(command).toBe("claude 'Ticket #7: Add the thing\nStatus: In Development\n\ndon'\\''t break'")
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

describe('ticketTabTitle', () => {
  it('leads with the ticket number', () => {
    expect(ticketTabTitle({ number: 33, title: 'Short title' })).toBe('#33 Short title')
  })

  it('cuts a long title to 40 code points plus an ellipsis', () => {
    const title = ticketTabTitle({ number: 33, title: 'Auto-run should attempt to set a title per new tab created.' })
    expect(title).toBe('#33 Auto-run should attempt to set a tit…')
    expect(Array.from(title)).toHaveLength(41)
  })

  it('never splits an emoji at the cut', () => {
    const title = ticketTabTitle({ number: 1, title: `${'a'.repeat(37)}🚀🚀` })
    expect(title).toBe(`#1 ${'a'.repeat(37)}…`)
    const atCut = ticketTabTitle({ number: 1, title: `${'a'.repeat(36)}🚀tail` })
    expect(atCut).toBe(`#1 ${'a'.repeat(36)}🚀…`)
  })

  it('strips newlines and terminal control characters', () => {
    expect(ticketTabTitle({ number: 7, title: 'one\n two\u001b]0;pwn\u0007\tend' })).toBe('#7 one two ]0;pwn end')
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
    expect(sections.at(-2)).toMatch(/^Full auto is on\. .*Then exit\.$/)
    expect(sections.at(-1)).toMatch(/^Output: docs\/prd\//)
    const onPromptWithoutSection = sections.filter((section) => !section.startsWith(FULL_AUTO_SECTION)).join('\n\n')
    expect(onPromptWithoutSection).toBe(offPrompt)
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

    it('moves a ticket whose checklist just went all-done and disarms it, keeping the target', () => {
      const { board, moves } = movesBetween(armed(), completed(), [], '2026-02-02T00:00:00.000Z')
      expect(moves.map((move) => `${move.ticket.number}->${move.toLane.name}`)).toEqual(['7->DEV'])
      expect(board.tickets[0]).toMatchObject({
        laneId: 'dev',
        moveToLaneId: 'dev',
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
  })

  it('keeps a ticket on its existing branch and drops its worktree path from the prompt when worktrees are on', () => {
    const placedTicket = ticket({ branchName: 't7-existing', worktreePath: '/code/.worktrees/t7' })
    const { launch } = buildAutoRunLaunch(placedTicket, lane('dev'), DEFAULT_AGENT, {}, true)
    expect(launch.branchName).toBe('t7-existing')
    expect(launch.command).toContain('Branch: t7-existing')
    expect(launch.command).not.toContain('Worktree:')
    expect(launch.title).toBe('#7 Add the thing')

    const inPlace = buildAutoRunLaunch(placedTicket, lane('dev'), DEFAULT_AGENT, {}, false)
    expect(inPlace.launch.command).toContain('Worktree: /code/.worktrees/t7')
  })

  it('keeps worktrees on for a ticket that already has one, even when the lane has them off', () => {
    const worktreesOff = lane('dev', { autoRunWorktrees: false })
    expect(autoRunUsesWorktrees(worktreesOff)).toBe(false)
    expect(autoRunUsesWorktrees(worktreesOff, ticket({ worktreePath: '/code/.worktrees/t7' }))).toBe(true)
    expect(autoRunUsesWorktrees(lane('dev'), ticket())).toBe(true)
  })
})

describe('agentMarkdownFileName', () => {
  it('turns spaces and path separators into hyphens', () => {
    expect(agentMarkdownFileName('My Project', 'In Review')).toBe('My-Project-In-Review-AgentContext.md')
    expect(agentMarkdownFileName('ProjectTracker/electron-app', 'PRD')).toBe('ProjectTracker-electron-app-PRD-AgentContext.md')
  })

  it('strips characters filesystems reject', () => {
    expect(agentMarkdownFileName('a:b*c?d"e<f>g|h', 'lane')).toBe('abcdefgh-lane-AgentContext.md')
  })

  it('never yields a path separator or a leading dot from a traversal name', () => {
    const fileName = agentMarkdownFileName('app', '../../etc/passwd')
    expect(fileName).not.toMatch(/[/\\]/)
    expect(fileName.startsWith('.')).toBe(false)
    expect(agentMarkdownFileName('..', '.hidden')).toBe('project-hidden-AgentContext.md')
  })

  it('falls back when a part sanitizes to nothing', () => {
    expect(agentMarkdownFileName('', '  ')).toBe('project-lane-AgentContext.md')
    expect(agentMarkdownFileName('***', '- -')).toBe('project-lane-AgentContext.md')
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

  describe('orchestratorPrompt', () => {
    const prompt = orchestratorPrompt(inDev, entries, context('ghostty', 'Ghostty'))

    it('lists every ticket with its title, tab title and branch', () => {
      expect(prompt).toContain('- #12 First thing — tab "#12 First thing" — branch t12-first-thing')
      expect(prompt).toContain('- #13 Second thing — tab "#13 Second thing" — branch t13-second-thing')
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

    it('tells the user to close Warp tabs by hand', () => {
      const warp = orchestratorPrompt(inDev, entries, context('warp', 'Warp'))
      expect(warp).toContain('Warp cannot be queried')
      expect(warp).toContain('close its tab by hand')
      expect(warp).not.toContain('osascript')
    })

    it("appends the lane's orchestrator prompt after the generated rules", () => {
      const steered = { ...inDev, orchestratorPrompt: '  Poll every 2 minutes.\n' }
      const withInstructions = orchestratorPrompt(steered, entries, context('ghostty', 'Ghostty'))
      const expectedSection = [
        'Lane instructions',
        'These override the Loop above (e.g. closing tabs), but never the report-only rule.',
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

    it("never puts the orchestrator prompt in a ticket agent's prompt", () => {
      const steered = { ...inDev, orchestratorPrompt: 'Poll every 2 minutes.' }
      const agentPrompt = ticketAgentPrompt(ticket(12, 'First thing'), steered)
      expect(agentPrompt).toBe(ticketAgentPrompt(ticket(12, 'First thing'), inDev))
      expect(agentPrompt).not.toContain('Poll every 2 minutes.')
    })

    it("polls at the lane's rate, every 2 minutes by default", () => {
      expect(prompt).toContain('every 2 minutes (sleep 120)')
      expect(prompt).not.toContain('sleep 60)')
      const slower = orchestratorPrompt({ ...inDev, orchestratorPollMinutes: 5 }, entries, context('ghostty', 'Ghostty'))
      expect(slower).toContain('every 5 minutes (sleep 300)')
    })

    it('no longer advertises the poll interval as a lane-instruction override', () => {
      const steered = { ...inDev, orchestratorPrompt: 'Flag PRs with failing checks.' }
      const withInstructions = orchestratorPrompt(steered, entries, context('ghostty', 'Ghostty'))
      expect(withInstructions).not.toContain('poll interval')
    })
  })

  describe('buildOrchestratorLaunch', () => {
    it('sends no orchestrator for a one-ticket run', () => {
      expect(buildOrchestratorLaunch(inDev, entries.slice(0, 1), DEFAULT_AGENT, context('ghostty'))).toBeUndefined()
    })

    it('sends no orchestrator when the lane turned its orchestrator off', () => {
      const inactive = { ...inDev, orchestratorPollActive: false }
      expect(buildOrchestratorLaunch(inactive, entries, DEFAULT_AGENT, context('ghostty'))).toBeUndefined()
    })

    it("runs the run's agent with the prompt single-quoted, under the lane's orchestrator title", () => {
      const launch = buildOrchestratorLaunch(inDev, entries, DEFAULT_AGENT, context('ghostty'))
      expect(launch?.title).toBe('AUTORUN-ORCHESTRATOR-IN-DEVELOPMENT')
      expect(launch?.command.startsWith(`${DEFAULT_AGENT.command} '`)).toBe(true)
      expect(launch?.command).toContain("it'\\''s-mine")
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

  it('keeps the version sentence but drops the command without a project path', () => {
    const prompt = ticketAgentPrompt(ticket(), lane({ agentSetsVersion: true }))
    expect(prompt).toContain("Leave it unset if it doesn't apply yet.")
    expect(prompt).not.toContain('sqlite3')
  })
})
