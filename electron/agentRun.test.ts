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
    expect(result.output).toContain('Echo exited with code 2.')
    expect(result.output).not.toContain('Command failed')
  })

  it('reports a cancelled run as cancelled, not as a crash', async () => {
    const hanging = { ...echoLastArgument, headlessArgs: ['-e', 'setTimeout(() => {}, 60_000)'] }
    const controller = new AbortController()
    const run = runAgentHeadless(hanging, 'prompt', tmpdir(), tmpdir(), controller.signal)
    controller.abort()
    expect(await run).toEqual({ succeeded: false, output: 'Cancelled.' })
  })

  it('names the missing CLI instead of surfacing a bare ENOENT', async () => {
    const missing = { ...echoLastArgument, name: 'Ghost', command: 'definitely-not-an-agent-cli' }
    const result = await runAgentHeadless(missing, 'prompt', tmpdir(), tmpdir())
    expect(result.output).toContain('Ghost CLI (`definitely-not-an-agent-cli`) was not found')
  })
})
