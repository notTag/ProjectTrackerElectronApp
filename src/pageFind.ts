import { ref } from 'vue'

// True while Find on page has a query. Native find only sees mounted text, so
// virtualized lanes mount every card while it is set.
export const pageFindActive = ref(false)
