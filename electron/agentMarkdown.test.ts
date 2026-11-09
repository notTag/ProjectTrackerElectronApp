import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

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

const target = (projectPath: string, agentFilePath = '') => ({
  projectPath,
  projectName: 'ProjectTracker/electron-app',
  laneName: 'PRD',
  agentFilePath
})

describe('resolveAgentMarkdownPath', () => {
  it('defaults to the generated name under agent-context/', () => {
    const resolved = resolveAgentMarkdownPath(target('/code/app'))
    expect(resolved).toBe('/code/app/agent-context/ProjectTracker-electron-app-PRD-AgentContext.md')
  })

  it('keeps a traversal lane name inside agent-context/', () => {
    const resolved = resolveAgentMarkdownPath({ ...target('/code/app'), laneName: '../../../etc/passwd' })
    expect(path.dirname(resolved)).toBe('/code/app/agent-context')
  })

  it('resolves a relative explicit path against the project', () => {
    expect(resolveAgentMarkdownPath(target('/code/app', 'docs/guide.md'))).toBe('/code/app/docs/guide.md')
  })

  it('rejects an explicit path that is not markdown', () => {
    expect(() => resolveAgentMarkdownPath(target('/code/app', '/Users/me/.zshrc'))).toThrow('must end in .md')
  })
})

describe('saveAgentMarkdown', () => {
  it('creates agent-context/ and writes the prompt', () => {
    const projectPath = freshProjectPath()
    const filePath = saveAgentMarkdown(target(projectPath), '# Guide\n')
    expect(readFileSync(filePath, 'utf8')).toBe('# Guide\n')
  })

  it('overwrites an explicit path, creating missing parents', () => {
    const projectPath = freshProjectPath()
    const explicitPath = path.join(projectPath, 'nested', 'deeper', 'guide.md')
    saveAgentMarkdown(target(projectPath, explicitPath), 'first')
    writeFileSync(explicitPath, 'edited by hand')
    saveAgentMarkdown(target(projectPath, explicitPath), 'second')
    expect(readFileSync(explicitPath, 'utf8')).toBe('second')
  })
})
