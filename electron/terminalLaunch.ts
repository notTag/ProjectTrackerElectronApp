/**
 * Builds the launch arguments that carry ticket commands into each supported
 * terminal — one tab per command, all in one new window, each tab titled after
 * its ticket where the terminal allows it.
 *
 * None of them accept a command through `open -a <app> <dir>`, which takes a
 * directory and no argv, so each needs its own route: Warp reads a launch
 * configuration file, and Terminal, iTerm2 and Ghostty are driven by AppleScript.
 *
 * Kept out of main.ts — which cannot be imported under test because it touches
 * the Electron app object at module load — so the escaping below has a home
 * that tests can reach.
 */

import { shellQuote, type TabLiveness, type TerminalTab } from '../src/shared/projectTypes.js'

export const WARP_LAUNCH_CONFIG_NAME = 'project-tracker-ticket'

// Formatting is ticketTabTitle's job; this only refuses garbage, and an
// oversized title is dropped rather than failing the run over a nicety.
const TAB_TITLE_MAX_LENGTH = 200
// Control characters could smuggle terminal escape sequences into the title.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/
export const usableTabTitle = (title: unknown): string | undefined => {
  if (typeof title !== 'string' || !title) return undefined
  if (title.length > TAB_TITLE_MAX_LENGTH || CONTROL_CHARACTERS.test(title)) return undefined
  return title
}

// The orchestrator tab is only told apart from ticket tabs by its title, so
// unlike a ticket title a bad one fails the run instead of being dropped.
export const orchestratorTab = (value: unknown): TerminalTab | undefined => {
  if (value === undefined) return undefined
  const candidate = value as Partial<TerminalTab> | null
  const isObject = typeof candidate === 'object' && candidate !== null
  const title = isObject ? usableTabTitle(candidate.title) : undefined
  if (!isObject || typeof candidate.command !== 'string' || !candidate.command || !title) {
    throw new Error('Invalid Auto Run orchestrator.')
  }
  return { command: candidate.command, title }
}

// JSON's string syntax is a subset of a YAML double-quoted scalar, so this
// carries the newlines and quotes of a ticket prompt through intact without
// pulling in a YAML serializer for two fields.
const yamlDoubleQuoted = (value: string) => JSON.stringify(value)

// A tab's `title` sits beside its `layout`, so a titled tab opens its list
// entry with the title instead.
const warpTabYaml = (projectPath: string, tab: TerminalTab) => {
  const tabHeader = tab.title
    ? [`      - title: ${yamlDoubleQuoted(tab.title)}`, '        layout:']
    : ['      - layout:']
  return [
    ...tabHeader,
    `          cwd: ${yamlDoubleQuoted(projectPath)}`,
    '          commands:',
    `            - exec: ${yamlDoubleQuoted(tab.command)}`
  ]
}

export const warpLaunchConfigYaml = (projectPath: string, tabs: TerminalTab[]): string =>
  [
    '---',
    `name: ${WARP_LAUNCH_CONFIG_NAME}`,
    'windows:',
    '  - tabs:',
    ...tabs.flatMap((tab) => warpTabYaml(projectPath, tab)),
    ''
  ].join('\n')

// AppleScript is passed as one -e per line. Commands and titles travel as argv
// entries read back via `item i of argv` rather than being interpolated into the
// script text, so a prompt full of quotes and newlines never has to survive
// AppleScript string escaping on top of the shell escaping it already carries.
const osascriptArgs = (scriptLines: string[], argv: string[]): string[] => [
  ...scriptLines.flatMap((line) => ['-e', line]),
  '--',
  ...argv
]

const inProjectDirectory = (projectPath: string, command: string) => `cd ${shellQuote(projectPath)} && ${command}`

// argv carries each tab as a [command, title] pair; a tab with no title gets an
// empty string so the pairs never shift.
const commandTitlePairs = (projectPath: string, tabs: TerminalTab[]) =>
  tabs.flatMap((tab) => [inProjectDirectory(projectPath, tab.command), tab.title ?? ''])

// A title is a nicety: inside `try` a terminal that refuses it still runs the
// tab's command and the rest of the batch.
const setTitleIfGiven = (...setTitleStatements: string[]) => [
  'if tabTitle is not "" then',
  'try',
  ...setTitleStatements,
  'end try',
  'end if'
]

// Terminal and iTerm2 show a shell's own title escapes in place of a title set
// while that shell is still starting, so their titles go on in a second pass
// once the shells are up. Any later title escape (an agent, a prompt hook)
// still replaces them.
// ponytail: a fixed 1s wait, not a readiness check; a slow shell startup can
// still win the race and leave that tab untitled.
const titleAfterShellStartup = (tabListName: string, ...setTitleStatements: string[]) => [
  'delay 1',
  `repeat with i from 1 to count of ${tabListName}`,
  'set tabTitle to item (2 * i) of argv',
  ...setTitleIfGiven(...setTitleStatements),
  'end repeat'
]

// A terminal that is not running opens its own blank window when started by
// `activate` (or by any command sent to it), because those launch it with an
// open-application event. `launch` starts it without one, so the script makes
// the only window; `activate` then brings that window forward. Already running
// → `launch` does nothing.
// ponytail: a terminal's own session restore (Warp, Ghostty's
// window-save-state) still reopens last session's windows; that follows the
// user's setting in that terminal.
const LAUNCH_WITHOUT_DEFAULT_WINDOW = 'launch'

// Terminal's dictionary can open a window running something (`do script`) but
// has no verb for a new tab, so later tabs come from pressing ⌘T through System
// Events — which needs Accessibility permission for Project Tracker. A keystroke
// goes to whatever is frontmost, so Terminal is brought forward first and the
// tab count is polled: if no tab appears the script errors rather than typing
// the next command into the previous ticket's running agent. A single command
// (Open In, or a full-auto handoff of one ticket) never touches System Events;
// Auto Run always has 2+ tabs since the orchestrator opens with every run.
export const terminalOsascriptArgs = (projectPath: string, tabs: TerminalTab[]): string[] =>
  osascriptArgs(
    [
      'on run argv',
      'tell application "Terminal"',
      LAUNCH_WITHOUT_DEFAULT_WINDOW,
      'set newTab to do script (item 1 of argv)',
      'activate',
      'set targetWindow to front window',
      'set openedTabs to {}',
      'repeat with i from 1 to (count of argv) div 2',
      'if i > 1 then',
      'set tabCount to count of tabs of targetWindow',
      'set index of targetWindow to 1',
      'tell application "System Events" to tell process "Terminal" to set frontmost to true',
      'tell application "System Events" to keystroke "t" using command down',
      'repeat 30 times',
      'if (count of tabs of targetWindow) > tabCount then exit repeat',
      'delay 0.1',
      'end repeat',
      'if (count of tabs of targetWindow) = tabCount then error "Terminal did not open a new tab."',
      'set newTab to do script (item (2 * i - 1) of argv) in last tab of targetWindow',
      'end if',
      'set end of openedTabs to newTab',
      'end repeat',
      ...titleAfterShellStartup(
        'openedTabs',
        'set custom title of item i of openedTabs to tabTitle',
        'set title displays custom title of item i of openedTabs to true'
      ),
      'end tell',
      'end run'
    ],
    commandTitlePairs(projectPath, tabs)
  )

// `write text` types into the tab's live shell, so the session outlives the
// agent the same way Terminal's `do script` does.
export const itermOsascriptArgs = (projectPath: string, tabs: TerminalTab[]): string[] =>
  osascriptArgs(
    [
      'on run argv',
      'tell application "iTerm"',
      LAUNCH_WITHOUT_DEFAULT_WINDOW,
      'set targetWindow to (create window with default profile)',
      'activate',
      'set tabSessions to {}',
      'repeat with i from 1 to (count of argv) div 2',
      'if i > 1 then tell targetWindow to create tab with default profile',
      'set end of tabSessions to current session of targetWindow',
      'tell current session of targetWindow to write text (item (2 * i - 1) of argv)',
      'end repeat',
      ...titleAfterShellStartup('tabSessions', 'set name of item i of tabSessions to tabTitle'),
      'end tell',
      'end run'
    ],
    commandTitlePairs(projectPath, tabs)
  )

// Ghostty 1.3+ scripting: `initial input` is typed into the tab's own shell
// rather than replacing it (as `command` would), so the shell outlives the
// agent with no exec trick. argv item 1 is the directory, item 2 the id of a
// window to add tabs to ('' = none), then [command, title] pairs; the commands
// are not cd-prefixed, the configuration sets the directory.
// #53: the window id is one this script returned earlier, so tabs only ever go
// into a window Project Tracker opened, never the user's own front window. A
// closed window's reference errors on first use, which falls back to a new one.
// The tab's `name override` (1.4+) pins its title over the terminal's own. It is
// written as its raw event code: AppleScript resolves dictionary terms at
// compile time, so the bare term would fail the whole script on 1.3, where the
// raw code only fails inside `try` and the tab keeps its default title.
export const ghosttyOsascriptArgs = (projectPath: string, tabs: TerminalTab[], reuseWindowId = ''): string[] =>
  osascriptArgs(
    [
      'on run argv',
      'tell application "Ghostty"',
      LAUNCH_WITHOUT_DEFAULT_WINDOW,
      'set surfaceConfig to new surface configuration',
      'set initial working directory of surfaceConfig to (item 1 of argv)',
      'set targetWindow to missing value',
      'set reuseWindowId to item 2 of argv',
      'if reuseWindowId is not "" then',
      'try',
      'set targetWindow to window id reuseWindowId',
      'get id of targetWindow',
      'on error',
      'set targetWindow to missing value',
      'end try',
      'end if',
      'repeat with i from 1 to ((count of argv) - 2) div 2',
      'set initial input of surfaceConfig to (item (2 * i + 1) of argv) & linefeed',
      'if targetWindow is missing value then',
      'set targetWindow to new window with configuration surfaceConfig',
      'set newTab to tab 1 of targetWindow',
      'else',
      'set newTab to new tab in targetWindow with configuration surfaceConfig',
      'end if',
      'set tabTitle to item (2 * i + 2) of argv',
      ...setTitleIfGiven('set «class GTno» of newTab to tabTitle'),
      'end repeat',
      'activate',
      // The tabs are already running by now, so a missing id must not fail the launch.
      'try',
      'return id of targetWindow',
      'on error',
      'return ""',
      'end try',
      'end tell',
      'end run'
    ],
    [projectPath, reuseWindowId, ...tabs.flatMap((tab) => [tab.command, tab.title ?? ''])]
  )

// Only Terminal can be asked: its custom title is a property of its own that
// title escapes never touch. iTerm2 session names and Ghostty tab names follow
// whatever the agent sets (Claude Code retitles its tab), so a live tab there
// would read as gone and get resumed a second time. Undefined = can't be asked.
export const tabTitlesOsascriptArgs = (targetId: string): string[] | undefined => {
  if (targetId !== 'terminal') return undefined
  const scriptLines = [
    'if application "Terminal" is not running then return ""',
    'set titles to {}',
    'tell application "Terminal"',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'set end of titles to custom title of t',
    'end repeat',
    'end repeat',
    'end tell',
    'set AppleScript\'s text item delimiters to linefeed',
    'return titles as text'
  ]
  return scriptLines.flatMap((line) => ['-e', line])
}

// No listing (unsupported terminal, osascript error) → nobody can say.
export const tabLiveness = (openTitles: string[] | undefined, wantedTitles: string[]): TabLiveness[] =>
  wantedTitles.map((title) => {
    if (!openTitles) return 'unknown'
    return openTitles.includes(title) ? 'alive' : 'gone'
  })
