export const formatDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

export const formatDateTime = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

// Electron prefixes errors thrown in main with "Error invoking remote method '<channel>': Error: ".
export const ipcErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export const imageFilesOf = (source: DataTransfer | HTMLInputElement | null) =>
  [...(source?.files ?? [])].filter((file) => file.type.startsWith('image/'))

// Rich text copied from Notes/Word/Sheets carries a PNG rendering alongside the
// text, so a paste into a text field with text on the clipboard stays a text paste.
export const isTextFieldPaste = (event: ClipboardEvent) => {
  const target = event.target
  const isIntoTextField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  const hasText = event.clipboardData?.types.includes('text/plain') ?? false
  return isIntoTextField && hasText
}

export const trimmedInputValue = (event: Event) => (event.target as HTMLInputElement).value.trim() || undefined
