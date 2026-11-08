import { describe, expect, it } from 'vitest'

import {
  WARP_LAUNCH_CONFIG_NAME,
  ghosttyOsascriptArgs,
  itermOsascriptArgs,
  terminalOsascriptArgs,
  warpLaunchConfigYaml
} from './terminalLaunch.js'

// A prompt that breaks every naive escaping attempt at once.
const AWKWARD_COMMAND = `claude 'Fix the "parser" bug\n\nIt drops C:\\path, $HOME and it'\\''s late'`

describe('warpLaunchConfigYaml', () => {
  // The emitted scalars are JSON strings, so parsing them back is a genuine
  // round-trip: whatever survives this survives Warp's YAML reader.
  const execValue = (yaml: string) => {
    const line = yaml.split('\n').find((candidate) => candidate.includes('- exec: '))
    if (!line) throw new Error('no exec line emitted')
    return JSON.parse(line.slice(line.indexOf('- exec: ') + '- exec: '.length))
  }

  it('names the config so warp://launch/<name> resolves it', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', ['claude hello'])
    expect(yaml).toContain(`name: ${WARP_LAUNCH_CONFIG_NAME}`)
  })

  it('runs the command in the project directory', () => {
    const yaml = warpLaunchConfigYaml('/tmp/my project', ['claude hello'])
    expect(yaml).toContain('cwd: "/tmp/my project"')
    expect(execValue(yaml)).toBe('claude hello')
  })

  it('keeps a prompt containing quotes, newlines and backslashes intact', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', [AWKWARD_COMMAND])
    expect(execValue(yaml)).toBe(AWKWARD_COMMAND)
  })

  it('emits the exec on a single line so the YAML stays flat', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', ['claude one\ntwo'])
    const execLines = yaml.split('\n').filter((line) => line.includes('exec'))
    expect(execLines).toHaveLength(1)
  })

  it('opens one tab per command in a single window', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', ['claude one', 'codex two'])
    expect(yaml.split('\n').filter((line) => line.includes('- tabs:'))).toHaveLength(1)
    expect(yaml.split('\n').filter((line) => line.includes('- layout:'))).toHaveLength(2)
    expect(yaml).toContain('- exec: "codex two"')
  })
})

describe('terminalOsascriptArgs', () => {
  const scriptArgument = (args: string[]) => args[args.length - 1]

  it('passes the command after -- so AppleScript reads it as data', () => {
    const args = terminalOsascriptArgs('/tmp/project', ['claude hello'])
    expect(args[args.length - 2]).toBe('--')
    expect(args).toContain('do script (item 1 of argv)')
  })

  it('cds into the project before running, quoting a path with spaces', () => {
    const args = terminalOsascriptArgs('/tmp/my project', ['claude hello'])
    expect(scriptArgument(args)).toBe(`cd '/tmp/my project' && claude hello`)
  })

  it('leaves the command untouched so its own quoting survives', () => {
    const args = terminalOsascriptArgs('/tmp/project', [AWKWARD_COMMAND])
    expect(scriptArgument(args).endsWith(AWKWARD_COMMAND)).toBe(true)
  })
})

// Auto Run: every multi-tab script hands each command over as its own argv entry.
describe('multi-tab AppleScript launches', () => {
  const argvAfterSeparator = (args: string[]) => args.slice(args.indexOf('--') + 1)

  it('Terminal opens later tabs with ⌘T, cd-ing each into the project', () => {
    const args = terminalOsascriptArgs('/tmp/project', ['claude one', 'claude two'])
    expect(args).toContain('tell application "System Events" to keystroke "t" using command down')
    expect(argvAfterSeparator(args)).toEqual([`cd '/tmp/project' && claude one`, `cd '/tmp/project' && claude two`])
  })

  it('iTerm2 creates one window and a tab per further command', () => {
    const args = itermOsascriptArgs('/tmp/project', ['claude one', AWKWARD_COMMAND])
    expect(args).toContain('set targetWindow to (create window with default profile)')
    expect(argvAfterSeparator(args)).toEqual([`cd '/tmp/project' && claude one`, `cd '/tmp/project' && ${AWKWARD_COMMAND}`])
  })

  it('Ghostty gets the directory first, then the commands untouched', () => {
    const args = ghosttyOsascriptArgs('/tmp/my project', ['claude one', AWKWARD_COMMAND])
    expect(args).toContain('new tab in targetWindow with configuration surfaceConfig')
    expect(argvAfterSeparator(args)).toEqual(['/tmp/my project', 'claude one', AWKWARD_COMMAND])
  })
})
