<script lang="ts">
// nextLaneId stays null until the user picks one, so the field follows the
// Status lane's default as Status changes. Images wait as Files until Save,
// since their folder is keyed by a ticket id that doesn't exist yet.
export type TicketDraft = {
  title: string
  description: string
  laneId: string
  nextLaneId: string | null
  images: { file: File; previewUrl: string }[]
}

export type TicketDraftSave = {
  laneId: string
  title: string
  description: string
  completion: { moveToLaneId?: string; moveOnComplete: boolean }
  files: File[]
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ticketModalExpanded, vEdgeResize } from '@/modalWidth'
import ExpandToggle from '@/components/ExpandToggle.vue'
import { TICKET_DESCRIPTION_TEMPLATE, UNASSIGNED_LANE_ID, UNASSIGNED_LANE_NAME } from '@/shared/projectTypes'
import { useBackdropPress } from './backdropPress'
import { useBoardContext } from './boardContext'
import { imageFilesOf, isTextFieldPaste } from './boardFormat'

// The draft object is owned by BoardView (its presence is the open flag); this
// form edits its fields in place.
const props = defineProps<{ draft: TicketDraft }>()
const emit = defineEmits<{ close: []; save: [save: TicketDraftSave] }>()

const { board, laneNextLaneId, nextLaneOptionsFor } = useBoardContext()
const { notePressTarget, closeIfPressStartedOnBackdrop } = useBackdropPress()

const draftImageInput = ref<HTMLInputElement | null>(null)

const stageDraftImages = (files: File[]) => {
  const stagedImages = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))
  props.draft.images.push(...stagedImages)
}

const pickDraftImages = (input: HTMLInputElement) => {
  stageDraftImages(imageFilesOf(input))
  input.value = ''
}

const pasteDraftImages = (event: ClipboardEvent) => {
  if (isTextFieldPaste(event)) return
  const files = imageFilesOf(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  stageDraftImages(files)
}

const dropDraftImages = (event: DragEvent) => {
  stageDraftImages(imageFilesOf(event.dataTransfer))
}

const unstageDraftImage = (index: number) => {
  const removed = props.draft.images.splice(index, 1)
  removed.forEach((stagedImage) => URL.revokeObjectURL(stagedImage.previewUrl))
}

const draftNextLaneId = computed(() => {
  const draft = props.draft
  // A pick made before Status changed to that same lane would be a no-op target.
  const pickIsStatusLane = draft.nextLaneId === draft.laneId
  if (draft.nextLaneId === null || pickIsStatusLane) return laneNextLaneId(draft.laneId)
  return draft.nextLaneId
})

const saveTicketDraft = () => {
  const draft = props.draft
  if (!draft.title.trim()) return
  const description = draft.description.trim()
  const templateWasLeftUntouched = description === TICKET_DESCRIPTION_TEMPLATE.trim()
  const resolvedNextLaneId = draftNextLaneId.value
  // Matching the lane default is stored as no override, so the ticket keeps
  // inheriting if the lane's Next Lane changes later.
  const overridesLaneDefault = resolvedNextLaneId !== laneNextLaneId(draft.laneId)
  const completion = {
    moveToLaneId: overridesLaneDefault && resolvedNextLaneId ? resolvedNextLaneId : undefined,
    moveOnComplete: Boolean(resolvedNextLaneId)
  }
  emit('save', {
    laneId: draft.laneId,
    title: draft.title.trim(),
    description: templateWasLeftUntouched ? '' : description,
    completion,
    files: draft.images.map((stagedImage) => stagedImage.file)
  })
}
</script>

<template>
  <div class="modal-backdrop" @pointerdown="notePressTarget" @click.self="closeIfPressStartedOnBackdrop(() => emit('close'))">
    <section v-edge-resize class="modal ticket-modal resizable" :class="{ expanded: ticketModalExpanded }" @paste="pasteDraftImages">
      <div class="ticket-modal-header">
        <p class="eyebrow">New ticket</p>
        <ExpandToggle v-model="ticketModalExpanded" />
      </div>
      <input
        v-model="draft.title"
        class="ticket-title-input"
        placeholder="Title"
        @keyup.enter="saveTicketDraft"
      />

      <label>
        Status
        <select v-model="draft.laneId">
          <option :value="UNASSIGNED_LANE_ID">{{ UNASSIGNED_LANE_NAME }}</option>
          <option v-for="lane in board.lanes" :key="lane.id" :value="lane.id">{{ lane.name }}</option>
        </select>
      </label>

      <label>
        Next Lane
        <select :value="draftNextLaneId" @change="draft.nextLaneId = ($event.target as HTMLSelectElement).value">
          <option value="">None</option>
          <option v-for="lane in nextLaneOptionsFor(draft.laneId)" :key="lane.id" :value="lane.id">
            {{ lane.name }}
          </option>
        </select>
        <span class="field-hint">Defaults to the Status lane's Next Lane.</span>
      </label>

      <label>
        Description
        <textarea v-model="draft.description" placeholder="Details, acceptance criteria, links..." />
      </label>

      <section class="ticket-images" @dragover.prevent @drop.prevent="dropDraftImages">
        <p class="eyebrow">Images</p>
        <input
          ref="draftImageInput"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          @change="pickDraftImages($event.target as HTMLInputElement)"
        />
        <button type="button" class="image-dropzone" @click="draftImageInput?.click()">
          <span>Drag or paste images here</span>
          <span class="image-dropzone-plus" aria-hidden="true">+</span>
        </button>
        <ul v-if="draft.images.length">
          <li v-for="(stagedImage, index) in draft.images" :key="stagedImage.previewUrl">
            <span class="ticket-image-thumb" :title="stagedImage.file.name">
              <img :src="stagedImage.previewUrl" alt="Staged image" decoding="async" />
            </span>
            <button class="icon-button" title="Remove image" @click="unstageDraftImage(index)">×</button>
          </li>
        </ul>
      </section>

      <div class="modal-actions">
        <button class="secondary" @click="emit('close')">Cancel</button>
        <button :disabled="!draft.title.trim()" @click="saveTicketDraft">Save</button>
      </div>
    </section>
  </div>
</template>
