import { describe, expect, it } from 'vitest'

import { WARP_LAUNCH_CONFIG_NAME, warpLaunchConfigYaml } from './warpLaunchConfig.js'

// The emitted scalars are JSON strings, so parsing them back is a genuine
// round-trip: whatever survives this survives Warp's YAML reader.
const execValue = (yaml: string) => {
  const line = yaml.split('\n').find((candidate) => candidate.includes('- exec: '))
  if (!line) throw new Error('no exec line emitted')
  return JSON.parse(line.slice(line.indexOf('- exec: ') + '- exec: '.length))
}

describe('warpLaunchConfigYaml', () => {
  it('names the config so warp://launch/<name> resolves it', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', 'claude hello')
    expect(yaml).toContain(`name: ${WARP_LAUNCH_CONFIG_NAME}`)
  })

  it('runs the command in the project directory', () => {
    const yaml = warpLaunchConfigYaml('/tmp/my project', 'claude hello')
    expect(yaml).toContain('cwd: "/tmp/my project"')
    expect(execValue(yaml)).toBe('claude hello')
  })

  it('keeps a prompt containing quotes, newlines and backslashes intact', () => {
    const command = `claude 'Fix the "parser" bug\n\nIt drops C:\\path and $HOME'`
    const yaml = warpLaunchConfigYaml('/tmp/project', command)
    expect(execValue(yaml)).toBe(command)
  })

  it('emits the exec on a single line so the YAML stays flat', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', 'claude one\ntwo')
    const execLines = yaml.split('\n').filter((line) => line.includes('exec'))
    expect(execLines).toHaveLength(1)
  })
})
