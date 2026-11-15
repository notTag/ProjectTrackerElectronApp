import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { SwimLane, Ticket } from '../src/shared/projectTypes.js'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES_DIRECTORY = path.join(REPO_ROOT, 'evals', 'fixtures')

interface LaneFixture extends Omit<SwimLane, 'agentPrompt' | 'agentFilePath'> {
  // Where the lane's prompt text comes from. Never duplicated in JSON, so the
  // committed markdown file is the only copy under test.
  promptFile?: string
  // Mirrors the live board: set only on lanes linked to a markdown file there.
  agentFilePath?: string
}

export type FieldCheck = 'nonEmpty' | 'changed'

export interface CaseExpectation {
  endLane: string
  moves?: number
  fields?: Record<string, FieldCheck>
  stubCalls?: string[]
}

export interface EvalCase {
  laneId: string
  name: string
  ticket: Partial<Ticket> & Pick<Ticket, 'title' | 'description'>
  // 'branch-with-commit' = the ticket's branch already exists with the work committed.
  setup?: 'branch-with-commit'
  expect: CaseExpectation
}

const readJson = <T>(filePath: string): T => JSON.parse(readFileSync(filePath, 'utf8')) as T

const boardFixture = readJson<{ projectName: string; lanes: LaneFixture[] }>(path.join(FIXTURES_DIRECTORY, 'board.json'))

export const FIXTURE_PROJECT_NAME = boardFixture.projectName

const laneFromFixture = ({ promptFile, agentFilePath, ...lane }: LaneFixture): SwimLane => {
  const agentPrompt = promptFile ? readFileSync(path.join(REPO_ROOT, promptFile), 'utf8') : ''
  return { ...lane, agentPrompt, agentFilePath: agentFilePath ?? '' }
}

export const fixtureLanes: SwimLane[] = boardFixture.lanes.map(laneFromFixture)

export const promptedLanes = fixtureLanes.filter((lane) => lane.agentPrompt.trim())

export const laneById = (laneId: string): SwimLane => {
  const lane = fixtureLanes.find((candidate) => candidate.id === laneId)
  if (!lane) throw new Error(`No fixture lane "${laneId}" in evals/fixtures/board.json.`)
  return lane
}

const CASES_DIRECTORY = path.join(FIXTURES_DIRECTORY, 'cases')

export const loadCases = (): EvalCase[] =>
  readdirSync(CASES_DIRECTORY).flatMap((laneId) =>
    readdirSync(path.join(CASES_DIRECTORY, laneId))
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => {
        const fixture = readJson<Omit<EvalCase, 'laneId' | 'name'>>(path.join(CASES_DIRECTORY, laneId, fileName))
        return { ...fixture, laneId, name: path.basename(fileName, '.json') }
      })
  )

// High enough that no real board reaches it, so a stray write aimed at the
// real DB matches no row and the real-DB guard can watch this exact number.
export const EVAL_TICKET_NUMBER = 9046

export const ticketFromCase = (evalCase: EvalCase): Ticket => ({
  id: `eval-${evalCase.laneId}-${evalCase.name}`,
  number: EVAL_TICKET_NUMBER,
  laneId: evalCase.laneId,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...evalCase.ticket
})
