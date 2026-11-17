import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { SWIMLANE_PROMPT_DIRECTORY, ticketAgentPrompt } from '../../src/shared/projectTypes.js'
import { REPO_ROOT, fixtureLanes, promptedLanes } from '../fixtures.js'

const promptRelativeNames = readdirSync(path.join(REPO_ROOT, SWIMLANE_PROMPT_DIRECTORY), { recursive: true, encoding: 'utf8' })
const promptMarkdownNames = promptRelativeNames.filter((name) => name.endsWith('.md'))
const promptFiles = promptMarkdownNames.map((name) => path.join(SWIMLANE_PROMPT_DIRECTORY, name))
const fixtureLaneIds = new Set(fixtureLanes.map((lane) => lane.id))

// Prompts must defer to CLAUDE.md or the injected path. A hard-coded path
// would also point eval runs at the real board.
const REAL_DATABASE_PATH_PATTERN = /project-tracker\.sqlite|Library\/Application Support\/Project Tracker/

// Only hyphenated tokens count as lane ids: plain words like `main` or "idea"
// are as likely to be prose, and display names aren't checked at all.
const LANE_ID_TOKEN = '[a-z0-9]+(?:-[a-z0-9]+)+'
const BACKTICKED_LANE_ID = new RegExp('`(' + LANE_ID_TOKEN + ')`', 'g')
const MOVE_TO_LANE_ID = new RegExp('\\b(?:move|moved|push)\\b[^.\\n]*?\\bto\\s+(?:the\\s+)?[\'"]?(' + LANE_ID_TOKEN + ')\\b', 'gi')

const mentionedLaneIds = (prompt: string): string[] => {
  const backticked = [...prompt.matchAll(BACKTICKED_LANE_ID)].map((match) => match[1])
  const moveTargets = [...prompt.matchAll(MOVE_TO_LANE_ID)].map((match) => match[1].toLowerCase())
  return [...new Set([...backticked, ...moveTargets])]
}

describe('agent prompt lint', () => {
  it('finds lane ids the way the lint expects', () => {
    expect(mentionedLaneIds('Move the ticket to in-pr. Then `in-dev`. Run `git checkout main`.')).toEqual([
      'in-dev',
      'in-pr'
    ])
  })

  describe.each(promptFiles)('%s', (relativePath) => {
    const content = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')

    it('is not empty', () => {
      expect(content.trim()).not.toBe('')
    })

    it('names only lane ids that exist on the fixture board', () => {
      const unknownLaneIds = mentionedLaneIds(content).filter((laneId) => !fixtureLaneIds.has(laneId))
      expect(unknownLaneIds).toEqual([])
    })

    it('hard-codes no real database path', () => {
      expect(content).not.toMatch(REAL_DATABASE_PATH_PATTERN)
    })
  })

  describe.each(promptedLanes.map((lane) => [lane.id, lane] as const))('lane %s', (_laneId, lane) => {
    it('assembles into a prompt the agent CLI cannot read as an option', () => {
      const prompt = ticketAgentPrompt({ id: 't', number: 1, laneId: lane.id, title: 'T', description: '', createdAt: '' }, lane)
      expect(prompt.startsWith('-')).toBe(false)
    })
  })
})
