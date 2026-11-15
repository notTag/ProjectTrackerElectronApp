import { describe, expect, it } from 'vitest'

import { assertTrustedSenderUrl } from './trustedSender.js'

const DEV = 'http://127.0.0.1:5173'
const PACKAGED = 'file:///Applications/Project%20Tracker.app/Contents/Resources/app.asar/out/renderer/index.html'

describe('assertTrustedSenderUrl', () => {
  it('rejects a frame with no URL', () => {
    expect(() => assertTrustedSenderUrl(undefined, PACKAGED)).toThrow('unknown renderer frame')
    expect(() => assertTrustedSenderUrl('', DEV)).toThrow('unknown renderer frame')
  })

  it('packaged: allows the bundled page (any hash route), rejects other files and origins', () => {
    expect(() => assertTrustedSenderUrl(`${PACKAGED}#/board`, PACKAGED)).not.toThrow()
    expect(() => assertTrustedSenderUrl('file:///Users/x/Downloads/evil.html', PACKAGED)).toThrow(
      'unexpected renderer origin'
    )
    expect(() => assertTrustedSenderUrl('http://127.0.0.1:5173/', PACKAGED)).toThrow('unexpected renderer origin')
  })

  it('dev: allows the Vite origin, rejects file:// and foreign origins', () => {
    expect(() => assertTrustedSenderUrl('http://127.0.0.1:5173/#/board', DEV)).not.toThrow()
    expect(() => assertTrustedSenderUrl('file:///index.html', DEV)).toThrow('unexpected renderer origin')
    expect(() => assertTrustedSenderUrl('https://evil.example/', DEV)).toThrow('unexpected renderer origin')
  })

  it('dev: a port that merely starts with 5173 is a different origin', () => {
    expect(() => assertTrustedSenderUrl('http://127.0.0.1:51730/', DEV)).toThrow('unexpected renderer origin')
  })

  it('dev: follows the configured server, not a hardcoded port', () => {
    expect(() => assertTrustedSenderUrl('http://localhost:5174/', 'http://localhost:5174')).not.toThrow()
  })
})
