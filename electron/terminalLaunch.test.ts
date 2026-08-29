import { describe, expect, it } from 'vitest'

import {
  WARP_LAUNCH_CONFIG_NAME,
  ghosttyOpenArgs,
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
    const yaml = warpLaunchConfigYaml('/tmp/project', 'claude hello')
    expect(yaml).toContain(`name: ${WARP_LAUNCH_CONFIG_NAME}`)
  })

  it('runs the command in the project directory', () => {
    const yaml = warpLaunchConfigYaml('/tmp/my project', 'claude hello')
    expect(yaml).toContain('cwd: "/tmp/my project"')
    expect(execValue(yaml)).toBe('claude hello')
  })

  it('keeps a prompt containing quotes, newlines and backslashes intact', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', AWKWARD_COMMAND)
    expect(execValue(yaml)).toBe(AWKWARD_COMMAND)
  })

  it('emits the exec on a single line so the YAML stays flat', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', 'claude one\ntwo')
    const execLines = yaml.split('\n').filter((line) => line.includes('exec'))
    expect(execLines).toHaveLength(1)
  })
})

describe('terminalOsascriptArgs', () => {
  const scriptArgument = (args: string[]) => args[args.length - 1]

  it('passes the command after -- so AppleScript reads it as data', () => {
    const args = terminalOsascriptArgs('/tmp/project', 'claude hello')
    expect(args[args.length - 2]).toBe('--')
    expect(args).toContain('do script (item 1 of argv)')
  })

  it('cds into the project before running, quoting a path with spaces', () => {
    const args = terminalOsascriptArgs('/tmp/my project', 'claude hello')
    expect(scriptArgument(args)).toBe(`cd '/tmp/my project' && claude hello`)
  })

  it('leaves the command untouched so its own quoting survives', () => {
    const args = terminalOsascriptArgs('/tmp/project', AWKWARD_COMMAND)
    expect(scriptArgument(args).endsWith(AWKWARD_COMMAND)).toBe(true)
  })
})

describe('ghosttyOpenArgs', () => {
  const valueOf = (args: string[], key: string) => {
    const match = args.find((arg) => arg.startsWith(`${key}=`))
    if (!match) throw new Error(`no ${key} argument emitted`)
    return match.slice(key.length + 1)
  }

  it('goes through open -na, which is the only supported route on macOS', () => {
    const args = ghosttyOpenArgs('/tmp/project', 'claude hello')
    expect(args.slice(0, 3)).toEqual(['-na', 'Ghostty.app', '--args'])
  })

  it('sets the working directory and the first-surface command', () => {
    const args = ghosttyOpenArgs('/tmp/my project', 'claude hello')
    expect(valueOf(args, '--working-directory')).toBe('/tmp/my project')
    expect(valueOf(args, '--initial-command')).toBe('shell:claude hello; exec "$SHELL" -l')
  })

  it('pins the command to a shell so its quoting is honoured', () => {
    const args = ghosttyOpenArgs('/tmp/project', AWKWARD_COMMAND)
    expect(valueOf(args, '--initial-command')).toContain(`shell:${AWKWARD_COMMAND}`)
  })

  // initial-command replaces the shell, so without this the window dies with
  // the agent instead of handing the project directory back to the user.
  it('leaves a live login shell behind once the agent exits', () => {
    const args = ghosttyOpenArgs('/tmp/project', 'claude hello')
    expect(valueOf(args, '--initial-command').endsWith('; exec "$SHELL" -l')).toBe(true)
  })
})
