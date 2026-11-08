import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import macTargetHelperModule from 'app-builder-lib/out/mac/MacTargetHelper.js'

const { MacTargetHelper } = macTargetHelperModule

// Same precedence electron-builder's GitHubPublisher uses.
const GITHUB_TOKEN_NAMES = ['GITHUB_RELEASE_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']

// Delegates to electron-builder's own resolver so precedence and messages can't
// drift. With no credentials it returns undefined and the build only warns and
// ships un-notarized — which macOS then refuses to install as an update.
const notarizeProblem = (env) => {
  // ponytail: getNotarizeOptions reads process.env directly, so swap it in for the call
  const realEnv = process.env
  process.env = env
  try {
    const notarizeOptions = MacTargetHelper.getNotarizeOptions('')
    if (notarizeOptions) return null
    return 'No notarization credentials. Set APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_KEYCHAIN_PROFILE'
  } catch (error) {
    return `Notarization credentials are incomplete: ${error.message}`
  } finally {
    process.env = realEnv
  }
}

export const releaseEnvProblems = (env) => {
  const problems = []

  // Checked up front because electron-builder only notices a missing token at
  // upload time, after the full build and notarization have already run.
  const hasGitHubToken = GITHUB_TOKEN_NAMES.some((name) => Boolean(env[name]))
  if (!hasGitHubToken) problems.push(`No GitHub token. Set one of ${GITHUB_TOKEN_NAMES.join(', ')} (needs repo scope)`)

  const notarizeIssue = notarizeProblem(env)
  if (notarizeIssue) problems.push(notarizeIssue)

  return problems
}

const entryScriptPath = process.argv[1]
const entryScriptUrl = entryScriptPath ? pathToFileURL(realpathSync(entryScriptPath)).href : null
const isRunDirectly = import.meta.url === entryScriptUrl

if (isRunDirectly) {
  const problems = releaseEnvProblems(process.env)
  if (problems.length > 0) {
    console.error(`Release aborted before building:\n\n${problems.join('\n\n')}`)
    process.exit(1)
  }
}
