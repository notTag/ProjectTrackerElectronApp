/**
 * Runs a ticket's agent headless, in the project directory, and hands back
 * what it printed.
 *
 * Kept out of main.ts — which cannot be imported under test because it touches
 * the Electron app object at module load — so the argv handling below has a
 * home that tests can reach.
 */

import { execFile, type ExecFileException } from 'node:child_process'
import path from 'node:path'

import { agentModelWords, agentResumeWords, agentSessionWords, type Agent } from '../src/shared/projectTypes.js'

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

interface AgentAttempt extends AgentRunResult {
  // Where a CLI reports why it stopped: stderr plus the last stdout line. Not
  // error.message (it repeats the argv, prompt included) and not the whole of
  // stdout, whose real work may well mention "network" or "timed out".
  failureReport: string
  error?: ExecFileException
}

const lastLine = (text: string): string => text.trim().split('\n').pop() ?? ''

// execFile with an argv array, no shell: the prompt — which can carry text from
// a GitHub issue — reaches the agent as one literal argument, never as code.
// Resolves even on failure so whatever the agent printed still reaches the
// ticket; a failed run's output is usually the most useful part.
const runAgentProcess = (
  agent: Agent,
  args: string[],
  projectPath: string,
  homeDirectory: string
): Promise<AgentAttempt> =>
  new Promise((resolve) => {
    const options = {
      cwd: projectPath,
      env: { ...process.env, PATH: agentSearchPath(homeDirectory) },
      timeout: AGENT_RUN_TIMEOUT_MS,
      maxBuffer: AGENT_RUN_MAX_OUTPUT_BYTES
    }
    const child = execFile(agent.command, args, options, (error, stdout, stderr) => {
      const printed = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n\n')
      const failureReport = [stderr.trim(), lastLine(stdout)].filter(Boolean).join('\n')
      if (!error) return resolve({ succeeded: true, output: stdout.trim(), failureReport })

      const commandMissing = error.code === 'ENOENT'
      const failureReason = commandMissing
        ? `${agent.name} CLI (\`${agent.command}\`) was not found. Install it or add it to your PATH.`
        : error.message
      const output = [printed, failureReason].filter(Boolean).join('\n\n')
      resolve({ succeeded: false, output, failureReport, error })
    })
    // An open stdin pipe reads as "input is coming" to CLIs that accept a piped
    // prompt, and they wait on it forever. There is no input; say so.
    child.stdin?.end()
  })

// Network drops and API overloads clear up on their own; a missing CLI or a
// run killed by the 30 min timeout won't, and retrying a stuck run is a stuck
// run twice. Status codes only count right after "error"/"status"/"HTTP", so
// "line 512" in a stack trace isn't an outage.
const TRANSIENT_FAILURE_PATTERN =
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|connection error|network|overloaded|rate limit|(?:error|status|http)\W{0,3}(?:429|5\d\d)\b|timed out/i

type FailureCause = Pick<ExecFileException, 'code' | 'killed'>

export const isTransientFailure = (failureReport: string, error?: FailureCause): boolean => {
  if (error?.code === 'ENOENT' || error?.killed) return false
  return TRANSIENT_FAILURE_PATTERN.test(failureReport)
}

export const RETRY_DELAYS_MS = [30_000, 120_000]
export const CONTINUE_PROMPT = 'Continue the task. Your previous attempt was interrupted.'

export interface AgentRetryNotice {
  attempt: number
  of: number
  delayMs: number
}

export interface HeadlessRunOptions {
  model?: string
  sessionId?: string
  sleep?: (delayMs: number) => Promise<void>
  onRetry?: (notice: AgentRetryNotice) => void
}

const sleepFor = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs))

// Attempt 1 starts the session under the app's id; retries resume that same
// session, so the agent keeps what it already did. An agent that can't resume
// gets one attempt: a retry would start over and redo the work.
export const runAgentHeadlessWithRetry = async (
  agent: Agent,
  prompt: string,
  projectPath: string,
  homeDirectory: string,
  { model, sessionId, sleep = sleepFor, onRetry }: HeadlessRunOptions = {}
): Promise<AgentRunResult & { attempts: number }> => {
  const modelWords = agentModelWords(agent, model)
  const sessionWords = agentSessionWords(agent, sessionId)
  const resumeWords = agentResumeWords(agent, sessionId)
  const canRetry = resumeWords.length > 0
  const firstArgs = [...agent.headlessArgs, ...modelWords, ...sessionWords, prompt]
  const resumeArgs = [...agent.headlessArgs, ...modelWords, ...resumeWords, CONTINUE_PROMPT]

  let attempt = await runAgentProcess(agent, firstArgs, projectPath, homeDirectory)
  // Every attempt's output is kept: the one that dropped often did the real work.
  const outputs = [attempt.output]
  let attempts = 1
  const retriesLeft = () => attempts <= RETRY_DELAYS_MS.length
  while (canRetry && !attempt.succeeded && retriesLeft() && isTransientFailure(attempt.failureReport, attempt.error)) {
    const delayMs = RETRY_DELAYS_MS[attempts - 1]
    onRetry?.({ attempt: attempts, of: RETRY_DELAYS_MS.length, delayMs })
    await sleep(delayMs)
    attempt = await runAgentProcess(agent, resumeArgs, projectPath, homeDirectory)
    outputs.push(attempt.output)
    attempts += 1
  }
  const output = outputs.filter(Boolean).join(`\n\n--- retry ---\n\n`)
  return { succeeded: attempt.succeeded, output, attempts }
}
