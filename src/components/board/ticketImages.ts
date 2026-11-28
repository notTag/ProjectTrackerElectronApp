import { useProjectsStore } from '@/stores/projects'
import { projectTrackerApi } from '@/services/projectTrackerApi'
import type { Ticket } from '@/shared/projectTypes'
import { ipcErrorMessage } from './boardFormat'

// Shared by the ticket modal and the new-ticket save, which attaches staged
// images once the ticket exists. Each call resolves to an error message or null.

// Store state only refreshes after the IPC save returns, so the new list is
// computed inside the queued mutate from the latest saved images: two quick
// adds or removes in a row would otherwise overwrite each other.
export const editTicketImages = (
  projectPath: string,
  ticket: Pick<Ticket, 'id'>,
  change: (images: string[]) => string[]
) => {
  const store = useProjectsStore()
  const updatedAt = new Date().toISOString()
  return store.updateBoard(projectPath, (board) => ({
    ...board,
    tickets: board.tickets.map((current) => {
      if (current.id !== ticket.id) return current
      const images = change(current.images ?? [])
      return { ...current, images: images.length ? images : undefined, updatedAt }
    })
  }))
}

// Files are written before the ticket lists them, so a failed save leaves at
// worst an orphan file, never a listed path that doesn't exist. Settled one by
// one: a bad file in a drop must not keep the good ones off the ticket.
export const attachImages = async (
  projectPath: string,
  ticket: Pick<Ticket, 'id'>,
  pendingSaves: Promise<string[]>[]
): Promise<string | null> => {
  const results = await Promise.allSettled(pendingSaves)
  const addedPaths = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  const failure = results.find((result) => result.status === 'rejected')
  let imageError = failure ? ipcErrorMessage(failure.reason) : null
  if (!addedPaths.length) return imageError
  try {
    await editTicketImages(projectPath, ticket, (images) => [...images, ...addedPaths])
  } catch (error) {
    imageError = ipcErrorMessage(error)
  }
  return imageError
}

const saveImageFile = async (ticket: Pick<Ticket, 'id'>, file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const imagePath = await projectTrackerApi.saveTicketImageBytes(ticket.id, bytes, file.type)
  return [imagePath]
}

// Paste and drop both send bytes: clipboard images have no file path at all.
export const saveImageFiles = (projectPath: string, ticket: Pick<Ticket, 'id'>, files: File[]) =>
  attachImages(projectPath, ticket, files.map((file) => saveImageFile(ticket, file)))
