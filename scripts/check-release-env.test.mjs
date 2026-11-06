import { describe, expect, it } from 'vitest'

import { releaseEnvProblems } from './check-release-env.mjs'

const appleIdCredentials = {
  APPLE_ID: 'dev@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop',
  APPLE_TEAM_ID: 'TEAM123456'
}

describe('releaseEnvProblems', () => {
  it('passes with a token and a complete Apple ID set', () => {
    expect(releaseEnvProblems({ GH_TOKEN: 'token', ...appleIdCredentials })).toEqual([])
  })

  it('passes with a keychain profile alone', () => {
    expect(releaseEnvProblems({ GH_TOKEN: 'token', APPLE_KEYCHAIN_PROFILE: 'notary' })).toEqual([])
  })

  it('rejects a partial credential set, which electron-builder would skip or throw on', () => {
    const { APPLE_TEAM_ID, ...withoutTeamId } = appleIdCredentials
    const problems = releaseEnvProblems({ GH_TOKEN: 'token', ...withoutTeamId })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('notarization')
  })

  it('reports a missing token and missing credentials together', () => {
    expect(releaseEnvProblems({})).toHaveLength(2)
  })
})
