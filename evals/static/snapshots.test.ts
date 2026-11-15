import { describe, expect, it } from 'vitest'

import { ticketAgentPrompt, type Ticket } from '../../src/shared/projectTypes.js'
import { promptedLanes } from '../fixtures.js'

const bareTicket = (laneId: string): Ticket => ({
  id: 'snapshot-ticket',
  number: 7,
  laneId,
  title: 'Add the thing',
  description: 'Make it work.',
  createdAt: '2026-01-01T00:00:00.000Z'
})

const TICKET_VARIANTS: Record<string, Partial<Ticket>> = {
  bare: {},
  'full auto': { fullAuto: true },
  'branch + worktree': { branchName: 't7-add-the-thing', worktreePath: '/eval/repo/.worktrees/t7' },
  checklist: {
    checklist: [
      { text: 'Write it', done: true },
      { text: 'Test it', done: false }
    ]
  }
}

// A prompt edit shows up as a snapshot diff in the PR, so the reviewer sees
// exactly what every agent in that lane will be told from now on.
describe.each(promptedLanes.map((lane) => [lane.id, lane] as const))('assembled prompt: %s', (laneId, lane) => {
  it.each(Object.entries(TICKET_VARIANTS))('%s', (_variant, patch) => {
    const ticket = { ...bareTicket(laneId), ...patch }
    expect(ticketAgentPrompt(ticket, lane, { projectPath: '/eval/repo' })).toMatchSnapshot()
  })
})
