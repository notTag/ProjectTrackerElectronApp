<script setup lang="ts">
import { useThemeEffect } from '@nick_tag_tech/themes/vue'
import { storeToRefs } from 'pinia'

import { useThemeStore } from '@/stores/theme'

// Applies the active theme's CSS variables + data-theme-type to <html>,
// reapplying whenever the selection (or live preview) changes.
const { currentTheme } = storeToRefs(useThemeStore())
useThemeEffect(currentTheme)
</script>

<template>
  <RouterView />
</template>
