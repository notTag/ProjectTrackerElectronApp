<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SwimLane, Ticket } from '@/shared/projectTypes'

const props = defineProps<{ projectName: string; lanes: SwimLane[]; tickets: Ticket[]; ticketOpen: boolean }>()
const emit = defineEmits<{ ticket: [id: string]; selection: [] }>()
const selectedLaneId = ref<string | null>(null)
const selectedLane = computed(() => props.lanes.find(lane => lane.id === selectedLaneId.value))
const laneTickets = (id: string) => props.tickets.filter(ticket => ticket.laneId === id)
const layout = computed(() => {
  let top = 40
  const lanes = props.lanes.map(lane => {
    const tickets = laneTickets(lane.id)
    const height = Math.max(90, tickets.length * 64)
    const y = top + height / 2
    const nodes = tickets.map((ticket, index) => ({ ticket, y: top + 32 + index * 64 }))
    top += height + 30
    return { lane, y, nodes }
  })
  return { lanes, height: Math.max(400, top), center: top / 2 }
})
function selectLane(id: string | null) {
  selectedLaneId.value = id
  emit('selection')
}
</script>

<template>
  <section class="ticket-graph" aria-label="Ticket graph">
    <div class="graph-scroll">
      <div class="graph-canvas" :style="{ height: `${layout.height}px` }">
        <svg class="graph-edges" width="860" :height="layout.height" aria-hidden="true">
          <defs><marker id="ticket-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
          <g v-for="entry in layout.lanes" :key="entry.lane.id">
            <path :d="`M 210 ${layout.center} C 270 ${layout.center}, 270 ${entry.y}, 330 ${entry.y}`" />
            <path v-for="node in entry.nodes" :key="node.ticket.id" :d="`M 510 ${entry.y} C 560 ${entry.y}, 560 ${node.y}, 610 ${node.y}`" />
          </g>
        </svg>
        <button :title="projectName" class="graph-node graph-project" :class="{ selected: !selectedLane && !ticketOpen }" :style="{ top: `${layout.center}px` }" @click="selectLane(null)"><small>Project</small>{{ projectName }}</button>
        <template v-for="entry in layout.lanes" :key="entry.lane.id">
          <button :title="entry.lane.name" class="graph-node graph-lane" :class="{ selected: selectedLaneId === entry.lane.id && !ticketOpen }" :style="{ top: `${entry.y}px` }" @click="selectLane(entry.lane.id)"><small>Swim lane · {{ entry.nodes.length }}</small>{{ entry.lane.name }}</button>
          <button v-for="node in entry.nodes" :key="node.ticket.id" :title="node.ticket.title" class="graph-node graph-ticket" :style="{ top: `${node.y}px` }" @click="emit('ticket', node.ticket.id)"><small>#{{ node.ticket.number }}</small>{{ node.ticket.title }}</button>
        </template>
      </div>
    </div>
    <div v-if="ticketOpen" class="graph-ticket-space" aria-hidden="true" />
    <aside v-if="!ticketOpen" class="graph-details" aria-label="Graph selection">
      <p class="eyebrow">{{ selectedLane ? 'Swim lane' : 'Project' }}</p>
      <h2>{{ selectedLane?.name ?? projectName }}</h2>
      <template v-if="selectedLane">
        <p>{{ laneTickets(selectedLane.id).length }} tickets</p>
        <button v-for="ticket in laneTickets(selectedLane.id)" :key="ticket.id" class="graph-list-item secondary" @click="emit('ticket', ticket.id)">#{{ ticket.number }} · {{ ticket.title }}</button>
        <p v-if="!laneTickets(selectedLane.id).length">No tickets match the current filters.</p>
      </template>
      <template v-else>
        <p>{{ lanes.length }} swim lanes</p>
        <button v-for="lane in lanes" :key="lane.id" class="graph-list-item secondary" @click="selectLane(lane.id)">{{ lane.name }} <span>{{ laneTickets(lane.id).length }}</span></button>
      </template>
    </aside>
  </section>
</template>
