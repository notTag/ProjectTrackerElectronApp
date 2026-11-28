import { describe, expect, it } from 'vitest'
import { clampGraphPanelWidth } from './modalWidth'

describe('clampGraphPanelWidth', () => {
  it('keeps a width inside the limits', () => {
    expect(clampGraphPanelWidth(500, 1400)).toBe(500)
  })

  it('never goes below 280px', () => {
    expect(clampGraphPanelWidth(100, 1400)).toBe(280)
  })

  it('leaves the canvas 320px of the window', () => {
    expect(clampGraphPanelWidth(1300, 1400)).toBe(1080)
  })

  it('prefers the 280px minimum when the window is too narrow for both', () => {
    expect(clampGraphPanelWidth(400, 500)).toBe(280)
  })
})
