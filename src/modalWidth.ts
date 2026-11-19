import { ref } from 'vue'

// Module scope, not component setup: App.vue remounts BoardView on Board <-> Dashboard
// switches, and each modal's chosen width should survive that.
// ponytail: app-session only; move to settings if it must survive restart.
export const ticketModalExpanded = ref(false)
// Separate from the ticket modal so expanding one modal type never resizes the other.
export const laneModalExpanded = ref(false)
