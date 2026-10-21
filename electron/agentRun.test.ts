import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { runAgentHeadless } from './agentRun.js'

const echoLastArgument = {
  id: 'echo',
  name: 'Echo',
  command: process.execPath,
  headlessArgs: ['-e', 'console.log(process.argv.at(-1))']
}

describe('runAgentHeadless', () => {
  it('passes the prompt as one literal argument, never through a shell', async () => {
    const prompt = `don't $(touch pwned) \`id\` "quoted"\nsecond line`
    const result = await runAgentHeadless(echoLastArgument, prompt, tmpdir(), tmpdir())
    expect(result).toEqual({ succeeded: true, output: prompt })
  })

  it('keeps what a failing agent printed alongside why it failed', async () => {
    const failing = { ...echoLastArgument, headlessArgs: ['-e', 'console.log("partial"); process.exit(2)'] }
    const result = await runAgentHeadless(failing, 'prompt', tmpdir(), tmpdir())
    expect(result.succeeded).toBe(false)
    expect(result.output).toContain('partial')
  })

  it('names the missing CLI instead of surfacing a bare ENOENT', async () => {
    const missing = { ...echoLastArgument, name: 'Ghost', command: 'definitely-not-an-agent-cli' }
    const result = await runAgentHeadless(missing, 'prompt', tmpdir(), tmpdir())
    expect(result.output).toContain('Ghost CLI (`definitely-not-an-agent-cli`) was not found')
  })
})
