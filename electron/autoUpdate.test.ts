import { EventEmitter } from 'node:events'

import type { AppUpdater } from 'electron-updater'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { startUpdateCheck } from './autoUpdate.js'

// A real EventEmitter, because the property under test is an EventEmitter one:
// emitting 'error' with no listener attached rethrows the error.
const updaterWithCheckResult = (checkResult: Promise<unknown>) => {
  const updater = new EventEmitter()
  Object.assign(updater, { checkForUpdatesAndNotify: () => checkResult })
  return updater as EventEmitter & AppUpdater
}

describe('startUpdateCheck', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('swallows a rejected check so launch is never blocked', async () => {
    const updater = updaterWithCheckResult(Promise.reject(new Error('getaddrinfo ENOTFOUND')))
    await expect(startUpdateCheck(updater)).resolves.toBeUndefined()
  })

  it('swallows an error event so no listener is left missing', () => {
    const updater = updaterWithCheckResult(Promise.resolve(null))
    startUpdateCheck(updater)
    expect(() => updater.emit('error', new Error('code signature invalid'))).not.toThrow()
  })
})
