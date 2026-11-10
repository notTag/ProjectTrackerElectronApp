import { describe, expect, it } from 'vitest'

import { toPlainJson } from './plainJson'

describe('toPlainJson', () => {
  it('passes undefined through without throwing', () => {
    expect(toPlainJson(undefined)).toBeUndefined()
  })

  it('drops undefined fields from objects', () => {
    expect(toPlainJson({ a: 1, b: undefined })).toEqual({ a: 1 })
  })
})
