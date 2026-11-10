import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { toPlainJson } from './plainJson'

describe('toPlainJson', () => {
  it('passes undefined through without throwing', () => {
    expect(toPlainJson(undefined)).toBeUndefined()
  })

  it('passes values JSON.stringify cannot serialize through as undefined', () => {
    expect(toPlainJson(() => 1)).toBeUndefined()
    expect(toPlainJson({ toJSON: () => undefined })).toBeUndefined()
  })

  // The sandboxed preload can't import this module, so it keeps a copy.
  it('matches the inline copy in electron/preload.cts', () => {
    const bodyOf = (file: string) => {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      const start = source.indexOf('const serialized')
      return source.slice(start, source.indexOf('\n}', start))
    }
    expect(bodyOf('../../electron/preload.cts')).toBe(bodyOf('./plainJson.ts'))
  })

  it('drops undefined fields from objects', () => {
    expect(toPlainJson({ a: 1, b: undefined })).toEqual({ a: 1 })
  })
})
