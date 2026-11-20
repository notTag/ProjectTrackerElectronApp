import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { writeWarpLaunchConfig } from './ipcHandlers.js'

describe('writeWarpLaunchConfig', () => {
  const homeDirectory = mkdtempSync(path.join(tmpdir(), 'warp-home-'))
  afterEach(() => rmSync(homeDirectory, { recursive: true, force: true }))

  it('gives back-to-back launches their own config file, each holding its own tabs', () => {
    const laneA = writeWarpLaunchConfig(homeDirectory, '/code/app', [{ command: 'claude lane-a' }])
    const laneB = writeWarpLaunchConfig(homeDirectory, '/code/app', [{ command: 'claude lane-b' }])

    expect(laneA.configName).not.toBe(laneB.configName)
    const laneAYaml = readFileSync(laneA.configPath, 'utf8')
    const laneBYaml = readFileSync(laneB.configPath, 'utf8')
    expect(laneAYaml).toContain(`name: ${laneA.configName}`)
    expect(laneAYaml).toContain('claude lane-a')
    expect(laneAYaml).not.toContain('claude lane-b')
    expect(laneBYaml).toContain(`name: ${laneB.configName}`)
    expect(laneBYaml).toContain('claude lane-b')
  })
})
