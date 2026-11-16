import type { ProjectPriority, ProjectRecord, ProjectStatus } from './projectTypes.js'

export interface ProjectFilters {
  query: string
  statuses: ProjectStatus[]
  priorities: ProjectPriority[]
  thirdPartyOnly: boolean
  hiddenPaths: string[]
  thirdPartyPaths: string[]
}

export const isProjectHidden = (project: ProjectRecord, hiddenPaths: string[]) =>
  project.status === 'hidden' || hiddenPaths.includes(project.path)

// Single source of truth for the Dashboard list AND its Metrics popover, so
// the two can never disagree about which projects are "in view".
export const projectMatchesFilters = (project: ProjectRecord, displayName: string, filters: ProjectFilters) => {
  const searchableText = `${displayName} ${project.name} ${project.path} ${project.notes}`.toLowerCase()
  const matchesQuery = searchableText.includes(filters.query.toLowerCase())
  const matchesStatus = filters.statuses.length === 0 || filters.statuses.includes(project.status)
  const matchesPriority = filters.priorities.length === 0 || filters.priorities.includes(project.priority)
  const matchesThirdParty = !filters.thirdPartyOnly || filters.thirdPartyPaths.includes(project.path)
  const hiddenFilterOn = filters.statuses.includes('hidden')
  const passesHiddenRule = hiddenFilterOn || !isProjectHidden(project, filters.hiddenPaths)
  return matchesQuery && matchesStatus && matchesPriority && matchesThirdParty && passesHiddenRule
}
