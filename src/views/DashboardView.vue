<script setup lang="ts">
import DOMPurify from 'dompurify'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import OpenInPicker from '@/components/OpenInPicker.vue'
import ProjectToolbar from '@/components/ProjectToolbar.vue'
import ThemePicker from '@/components/ThemePicker.vue'
import { useOpenInStore } from '@/stores/openIn'
import { useProjectsStore } from '@/stores/projects'
import type { ProjectPriority, ProjectRecord, ProjectStatus } from '@/shared/projectTypes'

type MetricFilter = 'total' | 'visible' | 'active' | 'ongoing' | 'completed' | 'high' | 'thirdparty' | 'hidden' | null
type ProjectTab = 'details' | 'readme'
type SortField = 'name' | 'status' | 'priority'
type SortDirection = 'asc' | 'desc'

const store = useProjectsStore()
const openInStore = useOpenInStore()
const onboardingPath = ref('')
const onboardingSkipped = ref(false)
const onboardingOpen = computed(() => store.isFirstLaunch && !onboardingSkipped.value)
const query = ref('')
const selectedStatuses = ref<ProjectStatus[]>([])
const selectedPriorities = ref<ProjectPriority[]>([])
const activeMetric = ref<MetricFilter>(null)
const showDirs = ref(false)
const expandedProjectPath = ref<string | null>(null)
const activeTabs = ref<Record<string, ProjectTab>>({})
const sortField = ref<SortField>('priority')
const sortDirection = ref<SortDirection>('desc')

const statusOptions: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'unknown', label: 'Unknown' }
]

const priorityOptions: Array<{ value: ProjectPriority; label: string }> = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' }
]

const statusRank: Record<ProjectStatus, number> = {
  active: 6,
  ongoing: 5,
  paused: 4,
  completed: 3,
  archived: 2,
  hidden: 1,
  unknown: 0
}

const priorityRank: Record<ProjectPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0
}

const isProjectHidden = (project: ProjectRecord) =>
  project.status === 'hidden' || store.state.hiddenPaths.includes(project.path)

const isProjectThirdParty = (project: ProjectRecord) =>
  store.state.thirdPartyPaths.includes(project.path)

const getProjectDisplayName = (project: ProjectRecord) => {
  const scanDirectory = [...store.state.scanDirectories]
    .sort((a, b) => b.length - a.length)
    .find((directory) => project.path === directory || project.path.startsWith(`${directory}/`))

  if (!scanDirectory) return project.name
  const relativePath = project.path.slice(scanDirectory.length).replace(/^\//, '')
  return relativePath.includes('/') ? relativePath : project.name
}

const filteredProjects = computed(() =>
  store.projects.filter((project) => {
    const text = `${getProjectDisplayName(project)} ${project.name} ${project.path} ${project.notes}`.toLowerCase()
    const matchesQuery = text.includes(query.value.toLowerCase())
    const matchesStatus =
      selectedStatuses.value.length === 0 || selectedStatuses.value.includes(project.status)
    const matchesPriority =
      selectedPriorities.value.length === 0 || selectedPriorities.value.includes(project.priority)
    const matchesMetric = activeMetric.value !== 'thirdparty' || isProjectThirdParty(project)
    const shouldShowHidden = selectedStatuses.value.includes('hidden')
    return (
      matchesQuery && matchesStatus && matchesPriority && matchesMetric && (shouldShowHidden || !isProjectHidden(project))
    )
  })
)

const sortedProjects = computed(() => {
  const direction = sortDirection.value === 'asc' ? 1 : -1
  return [...filteredProjects.value].sort((a, b) => {
    let comparison = 0

    if (sortField.value === 'name') {
      comparison = getProjectDisplayName(a).localeCompare(getProjectDisplayName(b))
    } else if (sortField.value === 'status') {
      comparison = statusRank[a.status] - statusRank[b.status]
    } else {
      comparison = priorityRank[a.priority] - priorityRank[b.priority]
    }

    if (comparison === 0) comparison = getProjectDisplayName(a).localeCompare(getProjectDisplayName(b))
    return comparison * direction
  })
})

const displayProjects = computed(() => {
  const projects = [...sortedProjects.value]
  const expandedIndex = projects.findIndex((project) => project.path === expandedProjectPath.value)
  if (expandedIndex > 0 && expandedIndex % 2 === 1) {
    const expanded = projects[expandedIndex]
    projects.splice(expandedIndex, 1)
    projects.splice(expandedIndex - 1, 0, expanded)
  }
  return projects
})

const counts = computed(() => ({
  total: store.projects.length,
  visible: store.projects.filter((project) => !isProjectHidden(project)).length,
  high: store.projects.filter((project) => project.priority === 'high' && !isProjectHidden(project)).length,
  active: store.projects.filter((project) => project.status === 'active').length,
  ongoing: store.projects.filter((project) => project.status === 'ongoing').length,
  completed: store.projects.filter((project) => project.status === 'completed').length,
  thirdParty: store.projects.filter((project) => isProjectThirdParty(project) && !isProjectHidden(project)).length,
  hidden: store.projects.filter(isProjectHidden).length
}))

const hasActiveFilters = computed(
  () =>
    query.value.length > 0 ||
    selectedStatuses.value.length > 0 ||
    selectedPriorities.value.length > 0 ||
    activeMetric.value !== null
)
const isSortFieldActive = computed(() => sortField.value !== 'priority')
const isSortDirectionActive = computed(() => sortDirection.value !== 'desc')

onMounted(() => {
  void store.load()
  window.addEventListener('keydown', handleEscapeKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscapeKey)
})

const setMetricFilter = (metric: Exclude<MetricFilter, null>) => {
  activeMetric.value = activeMetric.value === metric ? null : metric

  if (
    !activeMetric.value ||
    activeMetric.value === 'total' ||
    activeMetric.value === 'visible' ||
    activeMetric.value === 'thirdparty'
  ) {
    selectedStatuses.value = []
    selectedPriorities.value = []
    return
  }

  if (activeMetric.value === 'high') {
    selectedStatuses.value = []
    selectedPriorities.value = ['high']
    return
  }

  selectedPriorities.value = []
  selectedStatuses.value = [activeMetric.value]
}

const clearFilters = () => {
  query.value = ''
  selectedStatuses.value = []
  selectedPriorities.value = []
  activeMetric.value = null
}

const clearMetricFilter = () => {
  activeMetric.value = null
}

const handleEscapeKey = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  if (expandedProjectPath.value) {
    expandedProjectPath.value = null
    event.preventDefault()
  }
}

const pickOnboardingPath = async () => {
  const selected = await store.pickDirectory()
  if (selected) onboardingPath.value = selected
}

const startFirstScan = async () => {
  if (!onboardingPath.value) return
  const ok = await store.scan(onboardingPath.value, { requireProjects: true })
  if (ok) onboardingSkipped.value = true
}

const addScanDirectory = async () => {
  const selected = await store.pickDirectory()
  if (!selected) return
  await store.addScanDirectory(selected)
  await store.scan()
}

const rescan = () => {
  void store.scan()
}

const updateNotes = (project: ProjectRecord, event: Event) => {
  const notes = (event.target as HTMLTextAreaElement).value
  void store.setNotes(project.path, notes)
}

const toggleProject = (project: ProjectRecord) => {
  expandedProjectPath.value = expandedProjectPath.value === project.path ? null : project.path
  activeTabs.value[project.path] ??= 'details'
}

const selectTab = (project: ProjectRecord, tab: ProjectTab) => {
  activeTabs.value[project.path] = tab
  if (tab === 'readme') void store.loadReadme(project.path)
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

const renderInlineMarkdown = (value: string) =>
  escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')

const renderMarkdown = (markdown: string | null) => {
  if (!markdown) return ''
  const lines = markdown.split(/\r?\n/)
  const html: string[] = []
  let inCode = false
  let listOpen = false

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        html.push('</code></pre>')
      } else {
        if (listOpen) {
          html.push('</ul>')
          listOpen = false
        }
        html.push('<pre><code>')
      }
      inCode = !inCode
      continue
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`)
      continue
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      if (listOpen) {
        html.push('</ul>')
        listOpen = false
      }
      html.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`)
      continue
    }

    const listItem = /^[-*]\s+(.*)$/.exec(line)
    if (listItem) {
      if (!listOpen) {
        html.push('<ul>')
        listOpen = true
      }
      html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`)
      continue
    }

    if (line.trim() === '') {
      if (listOpen) {
        html.push('</ul>')
        listOpen = false
      }
      continue
    }

    if (listOpen) {
      html.push('</ul>')
      listOpen = false
    }
    html.push(`<p>${renderInlineMarkdown(line)}</p>`)
  }

  if (listOpen) html.push('</ul>')
  if (inCode) html.push('</code></pre>')
  return DOMPurify.sanitize(html.join(''))
}
</script>

<template>
  <main class="app-shell">
    <section class="topbar">
      <div>
        <p class="eyebrow">Project Tracker</p>
        <h1>Local projects</h1>
      </div>
      <div class="topbar-actions">
        <OpenInPicker />
        <ThemePicker />
        <button class="secondary" :disabled="store.scanning" @click="addScanDirectory">Add</button>
        <button class="secondary" @click="showDirs = !showDirs">Dirs</button>
        <button :disabled="store.scanning || store.state.scanDirectories.length === 0" @click="rescan">
          {{ store.scanning ? 'Scanning...' : 'Scan' }}
        </button>
      </div>
    </section>

    <section v-if="showDirs" class="scan-paths">
      <h2>Scan directories</h2>
      <div v-if="store.state.scanDirectories.length" class="path-list">
        <code v-for="directory in store.state.scanDirectories" :key="directory">{{ directory }}</code>
      </div>
      <p v-else>No scan directories selected.</p>
    </section>

    <section v-if="store.error || store.notice" class="message-row">
      <div v-if="store.error" class="message error">{{ store.error }}</div>
      <div v-if="store.notice" class="message notice">{{ store.notice }}</div>
    </section>

    <section class="metrics">
      <button class="metric" :class="{ selected: activeMetric === 'total' }" @click="setMetricFilter('total')">
        <span>Total</span>
        <strong>{{ counts.total }}</strong>
      </button>
      <button class="metric" :class="{ selected: activeMetric === 'visible' }" @click="setMetricFilter('visible')">
        <span>Visible</span>
        <strong>{{ counts.visible }}</strong>
      </button>
      <button class="metric" :class="{ selected: activeMetric === 'active' }" @click="setMetricFilter('active')">
        <span>Active</span>
        <strong>{{ counts.active }}</strong>
      </button>
      <button class="metric" :class="{ selected: activeMetric === 'ongoing' }" @click="setMetricFilter('ongoing')">
        <span>Ongoing</span>
        <strong>{{ counts.ongoing }}</strong>
      </button>
      <button class="metric" :class="{ selected: activeMetric === 'completed' }" @click="setMetricFilter('completed')">
        <span>Completed</span>
        <strong>{{ counts.completed }}</strong>
      </button>
      <button class="metric" :class="{ selected: activeMetric === 'high' }" @click="setMetricFilter('high')">
        <span>High Priority</span>
        <strong>{{ counts.high }}</strong>
      </button>
      <button class="metric" :class="{ selected: activeMetric === 'thirdparty' }" @click="setMetricFilter('thirdparty')">
        <span>Third Party</span>
        <strong>{{ counts.thirdParty }}</strong>
      </button>
      <button class="metric" :class="{ selected: activeMetric === 'hidden' }" @click="setMetricFilter('hidden')">
        <span>Hidden</span>
        <strong>{{ counts.hidden }}</strong>
      </button>
    </section>

    <ProjectToolbar
      v-model:query="query"
      v-model:selected-statuses="selectedStatuses"
      v-model:selected-priorities="selectedPriorities"
      v-model:sort-field="sortField"
      v-model:sort-direction="sortDirection"
      :status-options="statusOptions"
      :priority-options="priorityOptions"
      :has-active-filters="hasActiveFilters"
      :is-sort-field-active="isSortFieldActive"
      :is-sort-direction-active="isSortDirectionActive"
      @clear-filters="clearFilters"
      @filter-changed="clearMetricFilter"
    />

    <section class="project-list" aria-label="Project list">
      <article
        v-for="project in displayProjects"
        :key="project.path"
        class="project-card"
        :class="{ expanded: expandedProjectPath === project.path }"
        @click="toggleProject(project)"
      >
        <div class="project-heading">
          <div>
            <h2>{{ getProjectDisplayName(project) }}</h2>
            <code>{{ project.path }}</code>
          </div>
          <button
            class="icon-button"
            :title="`Open in ${openInStore.selectedTarget.label}`"
            @click.stop="store.openIn(project.path, openInStore.selectedId)"
          >
            ⌁
          </button>
        </div>

        <div class="project-meta">
          <span>{{ project.source }}</span>
          <span>{{ project.status }}</span>
          <span>{{ project.priority }} priority</span>
          <span v-if="project.packageManager">{{ project.packageManager }}</span>
          <span v-if="project.hasGit">git</span>
          <span v-if="project.hasPackageJson">package.json</span>
          <span v-if="project.hasReadme">readme</span>
        </div>

        <template v-if="expandedProjectPath === project.path">
          <div class="tabs" @click.stop>
            <button
              class="tab-button"
              :class="{ selected: activeTabs[project.path] !== 'readme' }"
              @click="selectTab(project, 'details')"
            >
              Details
            </button>
            <button
              class="tab-button"
              :class="{ selected: activeTabs[project.path] === 'readme' }"
              @click="selectTab(project, 'readme')"
            >
              README
            </button>
          </div>

          <div v-if="activeTabs[project.path] !== 'readme'" class="tab-panel" @click.stop>
            <div class="project-controls">
              <label>
                Status
                <select :value="project.status" @change="store.setStatus(project.path, ($event.target as HTMLSelectElement).value as ProjectStatus)">
                  <option v-for="option in statusOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label>
                Priority
                <select :value="project.priority" @change="store.setPriority(project.path, ($event.target as HTMLSelectElement).value as ProjectPriority)">
                  <option v-for="option in priorityOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </div>

            <div v-if="project.githubUrl" class="project-links">
              <a :href="project.githubUrl" target="_blank" rel="noreferrer">GitHub repository</a>
            </div>

            <textarea :value="project.notes" placeholder="Notes" @change="updateNotes(project, $event)" />

            <div class="project-actions">
              <label>
                <input
                  type="checkbox"
                  :checked="store.state.thirdPartyPaths.includes(project.path)"
                  @change="store.toggleThirdParty(project.path)"
                />
                Third-party
              </label>
              <label>
                <input
                  type="checkbox"
                  :checked="isProjectHidden(project)"
                  @change="store.toggleHidden(project.path)"
                />
                Hidden
              </label>
            </div>
          </div>

          <div v-else class="tab-panel readme-panel" @click.stop>
            <p v-if="store.readmes[project.path]?.loading">Loading README...</p>
            <p v-else-if="store.readmes[project.path]?.error" class="readme-error">
              {{ store.readmes[project.path].error }}
            </p>
            <p v-else-if="!store.readmes[project.path]?.content">No README found.</p>
            <div v-else>
              <p class="readme-file">{{ store.readmes[project.path].fileName }}</p>
              <div class="markdown-body" v-html="renderMarkdown(store.readmes[project.path].content)" />
            </div>
          </div>
        </template>
      </article>

      <div v-if="!filteredProjects.length" class="empty-state">
        <h2>No projects match the current view.</h2>
        <p>Adjust filters or add another scan directory.</p>
      </div>
    </section>

    <section v-if="store.state.snapshot.failures.length" class="failures">
      <h2>Scan issues</h2>
      <div v-for="failure in store.state.snapshot.failures" :key="`${failure.path}-${failure.message}`">
        <code>{{ failure.path }}</code>
        <span>{{ failure.message }}</span>
      </div>
    </section>

    <div v-if="onboardingOpen" class="modal-backdrop">
      <section class="modal">
        <p class="eyebrow">First launch</p>
        <h2>Choose your projects folder</h2>
        <p>Select the folder where your local projects live. You can skip this and use the seed snapshot until you scan.</p>
        <div class="path-picker">
          <input v-model="onboardingPath" placeholder="/Users/you/Code" />
          <button class="secondary" @click="pickOnboardingPath">Browse</button>
        </div>
        <div class="modal-actions">
          <button class="secondary" @click="onboardingSkipped = true">Skip</button>
          <button :disabled="!onboardingPath || store.scanning" @click="startFirstScan">
            {{ store.scanning ? 'Scanning...' : 'Scan Folder' }}
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
