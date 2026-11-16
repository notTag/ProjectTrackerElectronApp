import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { SWIMLANE_PROMPT_DIRECTORY, laneFolderName } from '../src/shared/projectTypes.js'

export interface AgentMarkdownTarget {
  projectPath: string
  laneName: string
  // What the user typed in the lane's file field; empty means "use the default".
  filePath: string
  // Default file inside the lane folder, e.g. AGENT_PROMPT_FILE_NAME.
  fileName: string
}

// An empty field gets <project>/SwimlaneAgentPrompt/<lane>/<fileName>; the
// sanitized folder name has no separators or leading dots, so it can't climb
// out. A path the user typed is honoured, but only as a .md file, so a stray
// paste can't overwrite something like ~/.zshrc. Main further confines it to
// the scan directories.
export const resolveAgentMarkdownPath = (target: AgentMarkdownTarget): string => {
  const projectPath = path.resolve(target.projectPath)
  const explicitPath = target.filePath.trim()

  if (explicitPath) {
    const resolved = path.resolve(projectPath, explicitPath)
    if (path.extname(resolved).toLowerCase() !== '.md') {
      throw new Error('Agent markdown file must end in .md.')
    }
    return resolved
  }

  const laneFolder = laneFolderName(target.laneName)
  return path.join(projectPath, SWIMLANE_PROMPT_DIRECTORY, laneFolder, target.fileName)
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
