import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'out/renderer'
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  test: {
    // Behavioral evals run real agents; they're opt-in via `bun run eval`.
    exclude: [...configDefaults.exclude, 'evals/behavioral/**']
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  }
})
