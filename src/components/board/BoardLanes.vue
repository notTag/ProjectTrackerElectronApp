<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import LaneCardList from '@/components/LaneCardList.vue'
import TicketCard from '@/components/TicketCard.vue'
import { pageFindActive } from '@/pageFind'
import {
  DEFAULT_LANE_WIDTH,
  carriedTicketIds,
  clampLaneWidth,
  findAgent,
  hasUnseenAgentResult,
  isFullAuto,
  isReadyToMove,
  laneColumns,
  placeLaneInBoard,
  setLaneWidth,
  ticketIdsToMove,
  UNASSIGNED_LANE_ID,
  type LanePlacement,
  type SwimLane,
  type Ticket
} from '@/shared/projectTypes'
import { useBoardContext } from './boardContext'

const props = defineProps<{
  visibleLanes: SwimLane[]
  visibleTickets: Ticket[]
  ticketsInLane: (laneId: string) => Ticket[]
  autoRunTicketCount: (lane: SwimLane) => number
  laneFilterNarrows: boolean
  selectedTicketIds: Set<string>
}>()
const emit = defineEmits<{
  openTicket: [ticketId: string]
  openLane: [laneId: string]
  autoRun: [lane: SwimLane]
  newTicket: [laneId: string]
  newLane: []
  toggleSelected: [ticketId: string]
}>()

const {
  store,
  projectPath,
  board,
  agents,
  preferences,
  savePreferences,
  assigneeName,
  laneName,
  laneOfTicket,
  autoRunTerminal
} = useBoardContext()

// Held as one object so a drag reads its own start point rather than a set of
// refs that can fall out of sync when a second pointer arrives.
const laneResize = ref<{ laneId: string; startX: number; startWidth: number; width: number } | null>(null)

const boardColumns = computed(() => laneColumns(board.value.lanes))

const columnTopIdByLaneId = computed(() => {
  const topIds = new Map<string, string>()
  for (const column of boardColumns.value) {
    for (const lane of column) topIds.set(lane.id, column[0].id)
  }
  return topIds
})

const columnTopId = (laneId: string) => columnTopIdByLaneId.value.get(laneId) ?? laneId

const visibleColumns = computed(() => {
  const visibleLaneById = new Map(props.visibleLanes.map((lane) => [lane.id, lane]))
  const unassignedColumns = props.visibleLanes.filter((lane) => lane.id === UNASSIGNED_LANE_ID).map((lane) => [lane])
  const visibleBoardColumns = boardColumns.value
    .map((column) => column.flatMap((lane) => visibleLaneById.get(lane.id) ?? []))
    .filter((column) => column.length > 0)
  return [...unassignedColumns, ...visibleBoardColumns]
})

const movableVisibleColumns = computed(() =>
  visibleColumns.value.filter((column) => column[0].id !== UNASSIGNED_LANE_ID)
)

const laneWidth = (laneId: string) => {
  const widthOwnerId = columnTopId(laneId)
  if (laneResize.value?.laneId === widthOwnerId) return laneResize.value.width
  return preferences.value.laneWidths[widthOwnerId] ?? DEFAULT_LANE_WIDTH
}

const startLaneResize = (lane: SwimLane, event: PointerEvent) => {
  const startWidth = laneWidth(lane.id)
  laneResize.value = { laneId: columnTopId(lane.id), startX: event.clientX, startWidth, width: startWidth }
  // Capture keeps move and up events on the handle even when the pointer runs
  // ahead of it, so a fast drag never strands the lane mid-resize.
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const trackLaneResize = (event: PointerEvent) => {
  const resize = laneResize.value
  if (!resize) return
  resize.width = clampLaneWidth(resize.startWidth + event.clientX - resize.startX)
}

// Saved once on release rather than on every move: a drag is one width change,
// not a hundred writes to disk.
const endLaneResize = async () => {
  const resize = laneResize.value
  laneResize.value = null
  if (!resize || resize.width === resize.startWidth) return
  await savePreferences(setLaneWidth(preferences.value, resize.laneId, resize.width))
}

// Lane order is board data, shared by every user, so a move goes through the
// store rather than preferences. Only rendered lanes can be anchors; the
// helper's id anchoring keeps hidden lanes where they were.
const boardElement = ref<HTMLElement | null>(null)

// A filtered board shows a subset of lanes, so a drop position among them is
// ambiguous against the full order — and with one lane, "before nothing" would
// send it to the end.
const laneCanMove = (laneId: string) => laneId !== UNASSIGNED_LANE_ID && !props.laneFilterNarrows

const movableVisibleLanes = computed(() => props.visibleLanes.filter((lane) => lane.id !== UNASSIGNED_LANE_ID))

const LANE_DRAG_THRESHOLD_PX = 4

type DropIndicator = { orientation: 'vertical' | 'horizontal'; left: number; top: number; length: number }

const laneDrag = ref<{
  laneId: string
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  active: boolean
  placement: LanePlacement | null
  indicator: DropIndicator | null
} | null>(null)

// A drag ends with a click on the header; two quick drags would read as a
// double-click and open a ticket draft. Remembering when the last drag ended
// lets the double-click handler tell them apart.
let lastLaneDragEndedAt = 0
const LANE_DRAG_DBLCLICK_GRACE_MS = 500

const startTicketDraftFromHeading = (laneId: string) => {
  const endedRecently = performance.now() - lastLaneDragEndedAt < LANE_DRAG_DBLCLICK_GRACE_MS
  if (!endedRecently) emit('newTicket', laneId)
}

const startLaneDrag = (lane: SwimLane, event: PointerEvent) => {
  const pressedHeaderButton = (event.target as HTMLElement).closest('button')
  if (event.button !== 0 || pressedHeaderButton || !laneCanMove(lane.id)) return
  laneDrag.value = {
    laneId: lane.id,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: 0,
    offsetY: 0,
    active: false,
    placement: null,
    indicator: null
  }
  // Captured straight away (as the resize handle does) so a fast flick that
  // leaves the header before the threshold still arrives here.
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const HALF_BOARD_GAP_PX = 6

const isDropCandidate = (laneId: string | undefined, draggedLaneId: string) =>
  laneId !== undefined && laneId !== draggedLaneId && laneId !== UNASSIGNED_LANE_ID

const stackTargetAt = (pointerX: number, pointerY: number, draggedLaneId: string) => {
  const laneElements = boardElement.value?.querySelectorAll<HTMLElement>('.lane[data-lane-id]') ?? []
  for (const element of laneElements) {
    const laneId = element.dataset.laneId
    if (!laneId || !isDropCandidate(laneId, draggedLaneId)) continue
    const rect = element.getBoundingClientRect()
    const insideX = pointerX >= rect.left && pointerX <= rect.right
    const insideY = pointerY >= rect.top && pointerY <= rect.bottom
    if (!insideX || !insideY) continue
    const heightFraction = (pointerY - rect.top) / rect.height
    const side = heightFraction < 1 / 3 ? 'above' : heightFraction > 2 / 3 ? 'below' : null
    if (!side) return null
    const gapAboveTop = Math.max(0, element.offsetTop - HALF_BOARD_GAP_PX)
    const gapBelowTop = element.offsetTop + element.offsetHeight + HALF_BOARD_GAP_PX
    const edgeTop = side === 'above' ? gapAboveTop : gapBelowTop
    const placement: LanePlacement = { kind: 'stack', anchorLaneId: laneId, side }
    const indicator: DropIndicator = { orientation: 'horizontal', left: element.offsetLeft, top: edgeTop, length: element.offsetWidth }
    return { placement, indicator }
  }
  return null
}

const columnTargetAt = (pointerX: number, draggedLaneId: string) => {
  const columnElements = boardElement.value?.querySelectorAll<HTMLElement>('.lane-column') ?? []
  const candidateColumns = Array.from(columnElements).flatMap((element) => {
    const laneIds = Array.from(element.querySelectorAll<HTMLElement>('.lane[data-lane-id]'), (lane) => lane.dataset.laneId)
    const topLaneId = laneIds.find((laneId) => laneId !== draggedLaneId)
    return isDropCandidate(topLaneId, draggedLaneId) ? [{ element, topLaneId: topLaneId as string }] : []
  })
  const anchor = candidateColumns.find(({ element }) => {
    const rect = element.getBoundingClientRect()
    return rect.left + rect.width / 2 > pointerX
  })
  const lastColumn = candidateColumns.at(-1)?.element
  let indicatorLeft: number | null = null
  if (anchor) indicatorLeft = anchor.element.offsetLeft - HALF_BOARD_GAP_PX
  else if (lastColumn) indicatorLeft = lastColumn.offsetLeft + lastColumn.offsetWidth + HALF_BOARD_GAP_PX
  const placement: LanePlacement = { kind: 'column', beforeLaneId: anchor?.topLaneId ?? null }
  const indicator: DropIndicator | null =
    indicatorLeft === null ? null : { orientation: 'vertical', left: indicatorLeft, top: 0, length: 0 }
  return { placement, indicator }
}

const trackLaneDrag = (event: PointerEvent) => {
  const drag = laneDrag.value
  if (!drag) return
  drag.offsetX = event.clientX - drag.startX
  drag.offsetY = event.clientY - drag.startY
  const pointerTravel = Math.hypot(drag.offsetX, drag.offsetY)
  if (!drag.active && pointerTravel < LANE_DRAG_THRESHOLD_PX) return
  drag.active = true
  const target = stackTargetAt(event.clientX, event.clientY, drag.laneId) ?? columnTargetAt(event.clientX, drag.laneId)
  const dropWouldMoveNothing = placeLaneInBoard(board.value, drag.laneId, target.placement) === board.value
  drag.placement = target.placement
  drag.indicator = dropWouldMoveNothing ? null : target.indicator
}

const pointerIsOverBoard = (event: PointerEvent) => {
  const rect = boardElement.value?.getBoundingClientRect()
  if (!rect) return false
  const insideX = event.clientX >= rect.left && event.clientX <= rect.right
  const insideY = event.clientY >= rect.top && event.clientY <= rect.bottom
  return insideX && insideY
}

const cancelLaneDrag = () => {
  if (laneDrag.value?.active) lastLaneDragEndedAt = performance.now()
  laneDrag.value = null
}

// A refresh, filter or hide can unmount the dragged header mid-drag. Its
// lostpointercapture then fires at the document, not the header, so the
// drag would never end on its own.
watch(movableVisibleLanes, (lanes) => {
  const drag = laneDrag.value
  if (!drag) return
  const draggedLaneStillShown = lanes.some((lane) => lane.id === drag.laneId)
  if (!draggedLaneStillShown || !laneCanMove(drag.laneId)) cancelLaneDrag()
})

// Saved once on release, like the resize. A drop outside the board writes
// nothing; a drop into the lane's own slot is a no-op the store skips. The
// store places the lane at once and puts it back if the save fails.
const endLaneDrag = async (event: PointerEvent) => {
  const drag = laneDrag.value
  const droppedOnBoard = pointerIsOverBoard(event)
  cancelLaneDrag()
  if (!drag?.active || !droppedOnBoard || !drag.placement) return
  await store.placeLane(projectPath.value, drag.laneId, drag.placement)
}

const laneDragStyle = (laneId: string) => {
  const drag = laneDrag.value
  if (drag?.active && drag.laneId === laneId) return { transform: `translate(${drag.offsetX}px, ${drag.offsetY}px)` }
  return {}
}

const dropIndicatorStyle = (indicator: DropIndicator) => {
  if (indicator.orientation === 'vertical') return { left: `${indicator.left}px` }
  return { left: `${indicator.left}px`, top: `${indicator.top}px`, width: `${indicator.length}px` }
}

const focusLaneHeading = (laneId: string) => {
  const escapedLaneId = CSS.escape(laneId)
  const headingSelector = `.lane[data-lane-id="${escapedLaneId}"] .lane-heading`
  const heading = boardElement.value?.querySelector<HTMLElement>(headingSelector)
  heading?.focus()
}

const LANE_MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

const keyboardPlacement = (laneId: string, key: string): LanePlacement | null => {
  const columns = movableVisibleColumns.value
  const columnIndex = columns.findIndex((column) => column.some((lane) => lane.id === laneId))
  const column = columns[columnIndex]
  if (!column) return null
  const stackIndex = column.findIndex((lane) => lane.id === laneId)
  const laneAbove = column[stackIndex - 1]
  const laneBelow = column[stackIndex + 1]
  const isStacked = column.length > 1
  const columnToTheLeft = columns[columnIndex - 1]
  const columnToTheRight = columns[columnIndex + 1]
  const columnTwoToTheRight = columns[columnIndex + 2]

  if (key === 'ArrowUp') return laneAbove ? { kind: 'stack', anchorLaneId: laneAbove.id, side: 'above' } : null
  if (key === 'ArrowDown') return laneBelow ? { kind: 'stack', anchorLaneId: laneBelow.id, side: 'below' } : null
  if (key === 'ArrowLeft' && isStacked) {
    const restOfStackTop = column.find((lane) => lane.id !== laneId) as SwimLane
    return { kind: 'column', beforeLaneId: restOfStackTop.id }
  }
  if (key === 'ArrowLeft') return columnToTheLeft ? { kind: 'column', beforeLaneId: columnToTheLeft[0].id } : null
  if (isStacked) return { kind: 'column', beforeLaneId: columnToTheRight?.[0].id ?? null }
  if (!columnToTheRight) return null
  return { kind: 'column', beforeLaneId: columnTwoToTheRight?.[0].id ?? null }
}

const moveLaneByKeyboard = async (lane: SwimLane, event: KeyboardEvent) => {
  // Keys bubbling up from the ▶ / ⚙ buttons inside the header aren't a lane move.
  const fromHeadingItself = event.target === event.currentTarget
  if (!fromHeadingItself || !event.altKey || !LANE_MOVE_KEYS.has(event.key) || !laneCanMove(lane.id)) return
  event.preventDefault()
  const placement = keyboardPlacement(lane.id, event.key)
  if (!placement) return
  // placeLane places the lane synchronously, so focus is restored after the
  // re-render rather than after the save; a quick second press still lands.
  const saving = store.placeLane(projectPath.value, lane.id, placement)
  // The keyed v-for may re-insert the moved lane's DOM node, which drops focus.
  await nextTick()
  focusLaneHeading(lane.id)
  await saving
}

const autoRunTooltip = (lane: SwimLane) => {
  const terminalLabel = autoRunTerminal(lane).label
  const agentName = findAgent(agents.value, lane.autoRunAgentId).name
  const ticketCount = props.autoRunTicketCount(lane)
  return `Auto Run ${ticketCount} — one ${terminalLabel} tab per ticket, running ${agentName}`
}

// Trailing "+" zone: shown on hover, lingers after the pointer leaves so it
// doesn't vanish mid-reach. Re-entering just cancels the pending hide.
const ADD_ZONE_HIDE_DELAY_MS = 3000
const addZoneShown = ref(false)
let addZoneHideTimer: ReturnType<typeof setTimeout> | undefined

const showAddZone = () => {
  clearTimeout(addZoneHideTimer)
  addZoneShown.value = true
}

const hideAddZoneNow = () => {
  clearTimeout(addZoneHideTimer)
  addZoneShown.value = false
}

const hideAddZoneLater = () => {
  clearTimeout(addZoneHideTimer)
  addZoneHideTimer = setTimeout(hideAddZoneNow, ADD_ZONE_HIDE_DELAY_MS)
}

onBeforeUnmount(() => clearTimeout(addZoneHideTimer))

const draggedTicketId = ref<string | null>(null)

const carriedIds = computed(() => {
  const ticketId = draggedTicketId.value
  if (!ticketId) return new Set<string>()
  return new Set(carriedTicketIds(ticketId, props.selectedTicketIds, props.visibleTickets))
})

const isCarriedBehind = (ticketId: string) => carriedIds.value.has(ticketId) && ticketId !== draggedTicketId.value

const MAX_STACK_LAYERS = 3
// Matches .ticket-drag-stack padding in styles.css.
const STACK_GHOST_PADDING = 8

// setDragImage snapshots the element when called, so the ghost must be in the
// DOM and painted (off-screen, not display:none); it is removed a frame later.
const buildStackGhost = (card: HTMLElement, carriedCount: number): HTMLElement => {
  const ghost = document.createElement('div')
  ghost.className = 'ticket-drag-stack'
  ghost.style.width = `${card.offsetWidth}px`
  const layersBehind = Math.min(carriedCount, MAX_STACK_LAYERS) - 1
  for (let depth = layersBehind; depth >= 1; depth--) {
    const layer = document.createElement('div')
    layer.className = 'ticket-drag-layer'
    layer.style.setProperty('--stack-depth', String(depth))
    ghost.append(layer)
  }
  const frontCard = card.cloneNode(true) as HTMLElement
  frontCard.classList.add('ticket-drag-front')
  const countBadge = document.createElement('span')
  countBadge.className = 'ticket-drag-count'
  countBadge.textContent = String(carriedCount)
  ghost.append(frontCard, countBadge)
  return ghost
}

const startTicketDrag = (event: DragEvent, ticketId: string) => {
  draggedTicketId.value = ticketId
  const carriedCount = carriedIds.value.size
  const card = event.currentTarget as HTMLElement
  if (carriedCount < 2 || !event.dataTransfer) return
  const ghost = buildStackGhost(card, carriedCount)
  document.body.append(ghost)
  const cardBounds = card.getBoundingClientRect()
  const pointerX = event.clientX - cardBounds.left + STACK_GHOST_PADDING
  const pointerY = event.clientY - cardBounds.top + STACK_GHOST_PADDING
  event.dataTransfer.setDragImage(ghost, pointerX, pointerY)
  requestAnimationFrame(() => ghost.remove())
}

const dropOnLane = async (laneId: string) => {
  const ticketId = draggedTicketId.value
  draggedTicketId.value = null
  if (!ticketId) return
  const ticketIds = ticketIdsToMove(ticketId, props.selectedTicketIds, props.visibleTickets, laneId)
  await store.moveTickets(projectPath.value, ticketIds, laneId)
}

const readyLaneNameByTicketId = computed(() => {
  const names = new Map<string, string>()
  for (const ticket of board.value.tickets) {
    const targetLaneId = isReadyToMove(ticket, board.value)
    if (targetLaneId) names.set(ticket.id, laneName(targetLaneId))
  }
  return names
})

// A re-running ticket shows the running dot, not its old result, so the lane
// count leaves it out too.
const showsUnseenResult = (ticket: Ticket) => !store.agentRunning[ticket.id] && hasUnseenAgentResult(ticket)
const unseenCountByLaneId = computed(() => {
  const counts = new Map<string, number>()
  for (const lane of props.visibleLanes) counts.set(lane.id, props.ticketsInLane(lane.id).filter(showsUnseenResult).length)
  return counts
})
const unseenAgentResultCount = (laneId: string) => unseenCountByLaneId.value.get(laneId) ?? 0

// Claimed first in BoardView's Escape order: an unhandled Escape leaves the board.
defineExpose({
  cancelDragOnEscape: () => {
    if (!laneDrag.value?.active) return false
    cancelLaneDrag()
    return true
  }
})
</script>

<template>
  <section
    ref="boardElement"
    class="board"
    :class="{ 'board-lane-dragging': laneDrag?.active }"
    aria-label="Swim lanes"
  >
    <div
      v-if="laneDrag?.active && laneDrag.indicator"
      class="lane-drop-indicator"
      :class="`lane-drop-indicator-${laneDrag.indicator.orientation}`"
      :style="dropIndicatorStyle(laneDrag.indicator)"
      aria-hidden="true"
    />
    <div
      v-for="column in visibleColumns"
      :key="column[0].id"
      class="lane-column"
      :style="{ width: `${laneWidth(column[0].id)}px` }"
    >
      <section
        v-for="lane in column"
        :key="lane.id"
        class="lane"
        :data-lane-id="lane.id"
        :class="{
          'lane-unassigned': lane.id === UNASSIGNED_LANE_ID,
          'lane-dragging': laneDrag?.active && laneDrag.laneId === lane.id
        }"
        :style="laneDragStyle(lane.id)"
        @dragover.prevent
        @drop.prevent="dropOnLane(lane.id)"
        @dblclick.self="emit('newTicket', lane.id)"
      >
        <header
          class="lane-heading"
          :class="{ 'lane-heading-movable': laneCanMove(lane.id) }"
          :tabindex="laneCanMove(lane.id) ? 0 : undefined"
          :aria-keyshortcuts="laneCanMove(lane.id) ? 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown' : undefined"
          @dblclick="startTicketDraftFromHeading(lane.id)"
          @pointerdown="startLaneDrag(lane, $event)"
          @pointermove="trackLaneDrag"
          @pointerup="endLaneDrag"
          @pointercancel="cancelLaneDrag"
          @lostpointercapture="cancelLaneDrag"
          @keydown="moveLaneByKeyboard(lane, $event)"
        >
          <h2 :title="lane.name">{{ lane.name }}</h2>
          <span class="lane-count">{{ ticketsInLane(lane.id).length }}</span>
          <span
            v-if="unseenAgentResultCount(lane.id) > 0"
            class="lane-unseen-count"
            role="img"
            :aria-label="`${unseenAgentResultCount(lane.id)} unseen agent results`"
            title="Agent results you haven't opened yet"
          >{{ unseenAgentResultCount(lane.id) }}</span>
          <button
            class="icon-button auto-run-button"
            :title="autoRunTooltip(lane)"
            :aria-label="`Auto Run ${autoRunTicketCount(lane)} in ${lane.name}`"
            @click="emit('autoRun', lane)"
            @dblclick.stop
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 5.5v13a1 1 0 0 0 1.55.83L13 13.2V18.5a1 1 0 0 0 1.55.83l9-6.5a1 1 0 0 0 0-1.66l-9-6.5A1 1 0 0 0 13 5.5v5.3L4.55 4.67A1 1 0 0 0 3 5.5z" />
            </svg>
          </button>
          <button
            class="icon-button"
            title="Lane settings"
            :aria-label="`Lane settings for ${lane.name}`"
            @click="emit('openLane', lane.id)"
            @dblclick.stop
          >
            ⚙
          </button>
        </header>

        <LaneCardList
          v-slot="{ ticket }"
          :tickets="ticketsInLane(lane.id)"
          :render-all="pageFindActive"
          :keep-mounted-id="draggedTicketId"
          @dblclick.self="emit('newTicket', lane.id)"
        >
          <TicketCard
            :ticket="ticket"
            :card-fields="preferences.cardFields"
            :selected="selectedTicketIds.has(ticket.id)"
            :carried="isCarriedBehind(ticket.id)"
            :agent-running="Boolean(store.agentRunning[ticket.id])"
            :full-auto="isFullAuto(ticket, laneOfTicket(ticket))"
            :ready-lane-name="readyLaneNameByTicketId.get(ticket.id)"
            :assignee-name="assigneeName(ticket.assigneeId)"
            @open="emit('openTicket', $event)"
            @toggle-select="emit('toggleSelected', $event)"
            @drag-start="startTicketDrag"
            @drag-end="draggedTicketId = null"
          />
        </LaneCardList>

        <div
          class="lane-resize-handle"
          role="separator"
          aria-orientation="vertical"
          :title="`Drag to resize ${lane.name}`"
          @pointerdown.prevent="startLaneResize(lane, $event)"
          @pointermove="trackLaneResize"
          @pointerup="endLaneResize"
          @pointercancel="endLaneResize"
        />
      </section>
    </div>

    <!-- Kept (inert) during a lane drag: removing its box would re-center
         every lane under "safe center" the moment the drag starts.
         Unmounting under the pointer fires no mouseleave → reset on unmount. -->
    <div
      v-if="!laneFilterNarrows"
      class="lane-add-zone"
      :class="{ shown: addZoneShown }"
      :inert="laneDrag?.active"
      :style="{ width: `${DEFAULT_LANE_WIDTH}px` }"
      @mouseenter="showAddZone"
      @mouseleave="hideAddZoneLater"
      @vue:before-unmount="hideAddZoneNow"
    >
      <button class="lane-add-button" aria-label="Add swim lane" title="Add swim lane" @click="emit('newLane')">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg>
      </button>
    </div>
  </section>
</template>
