import { defineConfig } from 'vitest/config'

// Behavioral tier: real agent runs, token cost, opt-in. Run with `bun run eval`.
// Cases run one at a time to bound spend.
export default defineConfig({
  test: {
    root: new URL('..', import.meta.url).pathname,
    include: ['evals/behavioral/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false }
  }
})
