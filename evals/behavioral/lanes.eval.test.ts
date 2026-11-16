import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { REPO_ROOT, loadCases, type EvalCase } from '../fixtures.js'
import {
  collectEvidence,
  createSandbox,
  evalAgent,
  gradeCase,
  readSeededRow,
  realDatabaseStrayRows,
  runCaseAgent
} from '../harness.js'
import { runJudge, type CriterionVerdict } from '../judge.js'

const RUNS = Number(process.env.EVAL_RUNS ?? 3)
// 0 would pass every case with no run at all.
if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`EVAL_RUNS must be a positive integer, got "${process.env.EVAL_RUNS}"`)
const PASS_THRESHOLD = Math.ceil((2 * RUNS) / 3)
const KEEP_SANDBOXES = process.env.EVAL_KEEP === '1'
const AGENT_RUN_TIMEOUT_MS = 30 * 60 * 1000
const CASE_TIMEOUT_MS = RUNS * AGENT_RUN_TIMEOUT_MS + 60_000
const OUTPUT_TAIL_CHARACTERS = 2000

interface RunFailure {
  run: number
  reason: string
  agentOutputTail: string
  // Every tool call the agent made: where a failure is usually explained.
  trajectory: string[]
  sandbox?: string
}

interface CaseResult {
  lane: string
  case: string
  runs: number
  passes: number
  failures: RunFailure[]
  rubric: { run: number; verdicts: CriterionVerdict[] }[]
}

const results: CaseResult[] = []
// Reset per case; every run's verdicts are kept, passing ones included, so a
// criterion that passes only narrowly still shows up in the report.
let runVerdicts: { run: number; verdicts: CriterionVerdict[] }[] = []

const selectedCases = loadCases().filter((evalCase) => !process.env.EVAL_LANE || evalCase.laneId === process.env.EVAL_LANE)
const casesByLane = Map.groupBy(selectedCases, (evalCase) => evalCase.laneId)

let strayRowsBefore: number | undefined

beforeAll(() => {
  strayRowsBefore = realDatabaseStrayRows()
})

const runOnce = async (evalCase: EvalCase, run: number): Promise<RunFailure | undefined> => {
  const sandbox = createSandbox(evalCase)
  try {
    const seededRow = readSeededRow(sandbox, evalCase)
    const agentResult = await runCaseAgent(sandbox, evalCase)
    const reasons = gradeCase(sandbox, evalCase, seededRow)
    if (!agentResult.succeeded) reasons.unshift('agent exited with an error')

    // ponytail: the judge is skipped once a deterministic check failed — the
    // run already fails, and a judge call costs as much as a short agent run.
    const rubric = evalCase.rubric ?? []
    const judgeIsUseful = rubric.length > 0 && reasons.length === 0 && process.env.EVAL_JUDGE !== '0'
    const verdicts = judgeIsUseful
      ? await runJudge(rubric, collectEvidence(sandbox, evalCase, seededRow, agentResult), sandbox.root)
      : []
    for (const verdict of verdicts.filter((candidate) => !candidate.pass)) {
      reasons.push(`rubric failed: ${verdict.criterion} — ${verdict.reason}`)
    }
    runVerdicts.push({ run, verdicts })

    // ponytail: watches only rows an eval could have hit; a write that lands
    // on some other real ticket isn't caught. Snapshot more columns if it matters.
    const strayRowsAfter = realDatabaseStrayRows()
    if (strayRowsAfter !== strayRowsBefore) {
      reasons.unshift(`REAL DB TOUCHED: stray eval rows ${strayRowsBefore} → ${strayRowsAfter}`)
      // Re-baseline so only the run that wrote gets blamed, not every later one.
      strayRowsBefore = strayRowsAfter
    }
    if (!reasons.length) return undefined
    return {
      run,
      reason: reasons.join('; '),
      agentOutputTail: agentResult.finalMessage.slice(-OUTPUT_TAIL_CHARACTERS),
      trajectory: agentResult.trajectory,
      sandbox: KEEP_SANDBOXES ? sandbox.root : undefined
    }
  } finally {
    if (!KEEP_SANDBOXES) rmSync(sandbox.root, { recursive: true, force: true })
  }
}

for (const [laneId, laneCases] of casesByLane) {
  describe(laneId, () => {
    for (const evalCase of laneCases) {
      it(
        evalCase.name,
        async () => {
          const failures: RunFailure[] = []
          runVerdicts = []
          for (let run = 1; run <= RUNS; run++) {
            // A run that throws (sandbox setup, DB open) counts as one failed
            // run instead of dropping the case's other runs and its report row.
            const failure = await runOnce(evalCase, run).catch(
              (error: unknown): RunFailure => ({ run, reason: `run threw: ${String(error)}`, agentOutputTail: '', trajectory: [] })
            )
            if (failure) failures.push(failure)
          }
          const passes = RUNS - failures.length
          results.push({ lane: laneId, case: evalCase.name, runs: RUNS, passes, failures, rubric: runVerdicts })

          const realDatabaseTouched = failures.some((failure) => failure.reason.includes('REAL DB TOUCHED'))
          expect(realDatabaseTouched, 'an eval run wrote to the real Project Tracker DB').toBe(false)
          expect(passes, failures.map((failure) => `run ${failure.run}: ${failure.reason}`).join('\n')).toBeGreaterThanOrEqual(
            PASS_THRESHOLD
          )
        },
        CASE_TIMEOUT_MS
      )
    }
  })
}

afterAll(() => {
  if (!results.length) return
  const resultsDirectory = path.join(REPO_ROOT, 'evals', 'results')
  mkdirSync(resultsDirectory, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const resultsPath = path.join(resultsDirectory, `${timestamp}.json`)
  writeFileSync(resultsPath, JSON.stringify({ agent: evalAgent().id, threshold: PASS_THRESHOLD, results }, null, 2))

  const rubricScore = (result: CaseResult) => {
    const verdicts = result.rubric.flatMap((run) => run.verdicts)
    return verdicts.length ? `${verdicts.filter((verdict) => verdict.pass).length}/${verdicts.length}` : '-'
  }
  const table = results.map((result) => ({
    lane: result.lane,
    case: result.case,
    passed: `${result.passes}/${result.runs}`,
    rubric: rubricScore(result)
  }))
  console.table(table)
  console.log(`Eval results: ${resultsPath}`)
})
