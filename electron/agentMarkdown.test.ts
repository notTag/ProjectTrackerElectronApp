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
    const saved = saveAgentMarkdown(target(projectPath), '# Guide\n')
    expect(saved.appended).toBe(false)
    expect(readFileSync(saved.filePath, 'utf8')).toBe('# Guide\n')
  })

  it('creates missing parents for an explicit path', () => {
    const projectPath = freshProjectPath()
    const explicitPath = path.join(projectPath, 'nested', 'deeper', 'guide.md')
    saveAgentMarkdown(target(projectPath, explicitPath), 'first')
    expect(readFileSync(explicitPath, 'utf8')).toBe('first')
  })

  it('replaces a blank file', () => {
    const projectPath = freshProjectPath()
    const explicitPath = path.join(projectPath, 'guide.md')
    writeFileSync(explicitPath, '  \n')
    const saved = saveAgentMarkdown(target(projectPath, explicitPath), 'prompt')
    expect(saved.appended).toBe(false)
    expect(readFileSync(explicitPath, 'utf8')).toBe('prompt')
  })

  it('appends to a file that has content, after a blank line', () => {
    const projectPath = freshProjectPath()
    const explicitPath = path.join(projectPath, 'guide.md')
    writeFileSync(explicitPath, '# Hand-written')
    const saved = saveAgentMarkdown(target(projectPath, explicitPath), 'prompt')
    expect(saved.appended).toBe(true)
    expect(readFileSync(explicitPath, 'utf8')).toBe('# Hand-written\n\nprompt')

    writeFileSync(explicitPath, '# Ends with newline\n')
    saveAgentMarkdown(target(projectPath, explicitPath), 'prompt')
    expect(readFileSync(explicitPath, 'utf8')).toBe('# Ends with newline\n\nprompt')
  })
})
