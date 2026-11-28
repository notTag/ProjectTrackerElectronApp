import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  addTicketImages,
  attachmentsRootOf,
  copyTicketImages,
  removeTicketImage,
  removeTicketImages,
  resolveAttachmentPath,
  saveTicketImageBytes
} from './ticketImages.js'

describe('ticket images', () => {
  let scratch: string
  let attachmentsRoot: string
  let sourceImage: string

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'ticket-images-'))
    attachmentsRoot = attachmentsRootOf(path.join(scratch, 'userData'))
    sourceImage = path.join(scratch, 'Screen Shot.PNG')
    writeFileSync(sourceImage, 'png-bytes')
  })

  afterEach(() => rmSync(scratch, { recursive: true, force: true }))

  it('copies images into the ticket folder so the original can go away', () => {
    const [imagePath] = addTicketImages(attachmentsRoot, 'ticket-1', [sourceImage])
    rmSync(sourceImage)

    expect(path.dirname(imagePath)).toBe(path.join(attachmentsRoot, 'ticket-1'))
    expect(imagePath).toMatch(/\.png$/)
    expect(readFileSync(imagePath, 'utf8')).toBe('png-bytes')
  })

  it('copies a ticket\'s images into another ticket so deleting the first keeps them', () => {
    const [originalImage] = addTicketImages(attachmentsRoot, 'ticket-1', [sourceImage])
    const [clonedImage] = copyTicketImages(attachmentsRoot, 'ticket-2', [originalImage])
    removeTicketImages(attachmentsRoot, 'ticket-1')

    expect(path.dirname(clonedImage)).toBe(path.join(attachmentsRoot, 'ticket-2'))
    expect(readFileSync(clonedImage, 'utf8')).toBe('png-bytes')
  })

  it('refuses to copy a path outside the attachments folder', () => {
    expect(() => copyTicketImages(attachmentsRoot, 'ticket-2', [sourceImage])).toThrow()
    expect(existsSync(path.join(attachmentsRoot, 'ticket-2'))).toBe(false)
  })

  it('rejects a non-image without copying any of the selection', () => {
    const notAnImage = path.join(scratch, 'notes.txt')
    writeFileSync(notAnImage, 'text')

    expect(() => addTicketImages(attachmentsRoot, 'ticket-1', [sourceImage, notAnImage])).toThrow('notes.txt')
    expect(existsSync(path.join(attachmentsRoot, 'ticket-1'))).toBe(false)
  })

  it('saves pasted bytes with the extension of their mime type', () => {
    const imagePath = saveTicketImageBytes(attachmentsRoot, 'ticket-1', new Uint8Array([1, 2, 3]), 'image/jpeg')
    expect(imagePath).toMatch(/\.jpg$/)
    expect([...readFileSync(imagePath)]).toEqual([1, 2, 3])
    expect(() => saveTicketImageBytes(attachmentsRoot, 'ticket-1', new Uint8Array(1), 'image/svg+xml')).toThrow()
  })

  it('refuses ticket ids and paths that escape the attachments folder', () => {
    expect(() => addTicketImages(attachmentsRoot, '../escape', [sourceImage])).toThrow('Invalid ticket id')
    expect(() => removeTicketImage(attachmentsRoot, 'ticket-1', sourceImage)).toThrow()
    expect(existsSync(sourceImage)).toBe(true)

    const otherTicketImage = saveTicketImageBytes(attachmentsRoot, 'ticket-2', new Uint8Array(1), 'image/png')
    expect(() => removeTicketImage(attachmentsRoot, 'ticket-1', otherTicketImage)).toThrow()
    expect(existsSync(otherTicketImage)).toBe(true)

    expect(resolveAttachmentPath(attachmentsRoot, `${attachmentsRoot}/../secret.png`)).toBeNull()
    expect(resolveAttachmentPath(attachmentsRoot, attachmentsRoot)).toBeNull()
    expect(resolveAttachmentPath(attachmentsRoot, otherTicketImage)).toBe(otherTicketImage)
  })

  it('removes one image, then the whole ticket folder', () => {
    const [first, second] = addTicketImages(attachmentsRoot, 'ticket-1', [sourceImage, sourceImage])
    removeTicketImage(attachmentsRoot, 'ticket-1', first)
    expect(existsSync(first)).toBe(false)
    expect(existsSync(second)).toBe(true)

    removeTicketImages(attachmentsRoot, 'ticket-1')
    expect(existsSync(path.join(attachmentsRoot, 'ticket-1'))).toBe(false)
  })
})
