<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { ticketModalExpanded, vEdgeResize } from '@/modalWidth'
import ExpandToggle from '@/components/ExpandToggle.vue'
import ModelField from '@/components/ModelField.vue'
import InfoTip from '@/components/InfoTip.vue'
import EyeOffIcon from '@/components/icons/EyeOffIcon.vue'
import { projectTrackerApi } from '@/services/projectTrackerApi'
import {
  addChecklistItem,
  addExternalLink,
  agentForTicket,
  boardLaneById,
  canResume,
  checklistProgress,
  effectiveNextLaneId,
  findAgent,
  formatLabels,
  githubErrorMessage,
  isWebUrl,
  moveRulesList,
  normalizeSemanticVersion,
  parseLabels,
  pullRequestLabel,
  pullRequestStatusLabel,
  removeChecklistItem,
  removeExternalLink,
  setChecklistItemDone,
  ticketAgentPrompt,
  ticketShellCommand,
  ticketTabTitle,
  toggleModalField,
  TICKET_MODAL_FIELDS,
  UNASSIGNED_LANE_ID,
  UNASSIGNED_LANE_NAME,
  type Ticket,
  type TicketModalField,
  type TicketPatch
} from '@/shared/projectTypes'
import { useBackdropPress } from './backdropPress'
import { useBoardContext } from './boardContext'
import {
  formatDate,
  formatDateTime,
  imageFilesOf,
  ipcErrorMessage,
  isTextFieldPaste,
  trimmedInputValue
} from './boardFormat'
import { attachImages, editTicketImages, saveImageFiles } from './ticketImages'

const props = defineProps<{
  ticket: Ticket
  boardView: 'lanes' | 'graph'
  // An upload that failed while the new-ticket draft saved: shown on the ticket it belongs to.
  initialImageError?: string | null
}>()
const emit = defineEmits<{ close: []; delete: [ticket: Ticket] }>()

const {
  store,
  openInStore,
  projectPath,
  project,
  board,
  users,
  agents,
  preferences,
  savePreferences,
  laneName,
  laneNextLaneId,
  nextLaneOptionsFor,
  laneOfTicket,
  promptContext
} = useBoardContext()
const { notePressTarget, closeIfPressStartedOnBackdrop } = useBackdropPress()

const githubUrl = computed(() => project.value?.githubUrl)

const checklistDraft = ref('')
const linkDraft = ref('')
const linkDraftInvalid = ref(false)
const linkInput = ref<HTMLInputElement | null>(null)
const imageError = ref<string | null>(props.initialImageError ?? null)
const modalFieldsMenuOpen = ref(false)

// Display-only: ticketAgentPrompt never reads preferences, so hidden fields still reach the agent.
const hidesModalField = (field: TicketModalField) => preferences.value.hiddenModalFields.includes(field)
const toggleModalFieldVisibility = (field: TicketModalField) =>
  savePreferences(toggleModalField(preferences.value, field))

const modalFieldsMenuRef = ref<HTMLElement | null>(null)
const closeModalFieldsMenuOnOutsideClick = (event: PointerEvent) => {
  if (modalFieldsMenuRef.value?.contains(event.target as Node)) return
  modalFieldsMenuOpen.value = false
}
onMounted(() => window.addEventListener('pointerdown', closeModalFieldsMenuOnOutsideClick))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeModalFieldsMenuOnOutsideClick))

// Fields save on change, so Cancel can't just drop a draft. Instead each field
// keeps the value it held just before its first edit this session. Captured at
// edit time, not on open, so a write that lands from elsewhere (a background
// run, an agent, a drag) before the user touches that field is never undone.
// A field that was unset keeps its key as undefined, which clears it on restore.
const valuesBeforeEdit = new Map<keyof TicketPatch, unknown>()

const rememberValuesBeforeEdit = (ticket: Ticket, patch: TicketPatch) => {
  const editedFields = Object.keys(patch) as (keyof TicketPatch)[]
  for (const field of editedFields) {
    if (valuesBeforeEdit.has(field)) continue
    const currentValue = toRaw(ticket[field])
    valuesBeforeEdit.set(field, structuredClone(currentValue))
  }
}

const cancelTicketEdits = () => {
  const ticketId = props.ticket.id
  const restorePatch: TicketPatch = Object.fromEntries(valuesBeforeEdit)
  emit('close')
  if (valuesBeforeEdit.size > 0) void store.updateTicket(projectPath.value, ticketId, restorePatch)
}

const editTicket = (ticket: Ticket, patch: TicketPatch) => {
  const editsOpenTicket = ticket.id === props.ticket.id
  if (editsOpenTicket) rememberValuesBeforeEdit(ticket, patch)
  void store.updateTicket(projectPath.value, ticket.id, patch)
}

const editTicketLabels = (ticket: Ticket, value: string) => editTicket(ticket, { labels: parseLabels(value) })

const pullRequestRefreshing = ref(false)
const pullRequestError = ref<string | null>(null)

const refreshOpenTicketPullRequest = async () => {
  pullRequestRefreshing.value = true
  pullRequestError.value = null
  try {
    await store.refreshPullRequest(projectPath.value, props.ticket)
  } catch (error) {
    pullRequestError.value = githubErrorMessage(error)
  } finally {
    pullRequestRefreshing.value = false
  }
}

const versionInvalid = ref(false)

// An invalid value is kept in the input with an error instead of being saved.
// A valid one is written back so "v1.4.0" shows as the "1.4.0" it saved as,
// even when that equals the stored value and Vue sees nothing to re-render.
const editTicketVersion = (ticket: Ticket, input: HTMLInputElement) => {
  const version = normalizeSemanticVersion(input.value)
  versionInvalid.value = version === null
  if (version === null) return
  input.value = version ?? ''
  editTicket(ticket, { version })
}

// A version written from outside (an agent's sqlite3 UPDATE) replaces whatever
// invalid text the error was about.
watch(() => props.ticket.version, () => {
  versionInvalid.value = false
})

// Drafts, errors and the cancel snapshot belong to the ticket they were made
// on, not the next one opened. Immediate: opening a ticket refreshes its PR.
watch(
  () => props.ticket.id,
  (_ticketId, previousTicketId) => {
    if (previousTicketId !== undefined) {
      imageError.value = props.initialImageError ?? null
      checklistDraft.value = ''
      linkDraft.value = ''
      linkDraftInvalid.value = false
    }
    modalFieldsMenuOpen.value = false
    valuesBeforeEdit.clear()
    pullRequestError.value = null
    versionInvalid.value = false
    void refreshOpenTicketPullRequest()
  },
  { immediate: true }
)

// A new URL points at a different PR, so the cached state is dropped rather
// than shown against it until the refresh lands.
const overridePullRequestUrl = async (ticket: Ticket, rawUrl: string) => {
  await store.updateTicket(projectPath.value, ticket.id, {
    pullRequestUrl: rawUrl.trim() || undefined,
    pullRequestState: undefined,
    pullRequestMergedAt: undefined
  })
  await refreshOpenTicketPullRequest()
}

const addChecklistDraft = (ticket: Ticket) => {
  const text = checklistDraft.value.trim()
  if (!text) return
  checklistDraft.value = ''
  editTicket(ticket, { checklist: addChecklistItem(ticket.checklist, text) })
}

const toggleChecklistItem = (ticket: Ticket, index: number, done: boolean) =>
  editTicket(ticket, { checklist: setChecklistItemDone(ticket.checklist, index, done) })

const dropChecklistItem = (ticket: Ticket, index: number) =>
  editTicket(ticket, { checklist: removeChecklistItem(ticket.checklist, index) })

// Invalid input keeps its text so it can be fixed; a duplicate clears, since
// that link is already listed above.
const addLinkDraft = (ticket: Ticket) => {
  const url = linkDraft.value.trim()
  if (!url) return
  linkInput.value?.focus()
  if (!isWebUrl(url)) {
    linkDraftInvalid.value = true
    return
  }
  linkDraft.value = ''
  const isAlreadyListed = ticket.externalLinks?.includes(url)
  if (!isAlreadyListed) editTicketLinks(ticket, (links) => addExternalLink(links, url))
}

const dropExternalLink = (ticket: Ticket, link: string) =>
  editTicketLinks(ticket, (links = []) => removeExternalLink(links, links.indexOf(link)))

// Store state only refreshes after the IPC save returns, so the new list is
// computed inside the queued mutate from the latest saved links: two quick
// adds or removes in a row would otherwise overwrite each other.
const editTicketLinks = (ticket: Ticket, change: (links?: string[]) => string[]) => {
  const updatedAt = new Date().toISOString()
  void store.updateBoard(projectPath.value, (board) => ({
    ...board,
    tickets: board.tickets.map((current) => {
      if (current.id !== ticket.id) return current
      const links = change(current.externalLinks)
      return { ...current, externalLinks: links.length ? links : undefined, updatedAt }
    })
  }))
}

const ticketImageUrl = (imagePath: string) => projectTrackerApi.ticketImageUrl(imagePath)

// A later success must not wipe an error another image action raised meanwhile.
const showImageResult = async (saving: Promise<string | null>) => {
  imageError.value = null
  const savingError = await saving
  if (savingError) imageError.value = savingError
}

const pickTicketImages = (ticket: Ticket) =>
  showImageResult(attachImages(projectPath.value, ticket, [projectTrackerApi.pickTicketImages(ticket.id)]))

const pasteTicketImages = (ticket: Ticket, event: ClipboardEvent) => {
  if (isTextFieldPaste(event)) return
  const files = imageFilesOf(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  void showImageResult(saveImageFiles(projectPath.value, ticket, files))
}

const dropTicketImages = (ticket: Ticket, event: DragEvent) => {
  const files = imageFilesOf(event.dataTransfer)
  if (files.length) void showImageResult(saveImageFiles(projectPath.value, ticket, files))
}

// The ticket stops listing the image before its file goes.
const removeTicketImage = async (ticket: Ticket, imagePath: string) => {
  imageError.value = null
  try {
    await editTicketImages(projectPath.value, ticket, (images) => images.filter((existingPath) => existingPath !== imagePath))
    await projectTrackerApi.removeTicketImage(ticket.id, imagePath)
  } catch (error) {
    imageError.value = ipcErrorMessage(error)
  }
}

const openTicketImage = (imagePath: string) =>
  projectTrackerApi.openTicketImage(imagePath).catch((error) => {
    imageError.value = ipcErrorMessage(error)
  })

const openTicketNextLaneId = computed(() =>
  effectiveNextLaneId(props.ticket, boardLaneById(board.value, props.ticket.laneId))
)

// '' = inherit. A stale override naming the ticket's own lane shows as inherit
// too, matching how effectiveNextLaneId resolves it.
const openTicketOverrideId = computed(() => {
  const ticket = props.ticket
  if (!ticket.moveToLaneId || ticket.moveToLaneId === ticket.laneId) return ''
  return ticket.moveToLaneId
})

const showsWhoRunsIt = computed(
  () => !hidesModalField('agent') || !hidesModalField('model') || !hidesModalField('fullAuto')
)
const showsMoveRules = computed(() => Boolean(openTicketNextLaneId.value || props.ticket.moveRules))
const showsWhenItsDone = computed(() => !hidesModalField('nextLane') || showsMoveRules.value)

const openTicketLaneDefaultLabel = computed(() => {
  const laneDefaultId = laneNextLaneId(props.ticket.laneId)
  return laneDefaultId ? `Lane default: ${laneName(laneDefaultId)}` : 'None'
})

// Picking a lane arms it — the checkbox starts ticked. Picking the lane default
// (or the lane it already inherits) drops the override, so the ticket follows
// later changes to its lane's Next Lane; it stays armed only if there is one.
const setMoveToLane = (ticket: Ticket, laneId: string) => {
  const laneDefaultId = laneNextLaneId(ticket.laneId)
  const overridesLaneDefault = laneId !== '' && laneId !== laneDefaultId
  if (overridesLaneDefault) {
    editTicket(ticket, { moveToLaneId: laneId, moveOnComplete: true })
    return
  }
  editTicket(ticket, { moveToLaneId: undefined, moveOnComplete: Boolean(laneDefaultId) })
}

const ticketCommand = (ticket: Ticket) => {
  const agent = agentForTicket(ticket, agents.value)
  return ticketShellCommand(ticket, laneOfTicket(ticket), agent, promptContext(ticket), ticket.model)
}

const openTicketInShell = (ticket: Ticket) => {
  const command = ticketCommand(ticket)
  const tabTitle = ticketTabTitle(ticket, laneOfTicket(ticket))
  return store.openIn(projectPath.value, openInStore.selectedId, command, tabTitle)
}

// Watching the open ticket (not the card click) also covers opening from the
// graph view, and a run that finishes while its modal is already open.
// Only unseen runs are written, so reopening a ticket doesn't touch it.
watch(
  () => props.ticket.agentRun,
  (agentRun) => {
    const ticket = props.ticket
    if (!agentRun || agentRun.seenAt !== undefined) return
    void store.markAgentRunSeen(projectPath.value, ticket.id, agentRun.at)
  },
  { immediate: true }
)

// The run's own agent, not the ticket's current pick: only the CLI that
// started a session can resume it.
const ticketCanResume = (ticket: Ticket) => {
  const runAgent = findAgent(agents.value, ticket.agentRun?.agentId ?? ticket.agentId)
  return canResume(ticket, runAgent)
}

const resumeTicketAgent = (ticket: Ticket) => void store.resumeTicketAgent(projectPath.value, ticket)

const runTicketAgent = (ticket: Ticket) => {
  const agent = agentForTicket(ticket, agents.value)
  const prompt = ticketAgentPrompt(ticket, laneOfTicket(ticket), promptContext(ticket))
  void store.runTicketAgent(projectPath.value, ticket, agent.id, prompt)
}

// Like the delete confirm: Escape closes the fields menu, not the modal under it.
// BoardView's single Escape handler calls this at its place in the order.
defineExpose({
  closeMenuOnEscape: () => {
    if (!modalFieldsMenuOpen.value) return false
    modalFieldsMenuOpen.value = false
    return true
  }
})
</script>

<template>
  <div class="modal-backdrop" :class="{ 'graph-ticket-panel': boardView === 'graph' }" @pointerdown="notePressTarget" @click.self="closeIfPressStartedOnBackdrop(() => emit('close'))">
    <!-- Refresh before editing so fields include writes from other processes. -->
    <section
      v-edge-resize
      class="modal ticket-modal"
      :class="{ expanded: ticketModalExpanded && boardView !== 'graph', resizable: boardView !== 'graph' }"
      @focusin="store.refresh()"
      @paste="pasteTicketImages(ticket, $event)"
    >
      <div class="ticket-modal-header">
        <p class="eyebrow">
          #{{ ticket.number }} · Created {{ formatDate(ticket.createdAt) }}
          <template v-if="ticket.updatedAt"> · Updated {{ formatDateTime(ticket.updatedAt) }}</template>
        </p>
        <div ref="modalFieldsMenuRef" class="filter-menu">
          <button
            type="button"
            class="icon-button"
            title="Ticket fields"
            aria-label="Ticket fields"
            aria-haspopup="true"
            :aria-expanded="modalFieldsMenuOpen"
            @click="modalFieldsMenuOpen = !modalFieldsMenuOpen"
          >
            <EyeOffIcon />
          </button>
          <div v-if="modalFieldsMenuOpen" class="filter-popover" role="group" aria-label="Shown ticket fields">
            <label v-for="field in TICKET_MODAL_FIELDS" :key="field.id">
              <input
                type="checkbox"
                :checked="!hidesModalField(field.id)"
                @change="toggleModalFieldVisibility(field.id)"
              />
              <span>{{ field.label }}</span>
            </label>
          </div>
        </div>
        <ExpandToggle v-if="boardView !== 'graph'" v-model="ticketModalExpanded" />
      </div>
      <input
        class="ticket-title-input"
        :value="ticket.title"
        @change="editTicket(ticket, { title: ($event.target as HTMLInputElement).value })"
      />

      <label v-if="!hidesModalField('status')">
        Status
        <select
          :value="ticket.laneId"
          @change="editTicket(ticket, { laneId: ($event.target as HTMLSelectElement).value })"
        >
          <option :value="UNASSIGNED_LANE_ID">{{ UNASSIGNED_LANE_NAME }}</option>
          <option v-for="lane in board.lanes" :key="lane.id" :value="lane.id">{{ lane.name }}</option>
        </select>
      </label>

      <label v-if="!hidesModalField('assignee')">
        Assignee
        <select
          :value="ticket.assigneeId ?? ''"
          @change="
            editTicket(ticket, {
              assigneeId: ($event.target as HTMLSelectElement).value || undefined
            })
          "
        >
          <option value="">Unassigned</option>
          <option v-for="user in users" :key="user.id" :value="user.id">{{ user.name }}</option>
        </select>
      </label>

      <label v-if="!hidesModalField('description')">
        Description
        <textarea
          :value="ticket.description"
          placeholder="Details, acceptance criteria, links..."
          @change="editTicket(ticket, { description: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>

      <label v-if="!hidesModalField('labels')">
        Labels
        <input
          :value="formatLabels(ticket.labels)"
          placeholder="bug, ui, needs-design"
          @change="editTicketLabels(ticket, ($event.target as HTMLInputElement).value)"
        />
        <span class="field-hint">Comma separated. Searchable from the filter box.</span>
      </label>

      <label v-if="!hidesModalField('branch')">
        Branch
        <input
          class="agent-file-path"
          :value="ticket.branchName ?? ''"
          placeholder="feat/board-ticket-fields"
          @change="editTicket(ticket, { branchName: trimmedInputValue($event) })"
        />
      </label>

      <label v-if="!hidesModalField('worktree')">
        Worktree
        <input
          class="agent-file-path"
          :value="ticket.worktreePath ?? ''"
          placeholder="/Users/me/Code/my-app-board-ticket-fields"
          @change="
            editTicket(ticket, { worktreePath: trimmedInputValue($event) })
          "
        />
      </label>

      <label v-if="!hidesModalField('version')">
        Version
        <input
          class="agent-file-path"
          :value="ticket.version ?? ''"
          placeholder="1.4.0"
          @change="editTicketVersion(ticket, $event.target as HTMLInputElement)"
        />
        <span v-if="versionInvalid" class="field-hint field-error">Use MAJOR.MINOR.PATCH, like 1.4.0</span>
      </label>

      <section v-if="!hidesModalField('pullRequest')" class="ticket-pull-request">
        <p class="eyebrow">Merge Request</p>
        <p class="pull-request-status">
          <span class="pull-request-pill" :data-state="ticket.pullRequestState ?? 'none'">
            {{ pullRequestStatusLabel(ticket.pullRequestState) }}
          </span>
          <span v-if="ticket.pullRequestState === 'merged' && ticket.pullRequestMergedAt" class="field-hint">
            Merged {{ formatDateTime(ticket.pullRequestMergedAt) }}
          </span>
          <a v-if="isWebUrl(ticket.pullRequestUrl)" :href="ticket.pullRequestUrl" target="_blank">
            {{ pullRequestLabel(ticket.pullRequestUrl) }} ↗
          </a>
          <button
            class="icon-button"
            title="Refresh from GitHub"
            :disabled="pullRequestRefreshing || !githubUrl"
            @click="refreshOpenTicketPullRequest"
          >
            ↻
          </button>
        </p>
        <span v-if="pullRequestError" class="field-hint field-error">{{ pullRequestError }}</span>
        <label>
          PR URL override
          <input
            type="url"
            class="agent-file-path"
            :value="ticket.pullRequestUrl ?? ''"
            placeholder="Found from the branch; paste https://github.com/owner/repo/pull/123 to override"
            @change="overridePullRequestUrl(ticket, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </section>

      <section v-if="!hidesModalField('externalLinks')" class="ticket-checklist ticket-links">
        <p class="eyebrow">External Links</p>
        <a v-if="ticket.externalUrl" class="ticket-external" :href="ticket.externalUrl" target="_blank" rel="noreferrer">
          View on GitHub ({{ ticket.externalId?.replace('github:', '#') }})
        </a>
        <ul v-if="ticket.externalLinks?.length">
          <li v-for="(link, index) in ticket.externalLinks" :key="index">
            <a v-if="isWebUrl(link)" :href="link" :title="link" target="_blank" rel="noreferrer">{{ link }}</a>
            <span v-else :title="link">{{ link }}</span>
            <button class="icon-button" title="Remove link" @click="dropExternalLink(ticket, link)">×</button>
          </li>
        </ul>
        <div class="ticket-links-add">
          <input
            ref="linkInput"
            v-model="linkDraft"
            type="url"
            placeholder="https://…"
            @input="linkDraftInvalid = false"
            @keyup.enter="addLinkDraft(ticket)"
          />
          <button type="button" @click="addLinkDraft(ticket)">Add</button>
        </div>
        <span v-if="linkDraftInvalid" class="field-hint field-error">Use an http(s) URL</span>
      </section>

      <section
        v-if="!hidesModalField('images') || imageError"
        class="ticket-images"
        @dragover.prevent
        @drop.prevent="dropTicketImages(ticket, $event)"
      >
        <p class="eyebrow">Images</p>
        <button type="button" class="image-dropzone" @click="pickTicketImages(ticket)">
          <span>Drag or paste images here</span>
          <span class="image-dropzone-plus" aria-hidden="true">+</span>
        </button>
        <ul v-if="ticket.images?.length">
          <li v-for="imagePath in ticket.images" :key="imagePath">
            <button type="button" class="ticket-image-thumb" :title="imagePath" @click="openTicketImage(imagePath)">
              <img :src="ticketImageUrl(imagePath)" alt="Attached image" loading="lazy" decoding="async" />
            </button>
            <button class="icon-button" title="Remove image" @click="removeTicketImage(ticket, imagePath)">×</button>
          </li>
        </ul>
        <span v-if="imageError" class="field-hint field-error">{{ imageError }}</span>
      </section>

      <section v-if="!hidesModalField('checklist')" class="ticket-checklist">
        <p class="eyebrow">
          Checklist
          <span v-if="ticket.checklist?.length">
            {{ checklistProgress(ticket.checklist).done }}/{{ checklistProgress(ticket.checklist).total }}
          </span>
        </p>
        <ul v-if="ticket.checklist?.length">
          <li v-for="(item, index) in ticket.checklist" :key="index">
            <input
              type="checkbox"
              :checked="item.done"
              @change="toggleChecklistItem(ticket, index, ($event.target as HTMLInputElement).checked)"
            />
            <span :class="{ 'checklist-done': item.done }">{{ item.text }}</span>
            <button class="icon-button" title="Remove item" @click="dropChecklistItem(ticket, index)">×</button>
          </li>
        </ul>
        <input
          v-model="checklistDraft"
          placeholder="Add an item, then press Enter"
          @keyup.enter="addChecklistDraft(ticket)"
        />
      </section>

      <a
        v-if="ticket.externalUrl && hidesModalField('externalLinks')"
        class="ticket-external"
        :href="ticket.externalUrl"
        target="_blank"
        rel="noreferrer"
      >
        View on GitHub ({{ ticket.externalId?.replace('github:', '#') }})
      </a>

      <section class="ticket-agent">
        <p class="eyebrow">Agent completion</p>

        <p v-if="showsWhoRunsIt" class="field-group-caption">Who runs it</p>
        <div v-if="showsWhoRunsIt" class="field-row">
          <label v-if="!hidesModalField('agent')">
            Agent
            <select
              :value="agentForTicket(ticket, agents).id"
              @change="editTicket(ticket, { agentId: ($event.target as HTMLSelectElement).value, model: undefined })"
            >
              <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
            </select>
          </label>
          <label v-if="!hidesModalField('model')">
            Model
            <ModelField
              :model-value="ticket.model ?? ''"
              :agent="findAgent(agents, ticket.agentId)"
              placeholder="CLI default"
              @update:model-value="editTicket(ticket, { model: $event || undefined })"
            />
          </label>
          <label v-if="!hidesModalField('fullAuto')" class="checkbox-label">
            <input
              type="checkbox"
              :checked="Boolean(ticket.fullAuto)"
              aria-labelledby="ticket-full-auto-label"
              @change="editTicket(ticket, { fullAuto: ($event.target as HTMLInputElement).checked })"
            />
            <span id="ticket-full-auto-label">Full auto</span>
            <InfoTip
              text="Same as a lane's Full auto, but for this ticket in every lane it enters: when an agent moves this ticket on, the next lane's agent starts on it."
            />
          </label>
        </div>

        <p v-if="showsWhenItsDone" class="field-group-caption">When it's done</p>
        <div v-if="!hidesModalField('nextLane')" class="field-row">
          <label for="ticket-next-lane-select">
            <span>
              <span id="ticket-next-lane-label">Next Lane</span> <InfoTip
                text="Where this ticket goes when its checklist is done or ▶ Run succeeds. Defaults to the lane's Next Lane."
              />
            </span>
            <select
              id="ticket-next-lane-select"
              aria-labelledby="ticket-next-lane-label"
              :value="openTicketOverrideId"
              @change="setMoveToLane(ticket, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ openTicketLaneDefaultLabel }}</option>
              <option v-for="lane in nextLaneOptionsFor(ticket.laneId)" :key="lane.id" :value="lane.id">
                {{ lane.name }}
              </option>
            </select>
          </label>
          <label v-if="openTicketNextLaneId" class="checkbox-label">
            <input
              type="checkbox"
              :checked="Boolean(ticket.moveOnComplete)"
              @change="editTicket(ticket, { moveOnComplete: ($event.target as HTMLInputElement).checked })"
            />
            Move to Next Lane: {{ laneName(openTicketNextLaneId) }}
          </label>
        </div>
        <label v-if="showsMoveRules">
          Move rules
          <textarea
            :value="ticket.moveRules ?? ''"
            placeholder="One rule per line, e.g. PR merged; no open questions"
            @change="editTicket(ticket, { moveRules: ($event.target as HTMLTextAreaElement).value })"
          />
        </label>
        <label v-if="moveRulesList(ticket).length" class="checkbox-label">
          <input
            type="checkbox"
            :checked="ticket.moveRulesPassedLaneId === ticket.laneId"
            @change="
              editTicket(ticket, {
                moveRulesPassedLaneId: ($event.target as HTMLInputElement).checked ? ticket.laneId : undefined
              })
            "
          />
          Move rules pass
        </label>

        <p class="field-group-caption">
          Run
          <InfoTip
            text="The agent gets this ticket, its lane's prompt, markdown file and output location. Run works in the background and saves its output below — it can write files but not run shell commands. Run in a terminal to watch and approve each step; editors get the command on the clipboard to paste."
          />
        </p>
        <pre class="agent-command">{{ ticketCommand(ticket) }}</pre>
        <div class="agent-actions">
          <button
            :disabled="store.agentRunning[ticket.id]"
            :title="`Run ${agentForTicket(ticket, agents).name} in the background`"
            @click="runTicketAgent(ticket)"
          >
            {{ store.agentRunning[ticket.id] ? 'Running…' : '▶ Run' }}
          </button>
          <button
            v-if="ticketCanResume(ticket)"
            class="secondary"
            :disabled="store.agentRunning[ticket.id]"
            title="Resume the interrupted session in a terminal tab, in the directory it started in"
            @click="resumeTicketAgent(ticket)"
          >
            ⏯ Resume
          </button>
          <button
            class="secondary"
            :title="`Run in ${openInStore.selectedTarget.label} — terminals run it, editors get it on the clipboard`"
            @click="openTicketInShell(ticket)"
          >
            ⌁ Run in {{ openInStore.selectedTarget.label }}
          </button>
        </div>
        <div v-if="ticket.agentRun && !hidesModalField('lastAgentRun')" class="ticket-agent-run">
          <p class="eyebrow">
            Last agent run · {{ laneName(ticket.agentRun.laneId) }} · {{ formatDateTime(ticket.agentRun.at) }}
            <template v-if="ticket.agentRun.status === 'blocked'"> · <span class="agent-status-blocked">Blocked</span></template>
          </p>
          <pre v-if="ticket.agentRun.output.trim()">{{ ticket.agentRun.output }}</pre>
          <p
            v-else-if="ticket.agentRun.status !== 'running' && ticket.agentRun.mode !== 'terminal'"
            class="field-hint"
          >
            No output
          </p>
        </div>
      </section>

      <div class="modal-actions">
        <button
          class="secondary danger ticket-delete"
          title="Delete ticket"
          aria-label="Delete ticket"
          @click="emit('delete', ticket)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
        </button>
        <button class="secondary" @click="cancelTicketEdits">Cancel</button>
        <button @click="emit('close')">Done</button>
      </div>
    </section>
  </div>
</template>
