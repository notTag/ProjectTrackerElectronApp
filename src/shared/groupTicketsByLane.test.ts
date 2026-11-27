import { describe, expect, it } from 'vitest'
import { groupTicketsByLane, type Ticket } from './projectTypes'

const ticket = (id: string, laneId: string) => ({ id, laneId }) as Ticket

describe('groupTicketsByLane', () => {
  it('groups by lane in board order, applies the filter, leaves empty lanes out', () => {
    const tickets = [ticket('a', 'todo'), ticket('b', 'done'), ticket('c', 'todo'), ticket('skip', 'todo')]
    const ticketsByLane = groupTicketsByLane(tickets, (entry) => entry.id !== 'skip')
    const todoIds = ticketsByLane.get('todo')?.map((entry) => entry.id)
    const doneIds = ticketsByLane.get('done')?.map((entry) => entry.id)
    expect(todoIds).toEqual(['a', 'c'])
    expect(doneIds).toEqual(['b'])
    expect(ticketsByLane.has('empty')).toBe(false)
  })
})
