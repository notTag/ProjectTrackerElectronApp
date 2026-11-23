import { describe, expect, it } from 'vitest'

import { UI_DEMO_CONTROLS, clampValue, defaultUiDemoValues, normalizeUiDemoValues, toCssValue } from './uiDemo'

const control = (key: string) => UI_DEMO_CONTROLS.find((candidate) => candidate.key === key)!

describe('uiDemo', () => {
  it('clamps range values and falls back to the default on junk', () => {
    const laneRadius = control('laneRadius')
    expect(clampValue(laneRadius, 99)).toBe(24)
    expect(clampValue(laneRadius, -5)).toBe(0)
    expect(clampValue(laneRadius, '12.6')).toBe(13)
    expect(clampValue(laneRadius, 'abc')).toBe(8)
    expect(clampValue(laneRadius, undefined)).toBe(8)
    expect(clampValue(laneRadius, '')).toBe(8)
  })

  it('rejects choices outside the allowed set', () => {
    const textAlign = control('cardTextAlign')
    expect(clampValue(textAlign, 'center')).toBe('center')
    expect(clampValue(textAlign, 'justify')).toBe('left')
  })

  it('maps each control to one --ui-* var with the right CSS value', () => {
    expect(control('cardRadius').cssVar).toBe('--ui-radius-card')
    expect(toCssValue(control('cardRadius'), 6)).toBe('6px')
    expect(control('modalAlpha').cssVar).toBe('--ui-alpha-modal')
    expect(toCssValue(control('modalAlpha'), 50)).toBe('50')
    expect(control('cardAlignItems').cssVar).toBe('--ui-card-align-items')
    expect(toCssValue(control('cardAlignItems'), 'end')).toBe('end')
    const cssVars = UI_DEMO_CONTROLS.map((candidate) => candidate.cssVar)
    expect(new Set(cssVars).size).toBe(cssVars.length)
  })

  it('defaults reproduce the hardcoded styles.css values', () => {
    expect(defaultUiDemoValues()).toEqual({
      laneRadius: 8,
      cardRadius: 6,
      modalRadius: 8,
      buttonRadius: 8,
      modalAlpha: 100,
      laneAlpha: 100,
      cardAlpha: 100,
      cardTextAlign: 'left',
      cardAlignItems: 'start'
    })
  })

  it('normalizes corrupt storage: drops unknown keys, re-clamps values', () => {
    const normalized = normalizeUiDemoValues({ laneRadius: 500, bogus: 1, cardTextAlign: 7 })
    expect(normalized.laneRadius).toBe(24)
    expect(normalized.cardTextAlign).toBe('left')
    expect(normalized).not.toHaveProperty('bogus')
    expect(normalizeUiDemoValues('garbage')).toEqual(defaultUiDemoValues())
  })
})
