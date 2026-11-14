import { describe, expect, it } from 'vitest'

import notarizeDmg, { notarytoolCredentialFlags } from './notarize-dmg.mjs'

const appleIdCredentials = {
  APPLE_ID: 'dev@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop',
  APPLE_TEAM_ID: 'TEAM123456'
}

const apiKeyCredentials = {
  APPLE_API_KEY: '/keys/AuthKey_ABC.p8',
  APPLE_API_KEY_ID: 'ABC',
  APPLE_API_ISSUER: 'issuer-uuid'
}

describe('notarytoolCredentialFlags', () => {
  it('maps the Apple ID set', () => {
    expect(notarytoolCredentialFlags(appleIdCredentials)).toEqual([
      '--apple-id', 'dev@example.com', '--password', 'abcd-efgh-ijkl-mnop', '--team-id', 'TEAM123456'
    ])
  })

  it('maps the API key set', () => {
    expect(notarytoolCredentialFlags(apiKeyCredentials)).toEqual([
      '--key', '/keys/AuthKey_ABC.p8', '--key-id', 'ABC', '--issuer', 'issuer-uuid'
    ])
  })

  it('maps a keychain profile, with an optional keychain', () => {
    expect(notarytoolCredentialFlags({ APPLE_KEYCHAIN_PROFILE: 'notary' })).toEqual(['--keychain-profile', 'notary'])
    expect(notarytoolCredentialFlags({ APPLE_KEYCHAIN_PROFILE: 'notary', APPLE_KEYCHAIN: '/k.keychain-db' })).toEqual([
      '--keychain-profile', 'notary', '--keychain', '/k.keychain-db'
    ])
  })

  it('follows electron-builder precedence: Apple ID, then API key, then profile', () => {
    const everything = { ...appleIdCredentials, ...apiKeyCredentials, APPLE_KEYCHAIN_PROFILE: 'notary' }
    expect(notarytoolCredentialFlags(everything)[0]).toBe('--apple-id')

    const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, ...withoutAppleId } = everything
    expect(notarytoolCredentialFlags(withoutAppleId)[0]).toBe('--key')
  })

  it('returns null with no credentials', () => {
    expect(notarytoolCredentialFlags({})).toBeNull()
  })
})

describe('notarizeDmg hook', () => {
  it('ignores artifacts that are not a .dmg', async () => {
    await expect(notarizeDmg({ file: '/dist/Project Tracker-0.2.0-arm64-mac.zip' })).resolves.toBeUndefined()
  })
})
