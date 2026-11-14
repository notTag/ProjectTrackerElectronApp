export const GITHUB_OFFLINE_MESSAGE = 'Could not reach GitHub. Check your connection.'

export type GithubRequest = <T>(apiPath: string, body?: unknown) => Promise<T>

// Single door to the GitHub REST API so auth, headers and the status-to-message
// mapping stay identical for every caller. fetch and the token lookup are
// injected so the mapping is testable without Electron or the network.
// A body makes it a JSON POST (the GraphQL endpoint); otherwise a GET.
export const createGithubRequest = (
  fetchImpl: typeof fetch,
  resolveToken: () => Promise<string | undefined>,
  userAgent: string
): GithubRequest =>
  async <T>(apiPath: string, body?: unknown): Promise<T> => {
    const token = await resolveToken()
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': userAgent
    }
    if (token) headers.Authorization = `Bearer ${token}`
    const init: RequestInit = body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) }

    let response: Response
    try {
      response = await fetchImpl(`https://api.github.com${apiPath}`, init)
    } catch (error) {
      throw new Error(GITHUB_OFFLINE_MESSAGE, { cause: error })
    }

    if (response.status === 401 && !token) {
      throw new Error('GitHub needs a sign-in for this. Run gh auth login or set GITHUB_TOKEN.')
    }
    if (response.status === 404) {
      throw new Error(
        token
          ? 'Repository not found on GitHub.'
          : 'Repository not found. If it is private, sign in with the GitHub CLI (gh auth login) or set GITHUB_TOKEN.'
      )
    }
    if (response.status === 401) throw new Error('GitHub rejected the token. Re-run gh auth login or update GITHUB_TOKEN.')
    // ponytail: every 403 reads as a rate limit; a token missing a scope also
    // gets 403. Check x-ratelimit-remaining: 0 to tell them apart if it confuses anyone.
    if (response.status === 403) throw new Error('GitHub rate limit reached. Try again in a while.')
    if (!response.ok) throw new Error(`GitHub request failed (HTTP ${response.status}).`)
    return (await response.json()) as T
  }
