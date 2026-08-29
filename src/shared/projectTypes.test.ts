import { describe, expect, it } from 'vitest'

import {
  addGithubIssuesToBoard,
  addTicketToBoard,
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
    expect(command).toBe("claude 'Ship small diffs.\n\nTicket #7: Add the thing\n\nMake it work.'")
  })

  it('omits an empty lane prompt and description rather than leaving blank gaps', () => {
    const command = ticketShellCommand(ticket({ description: '   ' }), lane())
    expect(command).toBe("claude 'Ticket #7: Add the thing'")
  })

  it('names the lane markdown file when the lane has one', () => {
    const command = ticketShellCommand(ticket({ description: '' }), lane({ agentFilePath: 'docs/dev.md' }))
    expect(command).toContain('Follow the guidance in docs/dev.md.')
  })

  it("escapes a description's own single quotes so the shell string stays closed", () => {
    const command = ticketShellCommand(ticket({ description: "don't break" }), lane())
    expect(command).toBe("claude 'Ticket #7: Add the thing\n\ndon'\\''t break'")
  })
})
