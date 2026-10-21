import type { AppUpdater } from 'electron-updater'

// Nothing here is actionable by the user — no network, no published release, a
// build macOS declines to verify — so a failed check is logged and dropped.
const reportUpdateFailure = (error: Error) => {
  console.warn(`[auto-update] check failed: ${error.message}`)
}

// electron-updater reports a failure twice: the promise rejects *and* an
// 'error' event fires. An EventEmitter with no 'error' listener rethrows, so
// the listener is what keeps a failed check from killing the launch.
export const startUpdateCheck = (updater: AppUpdater) => {
  updater.on('error', reportUpdateFailure)
  return updater.checkForUpdatesAndNotify().catch(reportUpdateFailure)
}
