<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

// A <select>, not a datalist: Chromium filters a datalist by the text already
// in the field, so once a model was saved the other models were hidden — and
// switching models is the whole point of the field. "Custom…" keeps free text
// for ids the list doesn't know yet (a new release, a custom agent).
const props = defineProps<{
  modelValue: string
  models?: string[]
  placeholder: string
}>()

const emit = defineEmits<{ 'update:modelValue': [model: string] }>()

const CUSTOM_OPTION = '\u0000custom'

const typingCustom = ref(false)
const customInput = ref<HTMLInputElement | null>(null)

const suggestedModels = computed(() => props.models ?? [])
const showSelect = computed(() => suggestedModels.value.length > 0 && !typingCustom.value)
const savedModelIsUnlisted = computed(() => props.modelValue !== '' && !suggestedModels.value.includes(props.modelValue))

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
  <select v-if="showSelect" :value="modelValue" @change="onSelect">
    <option value="">{{ placeholder }}</option>
    <option v-for="model in suggestedModels" :key="model" :value="model">{{ model }}</option>
    <option v-if="savedModelIsUnlisted" :value="modelValue">{{ modelValue }}</option>
    <option :value="CUSTOM_OPTION">Custom…</option>
  </select>
  <input
    v-else
    ref="customInput"
    :value="modelValue"
    :placeholder="placeholder"
    @change="onCustomChange"
    @blur="typingCustom = false"
  />
</template>
