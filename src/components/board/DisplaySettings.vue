<script setup lang="ts">
import InfoTip from '@/components/InfoTip.vue'
import {
  toggleCardField,
  toggleLaneModalField,
  LANE_MODAL_FIELDS,
  TICKET_CARD_FIELDS,
  type LaneModalField,
  type TicketCardField
} from '@/shared/projectTypes'
import { useBoardContext } from './boardContext'

const { laneColumns, preferences, savePreferences, laneIsHidden, toggleLaneVisibility, laneTicketTotal } =
  useBoardContext()

const showsField = (field: TicketCardField) => preferences.value.cardFields.includes(field)
const toggleField = (field: TicketCardField) => savePreferences(toggleCardField(preferences.value, field))

// This list is every lane's default; a lane's own eye button can only hide further.
const laneFieldShownOnBoard = (field: LaneModalField) => !preferences.value.hiddenLaneModalFields.includes(field)
const toggleLaneFieldOnBoard = (field: LaneModalField) => savePreferences(toggleLaneModalField(preferences.value, field))
</script>

<template>
  <div class="label-with-tip">
    <p class="eyebrow">Swimlane</p>
    <InfoTip text="Show/Hide Swimlane's" />
  </div>
  <ul class="card-field-list">
    <li v-for="lane in laneColumns" :key="lane.id">
      <label>
        <input
          type="checkbox"
          :checked="!laneIsHidden(lane.id)"
          @change="toggleLaneVisibility(lane.id)"
        />
        {{ lane.name }} ({{ laneTicketTotal(lane.id) }})
      </label>
    </li>
  </ul>

  <hr />

  <span class="label-with-tip">
    <p class="eyebrow">Ticket Card</p>
    <InfoTip text="Show/Hide Ticket Card fields" />
  </span>
  <ul class="card-field-list">
    <li>
      <label>
        <input type="checkbox" checked disabled />
        Title
      </label>
    </li>
    <li v-for="field in TICKET_CARD_FIELDS" :key="field.id">
      <label>
        <input type="checkbox" :checked="showsField(field.id)" @change="toggleField(field.id)" />
        {{ field.label }}
      </label>
    </li>
  </ul>

  <hr />

  <span class="label-with-tip">
    <p class="eyebrow">Swim lane Settings</p>
    <InfoTip text="Show/Hide Swim lane Settings fields" />
  </span>
  <span class="field-hint">Every lane's settings. The eye button in a lane's settings hides more for that lane.</span>
  <ul class="card-field-list">
    <li v-for="field in LANE_MODAL_FIELDS" :key="field.id">
      <label>
        <input
          type="checkbox"
          :checked="laneFieldShownOnBoard(field.id)"
          @change="toggleLaneFieldOnBoard(field.id)"
        />
        {{ field.label }}
      </label>
    </li>
  </ul>

</template>
