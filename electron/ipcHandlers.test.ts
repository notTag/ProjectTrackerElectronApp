import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createSeedState } from '../src/shared/projectTypes.js'
import { createIpcHandlers, type CallContext } from './ipcHandlers.js'
import { StateRepository } from './storage/stateRepository.js'

const createdRoots: string[] = []

afterEach(() => {
  for (const root of createdRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const setUp = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ipc-handlers-test-'))
  createdRoots.push(root)
  const scanDirectory = path.join(root, 'Projects')
  const sourcePath = path.join(scanDirectory, 'source')
  const targetPath = path.join(scanDirectory, 'target')
  mkdirSync(sourcePath, { recursive: true })
  mkdirSync(targetPath, { recursive: true })
  const seed = createSeedState()
  const project = seed.snapshot.projects[0]
  const repository = new StateRepository(path.join(root, 'userData'))
  repository.saveState({
    ...seed,
    scanDirectories: [scanDirectory],
    snapshot: {
      ...seed.snapshot,
      projects: [
        { ...project, path: sourcePath, name: 'Source' },
        { ...project, path: targetPath, name: 'Target' }
      ]
    },
    boards: {
      [sourcePath]: {
        lanes: [{ id: 'review', name: 'In Review', agentPrompt: 'Review it.', agentFilePath: '', outputTarget: 'docs/' }],
        tickets: []
      },
      [targetPath]: { lanes: [{ id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '' }], tickets: [] }
    }
  })
  const handlers = createIpcHandlers({
    homeDirectory: root,
    attachmentsRoot: path.join(root, 'attachments'),
    startedAt: new Date().toISOString(),
    pickDirectory: async () => null,
    writeClipboard: () => undefined,
    openPath: async () => ''
  })
  const context = { repository } as unknown as CallContext
  const call = (channel: keyof typeof handlers, payload?: unknown) => handlers[channel](payload, context)
  return { call, repository, sourcePath, targetPath }
}

const laneFile = (projectPath: string, fileName: string) =>
  path.join(projectPath, 'SwimlaneAgentPrompt', 'In-Review', fileName)

describe('lane-store:* handlers (#146)', () => {
  it('rejects malformed payloads', () => {
    const { call } = setUp()
    expect(() => call('lane-store:save', { projectPath: 1, laneId: 'review' })).toThrow('Invalid lane store save payload.')
    expect(() => call('lane-store:save', null)).toThrow('Invalid lane store save payload.')
    expect(() => call('lane-store:delete', { entryId: 7 })).toThrow('Invalid lane store delete payload.')
    expect(() => call('lane-store:add', { projectPath: '/x' })).toThrow('Invalid lane store add payload.')
  })

  it('refuses a project outside the scan directories', () => {
    const { call } = setUp()
    expect(() => call('lane-store:save', { projectPath: '/etc', laneId: 'review' })).toThrow('outside configured scan directories')
  })

  it('carries the prompt files to another board, writing only missing ones', () => {
    const { call, sourcePath, targetPath } = setUp()
    mkdirSync(path.dirname(laneFile(sourcePath, 'AgentPrompt.md')), { recursive: true })
    writeFileSync(laneFile(sourcePath, 'AgentPrompt.md'), '# Review agent', 'utf8')
    writeFileSync(laneFile(sourcePath, 'AgentOrchestratorPrompt.md'), '# Review orchestrator', 'utf8')
    mkdirSync(path.dirname(laneFile(targetPath, 'AgentPrompt.md')), { recursive: true })
    writeFileSync(laneFile(targetPath, 'AgentPrompt.md'), 'hand-written', 'utf8')

    const entry = call('lane-store:save', { projectPath: sourcePath, laneId: 'review' }) as { id: string; name: string }
    expect(entry.name).toBe('In Review')
    expect(call('lane-store:list')).toEqual([expect.objectContaining({ id: entry.id, laneId: 'review' })])

    const state = call('lane-store:add', { projectPath: targetPath, entryId: entry.id }) as ReturnType<
      StateRepository['getState']
    >
    const targetLanes = state.boards?.[targetPath].lanes.map((lane) => [lane.id, lane.outputTarget])
    expect(targetLanes).toEqual([['idea', ''], ['review', 'docs/']])
    expect(readFileSync(laneFile(targetPath, 'AgentPrompt.md'), 'utf8')).toBe('hand-written')
    expect(readFileSync(laneFile(targetPath, 'AgentOrchestratorPrompt.md'), 'utf8')).toBe('# Review orchestrator')

    call('lane-store:delete', { entryId: entry.id })
    expect(call('lane-store:list')).toEqual([])
  })

  it('saves a lane whose prompt file is outside the scan directories, without that prompt', () => {
    const { call, repository, sourcePath } = setUp()
    repository.updateSwimLane(sourcePath, 'review', { agentFilePath: '/etc/Prompt.md' })
    const entry = call('lane-store:save', { projectPath: sourcePath, laneId: 'review' }) as { id: string }
    expect(call('lane-store:list')).toEqual([expect.objectContaining({ id: entry.id })])
  })

  it('saves a lane whose prompt file field is not a .md or .txt path, without that prompt', () => {
    const { call, repository, sourcePath } = setUp()
    repository.updateSwimLane(sourcePath, 'review', { agentFilePath: 'notes/review.rtf' })
    const entry = call('lane-store:save', { projectPath: sourcePath, laneId: 'review' }) as { id: string }
    expect(call('lane-store:list')).toEqual([expect.objectContaining({ id: entry.id })])
  })

  it('writes empty files for a lane saved without prompt files', () => {
    const { call, sourcePath, targetPath } = setUp()
    const entry = call('lane-store:save', { projectPath: sourcePath, laneId: 'review' }) as { id: string }
    call('lane-store:add', { projectPath: targetPath, entryId: entry.id })
    expect(readFileSync(laneFile(targetPath, 'AgentPrompt.md'), 'utf8')).toBe('')
    expect(readFileSync(laneFile(targetPath, 'AgentOrchestratorPrompt.md'), 'utf8')).toBe('')
  })

  it('does not carry an old app-written copy of the agent prompt as markdown', () => {
    const { call, sourcePath, targetPath } = setUp()
    mkdirSync(path.dirname(laneFile(sourcePath, 'AgentPrompt.md')), { recursive: true })
    writeFileSync(laneFile(sourcePath, 'AgentPrompt.md'), 'Review it.\n', 'utf8')
    const entry = call('lane-store:save', { projectPath: sourcePath, laneId: 'review' }) as { id: string }
    call('lane-store:add', { projectPath: targetPath, entryId: entry.id })
    expect(readFileSync(laneFile(targetPath, 'AgentPrompt.md'), 'utf8')).toBe('')
  })
})

describe('lane markdown files (#175)', () => {
  it('gives a created lane empty default files and stores their paths', () => {
    const { call, sourcePath } = setUp()
    const lane = { id: 'qa', name: 'In Review', agentPrompt: '', agentFilePath: '' }
    const created = call('lane:create', { projectPath: sourcePath, lane }) as { agentFilePath: string; orchestratorFilePath: string }
    expect(created.agentFilePath).toBe(laneFile(sourcePath, 'AgentPrompt.md'))
    expect(created.orchestratorFilePath).toBe(laneFile(sourcePath, 'AgentOrchestratorPrompt.md'))
    expect(readFileSync(created.agentFilePath, 'utf8')).toBe('')
    expect(readFileSync(created.orchestratorFilePath, 'utf8')).toBe('')
  })

  it('fills only empty fields of an existing lane and never overwrites a file', () => {
    const { call, repository, sourcePath } = setUp()
    mkdirSync(path.dirname(laneFile(sourcePath, 'AgentPrompt.md')), { recursive: true })
    writeFileSync(laneFile(sourcePath, 'AgentPrompt.md'), 'Hand-written guide.', 'utf8')
    repository.updateSwimLane(sourcePath, 'review', { orchestratorFilePath: 'docs/orchestrator.txt' })

    const lane = call('lane:ensure-markdown-files', { projectPath: sourcePath, laneId: 'review' }) as {
      agentFilePath: string
      orchestratorFilePath: string
    }

    expect(lane.agentFilePath).toBe(laneFile(sourcePath, 'AgentPrompt.md'))
    expect(lane.orchestratorFilePath).toBe('docs/orchestrator.txt')
    expect(readFileSync(lane.agentFilePath, 'utf8')).toBe('Hand-written guide.')
    expect(existsSync(laneFile(sourcePath, 'AgentOrchestratorPrompt.md'))).toBe(false)
  })

  it('refuses a project outside the scan directories and skips an unknown lane', () => {
    const { call, sourcePath } = setUp()
    expect(() => call('lane:ensure-markdown-files', { projectPath: '/etc', laneId: 'review' })).toThrow('outside configured scan directories')
    expect(call('lane:ensure-markdown-files', { projectPath: sourcePath, laneId: 'missing' })).toBeNull()
  })

  it("reads the lane's agent file as context, .txt included", () => {
    const { call, sourcePath } = setUp()
    writeFileSync(path.join(sourcePath, 'guide.txt'), 'Run the linter.', 'utf8')
    const read = (filePath: string) =>
      call('lane:read-markdown-context', { kind: 'agent', projectPath: sourcePath, laneName: 'In Review', filePath })
    expect(read('guide.txt')).toEqual({ filePath: path.join(sourcePath, 'guide.txt'), content: 'Run the linter.' })
    expect(read('missing.md')).toBeNull()
    expect(() => call('lane:read-markdown-context', { kind: 'other', projectPath: sourcePath, laneName: 'x', filePath: '' })).toThrow(
      'Invalid read request.'
    )
  })
})
