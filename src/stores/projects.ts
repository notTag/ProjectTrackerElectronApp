import { defineStore } from 'pinia'

import { projectTrackerApi } from '@/services/projectTrackerApi'
import {
  createSeedState,
  mergeScannedProjects,
  type ProjectPriority,
  type ProjectRecord,
  type ProjectStatus,
  type ProjectTrackerState
} from '@/shared/projectTypes'

interface ProjectsStoreState {
  state: ProjectTrackerState
  loading: boolean
  scanning: boolean
  saving: boolean
  error: string | null
  notice: string | null
  readmes: Record<string, { loading: boolean; content: string | null; fileName: string | null; error: string | null }>
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))]

export const useProjectsStore = defineStore('projects', {
  state: (): ProjectsStoreState => ({
    state: createSeedState(),
    loading: false,
    scanning: false,
    saving: false,
    error: null,
    notice: null,
    readmes: {}
  }),

  getters: {
    projects: (store) => store.state.snapshot.projects,
    isFirstLaunch: (store) =>
      store.state.scanDirectories.length === 0 &&
      !store.state.snapshot.scannedAt &&
      store.state.snapshot.projects.length <= 1
  },

  actions: {
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

    async save(nextState?: ProjectTrackerState) {
      this.saving = true
      this.error = null
      try {
        this.state = await projectTrackerApi.saveProjectState(nextState ?? this.state)
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
      const next = {
        ...this.state,
        scanDirectories: unique([...this.state.scanDirectories, directory])
      }
      await this.save(next)
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
        const next = mergeScannedProjects(
          { ...this.state, scanDirectories },
          result.snapshot.projects,
          result.failures
        )
        await this.save(next)
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
      const next = {
        ...this.state,
        snapshot: {
          ...this.state.snapshot,
          projects: this.state.snapshot.projects.map((project) =>
            project.path === path ? { ...project, ...patch } : project
          )
        }
      }
      await this.save(next)
    },

    async setPriority(path: string, priority: ProjectPriority) {
      await this.updateProject(path, { priority })
    },

    async setStatus(path: string, status: ProjectStatus) {
      const hiddenPaths =
        status === 'hidden'
          ? unique([...this.state.hiddenPaths, path])
          : this.state.hiddenPaths.filter((entry) => entry !== path)
      const next = {
        ...this.state,
        hiddenPaths,
        snapshot: {
          ...this.state.snapshot,
          projects: this.state.snapshot.projects.map((project) =>
            project.path === path ? { ...project, status } : project
          )
        }
      }
      await this.save(next)
    },

    async setNotes(path: string, notes: string) {
      await this.updateProject(path, { notes })
    },

    async toggleHidden(path: string) {
      const project = this.state.snapshot.projects.find((entry) => entry.path === path)
      const hiddenPaths = this.state.hiddenPaths.includes(path)
        ? this.state.hiddenPaths.filter((entry) => entry !== path)
        : [...this.state.hiddenPaths, path]
      const status: ProjectStatus = project?.status === 'hidden' ? 'unknown' : 'hidden'
      const next = {
        ...this.state,
        hiddenPaths,
        snapshot: {
          ...this.state.snapshot,
          projects: this.state.snapshot.projects.map((entry) =>
            entry.path === path ? { ...entry, status } : entry
          )
        }
      }
      await this.save(next)
    },

    async toggleThirdParty(path: string) {
      const thirdPartyPaths = this.state.thirdPartyPaths.includes(path)
        ? this.state.thirdPartyPaths.filter((entry) => entry !== path)
        : [...this.state.thirdPartyPaths, path]
      await this.save({ ...this.state, thirdPartyPaths })
    },

    async openShell(path: string) {
      try {
        const result = await projectTrackerApi.openProjectShell(path)
        this.notice = result.fallbackCommand
          ? `Terminal could not be opened. Copied ${result.fallbackCommand} to the clipboard.`
          : 'Opening Terminal.'
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
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
