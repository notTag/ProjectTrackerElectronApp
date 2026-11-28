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
  isContextFilePath,
  orchestratorPollActive,
  orchestratorPollMinutes,
  orchestratorPromptMissingTokens,
  defaultOrchestratorPrompt,
  APP_ORCHESTRATOR_PROMPT_PATCH,
  orchestratorPromptTokenHelp,
  plural,
  steppedOrchestratorPoll,
  toggleLaneModalFieldInLane,
  updateLaneInBoard,
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

const props = defineProps<{ lane: SwimLane }>()
const emit = defineEmits<{ close: []; delete: [lane: SwimLane] }>()

const { store, projectPath, board, agents, preferences, savePreferences, editLane, autoRunTerminal, orchestratorContextFor } =
  useBoardContext()
const { notePressTarget, closeIfPressStartedOnBackdrop } = useBackdropPress()

// Bound as :text strings so they can carry \n line breaks for the bubble's pre-line (#112).
const agentPromptTip =
  'Instructions given to the agent each time it starts on a ticket in this lane. Saved with the lane. The Agent markdown file below is additional context added after this text at launch; it can hold the instructions on its own.' +
  "\n\nNo {{variables}}: tokens aren't filled in here; ticket details are added automatically."
const orchestratorPromptTip =
  "Instructions for this lane's orchestrator session, which dispatches and monitors ticket agents. Edits apply to this lane; Save as default keeps the text as the lane's default, Reset to default goes back to it, and Restore app default drops it for the app-generated prompt. With no default saved, the app generates the prompt." +
  '\n\nThe Agent Orchestrator markdown file below (default SwimlaneAgentPrompt/<lane>/AgentOrchestratorPrompt.md) is additional prompt context added after this text at launch. It does not replace it.' +
  `\n\n${orchestratorPromptTokenHelp()}`
const markdownFileTip = 'Additional context, added after the prompt at launch. It does not replace the prompt. .md or .txt.'

const contextFileError = (filePath: string | undefined) =>
  isContextFilePath(filePath ?? '') ? '' : 'Must end in .md or .txt, or it is skipped at launch.'

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

const openLaneDefaultOrchestratorPrompt = computed(() => {
  const context = orchestratorContextFor(autoRunTerminal(props.lane))
  return defaultOrchestratorPrompt(props.lane, context)
})

const openLaneCurrentOrchestratorPrompt = computed(() => {
  const currentPrompt = props.lane.currentAgentOrchestratorPrompt ?? ''
  return currentPrompt.trim() ? currentPrompt : ''
})

const openLaneHasSavedOrchestratorDefault = computed(() => {
  const savedDefault = props.lane.defaultAgentOrchestratorPrompt ?? ''
  return savedDefault.trim() !== ''
})

const openLaneOrchestratorPrompt = computed(
  () => openLaneCurrentOrchestratorPrompt.value || openLaneDefaultOrchestratorPrompt.value
)

const openLaneMissingOrchestratorTokens = computed(() => orchestratorPromptMissingTokens(openLaneOrchestratorPrompt.value))

const orchestratorPromptPatch = (text: string): Partial<Omit<SwimLane, 'id'>> => {
  const trimmedText = text.trim()
  const matchesDefault = trimmedText === openLaneDefaultOrchestratorPrompt.value.trim()
  if (!trimmedText || matchesDefault) return { currentAgentOrchestratorPrompt: '' }
  return { currentAgentOrchestratorPrompt: text, orchestratorPrompt: '' }
}

const lanePromptSources: Record<LaneMarkdownKind, () => string> = {
  agent: () => props.lane.agentPrompt ?? '',
  orchestrator: () => openLaneOrchestratorPrompt.value
}
const lanePromptDraft = ref<Record<LaneMarkdownKind, string>>({ agent: '', orchestrator: '' })

type LaneStoreStatus = { savedMessage: string; error: string }
const idleLaneStoreStatus = (): LaneStoreStatus => ({ savedMessage: '', error: '' })

const openLaneOrchestratorDiffersFromDefault = computed(() => {
  const typedPrompt = lanePromptDraft.value.orchestrator.trim()
  return typedPrompt !== '' && typedPrompt !== openLaneDefaultOrchestratorPrompt.value.trim()
})

for (const kind of ['agent', 'orchestrator'] as const) {
  watch(lanePromptSources[kind], (prompt) => (lanePromptDraft.value[kind] = prompt), { immediate: true })
}
watch(
  () => props.lane.id,
  (laneId) => void store.ensureLaneMarkdownFiles(projectPath.value, laneId),
  { immediate: true }
)

type LanePromptPatch = Partial<Omit<SwimLane, 'id'>>
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
// store typed prompts.
watch(
  () => props.lane.id,
  () => {
    laneFieldsMenuOpen.value = false
    laneStoreStatus.value = idleLaneStoreStatus()
    commitTypedPrompts()
    // The source watches only fire on a changed value, so two lanes storing the
    // same prompt would otherwise hand one lane's typed text to the next.
    for (const kind of ['agent', 'orchestrator'] as const) {
      lanePromptDraft.value[kind] = lanePromptSources[kind]()
    }
  }
)
onBeforeUnmount(commitTypedPrompts)

const laneStoreStatus = ref<LaneStoreStatus>(idleLaneStoreStatus())
const saveLaneToStore = async (lane: SwimLane) => {
  commitTypedPrompts()
  try {
    await store.saveLaneToStore(projectPath.value, lane.id)
    if (props.lane.id === lane.id) laneStoreStatus.value = { savedMessage: 'Saved to store', error: '' }
  } catch (error) {
    if (props.lane.id === lane.id) laneStoreStatus.value = { savedMessage: '', error: ipcErrorMessage(error) }
  }
}

const onLanePromptInput = (lane: SwimLane, kind: LaneMarkdownKind, event: Event) => {
  const text = (event.target as HTMLTextAreaElement).value
  lanePromptDraft.value[kind] = text
  uncommittedPrompts[kind] = { lane, patch: lanePromptPatch(kind, text) }
}

const saveOrchestratorPromptAsDefault = (lane: SwimLane) => {
  delete uncommittedPrompts.orchestrator
  const typedPrompt = lanePromptDraft.value.orchestrator
  editLane(lane, { defaultAgentOrchestratorPrompt: typedPrompt, currentAgentOrchestratorPrompt: '', orchestratorPrompt: '' })
}

const restoreAppOrchestratorPrompt = (lane: SwimLane) => {
  delete uncommittedPrompts.orchestrator
  editLane(lane, APP_ORCHESTRATOR_PROMPT_PATCH)
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
              :value="lanePromptDraft.agent"
              placeholder="Instructions for the agent that handles tickets in this lane — format, required sections, clarifying questions to ask..."
              @input="onLanePromptInput(lane, 'agent', $event)"
              @change="commitTypedPrompts"
            />
          </label>

          <label v-if="showsLaneField('agentFile', lane.id)" for="lane-agent-file">
            <span class="label-with-tip">
              <span id="lane-agent-file-label">Agent markdown file</span>
              <InfoTip :text="markdownFileTip" />
            </span>
            <input
              id="lane-agent-file"
              aria-labelledby="lane-agent-file-label"
              class="agent-file-path"
              :value="lane.agentFilePath"
              placeholder="/Users/you/Projects/thing/docs/agent-prompt.md"
              @change="editLane(lane, { agentFilePath: ($event.target as HTMLInputElement).value })"
            />
            <span v-if="contextFileError(lane.agentFilePath)" class="field-hint field-error">
              {{ contextFileError(lane.agentFilePath) }}
            </span>
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
              :value="lanePromptDraft.orchestrator"
              spellcheck="false"
              @input="onLanePromptInput(lane, 'orchestrator', $event)"
              @change="commitTypedPrompts"
            />
          </label>
          <span v-if="openLaneMissingOrchestratorTokens.length" class="field-hint field-error">
            Missing {{ openLaneMissingOrchestratorTokens.join(', ') }}: the orchestrator won't know which tickets to watch.
          </span>
          <div
            v-if="
              showsLaneField('orchestratorPrompt', lane.id) &&
              (openLaneOrchestratorDiffersFromDefault || openLaneCurrentOrchestratorPrompt || openLaneHasSavedOrchestratorDefault)
            "
            class="lane-prompt-actions"
          >
            <button
              v-if="openLaneOrchestratorDiffersFromDefault"
              class="secondary lane-prompt-save-default"
              type="button"
              @click="saveOrchestratorPromptAsDefault(lane)"
            >
              Save as default
            </button>
            <button
              v-if="openLaneCurrentOrchestratorPrompt"
              class="secondary lane-prompt-reset"
              type="button"
              @click="editLane(lane, { currentAgentOrchestratorPrompt: '' })"
            >
              Reset to default
            </button>
            <button
              v-if="openLaneHasSavedOrchestratorDefault"
              class="secondary lane-prompt-restore-app-default"
              type="button"
              @click="restoreAppOrchestratorPrompt(lane)"
            >
              Restore app default
            </button>
          </div>

          <label v-if="showsLaneField('orchestratorFile', lane.id)" for="lane-orchestrator-file">
            <span class="label-with-tip">
              <span id="lane-orchestrator-file-label">Agent Orchestrator markdown file</span>
              <InfoTip :text="markdownFileTip" />
            </span>
            <input
              id="lane-orchestrator-file"
              aria-labelledby="lane-orchestrator-file-label"
              class="agent-file-path"
              :value="lane.orchestratorFilePath ?? ''"
              placeholder="/Users/you/Projects/thing/docs/orchestrator.md"
              @change="editLane(lane, { orchestratorFilePath: ($event.target as HTMLInputElement).value })"
            />
            <span v-if="contextFileError(lane.orchestratorFilePath)" class="field-hint field-error">
              {{ contextFileError(lane.orchestratorFilePath) }}
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
          <div class="field-row">
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
        <template v-if="lane.id !== UNASSIGNED_LANE_ID">
          <button
            class="secondary danger"
            :title="`Delete ${lane.name} — its tickets move to ${UNASSIGNED_LANE_NAME}`"
            @click="emit('delete', lane)"
          >
            Delete lane
          </button>
          <button
            class="secondary"
            title="Save this lane's settings and prompts to the Swimlane Store, to add to any board's workflow"
            @click="saveLaneToStore(lane)"
          >
            Save to Store
          </button>
        </template>
        <span v-else class="field-hint">This column always exists — it holds tickets with no status.</span>
        <span v-if="laneStoreStatus.error" class="field-hint field-error">{{ laneStoreStatus.error }}</span>
        <span v-else-if="laneStoreStatus.savedMessage" class="field-hint">{{ laneStoreStatus.savedMessage }}</span>
        <button @click="emit('close')">Done</button>
      </div>
    </section>
  </div>
</template>
