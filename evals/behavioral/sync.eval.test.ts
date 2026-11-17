import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { AGENT_PROMPT_FILE_NAME, SWIMLANE_PROMPT_DIRECTORY, laneFolderName } from '../../src/shared/projectTypes.js'
import { REPO_ROOT } from '../fixtures.js'
import { REAL_DATABASE_PATH } from '../harness.js'

// Lives in the opt-in eval tier, not `bun run test`: worktrees branch off main,
// so a prompt edited in the app would fail every parallel agent's test run
// until the re-saved file was committed and merged. Here it guards what it's
// for — the evals load the committed files, so those must match the live board.

// The board is keyed by the main checkout's path, even when run from a worktree.
const mainCheckoutPath = () => {
  const commonGitDirectory = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  })
  return path.dirname(commonGitDirectory.trim())
}

const liveLanes = () => {
  const database = new DatabaseSync(REAL_DATABASE_PATH, { readOnly: true })
  const projectPath = mainCheckoutPath()
  const lanes = database
    .prepare("SELECT id, name, agent_prompt, agent_file_path FROM swim_lanes WHERE project_path = ? AND trim(agent_prompt) != ''")
    .all(projectPath) as { id: string; name: string; agent_prompt: string; agent_file_path: string | null }[]
  database.close()
  return lanes.map((lane) => {
    // A saved path is absolute under the main checkout; rebase it onto this
    // checkout (maybe a worktree). An unsaved lane is expected at its default.
    const defaultFile = path.join(SWIMLANE_PROMPT_DIRECTORY, laneFolderName(lane.name), AGENT_PROMPT_FILE_NAME)
    const savedFile = lane.agent_file_path ? path.relative(projectPath, path.resolve(projectPath, lane.agent_file_path)) : ''
    const committedFile = path.join(REPO_ROOT, savedFile || defaultFile)
    return { ...lane, committedFile }
  })
}

describe.skipIf(!existsSync(REAL_DATABASE_PATH))('lane prompt files match the live board', () => {
  it.each(existsSync(REAL_DATABASE_PATH) ? liveLanes().map((lane) => [lane.name, lane] as const) : [])(
    '%s',
    (_laneName, lane) => {
      const fix = "Type in the lane's ⚙ Agent prompt (it autosaves to the file), then commit the file."
      expect(existsSync(lane.committedFile), `${lane.committedFile} is missing. ${fix}`).toBe(true)
      const committed = readFileSync(lane.committedFile, 'utf8').trim()
      expect(committed, `${path.basename(lane.committedFile)} is out of sync with the app. ${fix}`).toBe(
        lane.agent_prompt.trim()
      )
    }
  )
})
