import { describe, expect, it } from 'vitest'

import {
  WARP_LAUNCH_CONFIG_NAME,
  ghosttyOsascriptArgs,
  itermOsascriptArgs,
  terminalOsascriptArgs,
  warpLaunchConfigYaml
} from './terminalLaunch.js'
import type { TerminalTab } from '../src/shared/projectTypes.js'

const tabs = (...commands: string[]): TerminalTab[] => commands.map((command) => ({ command }))

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
    const yaml = warpLaunchConfigYaml('/tmp/project', tabs('claude hello'))
    expect(yaml).toContain(`name: ${WARP_LAUNCH_CONFIG_NAME}`)
  })

  it('runs the command in the project directory', () => {
    const yaml = warpLaunchConfigYaml('/tmp/my project', tabs('claude hello'))
    expect(yaml).toContain('cwd: "/tmp/my project"')
    expect(execValue(yaml)).toBe('claude hello')
  })

  it('keeps a prompt containing quotes, newlines and backslashes intact', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', tabs(AWKWARD_COMMAND))
    expect(execValue(yaml)).toBe(AWKWARD_COMMAND)
  })

  it('emits the exec on a single line so the YAML stays flat', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', tabs('claude one\ntwo'))
    const execLines = yaml.split('\n').filter((line) => line.includes('exec'))
    expect(execLines).toHaveLength(1)
  })

  it('opens one tab per command in a single window', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', tabs('claude one', 'codex two'))
    expect(yaml.split('\n').filter((line) => line.includes('- tabs:'))).toHaveLength(1)
    expect(yaml.split('\n').filter((line) => line.includes('- layout:'))).toHaveLength(2)
    expect(yaml).toContain('- exec: "codex two"')
  })
})

describe('terminalOsascriptArgs', () => {
  const firstCommandArgument = (args: string[]) => args[args.indexOf('--') + 1]

  it('passes the command after -- so AppleScript reads it as data', () => {
    const args = terminalOsascriptArgs('/tmp/project', tabs('claude hello'))
    expect(args[args.length - 3]).toBe('--')
    expect(args).toContain('set newTab to do script (item 1 of argv)')
  })

  it('cds into the project before running, quoting a path with spaces', () => {
    const args = terminalOsascriptArgs('/tmp/my project', tabs('claude hello'))
    expect(firstCommandArgument(args)).toBe(`cd '/tmp/my project' && claude hello`)
  })

  it('leaves the command untouched so its own quoting survives', () => {
    const args = terminalOsascriptArgs('/tmp/project', tabs(AWKWARD_COMMAND))
    expect(firstCommandArgument(args).endsWith(AWKWARD_COMMAND)).toBe(true)
  })
})

// Auto Run: every multi-tab script hands each command over as its own argv entry.
describe('multi-tab AppleScript launches', () => {
  const argvAfterSeparator = (args: string[]) => args.slice(args.indexOf('--') + 1)

  it('Terminal opens later tabs with ⌘T, cd-ing each into the project', () => {
    const args = terminalOsascriptArgs('/tmp/project', tabs('claude one', 'claude two'))
    expect(args).toContain('tell application "System Events" to keystroke "t" using command down')
    expect(argvAfterSeparator(args)).toEqual([`cd '/tmp/project' && claude one`, '', `cd '/tmp/project' && claude two`, ''])
  })

  it('iTerm2 creates one window and a tab per further command', () => {
    const args = itermOsascriptArgs('/tmp/project', tabs('claude one', AWKWARD_COMMAND))
    expect(args).toContain('set targetWindow to (create window with default profile)')
    expect(argvAfterSeparator(args)).toEqual([
      `cd '/tmp/project' && claude one`,
      '',
      `cd '/tmp/project' && ${AWKWARD_COMMAND}`,
      ''
    ])
  })

  it('Ghostty gets the directory first, then the commands untouched', () => {
    const args = ghosttyOsascriptArgs('/tmp/my project', tabs('claude one', AWKWARD_COMMAND))
    expect(args).toContain('set newTab to new tab in targetWindow with configuration surfaceConfig')
    expect(argvAfterSeparator(args)).toEqual(['/tmp/my project', 'claude one', '', AWKWARD_COMMAND, ''])
  })
})

// Titles ride argv beside their commands; a hostile one must never reach script
// text or shift a command into the title slot.
describe('tab titles', () => {
  const HOSTILE_TITLE = `#33 it's "$HOME" \`id\` \\ 🚀 % \u001b]0;pwn\u0007 'x'`
  const titledTabs: TerminalTab[] = [
    { command: 'claude one', title: HOSTILE_TITLE },
    { command: 'claude two', title: '#34 Second' }
  ]
  const scriptLines = (args: string[]) => args.slice(0, args.indexOf('--')).filter((arg) => arg !== '-e')
  const argvAfterSeparator = (args: string[]) => args.slice(args.indexOf('--') + 1)

  it('Warp puts a single-line title beside each layout and round-trips it', () => {
    const yaml = warpLaunchConfigYaml('/tmp/project', titledTabs)
    const titleLines = yaml.split('\n').filter((line) => line.startsWith('      - title: '))
    expect(titleLines.map((line) => JSON.parse(line.slice('      - title: '.length)))).toEqual([
      HOSTILE_TITLE,
      '#34 Second'
    ])
    expect(yaml.split('\n').filter((line) => line === '        layout:')).toHaveLength(2)
  })

  it('Warp emits no title line for an untitled tab', () => {
    expect(warpLaunchConfigYaml('/tmp/project', tabs('claude one'))).not.toContain('title:')
  })

  it('Terminal pairs each command with its title, in order', () => {
    const args = terminalOsascriptArgs('/tmp/project', titledTabs)
    expect(argvAfterSeparator(args)).toEqual([
      `cd '/tmp/project' && claude one`,
      HOSTILE_TITLE,
      `cd '/tmp/project' && claude two`,
      '#34 Second'
    ])
    expect(args).toContain('set custom title of item i of openedTabs to tabTitle')
  })

  it('iTerm2 pairs each command with its title, in order', () => {
    const args = itermOsascriptArgs('/tmp/project', titledTabs)
    expect(argvAfterSeparator(args)).toEqual([
      `cd '/tmp/project' && claude one`,
      HOSTILE_TITLE,
      `cd '/tmp/project' && claude two`,
      '#34 Second'
    ])
    expect(args).toContain('set name of item i of tabSessions to tabTitle')
  })

  it('Ghostty pairs each command with its title after the directory', () => {
    const args = ghosttyOsascriptArgs('/tmp/project', titledTabs)
    expect(argvAfterSeparator(args)).toEqual(['/tmp/project', 'claude one', HOSTILE_TITLE, 'claude two', '#34 Second'])
    expect(args).toContain('set «class GTno» of newTab to tabTitle')
  })

  it.each([
    ['Terminal', terminalOsascriptArgs],
    ['iTerm2', itermOsascriptArgs],
    ['Ghostty', ghosttyOsascriptArgs]
  ])('%s never puts a title into the script text, and only sets it inside try', (_name, build) => {
    const args = build('/tmp/project', titledTabs)
    const lines = scriptLines(args)
    expect(lines.some((line) => line.includes('pwn') || line.includes('Second'))).toBe(false)
    const setterIndex = lines.findIndex((line) => line.includes('to tabTitle'))
    expect(lines[setterIndex - 1]).toBe('try')
  })
})
