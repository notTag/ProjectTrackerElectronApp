import { describe, expect, it } from 'vitest'
import { cardWindow } from './cardWindow'

const heights = new Array<number>(100).fill(92)
const base = { heights, gap: 8, viewportHeight: 500, overscan: 500 }

describe('cardWindow', () => {
  it('mounts the viewport plus overscan and sizes the spacers for the rest', () => {
    const window = cardWindow({ ...base, scrollTop: 2000 })
    expect(window).toEqual({ start: 15, end: 30, heightAbove: 1500, heightBelow: 7000 })
  })

  it('starts at the top and stops at the end of the lane', () => {
    expect(cardWindow({ ...base, scrollTop: 0 })).toMatchObject({ start: 0, end: 10, heightAbove: 0 })
    expect(cardWindow({ ...base, scrollTop: 9500 })).toMatchObject({ start: 90, end: 100, heightBelow: 0 })
  })

  it('keeps a far pinned card mounted on its own, without stretching the window', () => {
    const below = cardWindow({ ...base, scrollTop: 2000, pinnedIndex: 80 })
    expect(below).toEqual({ start: 15, end: 30, heightAbove: 1500, heightBelow: 6900, pinnedSide: 'below' })
    const above = cardWindow({ ...base, scrollTop: 9500, pinnedIndex: 0 })
    expect(above).toEqual({ start: 90, end: 100, heightAbove: 8900, heightBelow: 0, pinnedSide: 'above' })
  })

  it('leaves the window alone when the pinned card is already in it', () => {
    expect(cardWindow({ ...base, scrollTop: 2000, pinnedIndex: 20 }).pinnedSide).toBeUndefined()
  })
})
