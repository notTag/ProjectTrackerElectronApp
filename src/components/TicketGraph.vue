<script setup lang="ts">
import { computed, ref } from 'vue'
import { effectiveNextLaneId, laneTransitions, promptRules, rulesToPrompt, type LaneTransition, type SwimLane, type Ticket } from '@/shared/projectTypes'

type PromptField = 'agentPrompt' | 'orchestratorPrompt'

const props = defineProps<{ projectName: string; lanes: SwimLane[]; boardLanes: SwimLane[]; tickets: Ticket[]; ticketOpen: boolean }>()
const emit = defineEmits<{ ticket: [id: string]; selection: []; editLane: [lane: SwimLane, patch: Partial<Pick<SwimLane, PromptField>>] }>()

// ponytail: hand-rolled layout, one row of states. Swap for a layered layout
// (e.g. dagre) if wide boards make the arcs unreadable.
const LEFT_MARGIN = 50
const COLUMN_WIDTH = 220
const NODE_WIDTH = 180
const NODE_HALF_HEIGHT = 26
const TICKET_SPACING = 64
const LABEL_ROOM = 24

const selectedLaneId = ref<string | null>(null)
const selectedLane = computed(() => props.lanes.find(lane => lane.id === selectedLaneId.value))
const laneTickets = (id: string) => props.tickets.filter(ticket => ticket.laneId === id)
const transitions = computed(() => laneTransitions(props.lanes, props.tickets))

const laneIndexById = computed(() => new Map(props.lanes.map((lane, index) => [lane.id, index])))
const laneCenterX = (index: number) => LEFT_MARGIN + index * COLUMN_WIDTH + NODE_WIDTH / 2
const arcHeight = (span: number) => 24 + 22 * span

// Mirrors completionMoves: a target only counts if it's another lane still on the board.
function movingTarget(fromLaneId: string, targetId: string | undefined) {
  const isOtherBoardLane = targetId !== fromLaneId && props.boardLanes.some(lane => lane.id === targetId)
  return isOtherBoardLane ? targetId : undefined
}
const boardTargetIds = computed(() => new Set(props.boardLanes.map(lane => movingTarget(lane.id, lane.nextLaneId))))
const willMove = (ticket: Ticket, lane: SwimLane) => Boolean(ticket.moveOnComplete && movingTarget(lane.id, effectiveNextLaneId(ticket, lane)))

const transitionKey = (transition: LaneTransition) => `${transition.kind}:${transition.from}->${transition.to}`
function ticketCountLabel(transition: LaneTransition) {
  const ticketCount = transition.ticketIds.length
  return `${ticketCount} ticket${ticketCount === 1 ? '' : 's'}`
}

function laneLabel(id: string | undefined) {
  if (!id) return undefined
  const visibleLane = props.lanes.find(lane => lane.id === id)
  if (visibleLane) return visibleLane.name
  const boardLane = props.boardLanes.find(lane => lane.id === id)
  return boardLane ? `${boardLane.name} (hidden)` : undefined
}

function edgeGeometry(transition: LaneTransition) {
  const fromIndex = laneIndexById.value.get(transition.from)!
  const toIndex = laneIndexById.value.get(transition.to)!
  const isForward = toIndex > fromIndex
  const isOverride = transition.kind === 'override'
  const span = Math.abs(toIndex - fromIndex)
  const height = arcHeight(span) + (isOverride ? 14 : 0)
  // Overrides leave and land a little further out so they don't overlap the lane edge.
  const endInset = isOverride ? 40 : 20
  const direction = isForward ? 1 : -1
  const startX = laneCenterX(fromIndex) + endInset * direction
  const endX = laneCenterX(toIndex) - endInset * direction
  return { isForward, height, startX, endX }
}

const layout = computed(() => {
  const edges = transitions.value.map(transition => ({ transition, ...edgeGeometry(transition) }))
  const forwardHeights = edges.filter(edge => edge.isForward).map(edge => edge.height)
  const backwardHeights = edges.filter(edge => !edge.isForward).map(edge => edge.height)
  const forwardBand = Math.max(0, ...forwardHeights) * 0.75 + LABEL_ROOM
  const backwardBand = Math.max(0, ...backwardHeights) * 0.75 + LABEL_ROOM

  const stateY = 20 + forwardBand + NODE_HALF_HEIGHT
  const stateTop = stateY - NODE_HALF_HEIGHT
  const stateBottom = stateY + NODE_HALF_HEIGHT
  const ticketsTop = stateBottom + backwardBand + 20

  const paths = edges.map(edge => {
    const anchorY = edge.isForward ? stateTop : stateBottom
    const controlY = edge.isForward ? anchorY - edge.height : anchorY + edge.height
    // A cubic's apex sits 3/4 of the way to its control points.
    const apexY = anchorY + (controlY - anchorY) * 0.75
    const labelY = edge.isForward ? apexY - 4 : apexY + 12
    const d = `M ${edge.startX} ${anchorY} C ${edge.startX} ${controlY}, ${edge.endX} ${controlY}, ${edge.endX} ${anchorY}`
    const isOverride = edge.transition.kind === 'override'
    const label = isOverride ? ticketCountLabel(edge.transition) : ''
    const labelX = (edge.startX + edge.endX) / 2
    return { key: transitionKey(edge.transition), d, kind: edge.transition.kind, label, labelX, labelY }
  })

  // Hidden lanes still feed their Next Lane, so reachability uses the whole board.
  const visibleTargetIds = transitions.value.map(transition => transition.to)
  const targetIds = new Set([...boardTargetIds.value, ...visibleTargetIds])
  const states = props.lanes.map((lane, index) => {
    const isStart = index === 0
    const tickets = laneTickets(lane.id)
    const nodes = tickets.map((ticket, ticketIndex) => ({ ticket, y: ticketsTop + NODE_HALF_HEIGHT + ticketIndex * TICKET_SPACING }))
    return {
      lane,
      x: LEFT_MARGIN + index * COLUMN_WIDTH,
      nodes,
      isTerminal: Boolean(lane.closesTicket) || !movingTarget(lane.id, lane.nextLaneId),
      isUnreachable: !isStart && !targetIds.has(lane.id)
    }
  })

  const tallestColumn = Math.max(0, ...states.map(state => state.nodes.length))
  const height = Math.max(400, ticketsTop + tallestColumn * TICKET_SPACING + 20)
  const width = LEFT_MARGIN + props.lanes.length * COLUMN_WIDTH
  return { states, paths, stateY, height, width }
})

const transitionLines = computed(() => transitions.value.map(transition => {
  const from = laneLabel(transition.from)
  const to = laneLabel(transition.to)
  const overrideNote = transition.kind === 'override' ? ` (${ticketCountLabel(transition)})` : ''
  return { key: transitionKey(transition), text: `${from} → ${to}${overrideNote}` }
}))

const selectedLaneDetails = computed(() => {
  const lane = selectedLane.value
  if (!lane) return undefined
  const incoming = transitions.value
    .filter(transition => transition.to === lane.id)
    .map(transition => laneLabel(transition.from))
  const uniqueIncoming = [...new Set(incoming)]
  const overrides = laneTickets(lane.id)
    .map(ticket => ({ ticket, target: effectiveNextLaneId(ticket, lane) }))
    .filter(({ target }) => target && target !== lane.nextLaneId)
    .map(({ ticket, target }) => ({ ticket, targetName: laneLabel(target) }))
    .filter(({ targetName }) => targetName)
  const nextLaneId = movingTarget(lane.id, lane.nextLaneId)
  return { nextLaneName: laneLabel(nextLaneId), hasNextLane: Boolean(nextLaneId), incoming: uniqueIncoming, overrides }
})

const promptSections: { field: PromptField; title: string }[] = [
  { field: 'agentPrompt', title: 'Agent prompt' },
  { field: 'orchestratorPrompt', title: 'Orchestrator prompt' }
]
const addingRuleTo = ref<PromptField | null>(null)
const vFocus = { mounted: (element: HTMLElement) => element.focus() }
const laneRules = (lane: SwimLane, field: PromptField) => promptRules(lane[field] ?? '')
const agentFileName = (lane: SwimLane) => lane.agentFilePath.trim().split('/').pop()

function saveRules(lane: SwimLane, field: PromptField, rules: string[]) {
  const keptRules = rules.map(rule => rule.trim()).filter(Boolean)
  emit('editLane', lane, { [field]: rulesToPrompt(keptRules) })
}
function editRule(lane: SwimLane, field: PromptField, index: number, text: string) {
  const rules = laneRules(lane, field)
  rules[index] = text
  saveRules(lane, field, rules)
}
function deleteRule(lane: SwimLane, field: PromptField, index: number) {
  const remainingRules = laneRules(lane, field).filter((_, ruleIndex) => ruleIndex !== index)
  saveRules(lane, field, remainingRules)
}
function addRule(lane: SwimLane, field: PromptField, text: string) {
  addingRuleTo.value = null
  if (text.trim()) saveRules(lane, field, [...laneRules(lane, field), text])
}
// Enter commits the rule (blur fires change); Shift+Enter still adds a line break.
function commitOnEnter(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  ;(event.target as HTMLTextAreaElement).blur()
}

function selectLane(id: string | null) {
  selectedLaneId.value = id
  addingRuleTo.value = null
  emit('selection')
}
</script>

<template>
  <section class="ticket-graph" aria-label="Ticket graph">
    <div class="graph-scroll">
      <div class="graph-canvas" :style="{ height: `${layout.height}px`, width: `${layout.width}px` }">
        <svg class="graph-edges" :width="layout.width" :height="layout.height" aria-hidden="true">
          <defs><marker id="ticket-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
          <path v-if="layout.states.length" class="graph-edge graph-edge-entry" :d="`M 6 ${layout.stateY} L ${LEFT_MARGIN - 4} ${layout.stateY}`" />
          <template v-for="edge in layout.paths" :key="edge.key">
            <path class="graph-edge" :class="`graph-edge-${edge.kind}`" :d="edge.d" />
            <text v-if="edge.label" class="graph-edge-label" :x="edge.labelX" :y="edge.labelY" text-anchor="middle">{{ edge.label }}</text>
          </template>
        </svg>
        <template v-for="state in layout.states" :key="state.lane.id">
          <button
            :title="state.lane.name"
            class="graph-node graph-lane"
            :class="{ selected: selectedLaneId === state.lane.id && !ticketOpen, terminal: state.isTerminal, unreachable: state.isUnreachable }"
            :style="{ top: `${layout.stateY}px`, left: `${state.x}px` }"
            @click="selectLane(state.lane.id)"
          ><small>Swim lane · {{ state.nodes.length }}</small>{{ state.lane.name }}</button>
          <button
            v-for="node in state.nodes"
            :key="node.ticket.id"
            :title="node.ticket.title"
            class="graph-node graph-ticket"
            :style="{ top: `${node.y}px`, left: `${state.x}px` }"
            @click="emit('ticket', node.ticket.id)"
          ><small>#{{ node.ticket.number }}<span v-if="willMove(node.ticket, state.lane)" class="graph-armed" title="Moves to its Next Lane on completion"> ▶</span></small>{{ node.ticket.title }}</button>
        </template>
      </div>
    </div>
    <div v-if="ticketOpen" class="graph-ticket-space" aria-hidden="true" />
    <aside v-if="!ticketOpen" class="graph-details" aria-label="Graph selection">
      <button v-if="selectedLane" class="secondary graph-back" @click="selectLane(null)">← {{ projectName }}</button>
      <p class="eyebrow">{{ selectedLane ? 'Swim lane' : 'Project' }}</p>
      <h2>{{ selectedLane?.name ?? projectName }}</h2>
      <template v-if="selectedLane && selectedLaneDetails">
        <p>{{ laneTickets(selectedLane.id).length }} tickets</p>
        <p v-if="!selectedLaneDetails.hasNextLane">Next Lane: None — tickets stop here</p>
        <p v-else-if="selectedLaneDetails.nextLaneName">Next Lane: {{ selectedLaneDetails.nextLaneName }}</p>
        <p v-if="selectedLaneDetails.incoming.length">Incoming: {{ selectedLaneDetails.incoming.join(', ') }}</p>
        <template v-if="selectedLaneDetails.overrides.length">
          <h3 class="graph-details-heading">Ticket overrides</h3>
          <button v-for="override in selectedLaneDetails.overrides" :key="override.ticket.id" class="graph-list-item secondary" @click="emit('ticket', override.ticket.id)">#{{ override.ticket.number }} → {{ override.targetName }}</button>
        </template>
        <section v-for="section in promptSections" :key="section.field" class="graph-rules" :aria-label="section.title">
          <h3 class="graph-details-heading">{{ section.title }}</h3>
          <p v-if="section.field === 'agentPrompt' && agentFileName(selectedLane)" class="field-hint">Also follows: {{ agentFileName(selectedLane) }}</p>
          <div v-for="(rule, index) in laneRules(selectedLane, section.field)" :key="`${index}:${rule}`" class="graph-rule">
            <textarea
              rows="1"
              :value="rule"
              :aria-label="`${section.title} rule ${index + 1}`"
              @keydown="commitOnEnter"
              @change="editRule(selectedLane, section.field, index, ($event.target as HTMLTextAreaElement).value)"
            />
            <button class="secondary graph-rule-delete" :aria-label="`Delete rule ${index + 1}`" title="Delete rule" @click="deleteRule(selectedLane, section.field, index)">×</button>
          </div>
          <p v-if="!laneRules(selectedLane, section.field).length && addingRuleTo !== section.field">No rules yet</p>
          <div v-if="addingRuleTo === section.field" class="graph-rule">
            <textarea
              v-focus
              rows="1"
              :aria-label="`New ${section.title} rule`"
              @keydown="commitOnEnter"
              @blur="addRule(selectedLane, section.field, ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
          <button v-else class="secondary graph-rule-add" @click="addingRuleTo = section.field">+ Add rule</button>
        </section>
      </template>
      <template v-else>
        <p>{{ lanes.length }} swim lanes</p>
        <button v-for="lane in lanes" :key="lane.id" class="graph-list-item secondary" @click="selectLane(lane.id)">{{ lane.name }} <span>{{ laneTickets(lane.id).length }}</span></button>
        <h3 class="graph-details-heading">Transitions</h3>
        <p v-for="line in transitionLines" :key="line.key" class="graph-transition">{{ line.text }}</p>
        <p v-if="!transitionLines.length">No Next Lanes set.</p>
      </template>
    </aside>
  </section>
</template>
