<script lang="ts">
// What each lane's file last got from us, so main can tell our copy from a hand
// edit, plus the one-at-a-time save queue. Owned by BoardView and passed in:
// both must outlive this modal (a save can still be in flight after it closes),
// but reset when the board view itself goes, as they always have.
export type LaneMarkdownSaveState = { lastSaved: Map<string, string>; queue: Promise<void> }
export const createLaneMarkdownSaveState = (): LaneMarkdownSaveState => ({
  lastSaved: new Map(),
  queue: Promise.resolve()
})
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { laneModalExpanded, laneModalSectionsOpen, vEdgeResize } from '@/modalWidth'
import ExpandToggle from '@/components/ExpandToggle.vue'
import ModelField from '@/components/ModelField.vue'
import InfoTip from '@/components/InfoTip.vue'
import EyeOffIcon from '@/components/icons/EyeOffIcon.vue'
import { TERMINAL_TARGETS } from '@/shared/openInTargets'
import {
  autoRunUsesWorktrees,
  boardLaneById,
  findAgent,
  orchestratorPollActive,
  orchestratorPollMinutes,
  orchestratorPromptMissingTokens,
  orchestratorPromptTemplate,
  orchestratorPromptTokenHelp,
  plural,
  steppedOrchestratorPoll,
  toggleLaneModalFieldInLane,
  updateLaneInBoard,
  LANE_MARKDOWN_FILE_PATH_FIELD,
  LANE_MODAL_FIELDS,
  UNASSIGNED_LANE_ID,
  UNASSIGNED_LANE_NAME,
  type LaneMarkdownKind,
  type LaneModalField,
  type LaneModalSection,
  type SwimLane
} from '@/shared/projectTypes'
import { useBackdropPress } from './backdropPress'
import { useBoardContext } from './boardContext'
import { ipcErrorMessage } from './boardFormat'

const props = defineProps<{ lane: SwimLane; saveState: LaneMarkdownSaveState }>()
const emit = defineEmits<{ close: []; delete: [lane: SwimLane] }>()

const { store, projectPath, board, agents, preferences, savePreferences, editLane, autoRunTerminal, orchestratorContextFor } =
  useBoardContext()
const { notePressTarget, closeIfPressStartedOnBackdrop } = useBackdropPress()

// Bound as :text strings so they can carry \n line breaks for the bubble's pre-line (#112).
const agentPromptTip =
  'Instructions given to the agent each time it starts on a ticket in this lane. Autosaves as markdown to the Agent markdown file below (default SwimlaneAgentPrompt/<lane>/). With no prompt typed, the agent is pointed at that file instead.' +
  "\n\nNo {{variables}}: tokens aren't filled in here; ticket details are added automatically."
const orchestratorPromptTip =
  "Instructions for this lane's orchestrator session, which dispatches and monitors ticket agents. Leave empty to use the generated default template." +
  `\n\n${orchestratorPromptTokenHelp()}`

// Lane settings modal fields. The Display modal's list is every lane's default;
// a lane's eye button can only hide further. Display-only: values still reach the agent.
const laneFieldShownOnBoard = (field: LaneModalField) => !preferences.value.hiddenLaneModalFields.includes(field)
const laneFieldHiddenInLane = (field: LaneModalField, laneId: string) =>
  preferences.value.hiddenLaneModalFieldsByLane[laneId]?.includes(field) ?? false
const showsLaneField = (field: LaneModalField, laneId: string) =>
  laneFieldShownOnBoard(field) && !laneFieldHiddenInLane(field, laneId)
const showsLaneSection = (section: LaneModalSection, laneId: string) =>
  LANE_MODAL_FIELDS.some((field) => field.section === section && showsLaneField(field.id, laneId))
const rememberLaneSectionOpen = (section: LaneModalSection, event: Event) => {
  const details = event.target as HTMLDetailsElement
  laneModalSectionsOpen[section] = details.open
}
const toggleLaneFieldInLane = (laneId: string, field: LaneModalField) =>
  savePreferences(toggleLaneModalFieldInLane(preferences.value, laneId, field))

const laneFieldsMenuOpen = ref(false)
const laneFieldsMenuRef = ref<HTMLElement | null>(null)
const closeLaneFieldsMenuOnOutsideClick = (event: PointerEvent) => {
  if (laneFieldsMenuRef.value?.contains(event.target as Node)) return
  laneFieldsMenuOpen.value = false
}
onMounted(() => window.addEventListener('pointerdown', closeLaneFieldsMenuOnOutsideClick))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeLaneFieldsMenuOnOutsideClick))

const editOrchestratorPollMinutes = (lane: SwimLane, input: HTMLInputElement) => {
  const minutes = input.valueAsNumber
  const isWholeMinutes = Number.isInteger(minutes) && minutes >= 1
  if (!isWholeMinutes) {
    input.value = String(orchestratorPollMinutes(lane))
    return
  }
  editLane(lane, { orchestratorPollMinutes: minutes })
}

// Steps inside the queued mutate, not from the view's lane: the view only sees
// a click's result once its write lands, so fast clicks would repeat a step.
const stepOrchestratorPoll = (laneId: string, step: -1 | 1) => {
  void store.updateBoard(projectPath.value, (board) => {
    const currentLane = boardLaneById(board, laneId)
    const patch = currentLane && steppedOrchestratorPoll(currentLane, step)
    return patch ? updateLaneInBoard(board, laneId, patch) : board
  })
}

const orchestratorPollTooltip = (lane: SwimLane): string => {
  if (!orchestratorPollActive(lane)) return 'The Orchestrator agent never polls: it waits for messages from the ticket agents.'
  const pollInterval = plural(orchestratorPollMinutes(lane), 'minute')
  return `The Orchestrator agent will poll running agents every ${pollInterval}.`
}

// A model id belongs to one CLI ('opus' means nothing to Codex), so switching
// the agent clears it rather than handing the new CLI a model it can't run.
// An orchestrator left on "Same as ticket agent" follows the ticket agent, so
// its model is cleared along with it.
const changeLaneAutoRunAgent = (lane: SwimLane, autoRunAgentId: string) => {
  const orchestratorFollowsTicketAgent = !lane.orchestratorAgentId
  const orchestratorModelPatch = orchestratorFollowsTicketAgent ? { orchestratorModel: undefined } : {}
  editLane(lane, { autoRunAgentId, autoRunModel: undefined, ...orchestratorModelPatch })
}

const openLaneOrchestratorTemplate = computed(() => {
  const context = orchestratorContextFor(autoRunTerminal(props.lane))
  return orchestratorPromptTemplate(props.lane, context)
})

// Blank counts as no override, the same as at launch.
const openLaneOrchestratorOverride = computed(() => {
  const override = props.lane.orchestratorPromptOverride ?? ''
  return override.trim() ? override : ''
})

const openLaneMissingOrchestratorTokens = computed(() => {
  const override = openLaneOrchestratorOverride.value
  return override ? orchestratorPromptMissingTokens(override) : []
})

// Saving the untouched template, or clearing the box, keeps the lane on the
// generated prompt, so app updates to it still arrive and the old extras stay.
// An edit folds the extras into the override, since they are already part of
// the text the user just saved.
const orchestratorPromptPatch = (text: string): Partial<Omit<SwimLane, 'id'>> => {
  const trimmedText = text.trim()
  const isUnchangedTemplate = trimmedText === openLaneOrchestratorTemplate.value.trim()
  if (!trimmedText || isUnchangedTemplate) return { orchestratorPromptOverride: '' }
  return { orchestratorPromptOverride: text, orchestratorPrompt: '' }
}

// Live copies of each prompt + markdown file pair, because the inputs only
// commit on blur: autosave has to write what is on screen, not what state held
// before the blur.
type LaneMarkdownStatus = { savedMessage: string; error: string }
const idleMarkdownStatus = (): LaneMarkdownStatus => ({ savedMessage: '', error: '' })
const laneMarkdownDraft = ref<Record<LaneMarkdownKind, { prompt: string; filePath: string }>>({
  agent: { prompt: '', filePath: '' },
  orchestrator: { prompt: '', filePath: '' }
})
const laneMarkdownStatus = ref<Record<LaneMarkdownKind, LaneMarkdownStatus>>({
  agent: idleMarkdownStatus(),
  orchestrator: idleMarkdownStatus()
})

// The orchestrator box shows the full prompt (override or generated), so that
// is what its file gets.
const laneMarkdownSources: Record<LaneMarkdownKind, { prompt: () => string; filePath: () => string }> = {
  agent: {
    prompt: () => props.lane.agentPrompt ?? '',
    filePath: () => props.lane.agentFilePath ?? ''
  },
  orchestrator: {
    prompt: () => openLaneOrchestratorOverride.value || openLaneOrchestratorTemplate.value,
    filePath: () => props.lane.orchestratorFilePath ?? ''
  }
}

for (const kind of ['agent', 'orchestrator'] as const) {
  const source = laneMarkdownSources[kind]
  // One watch per field, not one getter returning an array: a fresh array on
  // every board refresh would reset the draft mid-typing, and the path an
  // autosave stores must not reset the prompt being typed.
  watch(source.prompt, (prompt) => (laneMarkdownDraft.value[kind].prompt = prompt), { immediate: true })
  watch(source.filePath, (filePath) => (laneMarkdownDraft.value[kind].filePath = filePath), { immediate: true })
}

// Autosave once typing pauses. 1s sits in the usual 1-2s autosave range: long
// enough not to write mid-word, short enough to land before the modal closes.
const MARKDOWN_AUTOSAVE_DELAY_MS = 1000

type PendingMarkdownSave = { timer: ReturnType<typeof setTimeout>; run: () => void }
const pendingMarkdownSaves: Partial<Record<LaneMarkdownKind, PendingMarkdownSave>> = {}

const flushMarkdownSaves = () => {
  for (const pending of Object.values(pendingMarkdownSaves)) {
    clearTimeout(pending.timer)
    pending.run()
  }
}

type LanePromptPatch = Partial<Omit<SwimLane, 'id'>>
// Typed text not stored on the lane yet. Blur stores it; closing or switching
// lanes without a blur (Escape) stores it here, so the lane never lags its file.
// The patch is built while its lane is open: the orchestrator one compares
// against that lane's template.
const uncommittedPrompts: Partial<Record<LaneMarkdownKind, { lane: SwimLane; patch: LanePromptPatch }>> = {}

const lanePromptPatch = (kind: LaneMarkdownKind, text: string): LanePromptPatch =>
  kind === 'agent' ? { agentPrompt: text } : orchestratorPromptPatch(text)

const commitTypedPrompts = () => {
  for (const kind of ['agent', 'orchestrator'] as const) {
    const uncommitted = uncommittedPrompts[kind]
    if (!uncommitted) continue
    delete uncommittedPrompts[kind]
    editLane(uncommitted.lane, uncommitted.patch)
  }
}

// Data-loss path: both a lane switch and the modal (or board) unmounting must
// flush pending file writes and store typed prompts.
watch(
  () => props.lane.id,
  () => {
    laneFieldsMenuOpen.value = false
    flushMarkdownSaves()
    commitTypedPrompts()
    laneMarkdownStatus.value = { agent: idleMarkdownStatus(), orchestrator: idleMarkdownStatus() }
    // The source watches only fire on a changed value, so two lanes storing the
    // same prompt would otherwise hand one lane's typed text to the next.
    for (const kind of ['agent', 'orchestrator'] as const) {
      const source = laneMarkdownSources[kind]
      laneMarkdownDraft.value[kind] = { prompt: source.prompt(), filePath: source.filePath() }
    }
  }
)
onBeforeUnmount(() => {
  flushMarkdownSaves()
  commitTypedPrompts()
})

// Only the file (and its path, the first time) is written here. The prompt
// itself is stored on blur, as before: storing it mid-typing would re-render
// the box under the cursor.
const saveLaneMarkdown = async (lane: SwimLane, kind: LaneMarkdownKind, prompt: string, filePath: string) => {
  const savedKey = `${lane.id}:${kind}`
  const previousPrompt = props.saveState.lastSaved.get(savedKey) ?? ''
  const setStatus = (status: LaneMarkdownStatus) => {
    // The modal may have switched lanes mid-save; don't show this lane's result on another.
    if (props.lane.id === lane.id) laneMarkdownStatus.value[kind] = status
  }
  try {
    const saved = await store.saveLaneMarkdown(projectPath.value, lane, kind, prompt, previousPrompt, filePath)
    // Recorded even if the lane update failed: the file holds this text now.
    props.saveState.lastSaved.set(savedKey, prompt)
    if (saved.laneUpdated) setStatus({ savedMessage: `Saved to ${saved.filePath}`, error: '' })
    else setStatus({ savedMessage: '', error: 'Saved the file but could not store its path on the lane.' })
  } catch (error) {
    setStatus({ savedMessage: '', error: ipcErrorMessage(error) })
  }
}

// Everything is captured now, not when the timer fires: by then the modal may
// show another lane.
const scheduleLaneMarkdownSave = (lane: SwimLane, kind: LaneMarkdownKind) => {
  const savedKey = `${lane.id}:${kind}`
  const { lastSaved } = props.saveState
  // Before the first save the file should hold the stored prompt: the lane
  // keeps it until blur commits the new text.
  if (!lastSaved.has(savedKey)) lastSaved.set(savedKey, laneMarkdownSources[kind].prompt())
  const { prompt, filePath } = laneMarkdownDraft.value[kind]
  const saveState = props.saveState
  const run = () => {
    delete pendingMarkdownSaves[kind]
    // One write at a time, in order: a slow save must not land after a newer one.
    saveState.queue = saveState.queue.then(() => saveLaneMarkdown(lane, kind, prompt, filePath))
  }
  const existing = pendingMarkdownSaves[kind]
  if (existing) clearTimeout(existing.timer)
  pendingMarkdownSaves[kind] = { timer: setTimeout(run, MARKDOWN_AUTOSAVE_DELAY_MS), run }
}

const onLaneMarkdownPromptInput = (lane: SwimLane, kind: LaneMarkdownKind, event: Event) => {
  const text = (event.target as HTMLTextAreaElement).value
  laneMarkdownDraft.value[kind].prompt = text
  uncommittedPrompts[kind] = { lane, patch: lanePromptPatch(kind, text) }
  scheduleLaneMarkdownSave(lane, kind)
}

const storeTypedPrompts = () => {
  commitTypedPrompts()
  flushMarkdownSaves()
}

// A new path gets the current text, unless there is none: linking an existing
// guide with an empty prompt must not try to write over it.
const onLaneMarkdownPathChange = (lane: SwimLane, kind: LaneMarkdownKind, event: Event) => {
  const filePath = (event.target as HTMLInputElement).value
  editLane(lane, { [LANE_MARKDOWN_FILE_PATH_FIELD[kind]]: filePath })
  if (laneMarkdownDraft.value[kind].prompt.trim()) scheduleLaneMarkdownSave(lane, kind)
}

// BoardView's single Escape handler calls this at its place in the order.
defineExpose({
  closeMenuOnEscape: () => {
    if (!laneFieldsMenuOpen.value) return false
    // The focused checkbox unmounts with the popover; hand focus back to its toggle.
    laneFieldsMenuRef.value?.querySelector<HTMLElement>('button')?.focus()
    laneFieldsMenuOpen.value = false
    return true
  }
})
</script>

<template>
  <div class="modal-backdrop" @pointerdown="notePressTarget" @click.self="closeIfPressStartedOnBackdrop(() => emit('close'))">
    <section v-edge-resize class="modal lane-modal resizable" :class="{ expanded: laneModalExpanded }">
      <div class="ticket-modal-header">
        <p class="eyebrow">Swim lane</p>
        <div ref="laneFieldsMenuRef" class="filter-menu">
          <button
            type="button"
            class="icon-button"
            title="Settings shown for this lane"
            :aria-label="`Settings shown for ${lane.name}`"
            aria-haspopup="true"
            :aria-expanded="laneFieldsMenuOpen"
            @click="laneFieldsMenuOpen = !laneFieldsMenuOpen"
          >
            <EyeOffIcon />
          </button>
          <div v-if="laneFieldsMenuOpen" class="filter-popover" role="group" aria-label="Settings shown for this lane">
            <label
              v-for="field in LANE_MODAL_FIELDS"
              :key="field.id"
              :title="laneFieldShownOnBoard(field.id) ? undefined : 'Hidden for the whole board'"
            >
              <input
                type="checkbox"
                :checked="showsLaneField(field.id, lane.id)"
                :disabled="!laneFieldShownOnBoard(field.id)"
                @change="toggleLaneFieldInLane(lane.id, field.id)"
              />
              <span>
                {{ field.label }}
                <small v-if="!laneFieldShownOnBoard(field.id)" class="field-hint">Hidden for the whole board</small>
              </span>
            </label>
          </div>
        </div>
        <ExpandToggle v-model="laneModalExpanded" />
      </div>
      <input
        class="ticket-title-input"
        :value="lane.name"
        @change="editLane(lane, { name: ($event.target as HTMLInputElement).value })"
      />

      <details
        v-if="showsLaneSection('agent', lane.id)"
        class="lane-settings-section"
        :open="laneModalSectionsOpen.agent"
        @toggle="rememberLaneSectionOpen('agent', $event)"
      >
        <summary class="eyebrow">Agent</summary>
        <div class="lane-settings-section-body">
          <label v-if="showsLaneField('agentPrompt', lane.id)" for="lane-agent-prompt">
            <span class="label-with-tip">
              <span id="lane-agent-prompt-label">Agent prompt</span>
              <InfoTip :text="agentPromptTip" />
            </span>
            <textarea
              id="lane-agent-prompt"
              aria-labelledby="lane-agent-prompt-label"
              class="agent-prompt"
              :value="laneMarkdownDraft.agent.prompt"
              placeholder="Instructions for the agent that handles tickets in this lane — format, required sections, clarifying questions to ask..."
              @input="onLaneMarkdownPromptInput(lane, 'agent', $event)"
              @change="storeTypedPrompts"
            />
          </label>

          <label v-if="showsLaneField('agentFile', lane.id)">
            Agent markdown file
            <input
              class="agent-file-path"
              :value="lane.agentFilePath"
              placeholder="/Users/you/Projects/thing/docs/agent-prompt.md"
              @input="laneMarkdownDraft.agent.filePath = ($event.target as HTMLInputElement).value"
              @change="onLaneMarkdownPathChange(lane, 'agent', $event)"
            />
            <span v-if="laneMarkdownStatus.agent.error" class="field-hint field-error">{{ laneMarkdownStatus.agent.error }}</span>
            <span v-else-if="laneMarkdownStatus.agent.savedMessage" class="field-hint">{{ laneMarkdownStatus.agent.savedMessage }}</span>
          </label>

          <label v-if="showsLaneField('output', lane.id)">
            Output
            <textarea
              class="agent-prompt"
              :value="lane.outputTarget ?? ''"
              placeholder="A file, a directory, or where it goes — e.g. a new folder inside the project directory"
              @change="editLane(lane, { outputTarget: ($event.target as HTMLTextAreaElement).value })"
            />
            <span class="field-hint">Where the agent puts its work. An existing directory is used as-is, no prompt.</span>
          </label>
        </div>
      </details>

      <details
        v-if="showsLaneSection('orchestrator', lane.id)"
        class="lane-settings-section"
        :open="laneModalSectionsOpen.orchestrator"
        @toggle="rememberLaneSectionOpen('orchestrator', $event)"
      >
        <summary class="eyebrow">
          Orchestrator
          <span
            v-if="openLaneMissingOrchestratorTokens.length && !laneModalSectionsOpen.orchestrator"
            class="field-error"
          >
            · prompt missing {{ openLaneMissingOrchestratorTokens.join(', ') }}
          </span>
        </summary>
        <div class="lane-settings-section-body">
          <label v-if="showsLaneField('orchestratorPrompt', lane.id)" for="lane-orchestrator-prompt">
            <span class="label-with-tip">
              <span id="lane-orchestrator-prompt-label">Orchestrator prompt</span>
              <InfoTip :text="orchestratorPromptTip" />
            </span>
            <textarea
              id="lane-orchestrator-prompt"
              aria-labelledby="lane-orchestrator-prompt-label"
              class="agent-prompt orchestrator-prompt"
              :value="laneMarkdownDraft.orchestrator.prompt"
              spellcheck="false"
              @input="onLaneMarkdownPromptInput(lane, 'orchestrator', $event)"
              @change="storeTypedPrompts"
            />
          </label>
          <span v-if="openLaneMissingOrchestratorTokens.length" class="field-hint field-error">
            Missing {{ openLaneMissingOrchestratorTokens.join(', ') }}: the orchestrator won't know which tickets to watch.
          </span>
          <button
            v-if="showsLaneField('orchestratorPrompt', lane.id) && openLaneOrchestratorOverride"
            class="secondary lane-prompt-reset"
            type="button"
            @click="editLane(lane, { orchestratorPromptOverride: '' })"
          >
            Reset to default
          </button>

          <label v-if="showsLaneField('orchestratorFile', lane.id)">
            Agent Orchestrator markdown file
            <input
              class="agent-file-path"
              :value="lane.orchestratorFilePath ?? ''"
              placeholder="/Users/you/Projects/thing/docs/orchestrator.md"
              @input="laneMarkdownDraft.orchestrator.filePath = ($event.target as HTMLInputElement).value"
              @change="onLaneMarkdownPathChange(lane, 'orchestrator', $event)"
            />
            <span v-if="laneMarkdownStatus.orchestrator.error" class="field-hint field-error">
              {{ laneMarkdownStatus.orchestrator.error }}
            </span>
            <span v-else-if="laneMarkdownStatus.orchestrator.savedMessage" class="field-hint">
              {{ laneMarkdownStatus.orchestrator.savedMessage }}
            </span>
            <span v-else class="field-hint">
              The prompt above autosaves here, for versioning or review. Left empty it's
              SwimlaneAgentPrompt/&lt;lane&gt;/AgentOrchestratorPrompt.md.
            </span>
          </label>

          <!-- Caption uses for=, not a wrapping label: a <button> is labelable, so
               clicking a wrapping caption would fire − and switch the lane off. -->
          <div v-if="showsLaneField('orchestratorPoll', lane.id)" class="orchestrator-poll-row">
            <label
              id="orchestrator-poll-caption"
              :for="orchestratorPollActive(lane) ? 'orchestrator-poll-minutes' : undefined"
            >Orchestrator poll (minutes)</label>
            <div
              class="poll-stepper"
              role="group"
              aria-labelledby="orchestrator-poll-caption"
              :title="orchestratorPollTooltip(lane)"
            >
              <button
                type="button"
                aria-label="Decrease orchestrator poll"
                :aria-disabled="!orchestratorPollActive(lane)"
                @click="stepOrchestratorPoll(lane.id, -1)"
              >−</button>
              <span class="poll-stepper-value">
                <input
                  v-if="orchestratorPollActive(lane)"
                  id="orchestrator-poll-minutes"
                  type="number"
                  min="1"
                  step="1"
                  :value="orchestratorPollMinutes(lane)"
                  @change="editOrchestratorPollMinutes(lane, $event.target as HTMLInputElement)"
                />
                <span v-else role="img" aria-label="Orchestrator never polls">∞</span>
              </span>
              <span class="poll-stepper-status" aria-live="polite">{{
                orchestratorPollActive(lane) ? plural(orchestratorPollMinutes(lane), 'minute') : 'Never polls'
              }}</span>
              <button
                type="button"
                aria-label="Increase orchestrator poll"
                @click="stepOrchestratorPoll(lane.id, 1)"
              >+</button>
            </div>
          </div>
          <label v-if="showsLaneField('orchestratorAgent', lane.id)">
            Orchestrator agent
            <select
              :value="lane.orchestratorAgentId ?? ''"
              @change="
                editLane(lane, {
                  orchestratorAgentId: ($event.target as HTMLSelectElement).value || undefined,
                  orchestratorModel: undefined
                })
              "
            >
              <option value="">Same as ticket agent</option>
              <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
            </select>
          </label>
          <label v-if="showsLaneField('orchestratorModel', lane.id)">
            Orchestrator model
            <ModelField
              :model-value="lane.orchestratorModel ?? ''"
              :agent="findAgent(agents, lane.orchestratorAgentId ?? lane.autoRunAgentId)"
              :placeholder="lane.orchestratorAgentId ? 'CLI default' : 'Same as ticket model'"
              @update:model-value="editLane(lane, { orchestratorModel: $event || undefined })"
            />
          </label>
        </div>
      </details>

      <details
        v-if="showsLaneSection('autoRun', lane.id)"
        class="lane-settings-section"
        :open="laneModalSectionsOpen.autoRun"
        @toggle="rememberLaneSectionOpen('autoRun', $event)"
      >
        <summary class="eyebrow">Auto Run</summary>
        <div class="lane-settings-section-body ticket-agent">
          <div class="auto-run-pickers">
            <label v-if="showsLaneField('autoRunAgent', lane.id)">
              Agent
              <select
                :value="findAgent(agents, lane.autoRunAgentId).id"
                @change="changeLaneAutoRunAgent(lane, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
              </select>
            </label>
            <label v-if="showsLaneField('autoRunShell', lane.id)">
              Shell
              <select
                :value="autoRunTerminal(lane).id"
                @change="editLane(lane, { autoRunTerminalId: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="terminal in TERMINAL_TARGETS" :key="terminal.id" :value="terminal.id">
                  {{ terminal.label }}
                </option>
              </select>
            </label>
          </div>
          <label v-if="showsLaneField('autoRunModel', lane.id)">
            Model
            <ModelField
              :model-value="lane.autoRunModel ?? ''"
              :agent="findAgent(agents, lane.autoRunAgentId)"
              placeholder="CLI default"
              @update:model-value="editLane(lane, { autoRunModel: $event || undefined })"
            />
          </label>
          <label v-if="showsLaneField('worktrees', lane.id)" class="checkbox-label">
            <input
              type="checkbox"
              :checked="autoRunUsesWorktrees(lane)"
              @change="editLane(lane, { autoRunWorktrees: ($event.target as HTMLInputElement).checked })"
            />
            Worktree and branch per ticket
          </label>
          <label v-if="showsLaneField('fullAuto', lane.id)" class="checkbox-label">
            <input
              type="checkbox"
              :checked="Boolean(lane.fullAuto)"
              aria-labelledby="lane-full-auto-label"
              @change="editLane(lane, { fullAuto: ($event.target as HTMLInputElement).checked })"
            />
            <span id="lane-full-auto-label">Full auto: start the next lane's agent when this lane's agent moves a ticket on</span>
            <InfoTip
              text="Covers every ticket in this lane. A ticket's own Full auto turns it on for that ticket in every lane. Next Lane below sets where a ticket moves when its checklist is done."
            />
          </label>
          <label v-if="showsLaneField('nextLane', lane.id)">
            Next Lane
            <select
              :value="lane.nextLaneId ?? ''"
              @change="editLane(lane, { nextLaneId: ($event.target as HTMLSelectElement).value || undefined })"
            >
              <option value="">None</option>
              <option v-if="lane.id !== UNASSIGNED_LANE_ID" :value="UNASSIGNED_LANE_ID">
                {{ UNASSIGNED_LANE_NAME }}
              </option>
              <option
                v-for="candidateLane in board.lanes.filter((candidate) => candidate.id !== lane.id)"
                :key="candidateLane.id"
                :value="candidateLane.id"
              >
                {{ candidateLane.name }}
              </option>
            </select>
            <span class="field-hint">Where this lane's tickets go on completion unless a ticket sets its own.</span>
          </label>
          <template v-if="showsLaneField('agentSetsVersion', lane.id)">
            <label class="checkbox-label">
              <input
                type="checkbox"
                :checked="Boolean(lane.agentSetsVersion)"
                @change="editLane(lane, { agentSetsVersion: ($event.target as HTMLInputElement).checked })"
              />
              Agent sets semantic version
            </label>
            <span class="field-hint">This lane's agent decides whether the ticket needs a version and writes it.</span>
          </template>
          <label v-if="showsLaneField('closesTicket', lane.id)" class="checkbox-label">
            <input
              type="checkbox"
              :checked="Boolean(lane.closesTicket)"
              @change="editLane(lane, { closesTicket: ($event.target as HTMLInputElement).checked })"
            />
            Counts as closed: tickets entering this lane count as closed in Metrics
          </label>
          <span class="field-hint">
            The next agent starts on the board's next refresh (about 10 seconds). While you're typing in a field it
            waits until focus leaves it.
          </span>
          <span class="field-hint">
            Auto Run on this lane opens one new window with a tab per visible ticket, each running its agent command.
            With worktrees on, each ticket gets .worktrees/tN on its own branch off freshly fetched main, so parallel
            agents never share a checkout. Terminal needs Accessibility permission to open tabs.
          </span>
        </div>
      </details>

      <div class="modal-actions">
        <button
          v-if="lane.id !== UNASSIGNED_LANE_ID"
          class="secondary danger"
          :title="`Delete ${lane.name} — its tickets move to ${UNASSIGNED_LANE_NAME}`"
          @click="emit('delete', lane)"
        >
          Delete lane
        </button>
        <span v-else class="field-hint">This column always exists — it holds tickets with no status.</span>
        <button @click="emit('close')">Done</button>
      </div>
    </section>
  </div>
</template>
