<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'
import { cardWindow } from '@/shared/cardWindow'
import type { Ticket } from '@/shared/projectTypes'

const props = defineProps<{
  tickets: Ticket[]
  renderAll: boolean
  keepMountedId: string | null
}>()

defineSlots<{ default(props: { ticket: Ticket }): unknown }>()

const VIRTUALIZE_ABOVE = 50
const ESTIMATED_CARD_HEIGHT = 96
const LANE_BODY_GAP = 8
const OVERSCAN_FALLBACK = 800

const scroller = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const measuredHeights = new Map<string, number>()
const measuredVersion = ref(0)

const virtualized = computed(() => !props.renderAll && props.tickets.length > VIRTUALIZE_ABOVE)

const cardRange = computed(() => {
  const tickets = props.tickets
  if (!virtualized.value) return { start: 0, end: tickets.length, heightAbove: 0, heightBelow: 0 }
  void measuredVersion.value
  const heights = tickets.map((ticket) => measuredHeights.get(ticket.id) ?? ESTIMATED_CARD_HEIGHT)
  const pinnedIndex = props.keepMountedId ? tickets.findIndex((ticket) => ticket.id === props.keepMountedId) : undefined
  return cardWindow({
    heights,
    gap: LANE_BODY_GAP,
    scrollTop: scrollTop.value,
    viewportHeight: viewportHeight.value,
    overscan: viewportHeight.value || OVERSCAN_FALLBACK,
    pinnedIndex
  })
})

const mountedTickets = computed(() => props.tickets.slice(cardRange.value.start, cardRange.value.end))

const spacerHeight = (height: number) => `${Math.max(0, height - LANE_BODY_GAP)}px`

const readViewport = () => {
  const element = scroller.value
  if (!element) return
  scrollTop.value = element.scrollTop
  viewportHeight.value = element.clientHeight
}

const measureMountedCards = () => {
  if (!virtualized.value || !scroller.value) return
  let anyChanged = false
  for (const element of scroller.value.children) {
    const ticketId = (element as HTMLElement).dataset.ticketId
    if (!ticketId) continue
    const height = (element as HTMLElement).offsetHeight
    if (measuredHeights.get(ticketId) === height) continue
    measuredHeights.set(ticketId, height)
    anyChanged = true
  }
  if (anyChanged) measuredVersion.value++
}

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  readViewport()
  measureMountedCards()
  resizeObserver = new ResizeObserver(readViewport)
  if (scroller.value) resizeObserver.observe(scroller.value)
})
onUpdated(measureMountedCards)
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div ref="scroller" class="lane-body" @scroll="readViewport">
    <div v-if="cardRange.start > 0" aria-hidden="true" :style="{ height: spacerHeight(cardRange.heightAbove), flex: '0 0 auto' }" />
    <template v-for="ticket in mountedTickets" :key="ticket.id">
      <slot :ticket="ticket" />
    </template>
    <div
      v-if="cardRange.end < tickets.length"
      aria-hidden="true"
      :style="{ height: spacerHeight(cardRange.heightBelow), flex: '0 0 auto' }"
    />
  </div>
</template>
