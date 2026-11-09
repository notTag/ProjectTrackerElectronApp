/**
 * Apps the "Open In" button can launch a project folder in.
 *
 * Shared between the renderer (dropdown options) and the Electron main process
 * (allowlist + macOS `open -a <appName>` lookup) so both sides agree on the set
 * of valid targets. `id` is the persisted/IPC value; `appName` is only ever
 * consumed in the main process.
 */
export interface OpenInTarget {
  /** Stable identifier persisted in localStorage and sent over IPC. */
  id: string
  /** Human-facing label shown in the picker. */
  label: string
  /** macOS application name passed to `open -a <appName> <dir>`. */
  appName: string
  /** Terminals run a ticket's command; editors only open the folder. */
  runsCommands: boolean
}

export const OPEN_IN_TARGETS: readonly OpenInTarget[] = [
  { id: 'warp', label: 'Warp', appName: 'Warp', runsCommands: true },
  { id: 'terminal', label: 'Terminal', appName: 'Terminal', runsCommands: true },
  { id: 'ghostty', label: 'Ghostty', appName: 'Ghostty', runsCommands: true },
  { id: 'iterm2', label: 'iTerm2', appName: 'iTerm', runsCommands: true },
  { id: 'cursor', label: 'Cursor', appName: 'Cursor', runsCommands: false },
  { id: 'zed', label: 'Zed', appName: 'Zed', runsCommands: false },
  { id: 'vscode', label: 'VSCode', appName: 'Visual Studio Code', runsCommands: false }
] as const

export const TERMINAL_TARGETS = OPEN_IN_TARGETS.filter((target) => target.runsCommands)

// First entry is the default; the picker also lists targets in this order.
export const DEFAULT_OPEN_IN_TARGET_ID = OPEN_IN_TARGETS[0].id

/** Resolve a target by id; returns undefined for unknown ids (untrusted input). */
export const findOpenInTarget = (id: string): OpenInTarget | undefined =>
  OPEN_IN_TARGETS.find((target) => target.id === id)

// A lane with no terminal of its own follows the Open In picker when that is a
// terminal, so Auto Run uses a terminal the user is known to have.
export const resolveAutoRunTerminal = (laneTerminalId: string | undefined, pickerTargetId: string): OpenInTarget => {
  const terminalId = laneTerminalId ?? pickerTargetId
  return TERMINAL_TARGETS.find((target) => target.id === terminalId) ?? TERMINAL_TARGETS[0]
}
