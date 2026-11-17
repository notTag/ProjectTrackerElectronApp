import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('keeps an existing explicit agent-context/ path untouched', () => {
    const legacyPath = '/code/app/agent-context/ProjectTracker-electron-app-PRD-AgentContext.md'
    expect(resolveAgentMarkdownPath(target('/code/app', legacyPath))).toBe(legacyPath)
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

const save = (markdownTarget: ReturnType<typeof target>, content: string, previousContent = '') =>
  saveAgentMarkdown(resolveAgentMarkdownPath(markdownTarget), content, previousContent)

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

  it('replaces a blank file', () => {
    const projectPath = freshProjectPath()
    const explicitPath = path.join(projectPath, 'guide.md')
    writeFileSync(explicitPath, '  \n')
    save(target(projectPath, explicitPath), 'prompt')
    expect(readFileSync(explicitPath, 'utf8')).toBe('prompt')
  })

  it('replaces its own last save, so autosaves mirror the box instead of stacking', () => {
    const projectPath = freshProjectPath()
    save(target(projectPath), 'Flag')
    const saved = save(target(projectPath), 'Flag red PRs.', 'Flag')
    expect(readFileSync(saved.filePath, 'utf8')).toBe('Flag red PRs.')
  })

  it('mirrors a cleared prompt as a blank file', () => {
    const projectPath = freshProjectPath()
    save(target(projectPath), 'prompt')
    const saved = save(target(projectPath), '', 'prompt')
    expect(readFileSync(saved.filePath, 'utf8')).toBe('')
  })

  it('refuses to overwrite content it did not write, e.g. a hand-written guide or an editor edit', () => {
    const projectPath = freshProjectPath()
    const explicitPath = path.join(projectPath, 'guide.md')
    writeFileSync(explicitPath, '# Hand-written')
    expect(() => save(target(projectPath, explicitPath), 'prompt', 'older prompt')).toThrow('has other content')
    expect(readFileSync(explicitPath, 'utf8')).toBe('# Hand-written')
  })

  it('replaces any content when there is no previous save to check against', () => {
    const projectPath = freshProjectPath()
    const explicitPath = path.join(projectPath, 'copy.md')
    writeFileSync(explicitPath, 'an older generated prompt')
    saveAgentMarkdown(explicitPath, 'the current prompt', null)
    expect(readFileSync(explicitPath, 'utf8')).toBe('the current prompt')
  })

  it('takes over a hand-edited file once the box holds the same text', () => {
    const projectPath = freshProjectPath()
    const explicitPath = path.join(projectPath, 'guide.md')
    writeFileSync(explicitPath, '# Hand-written\n')
    save(target(projectPath, explicitPath), '# Hand-written', 'older prompt')
    save(target(projectPath, explicitPath), '# Hand-written, then more', '# Hand-written')
    expect(readFileSync(explicitPath, 'utf8')).toBe('# Hand-written, then more')
  })
})
