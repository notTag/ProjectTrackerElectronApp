import { ref } from 'vue'

export type RowAction = 'delete' | 'add'

// One row at a time swaps its - and + for a single checkmark that confirms
// the action picked; starting another row's confirm drops the first.
export const useRowConfirm = () => {
  const pending = ref<{ rowId: string; action: RowAction } | null>(null)
  const start = (rowId: string, action: RowAction) => {
    pending.value = { rowId, action }
  }
  const cancel = () => {
    pending.value = null
  }
  const pendingActionOf = (rowId: string): RowAction | null =>
    pending.value?.rowId === rowId ? pending.value.action : null
  return { pending, start, cancel, pendingActionOf }
}
