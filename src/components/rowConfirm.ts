import { ref } from 'vue'

export type RowAction = 'delete' | 'add'

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
