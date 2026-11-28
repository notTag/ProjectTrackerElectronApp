import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  AGENT_PROMPT_FILE_NAME,
  CONTEXT_FILE_EXTENSIONS,
  ORCHESTRATOR_PROMPT_FILE_NAME,
  SWIMLANE_PROMPT_DIRECTORY,
  isAppWrittenOrchestratorCopy,
  laneFolderName,
  type LaneMarkdownKind
} from '../src/shared/projectTypes.js'

export interface AgentMarkdownTarget {
  kind: LaneMarkdownKind
  projectPath: string
  laneName: string
  // What the user typed in this kind's file field; empty means "use the default".
  filePath: string
}

const MARKDOWN_KINDS = {
  agent: { fieldLabel: 'Agent markdown file', fileName: AGENT_PROMPT_FILE_NAME },
  orchestrator: { fieldLabel: 'Agent Orchestrator markdown file', fileName: ORCHESTRATOR_PROMPT_FILE_NAME }
} as const

// An empty field gets <project>/SwimlaneAgentPrompt/<lane>/<fileName>; the
// sanitized folder name has no separators or leading dots, so it can't climb
// out. A stored path is used as typed, even after a lane rename, so the text
// in it is never left behind. Only .md and .txt, so a stray paste can't point
// at something like ~/.zshrc; main further confines it to the scan directories.
export const resolveAgentMarkdownPath = (target: AgentMarkdownTarget): string => {
  const projectPath = path.resolve(target.projectPath)
  const explicitPath = target.filePath.trim()
  const { fieldLabel, fileName } = MARKDOWN_KINDS[target.kind]

  if (explicitPath) {
    const resolved = path.resolve(projectPath, explicitPath)
    const extension = path.extname(resolved).toLowerCase()
    if (!CONTEXT_FILE_EXTENSIONS.includes(extension)) {
      throw new Error(`${fieldLabel} must end in .md or .txt.`)
    }
    return resolved
  }

  const laneFolder = laneFolderName(target.laneName)
  return path.join(projectPath, SWIMLANE_PROMPT_DIRECTORY, laneFolder, fileName)
}

const readIfExists = (filePath: string): string => (existsSync(filePath) ? readFileSync(filePath, 'utf8') : '')

export const readLaneMarkdownContext = (kind: LaneMarkdownKind, filePath: string): string => {
  try {
    const content = readFileSync(filePath, 'utf8')
    const isOldOrchestratorCopy = kind === 'orchestrator' && isAppWrittenOrchestratorCopy(content)
    return isOldOrchestratorCopy ? '' : content
  } catch {
    return ''
  }
}

export const readLaneMarkdown = (target: AgentMarkdownTarget): string => {
  const markdownPath = resolveAgentMarkdownPath(target)
  return readIfExists(markdownPath)
}

export const writeMissingLaneMarkdown = (target: Omit<AgentMarkdownTarget, 'filePath'>, content: string): string | null => {
  const filePath = resolveAgentMarkdownPath({ ...target, filePath: '' })
  if (existsSync(filePath)) return null
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  return filePath
}

export const ensureDefaultLaneMarkdown = (target: Omit<AgentMarkdownTarget, 'filePath'>): string => {
  writeMissingLaneMarkdown(target, '')
  return resolveAgentMarkdownPath({ ...target, filePath: '' })
}
