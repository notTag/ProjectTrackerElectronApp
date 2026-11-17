import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { LaneMarkdownKind } from '../src/shared/projectTypes.js'
import { resolveAgentMarkdownPath, saveAgentMarkdown } from './agentMarkdown.js'

const createdProjectPaths: string[] = []

const freshProjectPath = () => {
  const projectPath = mkdtempSync(path.join(tmpdir(), 'agent-markdown-test-'))
  createdProjectPaths.push(projectPath)
  return projectPath
}

afterEach(() => {
  for (const projectPath of createdProjectPaths.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true })
  }
})

const target = (projectPath: string, filePath = '', kind: LaneMarkdownKind = 'agent') => ({
  kind,
  projectPath,
  laneName: 'In Review',
  filePath
})

describe('resolveAgentMarkdownPath', () => {
  it('defaults to AgentPrompt.md in the lane folder under SwimlaneAgentPrompt/', () => {
    const resolved = resolveAgentMarkdownPath(target('/code/app'))
    expect(resolved).toBe('/code/app/SwimlaneAgentPrompt/In-Review/AgentPrompt.md')
  })

  it('puts the orchestrator file in the same lane folder', () => {
    const resolved = resolveAgentMarkdownPath(target('/code/app', '', 'orchestrator'))
    expect(resolved).toBe('/code/app/SwimlaneAgentPrompt/In-Review/AgentOrchestratorPrompt.md')
  })

  it('keeps a traversal lane name inside SwimlaneAgentPrompt/', () => {
    for (const laneName of ['../../etc', '../../../etc/passwd', '..', '/']) {
      const resolved = resolveAgentMarkdownPath({ ...target('/code/app'), laneName })
      const laneFolder = path.dirname(resolved)
      expect(path.dirname(laneFolder)).toBe('/code/app/SwimlaneAgentPrompt')
      expect(path.basename(laneFolder).startsWith('.')).toBe(false)
    }
  })

  it('moves a pre-#81 agent-context/ path into the lane folder', () => {
    const legacyPath = '/code/app/agent-context/ProjectTracker-electron-app-In-Review-AgentContext.md'
    const resolved = resolveAgentMarkdownPath(target('/code/app', legacyPath))
    expect(resolved).toBe('/code/app/SwimlaneAgentPrompt/In-Review/AgentPrompt.md')
  })

  it("follows a lane rename instead of keeping the old name's folder", () => {
    for (const kind of ['agent', 'orchestrator'] as const) {
      const fileName = kind === 'agent' ? 'AgentPrompt.md' : 'AgentOrchestratorPrompt.md'
      const oldNamePath = `/code/app/SwimlaneAgentPrompt/QA/${fileName}`
      const resolved = resolveAgentMarkdownPath(target('/code/app', oldNamePath, kind))
      expect(resolved).toBe(`/code/app/SwimlaneAgentPrompt/In-Review/${fileName}`)
    }
  })

  it('keeps a path the user chose, even inside the prompt folders', () => {
    for (const chosenPath of ['/code/app/agent-context/notes.md', '/code/app/SwimlaneAgentPrompt/QA/extra.md']) {
      expect(resolveAgentMarkdownPath(target('/code/app', chosenPath))).toBe(chosenPath)
    }
  })

  it('resolves a relative explicit path against the project', () => {
    expect(resolveAgentMarkdownPath(target('/code/app', 'docs/guide.md'))).toBe('/code/app/docs/guide.md')
  })

  it('rejects an explicit path that is not markdown', () => {
    expect(() => resolveAgentMarkdownPath(target('/code/app', '/Users/me/.zshrc'))).toThrow('must end in .md')
  })

  describe('orchestrator kind', () => {
    it('keeps a traversal lane name inside SwimlaneAgentPrompt/', () => {
      const traversal = { ...target('/code/app', '', 'orchestrator'), laneName: '../../etc' }
      const laneFolder = path.dirname(resolveAgentMarkdownPath(traversal))
      expect(path.dirname(laneFolder)).toBe('/code/app/SwimlaneAgentPrompt')
    })

    it('resolves a relative explicit path against the project', () => {
      const resolved = resolveAgentMarkdownPath(target('/code/app', 'docs/orchestrator.md', 'orchestrator'))
      expect(resolved).toBe('/code/app/docs/orchestrator.md')
    })

    it('rejects a non-markdown path, naming its own field', () => {
      const notMarkdown = target('/code/app', 'notes.txt', 'orchestrator')
      expect(() => resolveAgentMarkdownPath(notMarkdown)).toThrow('Agent Orchestrator markdown file must end in .md.')
    })
  })
})

const save = (markdownTarget: ReturnType<typeof target>, content: string) =>
  saveAgentMarkdown(resolveAgentMarkdownPath(markdownTarget), content)

describe('saveAgentMarkdown', () => {
  it('creates the lane folder recursively and writes the prompt', () => {
    const projectPath = freshProjectPath()
    const saved = save(target(projectPath), '# Guide\n')
    expect(readFileSync(saved.filePath, 'utf8')).toBe('# Guide\n')
  })

  it('creates missing parents for an explicit path', () => {
    const projectPath = freshProjectPath()
    const explicitPath = path.join(projectPath, 'nested', 'deeper', 'guide.md')
    save(target(projectPath, explicitPath), 'first')
    expect(readFileSync(explicitPath, 'utf8')).toBe('first')
  })

  it('overwrites an existing file with the current prompt', () => {
    const projectPath = freshProjectPath()
    save(target(projectPath), 'abc')
    const saved = save(target(projectPath), 'abcdef')
    expect(readFileSync(saved.filePath, 'utf8')).toBe('abcdef')
  })
})
