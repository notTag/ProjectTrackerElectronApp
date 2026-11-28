import { computed, reactive, ref, type Directive } from 'vue'
import type { LaneModalSection } from './shared/projectTypes'

// Module scope, not component setup: App.vue remounts BoardView on Board <-> Dashboard
// switches, and each modal's chosen width should survive that.
// ponytail: app-session only; move to settings if it must survive restart.
export const ticketModalExpanded = ref(false)
// Separate from the ticket modal so expanding one modal type never resizes the other.
export const laneModalExpanded = ref(false)
// Shared by every lane's modal: collapsing a section on one lane collapses it on all.
export const laneModalSectionsOpen = reactive<Record<LaneModalSection, boolean>>({
  agent: true,
  orchestrator: true,
  autoRun: true
})

export const graphPanelWidth = ref<number | null>(null)
export const graphPanelStyle = computed(() => (graphPanelWidth.value === null ? undefined : { width: `${graphPanelWidth.value}px` }))

const GRAPH_PANEL_MIN_PX = 280
const GRAPH_CANVAS_MIN_PX = 320

export function clampGraphPanelWidth(width: number, windowWidth: number) {
  const widestPanel = windowWidth - GRAPH_CANVAS_MIN_PX
  const notWiderThanWindowAllows = Math.min(width, widestPanel)
  return Math.max(GRAPH_PANEL_MIN_PX, notWiderThanWindowAllows)
}

// Half on the backdrop, half on the modal: a scrolling modal's right edge is its
// scrollbar, so there only the outer half is grabbable.
const EDGE_GRAB_PX = 6

type Edge = 'left' | 'right'

function edgeUnderPointer(modal: HTMLElement, event: PointerEvent): Edge | null {
  if (!modal.classList.contains('resizable')) return null
  const rect = modal.getBoundingClientRect()
  const isWithinModalHeight = event.clientY >= rect.top && event.clientY <= rect.bottom
  if (!isWithinModalHeight) return null
  // A press on the scrollbar scrolls natively and never delivers pointerup here,
  // so starting a resize there would leave it stuck on.
  const scrollbarStart = rect.left + modal.clientLeft + modal.clientWidth
  const isOnScrollbar = event.clientX >= scrollbarStart && event.clientX <= rect.right
  if (isOnScrollbar) return null
  const distanceFromLeft = Math.abs(event.clientX - rect.left)
  const distanceFromRight = Math.abs(event.clientX - rect.right)
  if (distanceFromLeft <= EDGE_GRAB_PX) return 'left'
  if (distanceFromRight <= EDGE_GRAB_PX) return 'right'
  return null
}

// Drag a `.resizable` modal's left or right edge to set its width. Min/max width
// come from `.modal.resizable` CSS, which clamps the inline width written here.
// Listens on the backdrop (capture phase, so it runs before the backdrop's own
// handlers) because half the grab zone lies outside the modal. preventDefault
// tells BoardView's backdrop-close logic that this press was a resize, not a dismiss.
export const vEdgeResize: Directive<HTMLElement> = {
  mounted(modal) {
    const backdrop = modal.parentElement
    if (!backdrop) return

    backdrop.addEventListener(
      'pointermove',
      (event) => {
        if (backdrop.hasPointerCapture(event.pointerId)) return
        const isOnEdge = edgeUnderPointer(modal, event) !== null
        backdrop.style.cursor = isOnEdge ? 'ew-resize' : ''
      },
      { capture: true }
    )

    backdrop.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return
        const edge = edgeUnderPointer(modal, event)
        if (!edge) return
        event.preventDefault()

        const startX = event.clientX
        const startWidth = modal.getBoundingClientRect().width
        const outwardDirection = edge === 'right' ? 1 : -1

        const resizeToPointer = (moveEvent: PointerEvent) => {
          const isButtonReleased = moveEvent.buttons === 0
          if (isButtonReleased) return stopResizing()
          const outwardDelta = (moveEvent.clientX - startX) * outwardDirection
          // The backdrop centres the modal, so it grows on both sides: 2x keeps the dragged edge under the pointer.
          const nextWidth = startWidth + outwardDelta * 2
          modal.style.width = `${nextWidth}px`
        }
        const stopResizing = () => {
          backdrop.removeEventListener('pointermove', resizeToPointer)
          backdrop.removeEventListener('lostpointercapture', stopResizing)
        }

        backdrop.setPointerCapture(event.pointerId)
        backdrop.addEventListener('pointermove', resizeToPointer)
        backdrop.addEventListener('lostpointercapture', stopResizing)
      },
      { capture: true }
    )
  },
}
