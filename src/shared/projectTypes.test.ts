import { describe, expect, it } from 'vitest'

import {
  buildAutoRunLaunch,
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
    expect(savedBeforeTracking.cardFields).toEqual(['number', 'branch', 'worktree', 'pullRequest'])

    const switchedOffAfterTracking = toggleCardField(savedBeforeTracking, 'worktree')
    const reread = getBoardPreferences(stateWith(switchedOffAfterTracking), '/repo')
    expect(reread.cardFields).not.toContain('worktree')
    expect(reread.cardFields).toContain('pullRequest')
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
    expect(agents.map((agent) => agent.id)).toEqual(['claude-code', 'codex', 'hermes', 'aider'])

    const savedCodex = { id: 'codex', name: 'My Codex', command: '/opt/bin/codex', headlessArgs: [] }
    const withSavedCodex = availableAgents({ agents: [savedCodex] })
    expect(withSavedCodex.filter((agent) => agent.id === 'codex')).toEqual([savedCodex])
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
