import { describe, expect, it } from 'vitest'

import { MAIN_CHECKOUT_PORT, resolveDevPort } from './dev.mjs'

const mainCheckout = '/repo/electron-app'
const mainPaths = { toplevel: mainCheckout, mainCheckout }
const worktreePaths = { toplevel: `${mainCheckout}/.worktrees/t88`, mainCheckout }
const otherWorktreePaths = { toplevel: `${mainCheckout}/.worktrees/t90`, mainCheckout }

const expectWorktreeRange = (port) => {
  expect(port).toBeGreaterThanOrEqual(5200)
  expect(port).toBeLessThanOrEqual(5899)
}

describe('resolveDevPort', () => {
  it('gives the main checkout 5173', () => {
    expect(resolveDevPort({}, mainPaths)).toEqual({ port: MAIN_CHECKOUT_PORT })
  })

  it('gives a worktree a stable port in 5200–5899', () => {
    const { port } = resolveDevPort({}, worktreePaths)
    expectWorktreeRange(port)
    expect(resolveDevPort({}, worktreePaths).port).toBe(port)
    expectWorktreeRange(resolveDevPort({}, otherWorktreePaths).port)
  })

  it('falls back to 5173 when git cannot say which checkout this is', () => {
    expect(resolveDevPort({}, null)).toEqual({ port: MAIN_CHECKOUT_PORT })
  })

  it('lets PROJECT_TRACKER_DEV_PORT override both main and worktree ports', () => {
    const env = { PROJECT_TRACKER_DEV_PORT: '5199' }
    expect(resolveDevPort(env, mainPaths)).toEqual({ port: 5199 })
    expect(resolveDevPort(env, worktreePaths)).toEqual({ port: 5199 })
  })

  it.each(['abc', '0', '70000', '51.5'])('rejects override %s', (value) => {
    const resolved = resolveDevPort({ PROJECT_TRACKER_DEV_PORT: value }, mainPaths)
    expect(resolved.error).toContain('PROJECT_TRACKER_DEV_PORT')
  })

  it('ignores a bare PORT, which other tools export globally', () => {
    expect(resolveDevPort({ PORT: '5199' }, mainPaths)).toEqual({ port: MAIN_CHECKOUT_PORT })
  })
})
