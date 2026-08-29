/**
 * Builds the launch arguments that carry a ticket's command into each supported
 * terminal.
 *
 * None of them accept a command through `open -a <app> <dir>`, which takes a
 * directory and no argv, so each needs its own route: Warp reads a launch
 * configuration file, Terminal is driven by AppleScript, and Ghostty takes
 * config keys on the command line.
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

export const warpLaunchConfigYaml = (projectPath: string, command: string): string =>
  [
    '---',
    `name: ${WARP_LAUNCH_CONFIG_NAME}`,
    'windows:',
    '  - tabs:',
    '      - layout:',
    `          cwd: ${yamlDoubleQuoted(projectPath)}`,
    '          commands:',
    `            - exec: ${yamlDoubleQuoted(command)}`,
    ''
  ].join('\n')

// Terminal has no launch-configuration equivalent; AppleScript's `do script` is
// the supported way to open a window running something. The command travels as
// an argv entry read back via `item 1 of argv` rather than being interpolated
// into the script text, so a prompt full of quotes and newlines never has to
// survive AppleScript string escaping on top of the shell escaping it already
// carries.
export const terminalOsascriptArgs = (projectPath: string, command: string): string[] => [
  '-e',
  'on run argv',
  '-e',
  'tell application "Terminal"',
  '-e',
  'activate',
  '-e',
  'do script (item 1 of argv)',
  '-e',
  'end tell',
  '-e',
  'end run',
  '--',
  `cd ${shellQuote(projectPath)} && ${command}`
]

// Ghostty refuses to launch its terminal from the CLI on macOS and documents
// `open -na Ghostty.app --args` as the way in. `initial-command` applies to the
// first surface only, leaving later tabs as normal shells; `-e` would have set
// the same key but also forces quit-after-last-window-closed, which would take
// the user's other Ghostty windows down when the agent exits.
//
// The `shell:` prefix pins the value to /bin/sh -c rather than leaving it to
// Ghostty's direct-vs-shell heuristic, so the quoting in the command is read by
// a shell exactly as it was written.
//
// ponytail: wait-after-command keeps the window up on a keypress once the agent
// exits. Swap for a trailing `exec $SHELL -l` if a live shell is wanted there.
export const ghosttyOpenArgs = (projectPath: string, command: string): string[] => [
  '-na',
  'Ghostty.app',
  '--args',
  `--working-directory=${projectPath}`,
  `--initial-command=shell:${command}`,
  '--wait-after-command=true'
]
