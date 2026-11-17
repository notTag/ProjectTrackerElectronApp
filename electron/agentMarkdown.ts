import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  AGENT_PROMPT_FILE_NAME,
  ORCHESTRATOR_PROMPT_FILE_NAME,
  SWIMLANE_PROMPT_DIRECTORY,
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

const LEGACY_AGENT_CONTEXT_DIRECTORY = 'agent-context'

// A path the app generated itself, not one the user chose: a lane folder file
// (maybe under the lane's old name) or a pre-#81 agent-context/ file. These
// are re-derived on save so a lane's prompts always share one folder, even
// after a rename. The old file is left where it is.
const isGeneratedPath = (projectPath: string, resolvedPath: string, fileName: string): boolean => {
  const segments = path.relative(projectPath, resolvedPath).split(path.sep)
  const topDirectory = segments[0]
  const lastSegment = segments[segments.length - 1]
  const inLaneFolder = segments.length === 3 && topDirectory === SWIMLANE_PROMPT_DIRECTORY && lastSegment === fileName
  const inLegacyFolder =
    segments.length === 2 && topDirectory === LEGACY_AGENT_CONTEXT_DIRECTORY && lastSegment.endsWith('-AgentContext.md')
  return inLaneFolder || inLegacyFolder
}

// An empty field gets <project>/SwimlaneAgentPrompt/<lane>/<fileName>; the
// sanitized folder name has no separators or leading dots, so it can't climb
// out. A path the user typed is honoured, but only as a .md file, so a stray
// paste can't overwrite something like ~/.zshrc. Main further confines it to
// the scan directories.
export const resolveAgentMarkdownPath = (target: AgentMarkdownTarget): string => {
  const projectPath = path.resolve(target.projectPath)
  const explicitPath = target.filePath.trim()
  const { fieldLabel, fileName } = MARKDOWN_KINDS[target.kind]
  const resolved = path.resolve(projectPath, explicitPath)

  if (explicitPath && !isGeneratedPath(projectPath, resolved, fileName)) {
    if (path.extname(resolved).toLowerCase() !== '.md') {
      throw new Error(`${fieldLabel} must end in .md.`)
    }
    return resolved
  }

  const laneFolder = laneFolderName(target.laneName)
  return path.join(projectPath, SWIMLANE_PROMPT_DIRECTORY, laneFolder, fileName)
}

const readIfExists = (filePath: string): string => (existsSync(filePath) ? readFileSync(filePath, 'utf8') : '')

// A guide that already has content may have been written by hand, so it is
// never replaced: the prompt goes on the end, after a blank line. Only a
// missing or blank file is written outright. Re-saving the same prompt is a
// no-op, so repeated clicks don't stack copies.
export const saveAgentMarkdown = (filePath: string, content: string) => {
  mkdirSync(path.dirname(filePath), { recursive: true })

  const existing = readIfExists(filePath)
  const hasContent = existing.trim() !== ''
  const alreadySaved = hasContent && existing.trimEnd().endsWith(content.trimEnd())
  const appended = hasContent && !alreadySaved
  if (appended) {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n'
    appendFileSync(filePath, `${separator}${content}`, 'utf8')
  } else if (!hasContent) {
    writeFileSync(filePath, content, 'utf8')
  }
  return { filePath, appended }
}
