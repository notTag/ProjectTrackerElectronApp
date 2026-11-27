export interface CardWindow {
  start: number
  end: number
  heightAbove: number
  heightBelow: number
}

export interface CardWindowInput {
  heights: number[]
  gap: number
  scrollTop: number
  viewportHeight: number
  overscan: number
  pinnedIndex?: number
}

export const cardWindow = ({ heights, gap, scrollTop, viewportHeight, overscan, pinnedIndex }: CardWindowInput): CardWindow => {
  const offsets = new Array<number>(heights.length + 1)
  offsets[0] = 0
  for (let index = 0; index < heights.length; index++) offsets[index + 1] = offsets[index] + heights[index] + gap

  const windowTop = scrollTop - overscan
  const windowBottom = scrollTop + viewportHeight + overscan
  let start = 0
  while (start < heights.length && offsets[start + 1] <= windowTop) start++
  let end = start
  while (end < heights.length && offsets[end] < windowBottom) end++

  const hasPin = pinnedIndex !== undefined && pinnedIndex >= 0 && pinnedIndex < heights.length
  if (hasPin) {
    start = Math.min(start, pinnedIndex)
    end = Math.max(end, pinnedIndex + 1)
  }
  const total = offsets[heights.length]
  return { start, end, heightAbove: offsets[start], heightBelow: total - offsets[end] }
}
