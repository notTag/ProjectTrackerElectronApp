export const ALLOWED_DEV_ORIGIN = 'http://127.0.0.1:5173'

const originOf = (url: string) => {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

// The app's own page: in dev the Vite server, packaged the bundled file://
// page. Whole origins are compared — a prefix match would also let
// http://127.0.0.1:51730 through.
export const isAppPageUrl = (url: string, devServerUrl: string | undefined) => {
  if (devServerUrl) return originOf(url) === ALLOWED_DEV_ORIGIN
  return url.startsWith('file://')
}

export const assertTrustedSenderUrl = (senderUrl: string | undefined, devServerUrl: string | undefined) => {
  if (!senderUrl) throw new Error('Rejected IPC call from an unknown renderer frame.')
  if (!isAppPageUrl(senderUrl, devServerUrl)) throw new Error('Rejected IPC call from an unexpected renderer origin.')
}
