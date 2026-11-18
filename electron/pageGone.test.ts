import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { watchPageGone } from './pageGone'

class FakeSender extends EventEmitter {
  destroyed = false
  isDestroyed() {
    return this.destroyed
  }
}

function setup() {
  const sender = new FakeSender()
  const listener = vi.fn()
  const cleanup = watchPageGone(sender, listener)
  return { sender, listener, cleanup }
}

describe('watchPageGone', () => {
  it('fires once when the sender is destroyed', () => {
    const { sender, listener } = setup()
    sender.emit('destroyed')
    sender.emit('destroyed')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('fires on main-frame cross-document navigation', () => {
    const { sender, listener } = setup()
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores same-document and subframe navigation', () => {
    const { sender, listener } = setup()
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    sender.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    expect(listener).not.toHaveBeenCalled()
  })

  it('cleanup removes both listeners and leaves others alone', () => {
    const sender = new FakeSender()
    const otherNavigationListener = vi.fn()
    sender.on('did-start-navigation', otherNavigationListener)
    const listener = vi.fn()
    const cleanup = watchPageGone(sender, listener)

    cleanup()

    expect(sender.listenerCount('did-start-navigation')).toBe(1)
    expect(sender.listenerCount('destroyed')).toBe(0)
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    sender.emit('destroyed')
    expect(listener).not.toHaveBeenCalled()
    expect(otherNavigationListener).toHaveBeenCalledTimes(1)
  })

  it('cleanup after destroy does not throw or call off', () => {
    const { sender, listener, cleanup } = setup()
    sender.destroyed = true
    sender.emit('destroyed')
    const offSpy = vi.spyOn(sender, 'off')

    expect(() => cleanup()).not.toThrow()
    expect(offSpy).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
