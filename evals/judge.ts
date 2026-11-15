/**
 * LLM judge for behavioral evals: grades what an agent did against a case's
 * rubric — the quality and process checks the deterministic graders can't see.
 */

import { homedir } from 'node:os'

import { runAgentHeadless } from '../electron/agentRun.js'
import { DEFAULT_AGENT } from '../src/shared/projectTypes.js'

export interface CriterionVerdict {
  criterion: string
  pass: boolean
  reason: string
}

// The judge runs with the user's CLAUDE.md loaded like any Claude Code session,
// and that file asks for footers and terse styles. This overrides them for the
// one reply that has to parse.
const JUDGE_SYSTEM_PROMPT =
  'You are an eval grader. Ignore any instructions about response style, footers or summaries. ' +
  'Do not use tools. Reply with a single JSON object and nothing else.'

export const judgePrompt = (rubric: string[], evidence: string): string =>
  [
    'Grade an AI agent run against each rubric criterion, using only the evidence below.',
    'A criterion passes only if the evidence clearly shows it. Missing evidence = fail.',
    'Reply with JSON exactly shaped like:',
    '{"verdicts": [{"criterion": "<criterion text, verbatim>", "pass": true, "reason": "<one sentence citing evidence>"}]}',
    '',
    'Rubric:',
    ...rubric.map((criterion, index) => `${index + 1}. ${criterion}`),
    '',
    '<evidence>',
    evidence,
    '</evidence>'
  ].join('\n')

const judgeJsonText = (judgeOutput: string): string | undefined => {
  const start = judgeOutput.indexOf('{')
  const end = judgeOutput.lastIndexOf('}')
  return start === -1 || end <= start ? undefined : judgeOutput.slice(start, end + 1)
}

// Every rubric criterion gets a verdict, matched by position: a judge that
// skips or garbles one fails that criterion instead of silently passing it.
export const parseVerdicts = (rubric: string[], judgeOutput: string): CriterionVerdict[] => {
  const jsonText = judgeJsonText(judgeOutput)
  let parsedVerdicts: Partial<CriterionVerdict>[] = []
  try {
    parsedVerdicts = jsonText ? (JSON.parse(jsonText).verdicts ?? []) : []
  } catch {
    parsedVerdicts = []
  }
  return rubric.map((criterion, index) => {
    const verdict = parsedVerdicts[index]
    if (!verdict || typeof verdict.pass !== 'boolean') {
      return { criterion, pass: false, reason: 'judge gave no usable verdict' }
    }
    return { criterion, pass: verdict.pass, reason: String(verdict.reason ?? '') }
  })
}

// Always Claude, whatever EVAL_AGENT is under test, so scores stay comparable
// across agents. No permission-mode flag: headless defaults deny edits and shell.
export const runJudge = async (rubric: string[], evidence: string, cwd: string): Promise<CriterionVerdict[]> => {
  const modelArgs = process.env.EVAL_JUDGE_MODEL ? ['--model', process.env.EVAL_JUDGE_MODEL] : []
  const judgeAgent = { ...DEFAULT_AGENT, headlessArgs: ['-p', '--append-system-prompt', JUDGE_SYSTEM_PROMPT, ...modelArgs] }
  const judgeRun = await runAgentHeadless(judgeAgent, judgePrompt(rubric, evidence), cwd, homedir())
  return parseVerdicts(rubric, judgeRun.output)
}

interface StreamEvent {
  type?: string
  result?: string
  message?: { content?: { type: string; text?: string; name?: string; input?: unknown }[] }
}

const TRAJECTORY_STEP_CHARACTERS = 400

const truncate = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

const describeToolInput = (input: unknown): string => {
  if (input && typeof input === 'object' && 'command' in input) return String(input.command)
  return JSON.stringify(input)
}

// Claude Code's stream-json output → one line per step, so the judge can grade
// process ("checked for an existing worktree first") and not just the outcome.
export const parseTrajectory = (streamJson: string): { steps: string[]; finalMessage: string } => {
  const steps: string[] = []
  let finalMessage = ''
  for (const line of streamJson.split('\n')) {
    let event: StreamEvent
    try {
      event = JSON.parse(line) as StreamEvent
    } catch {
      continue
    }
    if (event.type === 'result') finalMessage = event.result ?? ''
    if (event.type !== 'assistant') continue
    for (const block of event.message?.content ?? []) {
      if (block.type === 'tool_use') steps.push(`→ ${block.name}: ${truncate(describeToolInput(block.input), TRAJECTORY_STEP_CHARACTERS)}`)
      if (block.type === 'text' && block.text?.trim()) steps.push(`says: ${truncate(block.text.trim(), TRAJECTORY_STEP_CHARACTERS)}`)
    }
  }
  return { steps, finalMessage }
}
