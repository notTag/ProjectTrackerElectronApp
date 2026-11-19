import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { configDefaults, defineConfig } from 'vitest/config'

// `--mode web` builds the browser app served by electron/web/server.ts: absolute
// asset paths (served from /) and its own outDir so it never overwrites the
// desktop renderer.
export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  base: mode === 'web' ? '/' : './',
  build: {
    outDir: mode === 'web' ? 'out/web' : 'out/renderer'
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  test: {
    // Behavioral evals run real agents; they're opt-in via `bun run eval`.
    // .worktrees/ holds full checkouts of other branches; collecting them runs
    // every suite once per worktree and hangs the run.
    exclude: [...configDefaults.exclude, 'evals/behavioral/**', '.worktrees/**']
  },
  server: {
    host: '127.0.0.1',
    strictPort: true
  }
}))
