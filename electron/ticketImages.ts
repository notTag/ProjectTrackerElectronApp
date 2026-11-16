import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Copies live under <userData>/attachments/<ticketId>/ so moving or deleting the
// original never breaks the ticket, and the agent prompt can list absolute paths.
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

export const attachmentsRootOf = (userDataPath: string) => path.join(userDataPath, 'attachments')

const isInsideDirectory = (target: string, directory: string) => {
  const relativePath = path.relative(directory, target)
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

// Ticket ids are UUIDs; anything with a separator or ".." would escape the root.
const ticketDirectoryOf = (attachmentsRoot: string, ticketId: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(ticketId)) throw new Error('Invalid ticket id.')
  return path.join(attachmentsRoot, ticketId)
}

// The resolved path when it is an attachment file, else null. Every IPC and
// protocol entry point goes through this, so a renderer-supplied path can never
// read, open or delete anything outside the attachments folder.
export const resolveAttachmentPath = (attachmentsRoot: string, candidatePath: string) => {
  const resolvedPath = path.resolve(candidatePath)
  return isInsideDirectory(resolvedPath, attachmentsRoot) ? resolvedPath : null
}

const newImagePath = (ticketDirectory: string, extension: string) => {
  mkdirSync(ticketDirectory, { recursive: true })
  return path.join(ticketDirectory, `${randomUUID()}.${extension}`)
}

const assertImageSize = (byteCount: number) => {
  if (byteCount > MAX_IMAGE_BYTES) throw new Error('Image is larger than 20 MB.')
}

// All sources are checked before any copy, so a bad file in the selection
// leaves no partial set of orphans behind.
export const addTicketImages = (attachmentsRoot: string, ticketId: string, sourcePaths: string[]) => {
  const ticketDirectory = ticketDirectoryOf(attachmentsRoot, ticketId)
  const sources = sourcePaths.map((sourcePath) => {
    const extension = path.extname(sourcePath).slice(1).toLowerCase()
    if (!IMAGE_EXTENSIONS.includes(extension)) throw new Error(`Not a supported image: ${path.basename(sourcePath)}`)
    assertImageSize(statSync(sourcePath).size)
    return { sourcePath, extension }
  })
  return sources.map(({ sourcePath, extension }) => {
    const imagePath = newImagePath(ticketDirectory, extension)
    copyFileSync(sourcePath, imagePath)
    return imagePath
  })
}

// Pasted or dropped image data, which has bytes but no file path.
export const saveTicketImageBytes = (attachmentsRoot: string, ticketId: string, bytes: Uint8Array, mimeType: string) => {
  const extension = EXTENSION_BY_MIME_TYPE[mimeType]
  if (!extension) throw new Error(`Not a supported image type: ${mimeType}`)
  assertImageSize(bytes.byteLength)
  const imagePath = newImagePath(ticketDirectoryOf(attachmentsRoot, ticketId), extension)
  writeFileSync(imagePath, bytes)
  return imagePath
}

export const removeTicketImage = (attachmentsRoot: string, ticketId: string, imagePath: string) => {
  const ticketDirectory = ticketDirectoryOf(attachmentsRoot, ticketId)
  const resolvedPath = resolveAttachmentPath(ticketDirectory, imagePath)
  if (!resolvedPath) throw new Error('Image is not attached to this ticket.')
  rmSync(resolvedPath, { force: true })
}

export const removeTicketImages = (attachmentsRoot: string, ticketId: string) =>
  rmSync(ticketDirectoryOf(attachmentsRoot, ticketId), { recursive: true, force: true })
