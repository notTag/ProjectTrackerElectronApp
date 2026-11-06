import { pathToFileURL } from 'node:url'

// electron-builder notarizes with whichever of these credential sets is
// complete, and when none is it only logs a warning and ships the build
// un-notarized — which macOS then refuses to install as an update. Mirrors
// MacTargetHelper.getNotarizeOptions in app-builder-lib.
const NOTARIZE_CREDENTIAL_SETS = [
  ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
  ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  ['APPLE_KEYCHAIN_PROFILE']
]

const isSet = (env, name) => Boolean(env[name])

export const releaseEnvProblems = (env) => {
  const problems = []

  // Checked up front because electron-builder only notices a missing token at
  // upload time, after the full build and notarization have already run.
  if (!isSet(env, 'GH_TOKEN')) problems.push('GH_TOKEN is not set (needs repo scope)')

  const hasCompleteNotarizeSet = NOTARIZE_CREDENTIAL_SETS.some((names) =>
    names.every((name) => isSet(env, name))
  )
  if (!hasCompleteNotarizeSet) {
    const options = NOTARIZE_CREDENTIAL_SETS.map((names) => `  ${names.join(' + ')}`)
    problems.push(['No complete set of notarization credentials. Set one of:', ...options].join('\n'))
  }

  return problems
}

const isRunDirectly = import.meta.url === pathToFileURL(process.argv[1]).href

if (isRunDirectly) {
  const problems = releaseEnvProblems(process.env)
  if (problems.length > 0) {
    console.error(`Release aborted before building:\n\n${problems.join('\n\n')}`)
    process.exit(1)
  }
}
