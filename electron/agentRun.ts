/**
 * Runs a ticket's agent headless, in the project directory, and hands back
 * what it printed.
 *
 * Kept out of main.ts — which cannot be imported under test because it touches
 * the Electron app object at module load — so the argv handling below has a
 * home that tests can reach.
 */

import { execFile } from 'node:child_process'
import path from 'node:path'

import type { Agent } from '../src/shared/projectTypes.js'

// ponytail: an agent run is one-shot prelim work, not a session. Half an hour
// covers it; add a cancel button if runs ever need stopping sooner.
const AGENT_RUN_TIMEOUT_MS = 30 * 60 * 1000
const AGENT_RUN_MAX_OUTPUT_BYTES = 10 * 1024 * 1024

// Packaged apps launched from Finder don't inherit the user's shell PATH, so a
// CLI installed by Homebrew or a user-local installer won't resolve by name.
const agentSearchPath = (homeDirectory: string) =>
  [
    path.join(homeDirectory, '.local', 'bin'),
    path.join(homeDirectory, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.env.PATH ?? ''
  ].join(':')

export interface AgentRunResult {
  succeeded: boolean
  output: string
}

// execFile with an argv array, no shell: the prompt — which can carry text from
// a GitHub issue — reaches the agent as one literal argument, never as code.
// Resolves even on failure so whatever the agent printed still reaches the
// ticket; a failed run's output is usually the most useful part.
export const runAgentHeadless = (
  agent: Agent,
  prompt: string,
  projectPath: string,
  homeDirectory: string
): Promise<AgentRunResult> =>
  new Promise((resolve) => {
    const args = [...agent.headlessArgs, prompt]
    const options = {
      cwd: projectPath,
      env: { ...process.env, PATH: agentSearchPath(homeDirectory) },
      timeout: AGENT_RUN_TIMEOUT_MS,
      maxBuffer: AGENT_RUN_MAX_OUTPUT_BYTES
    }
    const child = execFile(agent.command, args, options, (error, stdout, stderr) => {
      if (!error) return resolve({ succeeded: true, output: stdout.trim() })

      const commandMissing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      const failureReason = commandMissing
        ? `${agent.name} CLI (\`${agent.command}\`) was not found. Install it or add it to your PATH.`
        : error.message
      const output = [stdout.trim(), stderr.trim(), failureReason].filter(Boolean).join('\n\n')
      resolve({ succeeded: false, output })
    })
    // An open stdin pipe reads as "input is coming" to CLIs that accept a piped
    // prompt, and they wait on it forever. There is no input; say so.
    child.stdin?.end()
  })
