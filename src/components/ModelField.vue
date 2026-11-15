<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Agent } from '@/shared/projectTypes'

// A <select>, not a datalist: Chromium filters a datalist by the text already
// in the field, so once a model was saved the other models were hidden — and
// switching models is the whole point of the field. "Custom…" keeps free text
// for ids the list doesn't know yet (a new release, a custom agent).
const props = defineProps<{
  modelValue: string
  agent: Agent
  placeholder: string
}>()

const emit = defineEmits<{ 'update:modelValue': [model: string] }>()

const CUSTOM_OPTION = '\u0000custom'

const typingCustom = ref(false)
const customInput = ref<HTMLInputElement | null>(null)

// A CLI with no model flag (Hermes) has nothing to pass a model to, so the
// field shows but can't be changed.
const agentTakesModel = computed(() => (props.agent.modelArgs?.length ?? 0) > 0)
const suggestedModels = computed(() => props.agent.models ?? [])
const hasSuggestions = computed(() => suggestedModels.value.length > 0)
const savedModelIsUnlisted = computed(() => props.modelValue !== '' && !suggestedModels.value.includes(props.modelValue))
// Vue re-applies a select's :value only when the value changes. Keying the
// select on its options re-renders it when the list alone changes (agents
// loading after the modal opened), so the saved model stays selected.
const optionsKey = computed(() => [props.agent.id, ...suggestedModels.value].join('\n'))

const onSelect = async (event: Event) => {
  const selected = (event.target as HTMLSelectElement).value
  if (selected !== CUSTOM_OPTION) {
    emit('update:modelValue', selected)
    return
  }
  typingCustom.value = true
  await nextTick()
  customInput.value?.focus()
}

const onCustomChange = (event: Event) => {
  const typed = (event.target as HTMLInputElement).value.trim()
  emit('update:modelValue', typed)
  typingCustom.value = false
}
</script>

<template>
  <select v-if="!agentTakesModel" disabled aria-label="Model">
    <option>No models configured</option>
  </select>
  <!-- Escape backs out of custom entry only; .stop keeps the board's window
       handler from closing the whole modal. -->
  <input
    v-else-if="typingCustom"
    ref="customInput"
    :value="modelValue"
    :placeholder="placeholder"
    aria-label="Model"
    @change="onCustomChange"
    @blur="typingCustom = false"
    @keydown.esc.stop="typingCustom = false"
  />
  <select v-else :key="optionsKey" :value="modelValue" aria-label="Model" @change="onSelect">
    <option value="">{{ placeholder }}</option>
    <option v-for="model in suggestedModels" :key="model" :value="model">{{ model }}</option>
    <option v-if="!hasSuggestions" disabled>No models configured</option>
    <option v-if="savedModelIsUnlisted" :value="modelValue">{{ modelValue }}</option>
    <option :value="CUSTOM_OPTION">Custom…</option>
  </select>
</template>
