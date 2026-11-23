import { describe, expect, it } from 'vitest'

import { parseCsv, summarizeCheckpoints } from './scale-report.mjs'
import { CSV_HEADER, TICKET_CAP, WALL_CAP_MS, checkpoints, median, stopReason } from './scale-test.mjs'

describe('checkpoints', () => {
  it('steps by 10 to 100, then by 100 up to the ticket cap', () => {
    const all = [...checkpoints()]
    expect(all.slice(0, 11)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200])
    expect(all.at(-1)).toBe(TICKET_CAP)
  })
})

describe('median', () => {
  it('takes the middle value, treating a timeout as the largest', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, Infinity, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('stopReason', () => {
  const healthy = { medianCreationSeconds: 1, ticketCount: 500, elapsedMs: 1000 }

  it('keeps going while every rule holds', () => {
    expect(stopReason(healthy)).toBeNull()
  })

  it('stops on the 5s threshold before either cap', () => {
    expect(stopReason({ ...healthy, medianCreationSeconds: 5.01, ticketCount: TICKET_CAP })).toBe('threshold')
    expect(stopReason({ ...healthy, medianCreationSeconds: 5 })).toBeNull()
    expect(stopReason({ ...healthy, medianCreationSeconds: Infinity })).toBe('threshold')
  })

  it('stops on the ticket and wall-time caps', () => {
    expect(stopReason({ ...healthy, ticketCount: TICKET_CAP })).toBe('ticket-cap')
    expect(stopReason({ ...healthy, elapsedMs: WALL_CAP_MS })).toBe('time-cap')
  })
})

describe('summarizeCheckpoints', () => {
  it('groups samples per checkpoint and keeps the first as the single timed sample', () => {
    const csv = [
      CSV_HEADER,
      '10,10,1,0.300,0.100,1.0,2026-11-23T00:00:01.000Z',
      '10,10,2,0.100,timeout,1.0,2026-11-23T00:00:02.000Z',
      '10,10,3,0.200,0.200,1.0,2026-11-23T00:00:03.000Z'
    ].join('\n')
    const [checkpoint] = summarizeCheckpoints(parseCsv(csv))
    expect(checkpoint).toMatchObject({ ticketCount: 10, firstCreation: 0.3, medianCreation: 0.2, medianAccess: 0.2 })
  })
})
