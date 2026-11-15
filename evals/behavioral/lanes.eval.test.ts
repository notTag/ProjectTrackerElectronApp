import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { REPO_ROOT, loadCases, type EvalCase } from '../fixtures.js'
import { createSandbox, evalAgent, gradeCase, readSeededRow, realDatabaseStrayRows, runCaseAgent } from '../harness.js'

const RUNS = Number(process.env.EVAL_RUNS ?? 3)
const PASS_THRESHOLD = Math.ceil((2 * RUNS) / 3)
const KEEP_SANDBOXES = process.env.EVAL_KEEP === '1'
const AGENT_RUN_TIMEOUT_MS = 30 * 60 * 1000
const CASE_TIMEOUT_MS = RUNS * AGENT_RUN_TIMEOUT_MS + 60_000
const OUTPUT_TAIL_CHARACTERS = 2000

interface RunFailure {
  run: number
  reason: string
  agentOutputTail: string
  sandbox?: string
}

interface CaseResult {
  lane: string
  case: string
  runs: number
  passes: number
  failures: RunFailure[]
}

const results: CaseResult[] = []

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

    // ponytail: watches only rows an eval could have hit; a write that lands
    // on some other real ticket isn't caught. Snapshot more columns if it matters.
    const strayRowsAfter = realDatabaseStrayRows()
    if (strayRowsAfter !== strayRowsBefore) {
      reasons.unshift(`REAL DB TOUCHED: stray eval rows ${strayRowsBefore} → ${strayRowsAfter}`)
    }
    if (!reasons.length) return undefined
    return {
      run,
      reason: reasons.join('; '),
      agentOutputTail: agentResult.output.slice(-OUTPUT_TAIL_CHARACTERS),
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
          for (let run = 1; run <= RUNS; run++) {
            const failure = await runOnce(evalCase, run)
            if (failure) failures.push(failure)
          }
          const passes = RUNS - failures.length
          results.push({ lane: laneId, case: evalCase.name, runs: RUNS, passes, failures })

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

  console.table(results.map(({ lane, case: caseName, runs, passes }) => ({ lane, case: caseName, passed: `${passes}/${runs}` })))
  console.log(`Eval results: ${resultsPath}`)
})
