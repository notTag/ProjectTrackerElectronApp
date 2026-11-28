import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { LaneMarkdownKind } from '../src/shared/projectTypes.js'
import { ensureDefaultLaneMarkdown, readLaneMarkdownContext, resolveAgentMarkdownPath } from './agentMarkdown.js'

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

  it('keeps a stored path as typed after a lane rename, so its text is not left behind', () => {
    for (const kind of ['agent', 'orchestrator'] as const) {
      const fileName = kind === 'agent' ? 'AgentPrompt.md' : 'AgentOrchestratorPrompt.md'
      const oldNamePath = `/code/app/SwimlaneAgentPrompt/QA/${fileName}`
      expect(resolveAgentMarkdownPath(target('/code/app', oldNamePath, kind))).toBe(oldNamePath)
    }
  })

  it('resolves a relative explicit path against the project', () => {
    expect(resolveAgentMarkdownPath(target('/code/app', 'docs/guide.md'))).toBe('/code/app/docs/guide.md')
  })

  it('accepts a .txt file', () => {
    expect(resolveAgentMarkdownPath(target('/code/app', 'docs/guide.txt'))).toBe('/code/app/docs/guide.txt')
  })

  it('rejects an explicit path that is not .md or .txt', () => {
    for (const refusedPath of ['/Users/me/.zshrc', 'scripts/run.sh']) {
      expect(() => resolveAgentMarkdownPath(target('/code/app', refusedPath))).toThrow('must end in .md or .txt')
    }
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

    it('rejects a path that is not .md or .txt, naming its own field', () => {
      const notMarkdown = target('/code/app', 'notes.rtf', 'orchestrator')
      expect(() => resolveAgentMarkdownPath(notMarkdown)).toThrow('Agent Orchestrator markdown file must end in .md or .txt.')
    })
  })
})

describe('ensureDefaultLaneMarkdown', () => {
  it('creates an empty default file and returns its path', () => {
    const projectPath = freshProjectPath()
    const filePath = ensureDefaultLaneMarkdown({ kind: 'agent', projectPath, laneName: 'In Review' })
    expect(filePath).toBe(path.join(projectPath, 'SwimlaneAgentPrompt', 'In-Review', 'AgentPrompt.md'))
    expect(readFileSync(filePath, 'utf8')).toBe('')
  })

  it('never overwrites an existing file', () => {
    const projectPath = freshProjectPath()
    const laneFolder = { kind: 'orchestrator' as const, projectPath, laneName: 'In Review' }
    const filePath = ensureDefaultLaneMarkdown(laneFolder)
    writeFileSync(filePath, 'Ping me on Slack.')
    expect(ensureDefaultLaneMarkdown(laneFolder)).toBe(filePath)
    expect(readFileSync(filePath, 'utf8')).toBe('Ping me on Slack.')
  })
})

describe('readLaneMarkdownContext', () => {
  it('reads the file as it is', () => {
    const projectPath = freshProjectPath()
    const contextPath = path.join(projectPath, 'context.txt')
    writeFileSync(contextPath, 'Ping me on Slack.\n')
    for (const kind of ['agent', 'orchestrator'] as const) {
      expect(readLaneMarkdownContext(kind, contextPath)).toBe('Ping me on Slack.\n')
    }
  })

  it('reads a missing file or a directory as no context', () => {
    const projectPath = freshProjectPath()
    expect(readLaneMarkdownContext('agent', path.join(projectPath, 'missing.md'))).toBe('')
    expect(readLaneMarkdownContext('agent', projectPath)).toBe('')
  })

  it('skips an orchestrator prompt copy written by the app before #168', () => {
    const projectPath = freshProjectPath()
    const contextPath = path.join(projectPath, 'AgentOrchestratorPrompt.md')
    writeFileSync(contextPath, 'You are the Auto Run orchestrator.\nTickets: {{ticket_numbers}}\n')
    expect(readLaneMarkdownContext('orchestrator', contextPath)).toBe('')
  })
})
