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
}

export const OPEN_IN_TARGETS: readonly OpenInTarget[] = [
  { id: 'warp', label: 'Warp', appName: 'Warp' },
  { id: 'terminal', label: 'Terminal', appName: 'Terminal' },
  { id: 'ghostty', label: 'Ghostty', appName: 'Ghostty' },
  { id: 'cursor', label: 'Cursor', appName: 'Cursor' },
  { id: 'zed', label: 'Zed', appName: 'Zed' },
  { id: 'vscode', label: 'VSCode', appName: 'Visual Studio Code' }
] as const

// First entry is the default; the picker also lists targets in this order.
export const DEFAULT_OPEN_IN_TARGET_ID = OPEN_IN_TARGETS[0].id

/** Resolve a target by id; returns undefined for unknown ids (untrusted input). */
export const findOpenInTarget = (id: string): OpenInTarget | undefined =>
  OPEN_IN_TARGETS.find((target) => target.id === id)
