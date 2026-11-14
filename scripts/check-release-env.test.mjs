import { describe, expect, it } from 'vitest'

import { distEnvProblems, releaseEnvProblems } from './check-release-env.mjs'

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

  it('accepts the GITHUB_TOKEN alias electron-builder also reads', () => {
    expect(releaseEnvProblems({ GITHUB_TOKEN: 'token', APPLE_KEYCHAIN_PROFILE: 'notary' })).toEqual([])
  })

  it('rejects a partial credential set, which electron-builder throws on mid-build', () => {
    const { APPLE_TEAM_ID, ...withoutTeamId } = appleIdCredentials
    const problems = releaseEnvProblems({ GH_TOKEN: 'token', ...withoutTeamId })
    expect(problems).toEqual([expect.stringContaining('APPLE_TEAM_ID')])
  })

  it('rejects a stray partial set even when a later set is complete', () => {
    const env = { GH_TOKEN: 'token', APPLE_ID: 'dev@example.com', APPLE_KEYCHAIN_PROFILE: 'notary' }
    expect(releaseEnvProblems(env)).toEqual([expect.stringContaining('APPLE_APP_SPECIFIC_PASSWORD')])
  })

  it('reports a missing token and missing credentials together', () => {
    expect(releaseEnvProblems({})).toHaveLength(2)
  })

  it('leaves process.env untouched', () => {
    const before = process.env
    releaseEnvProblems({})
    expect(process.env).toBe(before)
  })
})

describe('distEnvProblems', () => {
  it('passes with a keychain profile and no GitHub token', () => {
    expect(distEnvProblems({ APPLE_KEYCHAIN_PROFILE: 'notary' })).toEqual([])
  })

  it('fails on an empty env with only the notarization problem', () => {
    expect(distEnvProblems({})).toEqual([expect.stringContaining('No notarization credentials')])
  })
})
