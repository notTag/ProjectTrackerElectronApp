export type ProjectStatus = 'active' | 'ongoing' | 'paused' | 'completed' | 'archived' | 'hidden' | 'unknown'

export type ProjectPriority = 'high' | 'medium' | 'low' | 'none'

export type ProjectSource = 'first-party' | 'third-party'

export interface ProjectGithubData {
  defaultBranch: string
  openIssues: number
  stars: number
  forks: number
  description?: string
  pushedAt?: string
  fetchedAt: string
}

export interface ProjectRecord {
  path: string
  name: string
  status: ProjectStatus
  priority: ProjectPriority
  notes: string
  source: ProjectSource
  packageManager?: string
  githubUrl?: string
  github?: ProjectGithubData
  hasGit: boolean
  hasPackageJson: boolean
  hasReadme: boolean
  lastModifiedAt?: string
  lastScannedAt: string
  // Set when the user deletes the scan directory holding this project. The row
  // and everything hanging off it (notes, board) are kept but never shown;
  // adding the directory back clears the flag.
  archived?: boolean
}

export interface ProjectSnapshot {
  projects: ProjectRecord[]
  scannedAt?: string
  failures: ScanFailure[]
}

// One local user today. Every persisted row carries a user id so multi-user is a
// matter of adding rows, not reshaping tables.
export const DEFAULT_USER_ID = 'local'
export const DEFAULT_USER_NAME = 'Local'

export interface User {
  id: string
  name: string
}

export interface ProjectTrackerState {
  // Who this app instance is acting as. Projects and tickets are shared, so this
  // identifies the assignee, not an owner of the data.
  userId: string
  users: User[]
  version: number
  updatedAt: string
  scanDirectories: string[]
  hiddenPaths: string[]
  thirdPartyPaths: string[]
  snapshot: ProjectSnapshot
  // Keyed by project path. Optional so state saved before boards existed still loads.
  boards?: Record<string, ProjectBoard>
  // Also keyed by project path, but per-user rather than shared — see BoardPreferences.
  boardPreferences?: Record<string, BoardPreferences>
  // Extra agents offered on every board beside DEFAULT_AGENT. Optional and empty
  // by default — see availableAgents.
  agents?: Agent[]
}

export interface ScanFailure {
  path: string
  message: string
}

export interface ScanResult {
  snapshot: ProjectSnapshot
  failures: ScanFailure[]
}

export const createSeedState = (): ProjectTrackerState => ({
  userId: DEFAULT_USER_ID,
  users: [{ id: DEFAULT_USER_ID, name: DEFAULT_USER_NAME }],
  version: 1,
  updatedAt: new Date().toISOString(),
  scanDirectories: [],
  hiddenPaths: [],
  thirdPartyPaths: [],
  snapshot: {
    scannedAt: undefined,
    failures: [],
    projects: [
      {
        path: '/Users/example/Projects/sample-app',
        name: 'sample-app',
        status: 'unknown',
        priority: 'none',
        notes: 'Seed project shown until your first scan succeeds.',
        source: 'first-party',
        packageManager: 'npm',
        githubUrl: 'https://github.com/example/sample-app',
        hasGit: true,
        hasPackageJson: true,
        hasReadme: true,
        lastModifiedAt: undefined,
        lastScannedAt: new Date().toISOString()
      }
    ]
  }
})

export const mergeScannedProjects = (
  previous: ProjectTrackerState,
  scannedProjects: ProjectRecord[],
  failures: ScanFailure[]
): ProjectTrackerState => {
  const existingByPath = new Map(previous.snapshot.projects.map((project) => [project.path, project]))
  // Only the very first scan qualifies. A known path means an older state that
  // lost its scannedAt, not a new user.
  const isFirstEverScan =
    !previous.snapshot.scannedAt && scannedProjects.every((project) => !existingByPath.has(project.path))
  const firstFirstPartyProject = scannedProjects.find((project) => project.source === 'first-party')
  const firstAddedPath = isFirstEverScan ? firstFirstPartyProject?.path : undefined
  const projects = scannedProjects.map((project) => {
    const existing = existingByPath.get(project.path)
    const scannedStatus: ProjectStatus = project.path === firstAddedPath ? 'active' : project.status
    return {
      ...project,
      status: existing?.status ?? scannedStatus,
      priority: existing?.priority ?? project.priority,
      notes: existing?.notes ?? project.notes,
      githubUrl: project.githubUrl ?? existing?.githubUrl,
      github: existing?.github ?? project.github
    }
  })
  // A scan never finds archived projects (they sit outside every scan
  // directory) or hidden ones (the scanner skips hidden paths). Dropping what
  // the scan missed would delete them and their boards — carry them over.
  const scannedPaths = new Set(scannedProjects.map((project) => project.path))
  const isSkippedByScan = (project: ProjectRecord) =>
    project.archived || isInsideAny(project.path, previous.hiddenPaths)
  const unscannedProjects = previous.snapshot.projects.filter(
    (project) => isSkippedByScan(project) && !scannedPaths.has(project.path)
  )

  return {
    ...previous,
    updatedAt: new Date().toISOString(),
    snapshot: {
      scannedAt: new Date().toISOString(),
      projects: [...projects, ...unscannedProjects],
      failures
    }
  }
}

const isInsideAny = (target: string, parents: string[]) =>
  parents.some((parent) => target === parent || target.startsWith(`${parent}/`))

// What the user sees as deleting a scan directory archives its projects
// instead: nothing is ever destroyed, so re-adding the folder brings it all
// back. Projects still covered by a remaining (nested) scan directory stay put.
export const removeScanDirectory = (state: ProjectTrackerState, directory: string): ProjectTrackerState => {
  const remainingDirectories = state.scanDirectories.filter((entry) => entry !== directory)
  const isOrphaned = (target: string) =>
    isInsideAny(target, [directory]) && !isInsideAny(target, remainingDirectories)
  const projects = state.snapshot.projects.map((project) =>
    isOrphaned(project.path) ? { ...project, archived: true } : project
  )
  return { ...state, scanDirectories: remainingDirectories, snapshot: { ...state.snapshot, projects } }
}

// Re-adding a directory brings back whatever was archived under it, with its
// notes, status, priority and board exactly as they were left.
export const addScanDirectory = (state: ProjectTrackerState, directory: string): ProjectTrackerState => {
  const scanDirectories = [...new Set([...state.scanDirectories, directory])]
  const projects = state.snapshot.projects.map((project) =>
    project.archived && isInsideAny(project.path, [directory]) ? { ...project, archived: false } : project
  )
  return { ...state, scanDirectories, snapshot: { ...state.snapshot, projects } }
}

// Metrics panel (#27). Window starts are ISO timestamps, computed in the main
// process from local time.
export interface MetricWindows {
  today: string
  week: string
  month: string
  year: string
}

export type MetricWindowCounts = Record<keyof MetricWindows, number>

export interface ProjectPrMetrics {
  open: number
  merged: MetricWindowCounts
}

export interface ProjectMetrics {
  projectPath: string
  name: string
  closed: MetricWindowCounts
  hasClosingLanes: boolean
  // undefined: the project has no GitHub repo, so there is nothing to count.
  prs?: ProjectPrMetrics | { error: string }
  // null when the process listing failed.
  agentsRunning: number | null
}

export interface SwimLane {
  id: string
  name: string
  agentPrompt: string
  // Path to a markdown file whose contents supplement agentPrompt. Both are
  // used together when the lane's agent runs; either may be empty.
  agentFilePath: string
  // Free text naming where the agent's work goes: a file, a directory, or a
  // sentence like "a new PRD folder in the project". Optional so lanes saved
  // before it existed still load.
  outputTarget?: string
  // Appended, never substituted: the generated orchestrator prompt carries the
  // read-only DB rule. Never reaches ticket agents. Optional so older lanes load.
  orchestratorPrompt?: string
  // What the lane's Auto Run button launches: which agent works each ticket and
  // which terminal hosts the tabs. Absent means the defaults.
  autoRunAgentId?: string
  autoRunTerminalId?: string
  // Each Auto Run ticket gets its own git worktree and branch off freshly
  // fetched main. Absent (lanes saved before it existed) means on.
  autoRunWorktrees?: boolean
  // When this lane's agent moves a ticket on, the destination lane's agent
  // starts on it with no click. Absent means off.
  fullAuto?: boolean
  // A ticket entering this lane counts as closed in the metrics panel. Absent means no.
  closesTicket?: boolean
  // This lane's agent is told it may set the ticket's semantic version, and how.
  // When to set it is the agent's call, not a rule here. Absent means off.
  agentSetsVersion?: boolean
}

export interface ChecklistItem {
  text: string
  done: boolean
}

// Captures what a swim lane's agent produced for a ticket. Only the most recent
// run is kept: the board is a working surface, not an audit log.
export interface TicketAgentRun {
  at: string
  laneId: string
  output: string
  // Absent on runs saved before it existed; those show no completed badge
  // rather than claiming a success nobody recorded.
  succeeded?: boolean
  // When someone opened the ticket after this run finished. Absent = unseen, so
  // runs saved before it existed still surface their result once.
  seenAt?: string
}

export type AgentRunBadge = 'running' | 'succeeded' | 'failed'

// Lane-scoped: each lane has its own prompt, so a run finished in an earlier
// lane says nothing about the work in this one.
export const agentRunBadge = (ticket: Ticket, running: boolean): AgentRunBadge | null => {
  if (running) return 'running'
  const lastRun = ticket.agentRun
  if (!lastRun || lastRun.succeeded === undefined) return null
  const alreadySeen = lastRun.seenAt !== undefined
  const fromOtherLane = lastRun.laneId !== ticket.laneId
  if (alreadySeen || fromOtherLane) return null
  return lastRun.succeeded ? 'succeeded' : 'failed'
}

export const hasUnseenAgentResult = (ticket: Ticket): boolean => agentRunBadge(ticket, false) !== null

export interface Ticket {
  id: string
  // Human-facing ticket number, unique within its board and stable once assigned.
  number: number
  laneId: string
  title: string
  description: string
  createdAt: string
  // Every field below is optional so boards saved before it existed still load
  // unchanged — there is no migration step, only absent values.
  updatedAt?: string
  labels?: string[]
  branchName?: string
  worktreePath?: string
  pullRequestUrl?: string
  // Last state GitHub reported for that PR, cached so the board renders
  // without the network. Refreshed by the store, never typed in by hand.
  pullRequestState?: PullRequestState
  pullRequestMergedAt?: string
  // Who picked this ticket up. Absent means nobody has.
  assigneeId?: string
  checklist?: ChecklistItem[]
  // Which configured agent this ticket is earmarked for. Absent means none has
  // been chosen, which is every ticket until agents exist in state.
  agentId?: string
  agentRun?: TicketAgentRun
  // Set only on tickets imported from GitHub. Doubles as the dedupe key so
  // re-pulling issues updates nothing and duplicates nothing.
  externalId?: string
  externalUrl?: string
  // Full auto for this ticket in every lane, whatever the lane's own toggle says.
  fullAuto?: boolean
  // Any further http(s) links: design docs, threads, related issues. Absent means none.
  externalLinks?: string[]
  // Where the ticket goes when its work completes. Kept after the move so the
  // checkbox can be re-ticked; moveOnComplete is what arms it.
  moveToLaneId?: string
  moveOnComplete?: boolean
  // The release this ticket ships in, MAJOR.MINOR.PATCH. Absent means unset.
  version?: string
}

export type TicketPatch = Partial<Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'>>

// Prefilled into a new ticket so descriptions arrive in the shape a lane's agent
// can act on. Discarded on save when left untouched, so an unused template never
// persists as noise.
export const TICKET_DESCRIPTION_TEMPLATE = `## Context

## Acceptance criteria
-

## Out of scope
`

// Labels are typed into a single comma-separated input, so parsing has to
// survive stray whitespace, empty segments, and repeats.
export const parseLabels = (value: string): string[] => {
  const segments = value.split(',')
  const trimmedSegments = segments.map((segment) => segment.trim())
  const nonEmptySegments = trimmedSegments.filter(Boolean)
  return [...new Set(nonEmptySegments)]
}

export const formatLabels = (labels: string[] = []) => labels.join(', ')

export const addChecklistItem = (checklist: ChecklistItem[] = [], text: string): ChecklistItem[] => [
  ...checklist,
  { text, done: false }
]

export const setChecklistItemDone = (
  checklist: ChecklistItem[] = [],
  index: number,
  done: boolean
): ChecklistItem[] => checklist.map((item, itemIndex) => (itemIndex === index ? { ...item, done } : item))

export const removeChecklistItem = (checklist: ChecklistItem[] = [], index: number): ChecklistItem[] =>
  checklist.filter((_, itemIndex) => itemIndex !== index)

// Returns the same array for a non-web or duplicate URL.
export const addExternalLink = (links: string[] = [], url: string): string[] => {
  const trimmedUrl = url.trim()
  const isNewWebUrl = isWebUrl(trimmedUrl) && !links.includes(trimmedUrl)
  return isNewWebUrl ? [...links, trimmedUrl] : links
}

export const removeExternalLink = (links: string[] = [], index: number): string[] =>
  links.filter((_, linkIndex) => linkIndex !== index)

export const checklistProgress = (checklist: ChecklistItem[] = []) => {
  const doneItems = checklist.filter((item) => item.done)
  return { done: doneItems.length, total: checklist.length }
}

// Searched as one string so a query matches a ticket by number, prose, label, or
// branch without the caller knowing which field it hit.
export const ticketSearchText = (ticket: Ticket) => {
  const labels = formatLabels(ticket.labels)
  const branchName = ticket.branchName ?? ''
  return `#${ticket.number} ${ticket.title} ${ticket.description} ${labels} ${branchName}`.toLowerCase()
}

// A coding agent a ticket can be handed to. `command` is the CLI that takes the
// prompt as its last argument and runs in the project directory; `headlessArgs`
// go before the prompt when it runs in the background with nobody watching, and
// `promptArgs` go before it when it runs in a terminal someone is watching.
export interface Agent {
  id: string
  name: string
  command: string
  headlessArgs: string[]
  promptArgs?: string[]
}

// acceptEdits lets a background run write its output files without a human to
// approve them, while shell commands stay denied — the run can draft, not execute.
export const DEFAULT_AGENT: Agent = {
  id: 'claude-code',
  name: 'Claude Code',
  command: 'claude',
  headlessArgs: ['-p', '--permission-mode', 'acceptEdits']
}

// Codex's workspace-write sandbox is the closest match to acceptEdits: files in
// the project can change, nothing outside it can.
const CODEX_AGENT: Agent = {
  id: 'codex',
  name: 'Codex',
  command: 'codex',
  headlessArgs: ['exec', '--sandbox', 'workspace-write']
}

// Hermes reads its first positional as a subcommand, so a bare prompt would be
// rejected as an unknown command — the prompt has to ride on a flag.
const HERMES_AGENT: Agent = {
  id: 'hermes',
  name: 'Hermes',
  command: 'hermes',
  headlessArgs: ['-z'],
  promptArgs: ['chat', '-q']
}

// `opencode run` is the non-interactive mode. The TUI reads its first positional
// as a project directory (the Hermes trap again), so the prompt rides on --prompt.
// No --dangerously-skip-permissions: opencode.json's `permission` config decides
// what a headless run may do. To opt in, save an `opencode` agent with the flag —
// and keep promptArgs ['--prompt'], since a saved agent replaces this one whole.
const OPENCODE_AGENT: Agent = {
  id: 'opencode',
  name: 'opencode',
  command: 'opencode',
  headlessArgs: ['run'],
  promptArgs: ['--prompt']
}

const OPTIONAL_BUILT_IN_AGENTS = [CODEX_AGENT, HERMES_AGENT, OPENCODE_AGENT]

// Agents saved in state are offered alongside the built-ins, so adding another
// CLI is one entry, not a code change. A saved agent with a built-in's id wins
// over it — someone who configured their own codex keeps their binary and args —
// except the default, which stays fixed as the fallback every ticket runs with.
export const availableAgents = (state: Pick<ProjectTrackerState, 'agents'>): Agent[] => {
  const savedAgents = (state.agents ?? []).filter((agent) => agent.id !== DEFAULT_AGENT.id)
  const savedAgentIds = new Set(savedAgents.map((agent) => agent.id))
  const unshadowedBuiltIns = OPTIONAL_BUILT_IN_AGENTS.filter((agent) => !savedAgentIds.has(agent.id))
  return [DEFAULT_AGENT, ...unshadowedBuiltIns, ...savedAgents]
}

export const findAgent = (agents: Agent[], agentId?: string): Agent =>
  agents.find((agent) => agent.id === agentId) ?? DEFAULT_AGENT

// A ticket that never picked an agent still runs — with the default — so the
// hand-off works before anyone touches the picker.
export const agentForTicket = (ticket: Ticket, agents: Agent[]): Agent => findAgent(agents, ticket.agentId)

export interface TicketPromptContext {
  assigneeName?: string
  // The board's project path, which the version instruction's SQL filters on.
  projectPath?: string
}

// Only fields that carry a value become lines, so a bare ticket stays a short
// prompt instead of a column of "none"s.
const ticketMetadataLines = (ticket: Ticket, lane: SwimLane, context: TicketPromptContext): string => {
  const checklistLines = (ticket.checklist ?? []).map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)
  const linkLines = (ticket.externalLinks ?? []).map((link) => `- ${link}`)
  const lines = [
    `Ticket #${ticket.number}: ${ticket.title}`,
    `Status: ${lane.name}`,
    context.assigneeName ? `Assignee: ${context.assigneeName}` : '',
    ticket.labels?.length ? `Labels: ${formatLabels(ticket.labels)}` : '',
    ticket.branchName ? `Branch: ${ticket.branchName}` : '',
    ticket.worktreePath ? `Worktree: ${ticket.worktreePath}` : '',
    ticket.version ? `Version: ${ticket.version}` : '',
    ticket.pullRequestUrl ? `Pull request: ${ticket.pullRequestUrl}` : '',
    ticket.externalUrl ? `Source: ${ticket.externalUrl}` : '',
    linkLines.length ? ['Links:', ...linkLines].join('\n') : '',
    checklistLines.length ? ['Checklist:', ...checklistLines].join('\n') : ''
  ]
  return lines.filter(Boolean).join('\n')
}

// Stated as a standing permission because the agent would otherwise stop to ask
// whether writing into an existing folder is OK — the lane already answered that.
const outputInstruction = (outputTarget: string) =>
  [
    `Output: ${outputTarget}`,
    'Put your work there. Paths are relative to the project directory unless absolute. ' +
      'If that location already exists, use it as-is without asking; otherwise create it.'
  ].join('\n')

// The prompt reaches the agent as a CLI argument, and Claude Code's parser
// reads an argument starting with "-" as an option: a lane prompt written as a
// bullet list ("- Create a PRD…") failed with `error: unknown option`.
// A leading heading avoids that without a per-agent `--` separator, which
// custom agents with arbitrary flags couldn't be relied on to accept.
const guardAgainstOptionParsing = (prompt: string): string =>
  prompt.startsWith('-') ? `Instructions:\n${prompt}` : prompt

// Either toggle is enough: the lane's covers every ticket it runs, the
// ticket's covers that ticket wherever it runs.
export const isFullAuto = (ticket: Ticket, lane: SwimLane): boolean => Boolean(lane.fullAuto || ticket.fullAuto)

const FULL_AUTO_INSTRUCTION =
  "Full auto is on. Work without stopping to ask for confirmation. Leave the ticket in this lane while you work, even if other instructions say to move it when work starts: any move starts the next lane's agent. Move it once, when this lane's work is done, to the next lane as instructed above. Then exit."

// The official SemVer 2.0 pattern (semver.org), unchanged.
const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

// undefined = cleared, null = invalid. A leading "v" is a common habit
// ("v1.4.0"), not part of the version, so it is dropped rather than rejected.
export const normalizeSemanticVersion = (input: string): string | undefined | null => {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  const withoutPrefix = trimmed.replace(/^v/i, '')
  return SEMANTIC_VERSION_PATTERN.test(withoutPrefix) ? withoutPrefix : null
}

const versionInstruction = (ticket: Ticket, projectPath?: string): string => {
  const sentence =
    "Semantic version: you decide whether this ticket's work needs a version and what it is (MAJOR.MINOR.PATCH). Leave it unset if it doesn't apply yet."
  if (!projectPath) return sentence
  const updateSql =
    "UPDATE tickets SET version = '<X.Y.Z>', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') " +
    `WHERE project_path = ${sqlStringLiteral(projectPath)} AND number = ${ticket.number};`
  const command = `sqlite3 "${TRACKER_DATABASE_PATH}" ${shellQuote(updateSql)}`
  return [`${sentence} To set or change it:`, command].join('\n')
}

// The lane prompt comes first because it is the standing instruction for every
// ticket in that column; the ticket is the specific work it applies to, and the
// output location closes it out as the last thing the agent reads.
export const ticketAgentPrompt = (ticket: Ticket, lane: SwimLane, context: TicketPromptContext = {}): string => {
  const lanePrompt = lane.agentPrompt.trim()
  const laneFilePath = lane.agentFilePath.trim()
  const laneFileReference = laneFilePath ? `Follow the guidance in ${laneFilePath}.` : ''
  const ticketMetadata = ticketMetadataLines(ticket, lane, context)
  const ticketDescription = ticket.description.trim()
  const outputTarget = lane.outputTarget?.trim() ?? ''
  const output = outputTarget ? outputInstruction(outputTarget) : ''
  const versionSection = lane.agentSetsVersion ? versionInstruction(ticket, context.projectPath) : ''
  const fullAuto = isFullAuto(ticket, lane) ? FULL_AUTO_INSTRUCTION : ''
  const sections = [lanePrompt, laneFileReference, ticketMetadata, ticketDescription, versionSection, fullAuto, output]
  const prompt = sections.filter(Boolean).join('\n\n')
  return guardAgainstOptionParsing(prompt)
}

export const AGENT_CONTEXT_DIRECTORY = 'agent-context'

// Path separators become word breaks ("ProjectTracker/electron-app" reads as
// "ProjectTracker-electron-app"); the other characters filesystems reject are
// dropped. Leading dots go so a name can't produce a hidden file or "..".
const fileNamePart = (value: string, fallback: string): string => {
  const hyphenated = value.trim().replace(/[\s/\\]+/g, '-')
  const withoutForbidden = hyphenated.replace(/[:*?"<>|]/g, '')
  const withoutLeadingDots = withoutForbidden.replace(/^\.+/, '')
  const collapsed = withoutLeadingDots.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
  return collapsed || fallback
}

export const agentMarkdownFileName = (projectName: string, laneName: string): string =>
  `${fileNamePart(projectName, 'project')}-${fileNamePart(laneName, 'lane')}-AgentContext.md`

// Single quotes are the only POSIX quoting that leaves the contents completely
// literal, so a prompt full of backticks, $ and newlines survives intact. An
// embedded quote cannot appear inside them at all — it has to close the string,
// escape itself, and reopen it.
export const shellQuote = (value: string): string => {
  const escapedQuotes = value.split("'").join(`'\\''`)
  return `'${escapedQuotes}'`
}

export const ticketShellCommand = (
  ticket: Ticket,
  lane: SwimLane,
  agent: Agent = DEFAULT_AGENT,
  context: TicketPromptContext = {}
): string => {
  const prompt = ticketAgentPrompt(ticket, lane, context)
  return agentShellCommand(agent, prompt)
}

export const agentShellCommand = (agent: Agent, prompt: string): string => {
  const commandWords = [agent.command, ...(agent.promptArgs ?? []), shellQuote(prompt)]
  return commandWords.join(' ')
}

// Enough of the title to recognise the ticket; the number already identifies it.
const BRANCH_SLUG_WORD_COUNT = 3

// A ticket's own branch wins; otherwise one is derived from its number and
// title, so a re-run of the same ticket lands on the same branch.
export const ticketBranchName = (ticket: Ticket): string => {
  const ownBranch = ticket.branchName?.trim()
  if (ownBranch) return ownBranch
  const titleWords = ticket.title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const titleSlug = titleWords.slice(0, BRANCH_SLUG_WORD_COUNT).join('-')
  const ticketPrefix = `t${ticket.number}`
  return titleSlug ? `${ticketPrefix}-${titleSlug}` : ticketPrefix
}

// Long enough to tell tickets apart; the terminal truncates tabs further anyway,
// which is why the number leads.
const TAB_TITLE_MAX_CODE_POINTS = 40

// Control characters become spaces: a title fed through a terminal escape could
// otherwise end the sequence early (ESC, BEL) and inject its own. Counting code
// points rather than UTF-16 units keeps an emoji's surrogate pair whole at the cut.
export const ticketTabTitle = (ticket: Pick<Ticket, 'number' | 'title'>): string => {
  const singleLineTitle = ticket.title.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  const codePoints = Array.from(`#${ticket.number} ${singleLineTitle}`.trim())
  if (codePoints.length <= TAB_TITLE_MAX_CODE_POINTS) return codePoints.join('')
  const keptText = codePoints.slice(0, TAB_TITLE_MAX_CODE_POINTS).join('').trimEnd()
  return `${keptText}…`
}

// One tab of a terminal launch. No title leaves the terminal's own.
export interface TerminalTab {
  title?: string
  command: string
}

// One ticket of an Auto Run as it crosses IPC. With worktrees on, main makes
// the ticket's worktree on branchName and runs the command inside it.
export interface AutoRunTicketLaunch {
  number: number
  branchName: string
  command: string
  title?: string
}

export interface AutoRunLaunchEntry {
  ticket: Ticket
  launch: AutoRunTicketLaunch
}

// With worktrees on, the branch goes into the ticket before its prompt is
// built, so the agent is told which branch it is working on. Any older
// worktree path is dropped from the prompt: the tab runs in the one main
// returns, which for a ticket that already has one is the same path.
export const buildAutoRunLaunch = (
  ticket: Ticket,
  lane: SwimLane,
  agent: Agent,
  context: TicketPromptContext,
  useWorktrees: boolean
): AutoRunLaunchEntry => {
  const branchName = ticketBranchName(ticket)
  const ticketAsRun = useWorktrees ? { ...ticket, branchName, worktreePath: undefined } : ticket
  const command = ticketShellCommand(ticketAsRun, lane, agent, context)
  return { ticket, launch: { number: ticket.number, branchName, command, title: ticketTabTitle(ticket) } }
}

// A ticket that already has a worktree keeps working in it even when the next
// lane has worktrees off, so a handoff never loses the previous lane's work.
export const autoRunUsesWorktrees = (lane: SwimLane, ticket?: Ticket): boolean =>
  lane.autoRunWorktrees !== false || Boolean(ticket?.worktreePath)

export const laneHasAgentWork = (lane: SwimLane): boolean =>
  Boolean(lane.agentPrompt.trim() || lane.agentFilePath.trim())

const ORCHESTRATOR_TAB_TITLE_PREFIX = 'AUTORUN-ORCHESTRATOR-'
// main drops titles over 200 UTF-16 units; 100 code points stays under that
// even when every one is a surrogate pair.
const ORCHESTRATOR_TAB_TITLE_MAX_CODE_POINTS = 100

export const orchestratorTabTitle = (lane: Pick<SwimLane, 'name'>): string => {
  const singleLineName = lane.name.replace(/\p{Cc}/gu, ' ').trim()
  const laneSlug = singleLineName.toUpperCase().replace(/\s+/g, '-') || 'LANE'
  const codePoints = Array.from(`${ORCHESTRATOR_TAB_TITLE_PREFIX}${laneSlug}`)
  return codePoints.slice(0, ORCHESTRATOR_TAB_TITLE_MAX_CODE_POINTS).join('')
}

// Fixed in dev and packaged builds alike: main sets the app name before
// Electron resolves userData.
export const TRACKER_DATABASE_PATH = '$HOME/Library/Application Support/Project Tracker/project-tracker.sqlite'

interface TerminalTabRecipes {
  listTabs: string
  closeTab: string
}

// <N> is the ticket number. Each listing prints every tab title in one line.
// Verified against each app's scripting dictionary; Warp has none, so it gets no recipes.
const TERMINAL_TAB_RECIPES: Record<string, TerminalTabRecipes> = {
  ghostty: {
    listTabs: `osascript -e 'tell application "Ghostty" to get name of every tab of every window'`,
    closeTab: [
      `osascript -e 'tell application "Ghostty"' -e 'repeat with w in windows' -e 'repeat with t in tabs of w'`,
      `-e 'if name of t is "<TAB>" then' -e 'close tab t' -e 'return' -e 'end if'`,
      `-e 'end repeat' -e 'end repeat' -e 'end tell'`
    ].join(' ')
  },
  iterm2: {
    listTabs: `osascript -e 'tell application "iTerm" to get name of every session of every tab of every window'`,
    closeTab: [
      `osascript -e 'tell application "iTerm"' -e 'repeat with w in windows' -e 'repeat with t in tabs of w'`,
      `-e 'repeat with s in sessions of t' -e 'if name of s is "<TAB>" then' -e 'close s' -e 'return' -e 'end if'`,
      `-e 'end repeat' -e 'end repeat' -e 'end repeat' -e 'end tell'`
    ].join(' ')
  },
  // Terminal has no close verb for a tab: it is selected and closed with ⌘W.
  terminal: {
    listTabs: `osascript -e 'tell application "Terminal" to get custom title of every tab of every window'`,
    closeTab: [
      `osascript -e 'tell application "Terminal"' -e 'repeat with w in windows' -e 'repeat with t in tabs of w'`,
      `-e 'if custom title of t is "<TAB>" then' -e 'set selected of t to true' -e 'set index of w to 1' -e 'activate'`,
      `-e 'tell application "System Events" to keystroke "w" using command down' -e 'return' -e 'end if'`,
      `-e 'end repeat' -e 'end repeat' -e 'end tell'`
    ].join(' ')
  }
}

export interface OrchestratorPromptContext {
  projectPath: string
  // Every lane a ticket can reach, the unassigned one included.
  lanes: SwimLane[]
  terminalId: string
  terminalLabel: string
}

const sqlStringLiteral = (value: string): string => `'${value.split("'").join("''")}'`

const tabSection = (context: OrchestratorPromptContext): string => {
  const recipes = TERMINAL_TAB_RECIPES[context.terminalId]
  if (!recipes) {
    return [
      `${context.terminalLabel} cannot be queried or scripted: report every agent as "unknown",`,
      'and when a ticket is done tell the user to close its tab by hand.'
    ].join('\n')
  }
  return [
    `Open tab titles in ${context.terminalLabel}:`,
    recipes.listTabs,
    'A ticket\'s agent is running while a tab with exactly its tab title (listed above) exists. Full auto handoffs',
    'open new tabs for later lanes under the same title. Match the whole title: other projects reuse ticket numbers.',
    '',
    'Close a done ticket\'s tab (replace <TAB> with its tab title, " written as \\" and \' as \'\\\'\'; rerun until it is gone):',
    recipes.closeTab
  ].join('\n')
}

// User text may tune the Loop (poll interval, which tabs to close) but the
// report-only rule guards a DB shared with the app, so it always wins.
const LANE_INSTRUCTIONS_PRECEDENCE =
  'These override the Loop above (e.g. poll interval, closing tabs), but never the report-only rule.'

const laneInstructionsSection = (lane: SwimLane): string => {
  const laneInstructions = lane.orchestratorPrompt?.trim() ?? ''
  if (!laneInstructions) return ''
  return ['Lane instructions', LANE_INSTRUCTIONS_PRECEDENCE, laneInstructions].join('\n')
}

// The orchestrator only reports: it shares the DB with the app and the ticket
// agents, so it is told never to write, and never to steer the other agents.
export const orchestratorPrompt = (
  lane: SwimLane,
  entries: AutoRunLaunchEntry[],
  context: OrchestratorPromptContext
): string => {
  const launches = entries.map((entry) => entry.launch)
  const ticketLines = entries.map(({ ticket, launch }) => {
    const tabTitle = launch.title ?? `#${launch.number}`
    return `- #${launch.number} ${ticket.title} — tab "${tabTitle}" — branch ${launch.branchName}`
  })
  const laneLines = context.lanes.map(
    (boardLane) => `- ${boardLane.id} — ${boardLane.name} — agent work: ${laneHasAgentWork(boardLane) ? 'yes' : 'no'}`
  )
  const ticketNumbers = launches.map((launch) => launch.number).join(', ')
  const ticketSql = [
    'SELECT number, title, lane_id, branch_name, pull_request_url, description FROM tickets',
    `WHERE project_path = ${sqlStringLiteral(context.projectPath)} AND number IN (${ticketNumbers});`
  ].join(' ')
  // Double quotes only around the DB path, which needs $HOME expanded; the SQL
  // carries the project path, so it gets literal single quotes.
  const ticketQuery = `sqlite3 -readonly "${TRACKER_DATABASE_PATH}" ${shellQuote(ticketSql)}`

  return [
    `You are the Auto Run orchestrator for the "${lane.name}" lane of ${context.projectPath}.`,
    'You report only. Never write to the database, never move tickets, never edit files, never answer or message the ticket agents.',
    ['Watch these tickets until each one is done:', ...ticketLines].join('\n'),
    ['Board lanes (id — name — agent work):', ...laneLines].join('\n'),
    ['Ticket state (read-only):', ticketQuery].join('\n'),
    [
      'PR state per ticket (use the branch_name from the database when it differs from the one above):',
      'gh pr list --head <branch> --state all --json number,url,state'
    ].join('\n'),
    tabSection(context),
    [
      'Loop:',
      '1. On start, then every 60 seconds (sleep 60), gather the state above.',
      '2. On the first pass, and whenever a ticket changed since the last one, print one line per ticket:',
      '   #<N> <title> — lane: <name> — agent: running | not running | unknown — open PRs: <urls> — closed/merged PRs: <urls> — needs you: <question or no>',
      '3. Needs you = its description has a "## Open questions" section that is not empty and not "None",',
      `   or its tab is gone while it is still in the ${lane.id} lane.`,
      '4. Done = it is in a lane with agent work: no, or its PR is merged. When a ticket becomes done, close its tab and say so.',
      '5. When every ticket is done, print a final summary (each ticket: final lane, PR url and state) and exit. Leave your own tab open.'
    ].join('\n'),
    laneInstructionsSection(lane)
  ]
    .filter(Boolean)
    .join('\n\n')
}

// One ticket needs no watcher: its own tab already says everything.
export const buildOrchestratorLaunch = (
  lane: SwimLane,
  entries: AutoRunLaunchEntry[],
  agent: Agent,
  context: OrchestratorPromptContext
): TerminalTab | undefined => {
  if (entries.length < 2) return undefined
  const prompt = orchestratorPrompt(lane, entries, context)
  return { command: agentShellCommand(agent, prompt), title: orchestratorTabTitle(lane) }
}

export interface FullAutoHandoff {
  ticket: Ticket
  fromLane: SwimLane
  toLane: SwimLane
}

const boardLaneById = (board: ProjectBoard, laneId: string): SwimLane | undefined =>
  laneId === UNASSIGNED_LANE_ID ? getUnassignedLane(board) : board.lanes.find((lane) => lane.id === laneId)

// The lane a ticket LEFT decides: its agent did the work and moved the ticket.
// Tickets new in nextBoard have no previous lane, so they never hand off.
export const fullAutoHandoffs = (previousBoard: ProjectBoard, nextBoard: ProjectBoard): FullAutoHandoff[] => {
  const previousLaneIdByTicketId = new Map(previousBoard.tickets.map((ticket) => [ticket.id, ticket.laneId]))
  const handoffs: FullAutoHandoff[] = []
  for (const ticket of nextBoard.tickets) {
    const previousLaneId = previousLaneIdByTicketId.get(ticket.id)
    if (previousLaneId === undefined || previousLaneId === ticket.laneId) continue
    if (ticket.laneId === UNASSIGNED_LANE_ID) continue
    const fromLane = boardLaneById(previousBoard, previousLaneId)
    const toLane = boardLaneById(nextBoard, ticket.laneId)
    if (!fromLane || !toLane) continue
    if (!isFullAuto(ticket, fromLane) || !laneHasAgentWork(toLane)) continue
    handoffs.push({ ticket, fromLane, toLane })
  }
  return handoffs
}

const isChecklistComplete = (ticket: Ticket | undefined): boolean => {
  const checklist = ticket?.checklist ?? []
  return checklist.length > 0 && checklist.every((item) => item.done)
}

export interface CompletionMove {
  ticket: Ticket
  toLane: SwimLane
}

// Completed = the checklist just went all-done, or the caller saw it finish
// another way (a successful ▶ Run, passed in alsoCompletedIds). A transition,
// not a state: a ticket already all-done in previousBoard stays put. Every
// completed ticket with Move to armed is disarmed, even when it is already in
// its target lane or that lane is gone, so a later re-completion never moves it.
export const completionMoves = (
  previousBoard: ProjectBoard,
  nextBoard: ProjectBoard,
  alsoCompletedIds: string[] = [],
  at = new Date().toISOString()
): { board: ProjectBoard; moves: CompletionMove[] } => {
  const previousTicketById = new Map(previousBoard.tickets.map((ticket) => [ticket.id, ticket]))
  const isJustCompleted = (ticket: Ticket) => {
    const checklistJustCompleted =
      isChecklistComplete(ticket) && !isChecklistComplete(previousTicketById.get(ticket.id))
    return checklistJustCompleted || alsoCompletedIds.includes(ticket.id)
  }

  const moves: CompletionMove[] = []
  const tickets = nextBoard.tickets.map((ticket) => {
    if (!ticket.moveOnComplete || !isJustCompleted(ticket)) return ticket
    const toLane = ticket.moveToLaneId ? boardLaneById(nextBoard, ticket.moveToLaneId) : undefined
    const movesLane = toLane !== undefined && toLane.id !== ticket.laneId
    const disarmed = { ...ticket, moveOnComplete: false, updatedAt: at }
    if (!movesLane) return disarmed
    const moved = { ...disarmed, laneId: toLane.id }
    moves.push({ ticket: moved, toLane })
    return moved
  })
  const anyDisarmed = tickets.some((ticket, index) => ticket !== nextBoard.tickets[index])
  return { board: anyDisarmed ? { ...nextBoard, tickets } : nextBoard, moves }
}

export interface GithubIssue {
  number: number
  title: string
  body: string
  htmlUrl: string
}

// GitHub's state_reason: 'completed', 'not_planned', 'duplicate', or null.
export interface GithubClosedIssue extends GithubIssue {
  stateReason: string | null
}

export interface GithubIssueLists {
  open: GithubIssue[]
  closed: GithubClosedIssue[]
}

export interface ProjectBoard {
  lanes: SwimLane[]
  tickets: Ticket[]
  // The unassigned column's own config. Held apart from `lanes` so the column
  // can carry an agent prompt like any other lane while staying undeletable —
  // it is the fallback every orphaned ticket lands in.
  unassignedLane?: SwimLane
}

const DEFAULT_LANE_NAMES = ['Idea', 'PRD', 'In Development', 'In PR', 'In Dev', 'In QA', 'In Production']

const laneIdFromName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

// Every lane after the merge to main counts as closed. QA sits between In Dev
// and In Production, so leaving it out would reopen each ticket on its way to ship.
// New boards get these flags; the storage migration seeds the same ids once.
const CLOSING_LANE_NAMES = ['In Dev', 'In QA', 'In Production']
export const SEEDED_CLOSING_LANE_IDS = CLOSING_LANE_NAMES.map(laneIdFromName)

// Tickets with no status live under a lane id that is never stored in
// board.lanes — the board renders it as a virtual column, so it cannot be
// renamed, configured or deleted out from under its tickets.
export const UNASSIGNED_LANE_ID = 'unassigned'
export const UNASSIGNED_LANE_NAME = 'No status'

// Ids are derived from the lane name, never random: a board that has not been
// saved yet is rebuilt on every read, and random ids would hand out a different
// id each time — tickets written against one read would point at lanes that no
// longer exist by the next read.
export const createUnassignedLane = (): SwimLane => ({
  id: UNASSIGNED_LANE_ID,
  name: UNASSIGNED_LANE_NAME,
  agentPrompt: '',
  agentFilePath: ''
})

export const getUnassignedLane = (board: ProjectBoard): SwimLane =>
  board.unassignedLane ?? createUnassignedLane()

// Routes a lane edit to wherever that lane lives: the unassigned column is
// stored on its own field, every other lane in `lanes`.
export const updateLaneInBoard = (
  board: ProjectBoard,
  laneId: string,
  patch: Partial<Omit<SwimLane, 'id'>>
): ProjectBoard => {
  if (laneId === UNASSIGNED_LANE_ID) {
    return { ...board, unassignedLane: { ...getUnassignedLane(board), ...patch } }
  }
  return {
    ...board,
    lanes: board.lanes.map((lane) => (lane.id === laneId ? { ...lane, ...patch } : lane))
  }
}

// Anchored on a lane id rather than an index: the board view only sees its
// visible lanes, and a hidden lane (e.g. GitHub Issues) would shift any index
// it handed over. An anchor id lands in the same place whatever is hidden.
// Returns the original board when nothing would move, so callers can skip the
// save. No status lives outside `lanes`, so it can neither move nor be passed:
// dropping before it means "first".
export const moveLaneInBoard = (
  board: ProjectBoard,
  laneId: string,
  beforeLaneId: string | null
): ProjectBoard => {
  const movingLane = board.lanes.find((lane) => lane.id === laneId)
  if (!movingLane || beforeLaneId === laneId) return board

  const otherLanes = board.lanes.filter((lane) => lane.id !== laneId)
  const anchorIndex = otherLanes.findIndex((lane) => lane.id === beforeLaneId)
  const anchorFound = anchorIndex !== -1
  const dropsAheadOfEveryLane = beforeLaneId === UNASSIGNED_LANE_ID
  let insertAt = anchorFound ? anchorIndex : otherLanes.length
  if (dropsAheadOfEveryLane) insertAt = 0
  const reorderedLanes = [...otherLanes.slice(0, insertAt), movingLane, ...otherLanes.slice(insertAt)]

  const orderUnchanged = reorderedLanes.every((lane, index) => lane === board.lanes[index])
  return orderUnchanged ? board : { ...board, lanes: reorderedLanes }
}

export const createDefaultBoard = (): ProjectBoard => ({
  lanes: DEFAULT_LANE_NAMES.map((name) => ({
    id: laneIdFromName(name),
    name,
    agentPrompt: '',
    agentFilePath: '',
    closesTicket: SEEDED_CLOSING_LANE_IDS.includes(laneIdFromName(name))
  })),
  tickets: []
})

// Comparing against undefined yields false, so tickets saved before numbering
// existed are simply skipped rather than poisoning the result with NaN.
const highestTicketNumber = (tickets: Ticket[]) =>
  tickets.reduce((highest, ticket) => (ticket.number > highest ? ticket.number : highest), 0)

export const nextTicketNumber = (board: ProjectBoard) => highestTicketNumber(board.tickets) + 1

// Repairs a board on read: tickets whose lane no longer exists fall back to the
// unassigned column rather than rendering nowhere, and tickets saved before
// numbers existed are backfilled. Saving afterwards persists the repair.
export const normalizeBoard = (board: ProjectBoard): ProjectBoard => {
  const knownLaneIds = new Set([...board.lanes.map((lane) => lane.id), UNASSIGNED_LANE_ID])
  const hasOrphans = board.tickets.some((ticket) => !knownLaneIds.has(ticket.laneId))
  const hasUnnumbered = board.tickets.some((ticket) => !(ticket.number > 0))
  if (!hasOrphans && !hasUnnumbered) return board

  let numberToAssign = nextTicketNumber(board)
  const tickets = board.tickets.map((ticket) => {
    const laneId = knownLaneIds.has(ticket.laneId) ? ticket.laneId : UNASSIGNED_LANE_ID
    const number = ticket.number > 0 ? ticket.number : numberToAssign++
    if (laneId === ticket.laneId && number === ticket.number) return ticket
    return { ...ticket, laneId, number }
  })
  return { ...board, tickets }
}

export const addTicketToBoard = (
  board: ProjectBoard,
  input: { laneId: string; title: string; description: string }
): ProjectBoard => ({
  ...board,
  tickets: [
    ...board.tickets,
    { id: crypto.randomUUID(), number: nextTicketNumber(board), createdAt: new Date().toISOString(), ...input }
  ]
})

export const getBoard = (state: ProjectTrackerState, projectPath: string): ProjectBoard =>
  normalizeBoard(state.boards?.[projectPath] ?? createDefaultBoard())

// Deleting a lane never deletes work: its tickets move to the unassigned column,
// which always exists, so this holds even when the last lane is removed.
// Tickets set to Move to the deleted lane lose that target.
const withoutLane = (ticket: Ticket, laneId: string): Ticket => {
  const laneFixed = ticket.laneId === laneId ? { ...ticket, laneId: UNASSIGNED_LANE_ID } : ticket
  if (ticket.moveToLaneId !== laneId) return laneFixed
  return { ...laneFixed, moveToLaneId: undefined, moveOnComplete: false }
}

export const removeLaneFromBoard = (board: ProjectBoard, laneId: string): ProjectBoard => ({
  ...board,
  lanes: board.lanes.filter((lane) => lane.id !== laneId),
  tickets: board.tickets.map((ticket) => withoutLane(ticket, laneId))
})

export const githubIssueExternalId = (issue: GithubIssue) => `github:${issue.number}`

export const GITHUB_IMPORT_LANE_ID = 'github-issues'
export const GITHUB_IMPORT_LANE_NAME = 'GitHub Issues'

// Where tickets closed as completed on GitHub go: the rightmost lane that closes tickets.
export const productionLane = (board: ProjectBoard): SwimLane | undefined =>
  [...board.lanes].reverse().find((lane) => lane.closesTicket)

const hasLocalWork = (ticket: Ticket) => Boolean(ticket.worktreePath || ticket.pullRequestUrl)

export interface GithubSyncResult {
  board: ProjectBoard
  added: number
  moved: number
  removed: number
  keptWithWork: number
}

// A GitHub issue carries no swim-lane status, so imports land in a dedicated
// lane at the far left instead of guessing. Already-imported tickets keep every
// local edit; only GitHub's closed state reaches them: completed → production
// lane, closed for any other reason → removed unless the ticket has local work.
// Open or unlisted issues leave their ticket untouched.
export const syncGithubIssuesToBoard = (board: ProjectBoard, issues: GithubIssueLists): GithubSyncResult => {
  const closedById = new Map(issues.closed.map((issue) => [githubIssueExternalId(issue), issue]))
  const targetLane = productionLane(board)
  const movedAt = new Date().toISOString()
  let moved = 0
  let removed = 0
  let keptWithWork = 0

  const syncedTickets: Ticket[] = []
  for (const ticket of board.tickets) {
    const closedIssue = ticket.externalId ? closedById.get(ticket.externalId) : undefined
    if (!closedIssue) {
      syncedTickets.push(ticket)
      continue
    }
    const isCompleted = closedIssue.stateReason === 'completed'
    if (isCompleted) {
      const shouldMove = targetLane !== undefined && ticket.laneId !== targetLane.id
      if (shouldMove) moved += 1
      syncedTickets.push(shouldMove ? { ...ticket, laneId: targetLane.id, updatedAt: movedAt } : ticket)
      continue
    }
    if (hasLocalWork(ticket)) {
      keptWithWork += 1
      syncedTickets.push(ticket)
      continue
    }
    removed += 1
  }

  const importedIds = new Set(board.tickets.map((ticket) => ticket.externalId).filter(Boolean))
  const newIssues = issues.open.filter((issue) => !importedIds.has(githubIssueExternalId(issue)))
  // ponytail: no new issues → no import lane, so a sync-only pull doesn't add an empty lane.
  const importLaneExists = board.lanes.some((lane) => lane.id === GITHUB_IMPORT_LANE_ID)
  const needsImportLane = newIssues.length > 0 && !importLaneExists
  const lanes = needsImportLane
    ? [{ id: GITHUB_IMPORT_LANE_ID, name: GITHUB_IMPORT_LANE_NAME, agentPrompt: '', agentFilePath: '' }, ...board.lanes]
    : board.lanes

  const createdAt = new Date().toISOString()
  const firstNumber = nextTicketNumber(board)
  const newTickets: Ticket[] = newIssues.map((issue, index) => ({
    id: crypto.randomUUID(),
    number: firstNumber + index,
    laneId: GITHUB_IMPORT_LANE_ID,
    title: issue.title,
    description: issue.body,
    createdAt,
    externalId: githubIssueExternalId(issue),
    externalUrl: issue.htmlUrl
  }))

  return {
    board: { ...board, lanes, tickets: [...syncedTickets, ...newTickets] },
    added: newTickets.length,
    moved,
    removed,
    keptWithWork
  }
}

// Closed issues older than every imported ticket can't match one, so the closed
// fetch starts there. Undefined means nothing is imported and the fetch is skipped.
export const oldestImportedCreatedAt = (board: ProjectBoard): string | undefined => {
  const importedCreatedAts = board.tickets
    .filter((ticket) => ticket.externalId?.startsWith('github:'))
    .map((ticket) => ticket.createdAt)
  // ISO-8601 UTC strings sort chronologically.
  return importedCreatedAts.sort()[0]
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

export const githubSyncNotice = (result: GithubSyncResult, openCount: number, productionLaneName: string): string => {
  const skipped = openCount - result.added
  const skippedNote = skipped > 0 ? ` (${skipped} already on the board)` : ''
  const nothingChanged = result.added + result.moved + result.removed === 0
  const parts = [
    result.added > 0 || nothingChanged ? `Imported ${plural(result.added, 'issue')}${skippedNote}` : '',
    result.moved > 0 ? `moved ${result.moved} to ${productionLaneName}` : '',
    result.removed > 0 ? `removed ${result.removed} closed` : '',
    result.keptWithWork > 0 ? `kept ${result.keptWithWork} closed with local work` : ''
  ].filter(Boolean)
  const sentence = parts.join(', ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

// What a ticket card can show on the board. Ids are persisted, so renaming one
// silently drops that field from every saved preference — add, never rename.
export const TICKET_CARD_FIELDS = [
  { id: 'number', label: 'Ticket number' },
  { id: 'description', label: 'Description' },
  { id: 'assignee', label: 'Assignee' },
  { id: 'labels', label: 'Labels' },
  { id: 'checklist', label: 'Checklist progress' },
  { id: 'branch', label: 'Branch' },
  { id: 'worktree', label: 'Worktree' },
  { id: 'pullRequest', label: 'GitHub PR' },
  { id: 'version', label: 'Semantic version' }
] as const

export type TicketCardField = (typeof TICKET_CARD_FIELDS)[number]['id']

// A card is too narrow for a full path; the last segment is what tells
// sibling worktrees apart.
export const worktreeFolderName = (worktreePath: string) => {
  const segments = worktreePath.split('/').filter(Boolean)
  return segments.at(-1) ?? worktreePath
}

// A scheme-less href would resolve against the app's own origin instead of
// opening in the OS browser, so only absolute http(s) URLs become links.
export const isWebUrl = (url: string | undefined): url is string => /^https?:\/\//.test(url ?? '')

// GitHub PR URLs end in /pull/<number>; anything else still gets a link, just
// without the number.
export const pullRequestNumber = (pullRequestUrl: string): number | undefined => {
  const pullNumber = pullRequestUrl.match(/\/pull\/(\d+)/)?.[1]
  return pullNumber ? Number(pullNumber) : undefined
}

export const pullRequestLabel = (pullRequestUrl: string) => {
  const pullNumber = pullRequestNumber(pullRequestUrl)
  return pullNumber ? `PR #${pullNumber}` : 'PR'
}

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed'

export interface PullRequestStatus {
  url: string
  number: number
  state: PullRequestState
  mergedAt?: string
}

// The slice of GitHub's pull request payload the status is read from.
export interface GithubPullRequest {
  html_url: string
  number: number
  state: 'open' | 'closed'
  draft?: boolean
  merged_at?: string | null
  head?: { ref: string }
}

// GitHub reports a merged PR as state "closed"; merged_at is what tells the two
// apart. Draft only means something while the PR is still open.
const pullRequestStateOf = (pullRequest: GithubPullRequest): PullRequestState => {
  if (pullRequest.merged_at) return 'merged'
  if (pullRequest.state === 'closed') return 'closed'
  return pullRequest.draft ? 'draft' : 'open'
}

export const toPullRequestStatus = (pullRequest: GithubPullRequest): PullRequestStatus => ({
  url: pullRequest.html_url,
  number: pullRequest.number,
  state: pullRequestStateOf(pullRequest),
  mergedAt: pullRequest.merged_at ?? undefined
})

const PULL_REQUEST_STATE_LABELS: Record<PullRequestState, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed'
}

export const pullRequestStatusLabel = (state: PullRequestState | undefined) =>
  state ? PULL_REQUEST_STATE_LABELS[state] : 'No merge request'

// Only a merge is final: a closed PR can be reopened, or replaced by a new PR
// from the same branch.
export const isPullRequestSettled = (state: PullRequestState | undefined) => state === 'merged'

export const DEFAULT_LANE_WIDTH = 260
export const MIN_LANE_WIDTH = 200
export const MAX_LANE_WIDTH = 900

// How one person looks at a shared board: column widths, which columns are
// collapsed away, what a card shows. Kept out of ProjectBoard because none of it
// is the work itself — two people can view the same board differently.
export interface BoardPreferences {
  laneWidths: Record<string, number>
  hiddenLaneIds: string[]
  cardFields: TicketCardField[]
  // Every card field that existed when these preferences were saved. A field
  // missing from it shipped later, so it starts shown rather than looking
  // switched off.
  knownCardFields?: TicketCardField[]
}

const ALL_CARD_FIELDS = TICKET_CARD_FIELDS.map((field) => field.id)

// ponytail: the card fields that shipped before knownCardFields was recorded.
const CARD_FIELDS_BEFORE_TRACKING: TicketCardField[] = [
  'number',
  'description',
  'assignee',
  'labels',
  'checklist',
  'branch'
]

export const createDefaultBoardPreferences = (): BoardPreferences => ({
  laneWidths: {},
  hiddenLaneIds: [],
  cardFields: [...ALL_CARD_FIELDS],
  knownCardFields: [...ALL_CARD_FIELDS]
})

// Spread over the defaults rather than returned as-is, so preferences saved
// before a field existed read back complete instead of undefined.
export const getBoardPreferences = (state: ProjectTrackerState, projectPath: string): BoardPreferences => {
  const saved = state.boardPreferences?.[projectPath]
  const preferences = { ...createDefaultBoardPreferences(), ...saved }
  if (!saved?.cardFields) return preferences

  const knownWhenSaved = saved.knownCardFields ?? CARD_FIELDS_BEFORE_TRACKING
  const fieldsAddedSinceSave = ALL_CARD_FIELDS.filter((field) => !knownWhenSaved.includes(field))
  return {
    ...preferences,
    cardFields: [...saved.cardFields, ...fieldsAddedSinceSave],
    knownCardFields: [...ALL_CARD_FIELDS]
  }
}

export const clampLaneWidth = (width: number) =>
  Math.min(MAX_LANE_WIDTH, Math.max(MIN_LANE_WIDTH, Math.round(width)))

const toggleInList = <T>(values: T[], value: T): T[] =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]

export const toggleHiddenLane = (preferences: BoardPreferences, laneId: string): BoardPreferences => ({
  ...preferences,
  hiddenLaneIds: toggleInList(preferences.hiddenLaneIds, laneId)
})

export const toggleCardField = (preferences: BoardPreferences, field: TicketCardField): BoardPreferences => ({
  ...preferences,
  cardFields: toggleInList(preferences.cardFields, field)
})

export const setLaneWidth = (
  preferences: BoardPreferences,
  laneId: string,
  width: number
): BoardPreferences => ({
  ...preferences,
  laneWidths: { ...preferences.laneWidths, [laneId]: clampLaneWidth(width) }
})

// Each lane decides on its own: checked tickets in this set narrow the run to
// just those; with none checked here the whole set runs, whatever is checked
// in other lanes.
export const ticketsToRun = (tickets: Ticket[], selectedTicketIds: ReadonlySet<string>): Ticket[] => {
  const selectedTickets = tickets.filter((ticket) => selectedTicketIds.has(ticket.id))
  const nothingSelectedHere = selectedTickets.length === 0
  return nothingSelectedHere ? tickets : selectedTickets
}
