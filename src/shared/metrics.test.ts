import { describe, expect, it } from 'vitest'

import { barHeight, prCounts, prUnavailableReason } from './metrics'
import type { ProjectMetrics } from './projectTypes'

const windows = { today: 0, week: 0, month: 0, year: 0 }
const metricsWith = (prs: ProjectMetrics['prs']): ProjectMetrics => ({
  projectPath: '/p',
  name: 'p',
  closed: windows,
  hasClosingLanes: true,
  prs,
  agentsRunning: 0
})

describe('barHeight', () => {
  it('stays flat with no NaN when every count is zero', () => {
    expect(barHeight(0, 0)).toBe('0')
  })

  it('scales against the max and keeps a minimum for small counts', () => {
    expect(barHeight(10, 10)).toBe('max(2px, 100%)')
    expect(barHeight(1, 4)).toBe('max(2px, 25%)')
    expect(barHeight(0, 4)).toBe('0')
  })
})

describe('prs narrowing', () => {
  it('treats undefined as no repo', () => {
    const metrics = metricsWith(undefined)
    expect(prCounts(metrics)).toBeUndefined()
    expect(prUnavailableReason(metrics)).toBe('No GitHub repo')
  })

  it('surfaces a fetch error', () => {
    const metrics = metricsWith({ error: 'rate limited' })
    expect(prCounts(metrics)).toBeUndefined()
    expect(prUnavailableReason(metrics)).toBe('rate limited')
  })

  it('never shows a blank reason for an empty error', () => {
    expect(prUnavailableReason(metricsWith({ error: '' }))).toBe('PR fetch failed')
  })

  it('returns counts when present', () => {
    const prs = { open: 3, merged: { ...windows, year: 5 } }
    const metrics = metricsWith(prs)
    expect(prCounts(metrics)).toBe(prs)
    expect(prUnavailableReason(metrics)).toBe('')
  })
})
