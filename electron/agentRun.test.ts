import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { CONTINUE_PROMPT, RUN_STATUS_INSTRUCTION, isTransientFailure, runAgentHeadlessWithRetry } from './agentRun.js'

const echoLastArgument = {
  id: 'echo',
  name: 'Echo',
  command: process.execPath,
  headlessArgs: ['-e', 'console.log(process.argv.at(-1))']
}

describe('runAgentHeadlessWithRetry argv and output', () => {
  it('passes the prompt as one literal argument, never through a shell', async () => {
    const prompt = `don't $(touch pwned) \`id\` "quoted"\nsecond line`
    const result = await runAgentHeadlessWithRetry(echoLastArgument, prompt, tmpdir(), tmpdir())
    expect(result).toEqual({ succeeded: true, blocked: false, output: `${prompt}\n\n${RUN_STATUS_INSTRUCTION}`, attempts: 1 })
  })

  it('puts the model flag before the prompt, which stays last', async () => {
    const echoArgs = { ...echoLastArgument, headlessArgs: ['-e', 'console.log(process.argv.slice(1).join(" "))', '--'], modelArgs: ['--model'] }
    const result = await runAgentHeadlessWithRetry(echoArgs, 'prompt', tmpdir(), tmpdir(), { model: 'opus' })
    expect(result).toEqual({ succeeded: true, blocked: false, output: `--model opus prompt\n\n${RUN_STATUS_INSTRUCTION}`, attempts: 1 })
  })

  it('keeps what a failing agent printed alongside why it failed', async () => {
    const failing = { ...echoLastArgument, headlessArgs: ['-e', 'console.log("partial"); process.exit(2)'] }
    const result = await runAgentHeadlessWithRetry(failing, 'prompt', tmpdir(), tmpdir())
    expect(result.succeeded).toBe(false)
    expect(result.output).toContain('partial')
  })

  it('names the missing CLI instead of surfacing a bare ENOENT', async () => {
    const missing = { ...echoLastArgument, name: 'Ghost', command: 'definitely-not-an-agent-cli' }
    const result = await runAgentHeadlessWithRetry(missing, 'prompt', tmpdir(), tmpdir())
    expect(result.output).toContain('Ghost CLI (`definitely-not-an-agent-cli`) was not found')
  })
})

describe('runAgentHeadlessWithRetry run status marker', () => {
  const SESSION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
  const agentPrinting = (lines: string[]) => ({
    id: 'marker',
    name: 'Marker',
    command: process.execPath,
    headlessArgs: ['-e', `console.log(${JSON.stringify(lines.join('\n'))})`, '--'],
    sessionArgs: ['--session-id', '{sessionId}'],
    resumeArgs: ['--resume', '{sessionId}']
  })
  const run = (lines: string[]) =>
    runAgentHeadlessWithRetry(agentPrinting(lines), 'do it', tmpdir(), tmpdir(), {
      sessionId: SESSION_ID,
      sleep: async () => undefined
    })

  it('records an exit-0 run whose last line says blocked as blocked, not succeeded', async () => {
    const result = await run(['tried gh', 'RUN STATUS: blocked — need gh permission'])
    expect(result).toMatchObject({ succeeded: false, blocked: true, attempts: 1 })
  })

  it('reads the marker through markdown emphasis and any case', async () => {
    const result = await run(['**run status: Blocked** — no sqlite3'])
    expect(result.blocked).toBe(true)
  })

  it('reads a markdown-wrapped blocked marker as blocked', async () => {
    expect(await run(['RUN STATUS: **blocked** — need gh'])).toMatchObject({ blocked: true })
    expect(await run(['`RUN STATUS:` blocked — need gh'])).toMatchObject({ blocked: true })
    expect(await run(['```', 'RUN STATUS: blocked — need gh', '```'])).toMatchObject({ blocked: true })
  })

  it('never retries a blocked run, even when its reason mentions the network', async () => {
    const result = await run(['RUN STATUS: blocked — network sandbox denied'])
    expect(result).toMatchObject({ blocked: true, attempts: 1 })
  })

  it('keeps a done marker or no marker as succeeded', async () => {
    expect(await run(['work', 'RUN STATUS: done'])).toMatchObject({ succeeded: true, blocked: false })
    expect(await run(['work finished'])).toMatchObject({ succeeded: true, blocked: false })
  })

  it('ignores a blocked marker that is not the last line', async () => {
    const result = await run(['RUN STATUS: blocked — earlier', 'fixed it', 'RUN STATUS: done'])
    expect(result).toMatchObject({ succeeded: true, blocked: false })
  })

  it('does not read the echoed instruction as a blocked marker', async () => {
    const echo = { ...agentPrinting([]), headlessArgs: ['-e', 'console.log(process.argv.at(-1))', '--'] }
    const result = await runAgentHeadlessWithRetry(echo, 'do it', tmpdir(), tmpdir())
    expect(result).toMatchObject({ succeeded: true, blocked: false })
  })

  it('appends the run status instruction to the resume prompt too', async () => {
    const flaky = {
      ...agentPrinting([]),
      headlessArgs: ['-e', 'console.log(process.argv.slice(1).join(" ")); console.error("API Error: 529 overloaded"); process.exit(1)', '--']
    }
    const result = await runAgentHeadlessWithRetry(flaky, 'do it', tmpdir(), tmpdir(), {
      sessionId: SESSION_ID,
      sleep: async () => undefined
    })
    expect(result.output).toContain(`--resume ${SESSION_ID} ${CONTINUE_PROMPT}\n\n${RUN_STATUS_INSTRUCTION}`)
  })
})

describe('isTransientFailure', () => {
  const transientOutputs = [
    'Error: read ECONNRESET',
    'connect ETIMEDOUT 1.2.3.4:443',
    'getaddrinfo ENOTFOUND api.anthropic.com',
    'getaddrinfo EAI_AGAIN api.anthropic.com',
    'socket hang up',
    'TypeError: fetch failed',
    'API Connection Error',
    'Network is unreachable',
    'API Error: 529 {"type":"overloaded_error"}',
    'Rate limit reached',
    'HTTP 429 Too Many Requests',
    'API Error: 500 Internal server error',
    'Request timed out'
  ]
  it.each(transientOutputs)('treats %j as transient', (output) => {
    expect(isTransientFailure(output)).toBe(true)
  })

  it('never retries a missing CLI or a run the timeout killed', () => {
    expect(isTransientFailure('network', { code: 'ENOENT' })).toBe(false)
    expect(isTransientFailure('network', { killed: true })).toBe(false)
  })

  it('treats a plain non-zero exit as a real failure', () => {
    expect(isTransientFailure('Error: tests failed on line 512')).toBe(false)
  })
})

describe('runAgentHeadlessWithRetry', () => {
  const SESSION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
  // Prints its argv; exits 1 with an overload error unless `succeedOn` is in it.
  const flakyAgent = (succeedOn?: string) => ({
    id: 'flaky',
    name: 'Flaky',
    command: process.execPath,
    headlessArgs: [
      '-e',
      `const args = process.argv.slice(1); console.log(args.join(' ')); ` +
        `if (!${JSON.stringify(succeedOn ?? null)} || !args.includes(${JSON.stringify(succeedOn ?? '')})) { console.error('API Error: 529 overloaded'); process.exit(1) }`,
      '--'
    ],
    sessionArgs: ['--session-id', '{sessionId}'],
    resumeArgs: ['--resume', '{sessionId}']
  })
  const recordSleeps = () => {
    const delays: number[] = []
    return { delays, sleep: async (delayMs: number) => void delays.push(delayMs) }
  }

  it('retries a transient failure twice with backoff, resuming the same session', async () => {
    const { delays, sleep } = recordSleeps()
    const notices: number[] = []
    const result = await runAgentHeadlessWithRetry(flakyAgent(), 'do it', tmpdir(), tmpdir(), {
      sessionId: SESSION_ID,
      sleep,
      onRetry: (notice) => notices.push(notice.attempt)
    })
    expect(result.attempts).toBe(3)
    expect(result.succeeded).toBe(false)
    expect(delays).toEqual([30_000, 120_000])
    expect(notices).toEqual([1, 2])
    expect(result.output).toContain(`--resume ${SESSION_ID} ${CONTINUE_PROMPT}`)
  })

  it('starts the first attempt under the session id', async () => {
    const result = await runAgentHeadlessWithRetry(flakyAgent('--session-id'), 'do it', tmpdir(), tmpdir(), {
      sessionId: SESSION_ID,
      sleep: async () => undefined
    })
    expect(result).toMatchObject({ succeeded: true, attempts: 1, output: `--session-id ${SESSION_ID} do it\n\n${RUN_STATUS_INSTRUCTION}` })
  })

  it('stops as soon as a resumed attempt succeeds', async () => {
    const { delays, sleep } = recordSleeps()
    const result = await runAgentHeadlessWithRetry(flakyAgent('--resume'), 'do it', tmpdir(), tmpdir(), {
      sessionId: SESSION_ID,
      sleep
    })
    expect(result).toMatchObject({ succeeded: true, attempts: 2 })
    expect(delays).toEqual([30_000])
    // The dropped attempt's output survives next to the resumed one.
    expect(result.output).toContain(`--session-id ${SESSION_ID} do it`)
    expect(result.output).toContain(`--resume ${SESSION_ID}`)
  })

  it('does not read outage words in the work the agent printed as an outage', async () => {
    const failing = {
      ...flakyAgent(),
      headlessArgs: ['-e', 'console.log("updated network retry logic"); console.log("done"); process.exit(1)', '--']
    }
    const result = await runAgentHeadlessWithRetry(failing, 'do it', tmpdir(), tmpdir(), {
      sessionId: SESSION_ID,
      sleep: async () => undefined
    })
    expect(result.attempts).toBe(1)
  })

  it('does not retry a non-transient failure', async () => {
    const failing = { ...flakyAgent(), headlessArgs: ['-e', 'console.log("tests failed"); process.exit(1)'] }
    const result = await runAgentHeadlessWithRetry(failing, 'do it', tmpdir(), tmpdir(), {
      sessionId: SESSION_ID,
      sleep: async () => undefined
    })
    expect(result.attempts).toBe(1)
  })

  it('does not retry an agent that cannot resume', async () => {
    const { sessionArgs, resumeArgs, ...cannotResume } = flakyAgent()
    const result = await runAgentHeadlessWithRetry(cannotResume, 'do it', tmpdir(), tmpdir(), {
      sessionId: SESSION_ID,
      sleep: async () => undefined
    })
    expect(result.attempts).toBe(1)
    expect(result.output).not.toContain(SESSION_ID)
  })

  it('does not read the prompt quoted in the failure message as an outage', async () => {
    const failing = { ...flakyAgent(), headlessArgs: ['-e', 'process.exit(1)', '--'] }
    const result = await runAgentHeadlessWithRetry(failing, 'fix the network rate limit 503', tmpdir(), tmpdir(), {
      sessionId: SESSION_ID,
      sleep: async () => undefined
    })
    expect(result.attempts).toBe(1)
  })
})
