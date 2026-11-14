import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Same credential sets and precedence as electron-builder's
// MacTargetHelper.getNotarizeOptions, so the DMG is notarized with whatever
// notarized the .app. Partial sets are rejected earlier by check-release-env.
export const notarytoolCredentialFlags = (env) => {
  if (env.APPLE_ID) {
    return ['--apple-id', env.APPLE_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', env.APPLE_TEAM_ID]
  }
  if (env.APPLE_API_KEY) {
    return ['--key', env.APPLE_API_KEY, '--key-id', env.APPLE_API_KEY_ID, '--issuer', env.APPLE_API_ISSUER]
  }
  if (env.APPLE_KEYCHAIN_PROFILE) {
    const profileFlags = ['--keychain-profile', env.APPLE_KEYCHAIN_PROFILE]
    if (env.APPLE_KEYCHAIN) profileFlags.push('--keychain', env.APPLE_KEYCHAIN)
    return profileFlags
  }
  return null
}

// electron-builder's artifactBuildCompleted hook. It is awaited before the
// artifact is queued for upload, so `release` publishes the stapled DMG.
export default async function notarizeDmg(context) {
  const artifactPath = context.file
  if (!artifactPath.endsWith('.dmg')) return

  const credentialFlags = notarytoolCredentialFlags(process.env)
  if (!credentialFlags) {
    throw new Error(`No notarization credentials for ${artifactPath}; the dist/release preflight should have caught this`)
  }

  const submitArgs = ['notarytool', 'submit', artifactPath, ...credentialFlags, '--wait']
  const submitResult = await execFileAsync('xcrun', submitArgs)
  console.log(submitResult.stdout)

  // `--wait` exits 0 even when Apple rejects the submission, so check the status line.
  if (!/status:\s*Accepted/.test(submitResult.stdout)) {
    throw new Error(`Notarization of ${artifactPath} was not accepted. Run \`xcrun notarytool log <id>\` for details.`)
  }

  await execFileAsync('xcrun', ['stapler', 'staple', artifactPath])
  console.log(`Notarized and stapled ${artifactPath}`)
}
