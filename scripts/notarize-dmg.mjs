import { notarize } from '@electron/notarize'
import macTargetHelperModule from 'app-builder-lib/out/mac/MacTargetHelper.js'

const { MacTargetHelper } = macTargetHelperModule

// electron-builder's artifactBuildCompleted hook. It is awaited before the
// artifact is queued for upload, so `release` publishes the stapled DMG.
// Reuses electron-builder's own credential resolver and notarizer, so the DMG
// is notarized exactly like the .app (same precedence, redacted secrets,
// stapler retries).
export default async function notarizeDmg(context) {
  const artifactPath = context.file
  if (!artifactPath.endsWith('.dmg')) return

  const notarizeOptions = MacTargetHelper.getNotarizeOptions(artifactPath)
  if (!notarizeOptions) {
    throw new Error(`No notarization credentials for ${artifactPath}; the dist/release preflight should have caught this`)
  }

  await notarize(notarizeOptions)
  console.log(`Notarized and stapled ${artifactPath}`)
}
