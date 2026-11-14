import { describe, expect, it, vi } from 'vitest'

import { openProjectIn, type OpenInDependencies } from './openIn.js'

const SCAN_DIR = '/Users/me/Code'
const PROJECT = `${SCAN_DIR}/app`

const fakeDependencies = (overrides: Partial<OpenInDependencies> = {}) => {
  const clipboard: string[] = []
  const dependencies: OpenInDependencies = {
    assertScannedProjectPath: (projectPath) => {
      if (!projectPath.startsWith(`${SCAN_DIR}/`)) throw new Error('Project path is outside configured scan directories.')
      return projectPath
    },
    writeClipboard: (text) => clipboard.push(text),
    commandRunnerFor: () => undefined,
    openFolder: vi.fn(async () => undefined),
    ...overrides
  }
  return { dependencies, clipboard }
}

describe('project:open-in payload validation', () => {
  it.each([
    [null, 'Invalid project path.'],
    [{ projectPath: 42, targetId: 'zed' }, 'Invalid project path.'],
    [{ projectPath: PROJECT, targetId: ['zed'] }, 'Invalid open-in target.'],
    [{ projectPath: PROJECT }, 'Invalid open-in target.']
  ])('rejects %j', async (payload, message) => {
    const { dependencies } = fakeDependencies()
    await expect(openProjectIn(payload, dependencies)).rejects.toThrow(message)
  })

  it.each(['notepad', 'constructor', '__proto__'])('rejects unknown target %s', async (targetId) => {
    const { dependencies } = fakeDependencies()
    await expect(openProjectIn({ projectPath: PROJECT, targetId }, dependencies)).rejects.toThrow(
      `Unknown open-in target: ${targetId}`
    )
  })

  it('rejects a path outside the scan directories before launching anything', async () => {
    const { dependencies } = fakeDependencies()
    await expect(openProjectIn({ projectPath: '/etc', targetId: 'zed' }, dependencies)).rejects.toThrow(
      'outside configured scan directories'
    )
    expect(dependencies.openFolder).not.toHaveBeenCalled()
  })
})

describe('project:open-in launch and fallback', () => {
  it('app missing: copies cd "<path>" to the clipboard and returns it as fallbackCommand', async () => {
    const { dependencies, clipboard } = fakeDependencies({
      openFolder: async () => Promise.reject(new Error('Unable to find application named Zed'))
    })
    const result = await openProjectIn({ projectPath: PROJECT, targetId: 'zed' }, dependencies)
    expect(result).toEqual({ ok: true, appLabel: 'Zed', fallbackCommand: `cd "${PROJECT}"` })
    expect(clipboard).toEqual([`cd "${PROJECT}"`])
  })

  it('editor + ticket command: command copied before the launch, reported as copiedCommand', async () => {
    const order: string[] = []
    const { dependencies } = fakeDependencies({
      writeClipboard: (text) => order.push(`clipboard:${text}`),
      openFolder: async () => order.push('open')
    })
    const result = await openProjectIn({ projectPath: PROJECT, targetId: 'zed', command: 'claude' }, dependencies)
    expect(order).toEqual(['clipboard:claude', 'open'])
    expect(result).toEqual({ ok: true, appLabel: 'Zed', copiedCommand: 'claude' })
  })

  it('terminal + ticket command: runs it in a tab', async () => {
    const runner = vi.fn(async () => undefined)
    const { dependencies } = fakeDependencies({ commandRunnerFor: (id) => (id === 'warp' ? runner : undefined) })
    const result = await openProjectIn(
      { projectPath: PROJECT, targetId: 'warp', command: 'claude', title: 'T4' },
      dependencies
    )
    expect(runner).toHaveBeenCalledWith(PROJECT, [{ command: 'claude', title: 'T4' }])
    expect(result).toEqual({ ok: true, appLabel: 'Warp', ranCommand: 'claude' })
  })

  it('terminal runner failing falls back to the clipboard too', async () => {
    const { dependencies, clipboard } = fakeDependencies({
      commandRunnerFor: () => async () => Promise.reject(new Error('osascript: not authorized'))
    })
    const result = await openProjectIn({ projectPath: PROJECT, targetId: 'warp', command: 'claude' }, dependencies)
    expect(result.fallbackCommand).toBe(`cd "${PROJECT}"`)
    expect(clipboard).toEqual(['claude', `cd "${PROJECT}"`])
  })
})
