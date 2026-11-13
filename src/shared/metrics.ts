import type { MetricWindowCounts, ProjectMetrics, ProjectPrMetrics } from './projectTypes.js'

export const METRIC_WINDOWS: { key: keyof MetricWindowCounts; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7d' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' }
]

export const prCounts = (metrics: ProjectMetrics): ProjectPrMetrics | undefined =>
  metrics.prs && 'open' in metrics.prs ? metrics.prs : undefined

export const prUnavailableReason = (metrics: ProjectMetrics) => {
  if (!metrics.prs) return 'No GitHub repo'
  return 'error' in metrics.prs ? metrics.prs.error : ''
}

export const MIN_BAR_HEIGHT = '2px'

// A nonzero count always gets a visible sliver; an all-zero chart stays flat
// instead of dividing by zero.
export const barHeight = (count: number, maxCount: number) => {
  if (count <= 0 || maxCount <= 0) return '0'
  const percent = (count / maxCount) * 100
  return `max(${MIN_BAR_HEIGHT}, ${percent}%)`
}
