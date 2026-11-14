<script setup lang="ts">
import { computed, ref } from 'vue'
import { effectiveNextLaneId, laneTransitions, type LaneTransition, type SwimLane, type Ticket } from '@/shared/projectTypes'

const props = defineProps<{ projectName: string; lanes: SwimLane[]; boardLanes: SwimLane[]; tickets: Ticket[]; ticketOpen: boolean }>()
const emit = defineEmits<{ ticket: [id: string]; selection: [] }>()

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
    const ticketCount = edge.transition.ticketIds.length
    const label = edge.transition.kind === 'override' ? `${ticketCount} ticket${ticketCount === 1 ? '' : 's'}` : ''
    return { key: `${edge.transition.kind}:${edge.transition.from}->${edge.transition.to}`, d, kind: edge.transition.kind, label, labelX: (edge.startX + edge.endX) / 2, labelY }
  })

  const targetIds = new Set(transitions.value.map(transition => transition.to))
  const states = props.lanes.map((lane, index) => {
    const isStart = index === 0
    const tickets = laneTickets(lane.id)
    const nodes = tickets.map((ticket, ticketIndex) => ({ ticket, y: ticketsTop + NODE_HALF_HEIGHT + ticketIndex * TICKET_SPACING }))
    return {
      lane,
      x: LEFT_MARGIN + index * COLUMN_WIDTH,
      nodes,
      isTerminal: Boolean(lane.closesTicket) || !lane.nextLaneId,
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
  const ticketCount = transition.ticketIds.length
  const overrideNote = transition.kind === 'override' ? ` (${ticketCount} ticket${ticketCount === 1 ? '' : 's'})` : ''
  return { key: `${transition.kind}:${transition.from}->${transition.to}`, text: `${from} → ${to}${overrideNote}` }
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
  return { nextLaneName: laneLabel(lane.nextLaneId), hasNextLane: Boolean(lane.nextLaneId), incoming: uniqueIncoming, overrides }
})

function selectLane(id: string | null) {
  selectedLaneId.value = id
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
          ><small>#{{ node.ticket.number }}<span v-if="node.ticket.moveOnComplete" class="graph-armed" title="Moves to its Next Lane on completion"> ▶</span></small>{{ node.ticket.title }}</button>
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
        <h3 class="graph-details-heading">Tickets</h3>
        <button v-for="ticket in laneTickets(selectedLane.id)" :key="ticket.id" class="graph-list-item secondary" @click="emit('ticket', ticket.id)">#{{ ticket.number }} · {{ ticket.title }}</button>
        <p v-if="!laneTickets(selectedLane.id).length">No tickets match the current filters.</p>
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
