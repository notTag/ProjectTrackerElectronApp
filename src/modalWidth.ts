import { reactive, ref } from 'vue'
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
