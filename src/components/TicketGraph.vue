<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  graphPositionRightOf,
  laneGraphPosition,
  laneTransitions,
  moveRule,
  promptRules,
  rulesToPrompt,
  type GraphPosition,
  type SwimLane,
  type Ticket
} from '@/shared/projectTypes'
import { graphPanelStyle } from '@/modalWidth'
import GraphPanelResizeHandle from '@/components/GraphPanelResizeHandle.vue'

type PromptField = 'agentPrompt' | 'orchestratorPrompt'
type LaneGraphPatch = Partial<Pick<SwimLane, PromptField | 'nextLaneId' | 'graphPosition'>>

const props = defineProps<{ projectName: string; lanes: SwimLane[]; boardLanes: SwimLane[]; tickets: Ticket[]; ticketOpen: boolean }>()
const emit = defineEmits<{ selection: []; editLane: [lane: SwimLane, patch: LaneGraphPatch]; addLane: [position: GraphPosition] }>()

// ponytail: free-form canvas, no zoom/pan or auto-layout. Add dagre if boards outgrow manual placement.
const NODE_WIDTH = 180
const CANVAS_MARGIN = 80
// y is a node's vertical center (translateY(-50%)), so this keeps its top edge on the canvas.
const NODE_HALF_HEIGHT = 29
const DRAG_THRESHOLD = 4

const canvasElement = ref<HTMLElement>()
const selectedLaneId = ref<string | null>(null)
const selectedEdgeFromId = ref<string | null>(null)
const selectedLane = computed(() => props.lanes.find(lane => lane.id === selectedLaneId.value))
const laneTicketCount = (id: string) => props.tickets.filter(ticket => ticket.laneId === id).length
const transitions = computed(() => laneTransitions(props.lanes, []))

// Mirrors completionMoves: a target only counts if it's another lane still on the board.
function movingTarget(fromLaneId: string, targetId: string | undefined) {
  const isOtherBoardLane = targetId !== fromLaneId && props.boardLanes.some(lane => lane.id === targetId)
  return isOtherBoardLane ? targetId : undefined
}
const boardTargetIds = computed(() => new Set(props.boardLanes.map(lane => movingTarget(lane.id, lane.nextLaneId))))

function laneLabel(id: string | undefined) {
  if (!id) return undefined
  const visibleLane = props.lanes.find(lane => lane.id === id)
  if (visibleLane) return visibleLane.name
  const boardLane = props.boardLanes.find(lane => lane.id === id)
  return boardLane ? `${boardLane.name} (hidden)` : undefined
}

// Positions while a node is mid-drag; the saved graphPosition takes over after drop.
const draggedPositions = ref(new Map<string, GraphPosition>())
const positionById = computed(() => new Map(props.lanes.map((lane, index) => {
  const position = draggedPositions.value.get(lane.id) ?? laneGraphPosition(lane, index)
  return [lane.id, position]
})))
const positionOf = (laneId: string) => positionById.value.get(laneId)!
const leftDot = (laneId: string) => positionOf(laneId)
const rightDot = (laneId: string) => {
  const position = positionOf(laneId)
  return { x: position.x + NODE_WIDTH, y: position.y }
}

function bezier(start: GraphPosition, end: GraphPosition, startDirection = 1) {
  const horizontalSpan = Math.abs(end.x - start.x)
  const pull = Math.max(40, horizontalSpan / 2)
  // An arrow pointing back left would run straight through the nodes between, so it loops below them.
  const isBackward = startDirection === 1 && end.x < start.x
  const loopDrop = isBackward ? 60 + horizontalSpan * 0.1 : 0
  const control1 = { x: start.x + pull * startDirection, y: start.y + loopDrop }
  const control2 = { x: end.x - pull, y: end.y + loopDrop }
  // A cubic's t = 0.5 point, for the edge's delete button.
  const middle = {
    x: (start.x + 3 * control1.x + 3 * control2.x + end.x) / 8,
    y: (start.y + 3 * control1.y + 3 * control2.y + end.y) / 8
  }
  const d = `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`
  return { d, middle }
}

// Arrows stop short of the target dot so it doesn't cover the arrowhead.
const DOT_RADIUS = 7
const edges = computed(() => transitions.value.map(transition => {
  const targetDot = leftDot(transition.to)
  const arrowTip = { x: targetDot.x - DOT_RADIUS, y: targetDot.y }
  const { d, middle } = bezier(rightDot(transition.from), arrowTip)
  return { from: transition.from, d, middle }
}))

const states = computed(() => props.lanes.map((lane, index) => {
  const isStart = index === 0
  return {
    lane,
    position: positionOf(lane.id),
    isTerminal: Boolean(lane.closesTicket) || !movingTarget(lane.id, lane.nextLaneId),
    // Hidden lanes still feed their Next Lane, so reachability uses the whole board.
    isUnreachable: !isStart && !boardTargetIds.value.has(lane.id)
  }
}))

const canvasSize = computed(() => {
  const positions = [...positionById.value.values()]
  const farthestX = Math.max(0, ...positions.map(position => position.x + NODE_WIDTH))
  const nodeYs = positions.map(position => position.y)
  // A backward arrow's loop bottoms out near its middle, below the nodes.
  const edgeMiddleYs = edges.value.map(edge => edge.middle.y)
  const lowestY = Math.max(0, ...nodeYs, ...edgeMiddleYs)
  return { width: farthestX + CANVAS_MARGIN, height: Math.max(400, lowestY + CANVAS_MARGIN) }
})

const entryEdge = computed(() => {
  const firstLane = props.lanes[0]
  if (!firstLane) return undefined
  const end = leftDot(firstLane.id)
  return `M ${Math.max(0, end.x - 44)} ${end.y} L ${end.x - DOT_RADIUS} ${end.y}`
})

function canvasPoint(event: PointerEvent): GraphPosition {
  const bounds = canvasElement.value!.getBoundingClientRect()
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}

// --- Node dragging: a press that never passes DRAG_THRESHOLD stays a click.
let nodeDrag: { lane: SwimLane; pointerStart: GraphPosition; nodeStart: GraphPosition; moved: boolean } | null = null
let suppressNextClick = false

function startNodeDrag(lane: SwimLane, event: PointerEvent) {
  if (event.button !== 0) return
  nodeDrag = { lane, pointerStart: canvasPoint(event), nodeStart: positionOf(lane.id), moved: false }
}

function moveNode(event: PointerEvent) {
  if (!nodeDrag) return
  const pointer = canvasPoint(event)
  const deltaX = pointer.x - nodeDrag.pointerStart.x
  const deltaY = pointer.y - nodeDrag.pointerStart.y
  if (!nodeDrag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return
  nodeDrag.moved = true
  const x = Math.max(0, Math.round(nodeDrag.nodeStart.x + deltaX))
  const y = Math.max(NODE_HALF_HEIGHT, Math.round(nodeDrag.nodeStart.y + deltaY))
  const nextPositions = new Map(draggedPositions.value)
  nextPositions.set(nodeDrag.lane.id, { x, y })
  draggedPositions.value = nextPositions
}

function dropNode() {
  if (!nodeDrag) return
  const { lane, moved } = nodeDrag
  nodeDrag = null
  if (!moved) return
  // The release may land off the button (clamped edge, own dot), so its click never comes; don't let the flag outlive this gesture.
  suppressNextClick = true
  setTimeout(() => { suppressNextClick = false })
  const graphPosition = draggedPositions.value.get(lane.id)!
  emit('editLane', lane, { graphPosition })
}

// The store saves positions through a queue, so a dropped node keeps its dragged spot until the new lanes arrive.
watch(() => props.lanes, () => {
  if (!draggedPositions.value.size || nodeDrag) return
  draggedPositions.value = new Map()
})

function cancelGestures() {
  nodeDrag = null
  draggedPositions.value = new Map()
  connection.value = null
}

function clickNode(laneId: string) {
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  selectLane(laneId)
}

// --- Drag-to-connect: release over another lane's dot sets the origin's Next Lane.
const connection = ref<{ fromLaneId: string; start: GraphPosition; startDirection: number; pointer: GraphPosition } | null>(null)
const connectionPath = computed(() => {
  const current = connection.value
  return current ? bezier(current.start, current.pointer, current.startDirection).d : undefined
})

function startConnection(laneId: string, side: 'left' | 'right', event: PointerEvent) {
  if (event.button !== 0) return
  const start = side === 'right' ? rightDot(laneId) : leftDot(laneId)
  connection.value = { fromLaneId: laneId, start, startDirection: side === 'right' ? 1 : -1, pointer: canvasPoint(event) }
}

function dropConnection(event: PointerEvent) {
  const current = connection.value
  if (!current) return
  connection.value = null
  const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY)
  const dropDot = elementUnderPointer?.closest<HTMLElement>('[data-dot-lane-id]')
  const targetLaneId = dropDot?.dataset.dotLaneId
  const originLane = props.lanes.find(lane => lane.id === current.fromLaneId)
  if (!originLane || !targetLaneId || targetLaneId === originLane.id) return
  emit('editLane', originLane, { nextLaneId: targetLaneId })
}

function onPointerMove(event: PointerEvent) {
  moveNode(event)
  if (connection.value) connection.value = { ...connection.value, pointer: canvasPoint(event) }
}
function onPointerUp(event: PointerEvent) {
  dropNode()
  dropConnection(event)
}

// --- Edge selection + delete.
function selectEdge(fromLaneId: string) {
  selectedEdgeFromId.value = fromLaneId
}
function deleteEdge(fromLaneId: string) {
  selectedEdgeFromId.value = null
  const lane = props.lanes.find(candidate => candidate.id === fromLaneId)
  if (lane) emit('editLane', lane, { nextLaneId: undefined })
}
function onKeyDown(event: KeyboardEvent) {
  const isDeleteKey = event.key === 'Delete' || event.key === 'Backspace'
  const fromLaneId = selectedEdgeFromId.value
  if (!isDeleteKey || !fromLaneId) return
  const target = event.target as HTMLElement | null
  const isTyping = target?.closest('input, textarea, select, [contenteditable="true"]')
  if (isTyping) return
  event.preventDefault()
  deleteEdge(fromLaneId)
}

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', cancelGestures)
  window.addEventListener('blur', cancelGestures)
  window.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', cancelGestures)
  window.removeEventListener('blur', cancelGestures)
  window.removeEventListener('keydown', onKeyDown)
})

function requestAddLane() {
  const positions = [...positionById.value.values()]
  emit('addLane', graphPositionRightOf(positions))
}

const transitionLines = computed(() => transitions.value.map(transition => ({
  key: `${transition.from}->${transition.to}`,
  text: `${laneLabel(transition.from)} → ${laneLabel(transition.to)}`
})))

const selectedLaneDetails = computed(() => {
  const lane = selectedLane.value
  if (!lane) return undefined
  const incoming = transitions.value
    .filter(transition => transition.to === lane.id)
    .map(transition => laneLabel(transition.from))
  const nextLaneId = movingTarget(lane.id, lane.nextLaneId)
  return { nextLaneName: laneLabel(nextLaneId), hasNextLane: Boolean(nextLaneId), incoming }
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

type RuleSlot = { field: PromptField; index: number }
const draggingRule = ref<RuleSlot | null>(null)
const ruleDropTarget = ref<RuleSlot | null>(null)
const ruleHandleToFocus = ref<RuleSlot | null>(null)
const vFocusWhen = {
  mounted(element: HTMLElement, binding: { value: boolean }) {
    if (binding.value) element.focus()
  }
}
const isSlot = (slot: RuleSlot | null, field: PromptField, index: number) => slot?.field === field && slot.index === index

function reorderRule(lane: SwimLane, field: PromptField, fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return
  saveRules(lane, field, moveRule(laneRules(lane, field), fromIndex, toIndex))
}
function startRuleDrag(field: PromptField, index: number, event: DragEvent) {
  draggingRule.value = { field, index }
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  const ruleRow = (event.currentTarget as HTMLElement).parentElement
  if (ruleRow) event.dataTransfer.setDragImage(ruleRow, 0, 0)
}
function endRuleDrag() {
  draggingRule.value = null
  ruleDropTarget.value = null
}
function dragOverRule(field: PromptField, index: number, event: DragEvent) {
  if (draggingRule.value?.field !== field) return
  event.preventDefault()
  ruleDropTarget.value = { field, index }
}
function dropRule(lane: SwimLane, field: PromptField, index: number, event: DragEvent) {
  const dragged = draggingRule.value
  if (dragged?.field !== field) return
  event.preventDefault()
  endRuleDrag()
  reorderRule(lane, field, dragged.index, index)
}
function dropIndicatorClass(field: PromptField, index: number) {
  const dragged = draggingRule.value
  if (!dragged || !isSlot(ruleDropTarget.value, field, index) || dragged.index === index) return undefined
  return dragged.index > index ? 'drop-before' : 'drop-after'
}
const ruleStepByKey: Record<string, number> = { ArrowUp: -1, ArrowDown: 1 }
function moveRuleByKey(lane: SwimLane, field: PromptField, index: number, event: KeyboardEvent) {
  const step = ruleStepByKey[event.key]
  if (!step) return
  event.preventDefault()
  const targetIndex = index + step
  const rules = laneRules(lane, field)
  const isSameText = rules[targetIndex] === rules[index]
  if (targetIndex < 0 || targetIndex >= rules.length || isSameText) return
  ruleHandleToFocus.value = { field, index: targetIndex }
  reorderRule(lane, field, index, targetIndex)
}

// Enter commits the rule (blur fires change); Shift+Enter still adds a line break.
function commitOnEnter(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  ;(event.target as HTMLTextAreaElement).blur()
}

function selectLane(id: string | null) {
  selectedLaneId.value = id
  selectedEdgeFromId.value = null
  addingRuleTo.value = null
  emit('selection')
}
</script>

<template>
  <section class="ticket-graph" aria-label="Lane graph">
    <div class="graph-scroll">
      <div ref="canvasElement" class="graph-canvas" :class="{ connecting: connection }" :style="{ height: `${canvasSize.height}px`, width: `${canvasSize.width}px` }" @click.self="selectedEdgeFromId = null">
        <svg class="graph-edges" :width="canvasSize.width" :height="canvasSize.height" aria-hidden="true">
          <defs><marker id="ticket-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
          <path v-if="entryEdge" class="graph-edge graph-edge-entry" :d="entryEdge" />
          <g v-for="edge in edges" :key="edge.from" class="graph-edge-group" :class="{ selected: selectedEdgeFromId === edge.from }" @click="selectEdge(edge.from)">
            <path class="graph-edge-hit" :d="edge.d" />
            <path class="graph-edge" :d="edge.d" />
          </g>
          <path v-if="connectionPath" class="graph-edge graph-edge-live" :d="connectionPath" />
        </svg>
        <template v-for="edge in edges" :key="`delete:${edge.from}`">
          <button
            v-if="selectedEdgeFromId === edge.from"
            class="graph-edge-delete"
            :style="{ left: `${edge.middle.x}px`, top: `${edge.middle.y}px` }"
            aria-label="Clear Next Lane"
            title="Clear Next Lane (Delete)"
            @click="deleteEdge(edge.from)"
          >×</button>
        </template>
        <div
          v-for="state in states"
          :key="state.lane.id"
          class="graph-lane-node"
          :style="{ top: `${state.position.y}px`, left: `${state.position.x}px` }"
        >
          <button
            :title="state.lane.name"
            class="graph-node graph-lane"
            :class="{ selected: selectedLaneId === state.lane.id && !ticketOpen, terminal: state.isTerminal, unreachable: state.isUnreachable }"
            @pointerdown="startNodeDrag(state.lane, $event)"
            @click="clickNode(state.lane.id)"
          ><small>Swim lane · {{ laneTicketCount(state.lane.id) }}</small>{{ state.lane.name }}</button>
          <span
            v-for="side in (['left', 'right'] as const)"
            :key="side"
            class="graph-dot"
            :class="`graph-dot-${side}`"
            :data-dot-lane-id="state.lane.id"
            :title="`Drag to set ${state.lane.name}'s Next Lane`"
            @pointerdown.stop.prevent="startConnection(state.lane.id, side, $event)"
          />
        </div>
      </div>
    </div>
    <div v-if="ticketOpen" class="graph-ticket-space" :style="graphPanelStyle" aria-hidden="true" />
    <GraphPanelResizeHandle v-if="!ticketOpen" />
    <aside v-if="!ticketOpen" class="graph-details" :style="graphPanelStyle" aria-label="Graph selection">
      <button v-if="selectedLane" class="secondary graph-back" @click="selectLane(null)">← {{ projectName }}</button>
      <p class="eyebrow">{{ selectedLane ? 'Swim lane' : 'Project' }}</p>
      <h2>{{ selectedLane?.name ?? projectName }}</h2>
      <template v-if="selectedLane && selectedLaneDetails">
        <p>{{ laneTicketCount(selectedLane.id) }} tickets</p>
        <p v-if="!selectedLaneDetails.hasNextLane">Next Lane: None — tickets stop here</p>
        <p v-else-if="selectedLaneDetails.nextLaneName">Next Lane: {{ selectedLaneDetails.nextLaneName }}</p>
        <p v-if="selectedLaneDetails.incoming.length">Incoming: {{ selectedLaneDetails.incoming.join(', ') }}</p>
        <section v-for="section in promptSections" :key="section.field" class="graph-rules" :aria-label="section.title">
          <h3 class="graph-details-heading">{{ section.title }}</h3>
          <p v-if="section.field === 'agentPrompt' && agentFileName(selectedLane)" class="field-hint">Additional context: {{ agentFileName(selectedLane) }}</p>
          <div
            v-for="(rule, index) in laneRules(selectedLane, section.field)"
            :key="`${index}:${rule}`"
            class="graph-rule"
            :class="dropIndicatorClass(section.field, index)"
            @dragover="dragOverRule(section.field, index, $event)"
            @dragleave="ruleDropTarget = null"
            @drop="dropRule(selectedLane, section.field, index, $event)"
          >
            <button
              v-focus-when="isSlot(ruleHandleToFocus, section.field, index)"
              class="secondary graph-rule-handle"
              draggable="true"
              :aria-label="`Reorder rule ${index + 1}`"
              title="Drag or use arrow keys to reorder"
              @dragstart="startRuleDrag(section.field, index, $event)"
              @dragend="endRuleDrag"
              @keydown="moveRuleByKey(selectedLane, section.field, index, $event)"
              @focus="ruleHandleToFocus = null"
            >☰</button>
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
        <button class="secondary graph-add-lane" @click="requestAddLane">+ Add swim lane</button>
        <button v-for="lane in lanes" :key="lane.id" class="graph-list-item secondary" @click="selectLane(lane.id)">{{ lane.name }} <span>{{ laneTicketCount(lane.id) }}</span></button>
        <h3 class="graph-details-heading">Transitions</h3>
        <p v-for="line in transitionLines" :key="line.key" class="graph-transition">{{ line.text }}</p>
        <p v-if="!transitionLines.length">No Next Lanes set.</p>
        <p class="field-hint">Drag a lane's edge dot onto another lane's dot to set its Next Lane. Click an arrow, then Delete, to clear it.</p>
      </template>
    </aside>
  </section>
</template>
