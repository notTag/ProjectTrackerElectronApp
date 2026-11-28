<script lang="ts">
export type AutoRunPicks = {
  agentId: string
  model: string
  // '' = same as the ticket agent, matching an absent lane.orchestratorAgentId.
  orchestratorAgentId: string
  orchestratorModel: string
  terminalId: string
}

export const HEADLESS_AUTO_RUN_ID = 'headless'
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ModelField from '@/components/ModelField.vue'
import { TERMINAL_TARGETS } from '@/shared/openInTargets'
import { autoRunUsesWorktrees, findAgent, type SwimLane } from '@/shared/projectTypes'
import { useBoardContext } from './boardContext'

const props = defineProps<{ lane: SwimLane; ticketCount: number }>()
const emit = defineEmits<{ close: []; confirm: [picks: AutoRunPicks] }>()

const { agents, autoRunTerminal } = useBoardContext()

// The button only asks; the dialog starts on the lane's defaults and lets this
// one run pick a different agent or terminal without changing the lane.
const laneAgent = findAgent(agents.value, props.lane.autoRunAgentId)
const agentId = ref(laneAgent.id)
const model = ref(props.lane.autoRunModel || laneAgent.defaultModel || '')
const orchestratorAgentId = ref(props.lane.orchestratorAgentId ?? '')
const orchestratorModel = ref(props.lane.orchestratorModel ?? '')
const terminalId = ref(autoRunTerminal(props.lane).id)
const isHeadless = computed(() => terminalId.value === HEADLESS_AUTO_RUN_ID)

const changeAgent = () => {
  const agent = findAgent(agents.value, agentId.value)
  model.value = agent.defaultModel ?? ''
  if (!orchestratorAgentId.value) orchestratorModel.value = ''
}

const confirm = () =>
  emit('confirm', {
    agentId: agentId.value,
    model: model.value,
    orchestratorAgentId: orchestratorAgentId.value,
    orchestratorModel: orchestratorModel.value,
    terminalId: terminalId.value
  })
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal" role="alertdialog" aria-labelledby="auto-run-confirm-question">
      <p class="eyebrow">Auto Run · {{ lane.name }}</p>
      <p id="auto-run-confirm-question" class="auto-run-question">
        Run {{ ticketCount }} separate
        <select v-model="agentId" aria-label="Agent" @change="changeAgent">
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
        </select>
        agents with
        <ModelField
          v-model="model"
          :agent="findAgent(agents, agentId)"
          placeholder="CLI default"
        />
        for {{ ticketCount }} tickets?
      </p>
      <section v-if="!isHeadless" class="auto-run-orchestrator">
        <p class="eyebrow">Orchestrator</p>
        <div class="auto-run-orchestrator-fields">
          <label>
            Agent
            <select v-model="orchestratorAgentId" @change="orchestratorModel = ''">
              <option value="">Same as ticket agent</option>
              <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
            </select>
          </label>
          <label>
            Model
            <ModelField
              v-model="orchestratorModel"
              :agent="findAgent(agents, orchestratorAgentId || agentId)"
              :placeholder="orchestratorAgentId ? 'CLI default' : 'Same as ticket model'"
            />
          </label>
        </div>
      </section>
      <p class="auto-run-question">
        Each {{ isHeadless ? 'runs' : 'opens in its own' }}
        <select v-model="terminalId" aria-label="Shell">
          <option v-for="terminal in TERMINAL_TARGETS" :key="terminal.id" :value="terminal.id">
            {{ terminal.label }}
          </option>
          <option :value="HEADLESS_AUTO_RUN_ID">Headless</option>
        </select>
        {{ isHeadless ? 'in the background.' : 'tab.' }}
      </p>
      <p class="field-hint">
        {{
          autoRunUsesWorktrees(lane)
            ? 'Each runs in .worktrees/tN on its own branch, cut from freshly fetched main.'
            : 'All run in the project directory, on whatever branch it has checked out.'
        }}
      </p>
      <div class="modal-actions">
        <button class="secondary" @click="emit('close')">Cancel</button>
        <button @click="confirm">Run</button>
      </div>
    </section>
  </div>
</template>
