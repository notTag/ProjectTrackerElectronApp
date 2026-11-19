export interface NavigationEvent {
  isMainFrame: boolean
  isSameDocument: boolean
}

type NavigationListener = (navigation: NavigationEvent) => void

// Structural subset of Electron's WebContents, so tests can pass a plain EventEmitter.
export interface PageGoneSender {
  on(event: 'did-start-navigation', listener: NavigationListener): unknown
  off(event: 'did-start-navigation', listener: NavigationListener): unknown
  once(event: 'destroyed', listener: () => void): unknown
  off(event: 'destroyed', listener: () => void): unknown
  isDestroyed(): boolean
}

// Fires on reload/navigation and on window close (sender destroyed, no navigation).
export function watchPageGone(sender: PageGoneSender, listener: () => void): () => void {
  // Window closed before the IPC handler ran: 'destroyed' already fired and won't again.
  if (sender.isDestroyed()) {
    listener()
    return () => {}
  }
  const onNavigation = (navigation: NavigationEvent) => {
    const isPageLoad = navigation.isMainFrame && !navigation.isSameDocument
    if (isPageLoad) listener()
  }
  // Own closure so cleanup can't remove another watcher's once-wrapper sharing `listener`.
  const onDestroyed = () => listener()
  sender.on('did-start-navigation', onNavigation)
  sender.once('destroyed', onDestroyed)
  return () => {
    if (sender.isDestroyed()) return
    sender.off('did-start-navigation', onNavigation)
    sender.off('destroyed', onDestroyed)
  }
}
