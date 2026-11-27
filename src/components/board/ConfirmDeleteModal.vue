<script setup lang="ts">
import { onMounted, ref } from 'vue'

// The default slot holds the question (with id=questionId) and any detail lines.
defineProps<{ eyebrow: string; questionId: string }>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()

const cancelButton = ref<HTMLButtonElement | null>(null)

// Focus lands on Cancel so a stray Enter can't delete anything.
onMounted(() => cancelButton.value?.focus())
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <section class="modal" role="alertdialog" :aria-labelledby="questionId">
      <p class="eyebrow">{{ eyebrow }}</p>
      <slot />
      <div class="modal-actions">
        <button ref="cancelButton" class="secondary" @click="emit('cancel')">Cancel</button>
        <button class="secondary danger" @click="emit('confirm')">Delete</button>
      </div>
    </section>
  </div>
</template>
