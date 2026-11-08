/**
 * Builds the launch arguments that carry ticket commands into each supported
 * terminal — one tab per command, all in one new window.
 *
 * None of them accept a command through `open -a <app> <dir>`, which takes a
 * directory and no argv, so each needs its own route: Warp reads a launch
 * configuration file, and Terminal, iTerm2 and Ghostty are driven by AppleScript.
 *
 * Kept out of main.ts — which cannot be imported under test because it touches
 * the Electron app object at module load — so the escaping below has a home
 * that tests can reach.
 */

import { shellQuote } from '../src/shared/projectTypes.js'

export const WARP_LAUNCH_CONFIG_NAME = 'project-tracker-ticket'

// JSON's string syntax is a subset of a YAML double-quoted scalar, so this
// carries the newlines and quotes of a ticket prompt through intact without
// pulling in a YAML serializer for two fields.
const yamlDoubleQuoted = (value: string) => JSON.stringify(value)

const warpTabYaml = (projectPath: string, command: string) => [
  '      - layout:',
  `          cwd: ${yamlDoubleQuoted(projectPath)}`,
  '          commands:',
  `            - exec: ${yamlDoubleQuoted(command)}`
]

export const warpLaunchConfigYaml = (projectPath: string, commands: string[]): string =>
  [
    '---',
    `name: ${WARP_LAUNCH_CONFIG_NAME}`,
    'windows:',
    '  - tabs:',
    ...commands.flatMap((command) => warpTabYaml(projectPath, command)),
    ''
  ].join('\n')

// AppleScript is passed as one -e per line. Commands travel as argv entries read
// back via `item i of argv` rather than being interpolated into the script text,
// so a prompt full of quotes and newlines never has to survive AppleScript string
// escaping on top of the shell escaping it already carries.
const osascriptArgs = (scriptLines: string[], argv: string[]): string[] => [
  ...scriptLines.flatMap((line) => ['-e', line]),
  '--',
  ...argv
]

const inProjectDirectory = (projectPath: string, command: string) => `cd ${shellQuote(projectPath)} && ${command}`

// Terminal's dictionary can open a window running something (`do script`) but
// has no verb for a new tab, so later tabs come from pressing ⌘T through System
// Events — which needs Accessibility permission for Project Tracker. A keystroke
// goes to whatever is frontmost, so Terminal is brought forward first and the
// tab count is polled: if no tab appears the script errors rather than typing
// the next command into the previous ticket's running agent. A single command
// never touches System Events.
export const terminalOsascriptArgs = (projectPath: string, commands: string[]): string[] =>
  osascriptArgs(
    [
      'on run argv',
      'tell application "Terminal"',
      'activate',
      'do script (item 1 of argv)',
      'set targetWindow to front window',
      'repeat with i from 2 to count of argv',
      'set tabCount to count of tabs of targetWindow',
      'set index of targetWindow to 1',
      'tell application "System Events" to tell process "Terminal" to set frontmost to true',
      'tell application "System Events" to keystroke "t" using command down',
      'repeat 30 times',
      'if (count of tabs of targetWindow) > tabCount then exit repeat',
      'delay 0.1',
      'end repeat',
      'if (count of tabs of targetWindow) = tabCount then error "Terminal did not open a new tab."',
      'do script (item i of argv) in last tab of targetWindow',
      'end repeat',
      'end tell',
      'end run'
    ],
    commands.map((command) => inProjectDirectory(projectPath, command))
  )

// `write text` types into the tab's live shell, so the session outlives the
// agent the same way Terminal's `do script` does.
export const itermOsascriptArgs = (projectPath: string, commands: string[]): string[] =>
  osascriptArgs(
    [
      'on run argv',
      'tell application "iTerm"',
      'activate',
      'set targetWindow to (create window with default profile)',
      'repeat with i from 1 to count of argv',
      'if i > 1 then tell targetWindow to create tab with default profile',
      'tell current session of targetWindow to write text (item i of argv)',
      'end repeat',
      'end tell',
      'end run'
    ],
    commands.map((command) => inProjectDirectory(projectPath, command))
  )

// Ghostty 1.3+ scripting: `initial input` is typed into the tab's own shell
// rather than replacing it (as `command` would), so the shell outlives the
// agent with no exec trick. argv item 1 is the directory, the rest commands.
export const ghosttyOsascriptArgs = (projectPath: string, commands: string[]): string[] =>
  osascriptArgs(
    [
      'on run argv',
      'tell application "Ghostty"',
      'activate',
      'set surfaceConfig to new surface configuration',
      'set initial working directory of surfaceConfig to (item 1 of argv)',
      'set initial input of surfaceConfig to (item 2 of argv) & linefeed',
      'set targetWindow to new window with configuration surfaceConfig',
      'repeat with i from 3 to count of argv',
      'set initial input of surfaceConfig to (item i of argv) & linefeed',
      'new tab in targetWindow with configuration surfaceConfig',
      'end repeat',
      'end tell',
      'end run'
    ],
    [projectPath, ...commands]
  )
