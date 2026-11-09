import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { AGENT_CONTEXT_DIRECTORY, agentMarkdownFileName } from '../src/shared/projectTypes.js'

export interface AgentMarkdownTarget {
  projectPath: string
  projectName: string
  laneName: string
  agentFilePath: string
}

const isInside = (target: string, parent: string) => target.startsWith(`${parent}${path.sep}`)

// An empty field gets the generated name under <project>/agent-context/, and
// that path must stay inside it. A path the user typed is honoured wherever it
// points — they chose it — but only as a .md file, so a stray paste can't
// overwrite something like ~/.zshrc.
export const resolveAgentMarkdownPath = (target: AgentMarkdownTarget): string => {
  const projectPath = path.resolve(target.projectPath)
  const explicitPath = target.agentFilePath.trim()

  if (explicitPath) {
    const resolved = path.resolve(projectPath, explicitPath)
    if (path.extname(resolved).toLowerCase() !== '.md') {
      throw new Error('Agent markdown file must end in .md.')
    }
    return resolved
  }

  const contextDirectory = path.join(projectPath, AGENT_CONTEXT_DIRECTORY)
  const fileName = agentMarkdownFileName(target.projectName, target.laneName)
  const resolved = path.resolve(contextDirectory, fileName)
  if (!isInside(resolved, contextDirectory)) {
    throw new Error('Generated agent markdown path escaped the agent-context directory.')
  }
  return resolved
}

export const saveAgentMarkdown = (target: AgentMarkdownTarget, content: string): string => {
  const filePath = resolveAgentMarkdownPath(target)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  return filePath
}
