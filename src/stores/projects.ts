import { defineStore } from 'pinia'

import { projectTrackerApi } from '@/services/projectTrackerApi'
import {
  addGithubIssuesToBoard,
  addTicketToBoard,
  createSeedState,
  getBoard,
  getBoardPreferences,
  mergeScannedProjects,
  removeLaneFromBoard,
  updateLaneInBoard,
  type BoardPreferences,
  type ProjectBoard,
  type ProjectPriority,
  type ProjectRecord,
  type ProjectStatus,
  type ProjectTrackerState,
  type SwimLane,
  type Ticket
} from '@/shared/projectTypes'

interface ProjectsStoreState {
  state: ProjectTrackerState
  loading: boolean
  scanning: boolean
  saving: boolean
  error: string | null
  notice: string | null
  readmes: Record<string, { loading: boolean; content: string | null; fileName: string | null; error: string | null }>
  githubLoading: Record<string, boolean>
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))]
let saveQueue = Promise.resolve()

export const useProjectsStore = defineStore('projects', {
  state: (): ProjectsStoreState => ({
    state: createSeedState(),
    loading: false,
    scanning: false,
    saving: false,
    error: null,
    notice: null,
    readmes: {},
    githubLoading: {}
  }),

  getters: {
    projects: (store) => store.state.snapshot.projects,
    isFirstLaunch: (store) =>
      store.state.scanDirectories.length === 0 &&
      !store.state.snapshot.scannedAt &&
      store.state.snapshot.projects.length <= 1
  },

  actions: {
    board(projectPath: string): ProjectBoard {
      return getBoard(this.state, projectPath)
    },

    async updateBoard(projectPath: string, mutate: (board: ProjectBoard) => ProjectBoard) {
      await this.save((currentState) => ({
        ...currentState,
        boards: {
          ...currentState.boards,
          [projectPath]: mutate(getBoard(currentState, projectPath))
        }
      }))
    },

    boardPreferences(projectPath: string): BoardPreferences {
      return getBoardPreferences(this.state, projectPath)
    },

    // Takes the whole next preferences object rather than a patch: callers build
    // it with the toggle/setLaneWidth helpers, which already read the current
    // value, so a patch would just be a second way to say the same thing.
    async saveBoardPreferences(projectPath: string, preferences: BoardPreferences) {
      await this.save((currentState) => ({
        ...currentState,
        boardPreferences: { ...currentState.boardPreferences, [projectPath]: preferences }
      }))
    },

    async addLane(projectPath: string, name: string) {
      const lane: SwimLane = { id: crypto.randomUUID(), name, agentPrompt: '', agentFilePath: '' }
      await this.updateBoard(projectPath, (board) => ({ ...board, lanes: [...board.lanes, lane] }))
    },

    async updateLane(projectPath: string, laneId: string, patch: Partial<Omit<SwimLane, 'id'>>) {
      await this.updateBoard(projectPath, (board) => updateLaneInBoard(board, laneId, patch))
    },

    async removeLane(projectPath: string, laneId: string) {
      await this.updateBoard(projectPath, (board) => removeLaneFromBoard(board, laneId))
    },

    async addTicket(projectPath: string, laneId: string, title: string, description = '') {
      // Built inside the mutate callback so the ticket number is derived from the
      // same board revision it is appended to.
      await this.updateBoard(projectPath, (board) => addTicketToBoard(board, { laneId, title, description }))
    },

    // Every ticket edit funnels through here — modal fields, checklist toggles,
    // and drag-and-drop between lanes alike — so this is the only place that has
    // to stamp updatedAt for all of them.
    async updateTicket(
      projectPath: string,
      ticketId: string,
      patch: Partial<Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'>>
    ) {
      const updatedAt = new Date().toISOString()
      await this.updateBoard(projectPath, (board) => ({
        ...board,
        tickets: board.tickets.map((ticket) =>
          ticket.id === ticketId ? { ...ticket, ...patch, updatedAt } : ticket
        )
      }))
    },

    // Imports open GitHub issues into the board's dedicated import lane, which
    // is created on first pull. Already-imported issues are left untouched, so
    // this is safe to re-run.
    async pullGithubIssues(projectPath: string) {
      const project = this.projects.find((entry) => entry.path === projectPath)
      if (!project?.githubUrl) {
        this.error = 'This project has no linked GitHub repository.'
        return
      }
      this.githubLoading[projectPath] = true
      this.error = null
      this.notice = null
      try {
        const issues = await projectTrackerApi.fetchProjectGithubIssues(project.githubUrl)
        let added = 0
        await this.updateBoard(projectPath, (board) => {
          const result = addGithubIssuesToBoard(board, issues)
          added = result.added
          return result.board
        })
        const skipped = issues.length - added
        this.notice = `Imported ${added} issue${added === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} already on the board)` : ''}.`
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.githubLoading[projectPath] = false
      }
    },

    async removeTicket(projectPath: string, ticketId: string) {
      await this.updateBoard(projectPath, (board) => ({
        ...board,
        tickets: board.tickets.filter((ticket) => ticket.id !== ticketId)
      }))
    },

    async load() {
      this.loading = true
      this.error = null
      try {
        this.state = await projectTrackerApi.getProjectState()
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    async save(nextState?: ProjectTrackerState | ((currentState: ProjectTrackerState) => ProjectTrackerState)) {
      this.saving = true
      this.error = null
      try {
        saveQueue = saveQueue
          .catch(() => undefined)
          .then(async () => {
            const candidate = typeof nextState === 'function' ? nextState(this.state) : nextState ?? this.state
            this.state = await projectTrackerApi.saveProjectState(candidate)
          })
        await saveQueue
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.saving = false
      }
    },

    async pickDirectory() {
      try {
        return await projectTrackerApi.pickScanDirectory()
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        return null
      }
    },

    async addScanDirectory(directory: string) {
      await this.save((currentState) => ({
        ...currentState,
        scanDirectories: unique([...currentState.scanDirectories, directory])
      }))
    },

    async removeScanDirectory(directory: string) {
      await this.save((currentState) => {
        const remaining = currentState.scanDirectories.filter((entry) => entry !== directory)
        // Projects derive from the scan directories (mergeScannedProjects replaces
        // the set on each scan), so drop anything no longer covered by a remaining
        // directory. Checking against *all* remaining dirs handles nested scan
        // roots — a project under both /a and /a/b survives removing just one.
        const insideRemaining = (target: string) =>
          remaining.some((dir) => target === dir || target.startsWith(`${dir}/`))
        return {
          ...currentState,
          scanDirectories: remaining,
          hiddenPaths: currentState.hiddenPaths.filter(insideRemaining),
          thirdPartyPaths: currentState.thirdPartyPaths.filter(insideRemaining),
          snapshot: {
            ...currentState.snapshot,
            projects: currentState.snapshot.projects.filter((project) => insideRemaining(project.path))
          }
        }
      })
    },

    async scan(extraDirectory?: string, options?: { requireProjects?: boolean }) {
      this.scanning = true
      this.error = null
      this.notice = null
      const scanDirectories = unique(extraDirectory ? [...this.state.scanDirectories, extraDirectory] : this.state.scanDirectories)

      try {
        const result = await projectTrackerApi.scanProjectDirectories(
          scanDirectories,
          this.state.hiddenPaths,
          this.state.thirdPartyPaths
        )
        if (options?.requireProjects && result.snapshot.projects.length === 0 && result.failures.length > 0) {
          this.error = `Scan failed for ${result.failures[0].path}: ${result.failures[0].message}`
          return false
        }
        await this.save((currentState) => mergeScannedProjects(
          { ...currentState, scanDirectories },
          result.snapshot.projects,
          result.failures
        ))
        this.notice =
          result.failures.length > 0
            ? `Scan finished with ${result.failures.length} issue${result.failures.length === 1 ? '' : 's'}.`
            : `Scan found ${result.snapshot.projects.length} project${result.snapshot.projects.length === 1 ? '' : 's'}.`
        return true
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        return false
      } finally {
        this.scanning = false
      }
    },

    async updateProject(path: string, patch: Partial<Pick<ProjectRecord, 'notes' | 'priority' | 'status'>>) {
      await this.save((currentState) => ({
        ...currentState,
        snapshot: {
          ...currentState.snapshot,
          projects: currentState.snapshot.projects.map((project) =>
            project.path === path ? { ...project, ...patch } : project
          )
        }
      }))
    },

    async setPriority(path: string, priority: ProjectPriority) {
      await this.updateProject(path, { priority })
    },

    async setStatus(path: string, status: ProjectStatus) {
      await this.save((currentState) => {
        const hiddenPaths =
          status === 'hidden'
            ? unique([...currentState.hiddenPaths, path])
            : currentState.hiddenPaths.filter((entry) => entry !== path)
        return {
          ...currentState,
          hiddenPaths,
          snapshot: {
            ...currentState.snapshot,
            projects: currentState.snapshot.projects.map((project) =>
              project.path === path ? { ...project, status } : project
            )
          }
        }
      })
    },

    async setNotes(path: string, notes: string) {
      await this.updateProject(path, { notes })
    },

    async toggleHidden(path: string) {
      await this.save((currentState) => {
        const project = currentState.snapshot.projects.find((entry) => entry.path === path)
        const hiddenPaths = currentState.hiddenPaths.includes(path)
          ? currentState.hiddenPaths.filter((entry) => entry !== path)
          : [...currentState.hiddenPaths, path]
        const status: ProjectStatus = project?.status === 'hidden' ? 'unknown' : 'hidden'
        return {
          ...currentState,
          hiddenPaths,
          snapshot: {
            ...currentState.snapshot,
            projects: currentState.snapshot.projects.map((entry) =>
              entry.path === path ? { ...entry, status } : entry
            )
          }
        }
      })
    },

    async toggleThirdParty(path: string) {
      await this.save((currentState) => {
        const thirdPartyPaths = currentState.thirdPartyPaths.includes(path)
          ? currentState.thirdPartyPaths.filter((entry) => entry !== path)
          : [...currentState.thirdPartyPaths, path]
        return { ...currentState, thirdPartyPaths }
      })
    },

    async openIn(path: string, targetId: string) {
      try {
        const result = await projectTrackerApi.openProjectIn(path, targetId)
        this.notice = result.fallbackCommand
          ? `${result.appLabel} could not be opened. Copied ${result.fallbackCommand} to the clipboard.`
          : `Opening in ${result.appLabel}.`
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      }
    },

    async fetchGithub(path: string) {
      const project = this.projects.find((entry) => entry.path === path)
      if (!project?.githubUrl) {
        this.error = 'This project has no linked GitHub repository.'
        return
      }
      this.githubLoading[path] = true
      this.error = null
      this.notice = null
      try {
        const github = await projectTrackerApi.fetchProjectGithub(project.githubUrl)
        await this.save((currentState) => ({
          ...currentState,
          snapshot: {
            ...currentState.snapshot,
            projects: currentState.snapshot.projects.map((entry) =>
              entry.path === path ? { ...entry, github } : entry
            )
          }
        }))
        this.notice = `Updated GitHub data for ${project.name}.`
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.githubLoading[path] = false
      }
    },

    async loadReadme(path: string) {
      if (this.readmes[path]?.content || this.readmes[path]?.loading) return
      this.readmes[path] = { loading: true, content: null, fileName: null, error: null }
      try {
        this.readmes[path] = { loading: false, error: null, ...(await projectTrackerApi.readProjectReadme(path)) }
      } catch (error) {
        this.readmes[path] = {
          loading: false,
          content: null,
          fileName: null,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
})
