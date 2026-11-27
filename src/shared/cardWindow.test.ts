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

  it('stretches to keep a pinned card mounted', () => {
    const window = cardWindow({ ...base, scrollTop: 2000, pinnedIndex: 80 })
    expect(window).toMatchObject({ start: 15, end: 81, heightBelow: 1900 })
  })
})
