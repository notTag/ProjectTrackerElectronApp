const parseUrl = (url: string) => {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

// appPageUrl is the URL the window loads: the Vite server in dev, the bundled
// index.html as a file:// URL when packaged. Dev compares whole origins (a
// prefix match would let http://127.0.0.1:51730 through); packaged compares
// the exact file, since any other local file (a dropped download) is not ours.
// Hash and query are ignored: the router lives in the hash.
export const isAppPageUrl = (url: string, appPageUrl: string) => {
  const candidate = parseUrl(url)
  const appPage = parseUrl(appPageUrl)
  if (!candidate || !appPage) return false
  if (appPage.protocol === 'file:') return candidate.protocol === 'file:' && candidate.pathname === appPage.pathname
  return candidate.origin === appPage.origin
}

export const assertTrustedSenderUrl = (senderUrl: string | undefined, appPageUrl: string) => {
  if (!senderUrl) throw new Error('Rejected IPC call from an unknown renderer frame.')
  if (!isAppPageUrl(senderUrl, appPageUrl)) throw new Error('Rejected IPC call from an unexpected renderer origin.')
}
