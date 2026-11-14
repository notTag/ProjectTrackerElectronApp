import { describe, expect, it, vi } from 'vitest'

import { createGithubRequest, GITHUB_OFFLINE_MESSAGE } from './githubRequest.js'

const respondWith = (status: number, body: unknown = {}) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }))

const requestWith = (fetchImpl: typeof fetch, token?: string) =>
  createGithubRequest(fetchImpl, async () => token, 'Project Tracker')

describe('requestGithub error mapping', () => {
  it.each([
    [401, undefined, 'GitHub needs a sign-in for this. Run gh auth login or set GITHUB_TOKEN.'],
    [401, 'tok', 'GitHub rejected the token. Re-run gh auth login or update GITHUB_TOKEN.'],
    [
      404,
      undefined,
      'Repository not found. If it is private, sign in with the GitHub CLI (gh auth login) or set GITHUB_TOKEN.'
    ],
    [404, 'tok', 'Repository not found on GitHub.'],
    [403, 'tok', 'GitHub rate limit reached. Try again in a while.'],
    [500, 'tok', 'GitHub request failed (HTTP 500).']
  ])('HTTP %i with token=%s → user-facing message', async (status, token, message) => {
    const request = requestWith(respondWith(status), token)
    await expect(request('/repos/o/r')).rejects.toThrow(message)
  })

  it('offline: a rejected fetch becomes a readable message, original error kept as cause', async () => {
    const networkError = new TypeError('fetch failed')
    const request = requestWith(vi.fn<typeof fetch>(async () => Promise.reject(networkError)))
    const failure = await request('/repos/o/r').catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(GITHUB_OFFLINE_MESSAGE)
    expect((failure as Error).cause).toBe(networkError)
  })
})

describe('requestGithub success', () => {
  it('GETs without a body or Authorization when there is no token', async () => {
    const fetchImpl = respondWith(200, [{ id: 1 }])
    const data = await requestWith(fetchImpl)<unknown[]>('/repos/o/r/pulls')
    expect(data).toEqual([{ id: 1 }])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/o/r/pulls')
    expect(init?.method).toBeUndefined()
    expect(init?.body).toBeUndefined()
    expect(init?.headers).not.toHaveProperty('Authorization')
  })

  it('POSTs a JSON body with a bearer token when one exists', async () => {
    const fetchImpl = respondWith(200, { data: {} })
    await requestWith(fetchImpl, 'tok')('/graphql', { query: '{ viewer { login } }' })
    const [, init] = fetchImpl.mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ query: '{ viewer { login } }' }))
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok', 'User-Agent': 'Project Tracker' })
  })
})
