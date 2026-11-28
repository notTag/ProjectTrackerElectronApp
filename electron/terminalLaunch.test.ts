import { describe, expect, it } from 'vitest'

import {
  ghosttyOsascriptArgs,
  itermOsascriptArgs,
  orchestratorTab,
  tabLiveness,
  tabTitlesOsascriptArgs,
  terminalOsascriptArgs,
  warpLaunchConfigYaml,
  warpTabConfigToml
} from './terminalLaunch.js'
import type { TerminalTab } from '../src/shared/projectTypes.js'

const tabs = (...commands: string[]): TerminalTab[] => commands.map((command) => ({ command }))
const scriptLines = (args: string[]) => args.slice(0, args.indexOf('--')).filter((arg) => arg !== '-e')
const argvAfterSeparator = (args: string[]) => args.slice(args.indexOf('--') + 1)

// A prompt that breaks every naive escaping attempt at once.
const AWKWARD_COMMAND = `claude 'Fix the "parser" bug\n\nIt drops C:\\path, $HOME and it'\\''s late'`

describe('warpLaunchConfigYaml', () => {
  const scalarAfter = (yaml: string, key: string) => {
    const keyPrefix = `${key}: `
    const hasKey = (line: string) => line.trimStart().replace(/^- /, '').startsWith(keyPrefix)
    const parseScalar = (line: string) => {
      const valueStart = line.indexOf(keyPrefix) + keyPrefix.length
      const rawScalar = line.slice(valueStart)
      return JSON.parse(rawScalar)
    }
    return yaml.split('\n').filter(hasKey).map(parseScalar)
  }

  it('puts every tab in one window, named after the file so warp://launch/<name> finds it', () => {
    const yaml = warpLaunchConfigYaml('project_tracker_launch_abc', '/tmp/project', [
      { command: 'claude one', title: '#1 One' },
      { command: 'claude orchestrate', title: 'AUTORUN-ORCHESTRATOR-PRD' }
    ])
    expect(yaml.split('\n').filter((line) => line === '  - tabs:')).toHaveLength(1)
    expect(scalarAfter(yaml, 'name')).toEqual(['project_tracker_launch_abc'])
    expect(scalarAfter(yaml, 'title')).toEqual(['#1 One', 'AUTORUN-ORCHESTRATOR-PRD'])
    expect(scalarAfter(yaml, 'cwd')).toEqual(['/tmp/project', '/tmp/project'])
    expect(scalarAfter(yaml, 'exec')).toEqual(['claude one; exit', 'claude orchestrate; exit'])
  })

  it('carries hostile titles, paths and commands as quoted scalars', () => {
    const hostile = 'a"b\\c\nd $(rm -rf ~) `x` #: - [ ]'
    const yaml = warpLaunchConfigYaml('n', `/tmp/${hostile}`, [{ command: hostile, title: hostile }])
    expect(scalarAfter(yaml, 'title')).toEqual([hostile])
    expect(scalarAfter(yaml, 'cwd')).toEqual([`/tmp/${hostile}`])
    expect(scalarAfter(yaml, 'exec')).toEqual([`${hostile}; exit`])
    expect(yaml.split('\n')).toHaveLength(10)
  })

  it('leaves out the title of an untitled tab so Warp names it', () => {
    const yaml = warpLaunchConfigYaml('n', '/tmp/project', [{ command: 'claude one' }])
    expect(scalarAfter(yaml, 'title')).toEqual([])
    expect(yaml).toContain('      - layout:')
  })
})

describe('warpTabConfigToml', () => {
  // The emitted strings are JSON strings, so parsing them back is a genuine
  // round-trip: whatever survives this survives Warp's TOML reader.
  const tomlValue = (toml: string, key: string) => {
    const prefix = `${key} = `
    const line = toml.split('\n').find((candidate) => candidate.startsWith(prefix))
    if (!line) throw new Error(`no ${key} line emitted`)
    return JSON.parse(line.slice(prefix.length))
  }
  const commandValue = (toml: string) => tomlValue(toml, 'commands')[0]

  it('declares one terminal pane with the Tab Config schema Warp requires', () => {
    const toml = warpTabConfigToml('/tmp/project', { command: 'claude hello' })
    expect(tomlValue(toml, 'name')).toBe('Project Tracker ticket')
    expect(toml.split('\n').filter((line) => line === '[[panes]]')).toHaveLength(1)
    expect(toml).toContain('id = "main"')
    expect(toml).toContain('type = "terminal"')
  })

  it('runs the command in the project directory', () => {
    const toml = warpTabConfigToml('/tmp/my project', { command: 'claude hello' })
    expect(tomlValue(toml, 'directory')).toBe('/tmp/my project')
    expect(tomlValue(toml, 'commands')).toEqual(['claude hello; exit'])
  })

  it('keeps a prompt containing quotes, newlines and backslashes intact', () => {
    const toml = warpTabConfigToml('/tmp/project', { command: AWKWARD_COMMAND })
    expect(commandValue(toml)).toBe(`${AWKWARD_COMMAND}; exit`)
  })

  it('emits a multi-line command on a single line', () => {
    const toml = warpTabConfigToml('/tmp/project', { command: 'claude one\ntwo' })
    expect(toml.split('\n').filter((line) => line.startsWith('commands = '))).toHaveLength(1)
    expect(commandValue(toml)).toBe('claude one\ntwo; exit')
  })

  // `; exit`, not `&& exit`: a SIGTERM'd agent exits 143 and must still close its tab.
  it('ends every tab, ticket and orchestrator alike, with its agent', () => {
    const ticketTab = warpTabConfigToml('/tmp/project', { command: 'claude hello', title: '12-In-Dev' })
    const orchestrator = warpTabConfigToml('/tmp/project', { command: 'claude watch', title: 'AUTORUN-ORCHESTRATOR-IN-DEV' })
    expect(commandValue(ticketTab)).toBe('claude hello; exit')
    expect(commandValue(orchestrator)).toBe('claude watch; exit')
  })

  it('escapes DEL, which JSON leaves raw but TOML forbids', () => {
    const toml = warpTabConfigToml('/tmp/project', { command: 'claude a\x7fb' })
    expect(toml).not.toContain('\x7f')
    expect(commandValue(toml)).toBe('claude a\x7fb; exit')
  })

  it('replaces a lone surrogate, which TOML rejects, and keeps paired ones', () => {
    const toml = warpTabConfigToml('/tmp/project', { command: 'claude \ud800 🚀' })
    expect(toml).not.toMatch(/\\ud[89a-f]/i)
    expect(commandValue(toml)).toBe('claude \ufffd 🚀; exit')
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
    expect(firstCommandArgument(args)).toBe(`cd '/tmp/project' && ${AWKWARD_COMMAND}`)
  })
})

// Auto Run: every multi-tab script hands each command over as its own argv entry.
describe('multi-tab AppleScript launches', () => {
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
    expect(argvAfterSeparator(args)).toEqual(['/tmp/my project', '', 'claude one', '', AWKWARD_COMMAND, ''])
  })
})

// #53: separate launches share the window the app opened last, never a window
// the user opened themselves.
describe('Ghostty window reuse', () => {
  it('passes the window id to reuse as argv item 2, outside the script text', () => {
    const args = ghosttyOsascriptArgs('/tmp/project', tabs('claude one'), 'window-42')
    expect(argvAfterSeparator(args)).toEqual(['/tmp/project', 'window-42', 'claude one', ''])
    expect(scriptLines(args).some((line) => line.includes('window-42'))).toBe(false)
  })

  it('looks the window up by id and falls back to a new window when it is gone', () => {
    const lines = scriptLines(ghosttyOsascriptArgs('/tmp/project', tabs('claude one'), 'window-42'))
    const lookupIndex = lines.indexOf('set targetWindow to window id reuseWindowId')
    expect(lookupIndex).toBeGreaterThan(-1)
    expect(lines[lookupIndex - 1]).toBe('try')
    expect(lines[lookupIndex + 1]).toBe('get id of targetWindow')
    expect(lines.slice(lookupIndex, lookupIndex + 4)).toContain('set targetWindow to missing value')
    const branchIndex = lines.indexOf('if targetWindow is missing value then')
    expect(lines[branchIndex + 1]).toBe('set targetWindow to new window with configuration surfaceConfig')
    expect(lines[branchIndex + 3]).toBe('else')
    expect(lines[branchIndex + 4]).toBe('set newTab to new tab in targetWindow with configuration surfaceConfig')
  })

  it('returns the window id so the next launch can reuse it', () => {
    const lines = scriptLines(ghosttyOsascriptArgs('/tmp/project', tabs('claude one')))
    const returnIndex = lines.indexOf('return id of targetWindow')
    expect(returnIndex).toBeGreaterThan(lines.lastIndexOf('end repeat'))
    expect(lines[returnIndex - 1]).toBe('try')
    expect(lines[returnIndex + 2]).toBe('return ""')
  })
})

// #38: a single-ticket Run must open exactly one window. The app asks for one
// tab, and a terminal that is not running must not add a blank window of its
// own, which `activate` before the script's window would make it do.
describe('single-ticket launches', () => {
  const singleTab: TerminalTab[] = [{ command: 'claude hello', title: '#38 Only' }]

  it('Terminal gets one command and title pair', () => {
    const args = terminalOsascriptArgs('/tmp/project', singleTab)
    expect(argvAfterSeparator(args)).toEqual([`cd '/tmp/project' && claude hello`, '#38 Only'])
  })

  it('iTerm2 gets one command and title pair', () => {
    const args = itermOsascriptArgs('/tmp/project', singleTab)
    expect(argvAfterSeparator(args)).toEqual([`cd '/tmp/project' && claude hello`, '#38 Only'])
  })

  it('Ghostty gets the directory and one command and title pair', () => {
    const args = ghosttyOsascriptArgs('/tmp/project', singleTab)
    expect(argvAfterSeparator(args)).toEqual(['/tmp/project', '', 'claude hello', '#38 Only'])
  })

  it.each([
    ['Terminal', terminalOsascriptArgs, 'set newTab to do script (item 1 of argv)'],
    ['iTerm2', itermOsascriptArgs, 'set targetWindow to (create window with default profile)'],
    ['Ghostty', ghosttyOsascriptArgs, 'set targetWindow to new window with configuration surfaceConfig']
  ])('%s launches without a default window and activates only after making its own', (_name, build, makesWindow) => {
    const lines = scriptLines(build('/tmp/project', singleTab))
    const tellIndex = lines.findIndex((line) => line.startsWith('tell application'))
    const makesWindowIndex = lines.indexOf(makesWindow)
    expect(lines[tellIndex + 1]).toBe('launch')
    expect(makesWindowIndex).toBeGreaterThan(tellIndex)
    expect(lines.indexOf('activate')).toBeGreaterThan(makesWindowIndex)
    expect(lines.filter((line) => line === 'activate')).toHaveLength(1)
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

  it('Warp sets the tab title and round-trips a hostile one', () => {
    const toml = warpTabConfigToml('/tmp/project', titledTabs[0])
    const titleLine = toml.split('\n').find((line) => line.startsWith('title = '))
    expect(JSON.parse(titleLine!.slice('title = '.length))).toBe(HOSTILE_TITLE)
  })

  it('Warp emits no title line for an untitled tab', () => {
    expect(warpTabConfigToml('/tmp/project', { command: 'claude one' })).not.toContain('title =')
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
    expect(argvAfterSeparator(args)).toEqual(['/tmp/project', '', 'claude one', HOSTILE_TITLE, 'claude two', '#34 Second'])
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

describe('orchestratorTab', () => {
  const valid = { command: "claude 'watch'", title: 'AUTORUN-ORCHESTRATOR-IN-DEV' }

  it('passes a run without an orchestrator', () => {
    expect(orchestratorTab(undefined)).toBeUndefined()
  })

  it('keeps a well-formed orchestrator', () => {
    expect(orchestratorTab(valid)).toEqual(valid)
  })

  it.each([
    ['null', null],
    ['a string', 'claude'],
    ['a missing command', { title: valid.title }],
    ['an empty command', { ...valid, command: '' }],
    ['a non-string command', { ...valid, command: 7 }],
    ['a missing title', { command: valid.command }],
    ['a title with an escape sequence', { ...valid, title: 'AUTORUN\u001b]0;pwn\u0007' }],
    ['an oversized title', { ...valid, title: 'A'.repeat(201) }]
  ])('rejects %s', (_label, payload) => {
    expect(() => orchestratorTab(payload)).toThrow('Invalid Auto Run orchestrator.')
  })
})

describe('tab liveness', () => {
  it('builds a read-only Terminal listing, checking it is running before telling it anything', () => {
    const lines = (tabTitlesOsascriptArgs('terminal') ?? []).filter((arg) => arg !== '-e')
    expect(lines[0]).toBe('if application "Terminal" is not running then return ""')
    expect(lines).toContain('set end of titles to custom title of t')
    expect(lines.join('\n')).not.toMatch(/activate|launch|close|keystroke/)
  })

  // Their tab names follow the agent's own title escapes, so a live tab would read as gone.
  it('has no listing for terminals whose tab names the agent overwrites, Warp, or an unknown id', () => {
    expect(tabTitlesOsascriptArgs('iterm2')).toBeUndefined()
    expect(tabTitlesOsascriptArgs('ghostty')).toBeUndefined()
    expect(tabTitlesOsascriptArgs('warp')).toBeUndefined()
    expect(tabTitlesOsascriptArgs('constructor')).toBeUndefined()
  })

  it('matches whole titles, and says unknown when there is no listing', () => {
    expect(tabLiveness(['#7 Add the thing', '#8 Other'], ['#7 Add the thing', '#7 Add'])).toEqual(['alive', 'gone'])
    expect(tabLiveness(undefined, ['#7 Add the thing'])).toEqual(['unknown'])
  })
})
