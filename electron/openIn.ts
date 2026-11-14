import { findOpenInTarget } from '../src/shared/openInTargets.js'
import type { TerminalTab } from '../src/shared/projectTypes.js'
import { usableTabTitle } from './terminalLaunch.js'

export type CommandRunner = (projectPath: string, tabs: TerminalTab[]) => Promise<unknown>

export interface OpenInDependencies {
  // Throws when the path is outside the configured scan directories; returns it normalized.
  assertScannedProjectPath: (projectPath: string) => string
  writeClipboard: (text: string) => void
  // undefined when the target can't run commands (an editor, or not on macOS).
  commandRunnerFor: (targetId: string) => CommandRunner | undefined
  openFolder: (appName: string, projectPath: string) => Promise<unknown>
}

export interface OpenInResult {
  ok: true
  appLabel: string
  ranCommand?: string
  copiedCommand?: string
  fallbackCommand?: string
}

// The project:open-in handler minus Electron: validates the renderer's payload,
// then launches. Terminals get the command and run it; editors are launched
// with `open -a`, which takes a directory and no argv, so the clipboard remains
// the hand-off there. Copy either way: a launch that never reaches the shell
// still leaves something to paste.
export const openProjectIn = async (payload: unknown, dependencies: OpenInDependencies): Promise<OpenInResult> => {
  const { projectPath, targetId, command, title } = (payload ?? {}) as {
    projectPath?: unknown
    targetId?: unknown
    command?: unknown
    title?: unknown
  }
  if (typeof projectPath !== 'string') throw new Error('Invalid project path.')
  if (typeof targetId !== 'string') throw new Error('Invalid open-in target.')
  // Resolve against the shared allowlist so only known apps are ever launched.
  const target = findOpenInTarget(targetId)
  if (!target) throw new Error(`Unknown open-in target: ${targetId}`)
  const normalized = dependencies.assertScannedProjectPath(projectPath)

  const ticketCommand = typeof command === 'string' && command.trim() ? command : undefined
  if (ticketCommand) dependencies.writeClipboard(ticketCommand)
  const runCommand = dependencies.commandRunnerFor(target.id)

  try {
    if (ticketCommand && runCommand) {
      // A bad title is dropped, never rejected: it must not block the command.
      const tabTitle = usableTabTitle(title)
      await runCommand(normalized, [{ command: ticketCommand, title: tabTitle }])
      return { ok: true, appLabel: target.label, ranCommand: ticketCommand }
    }
    await dependencies.openFolder(target.appName, normalized)
    return { ok: true, appLabel: target.label, copiedCommand: ticketCommand }
  } catch {
    const fallbackCommand = `cd ${JSON.stringify(normalized)}`
    dependencies.writeClipboard(fallbackCommand)
    return { ok: true, appLabel: target.label, fallbackCommand }
  }
}
