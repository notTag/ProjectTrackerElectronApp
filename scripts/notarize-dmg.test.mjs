import { afterEach, describe, expect, it, vi } from 'vitest'

import notarizeDmg from './notarize-dmg.mjs'

const NOTARIZE_ENV_NAMES = [
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_KEYCHAIN_PROFILE'
]

describe('notarizeDmg hook', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('ignores artifacts that are not a .dmg', async () => {
    await expect(notarizeDmg({ file: '/dist/Project Tracker-0.2.0-arm64-mac.zip' })).resolves.toBeUndefined()
  })

  it('fails the build on a .dmg when no credentials are set', async () => {
    for (const name of NOTARIZE_ENV_NAMES) vi.stubEnv(name, '')
    await expect(notarizeDmg({ file: '/dist/Project Tracker-0.2.0-arm64.dmg' })).rejects.toThrow('No notarization credentials')
  })
})
