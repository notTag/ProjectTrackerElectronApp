import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AGENT,
  STALE_RUN_MS,
  agentResumeCommand,
  agentRunBadge,
  agentShellCommand,
  buildAutoRunLaunch,
  canResume,
  hasUnseenAgentResult,
  isUuid,
  runsToInterrupt,
  type Agent,
  type SwimLane,
  type Ticket,
  type TicketAgentRun
} from './projectTypes'

const SESSION_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const CODEX: Agent = { id: 'codex', name: 'Codex', command: 'codex', headlessArgs: ['exec'] }

const ticketWithRun = (run: Partial<TicketAgentRun> = {}, id = 'ticket-1'): Ticket => ({
  id,
  number: 7,
  laneId: 'dev',
  title: 'Add the thing',
  description: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  agentRun: { at: '2026-01-02T00:00:00.000Z', laneId: 'dev', output: '', ...run }
})

describe('isUuid', () => {
  it('accepts a v4 uuid and rejects anything that could carry shell syntax', () => {
    expect(isUuid(SESSION_ID)).toBe(true)
    expect(isUuid(crypto.randomUUID())).toBe(true)
    expect(isUuid("'; rm -rf ~'")).toBe(false)
    expect(isUuid(`${SESSION_ID}; id`)).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })
})

describe('agentShellCommand with a session id', () => {
  it('starts the session under the given id, before the prompt', () => {
    expect(agentShellCommand(DEFAULT_AGENT, 'go', undefined, SESSION_ID)).toBe(`claude --session-id ${SESSION_ID} 'go'`)
  })

  it('passes no session flag to an agent that cannot resume, or for a bad id', () => {
    expect(agentShellCommand(CODEX, 'go', undefined, SESSION_ID)).toBe(`codex 'go'`)
    expect(agentShellCommand(DEFAULT_AGENT, 'go', undefined, "'; rm -rf ~'")).toBe(`claude 'go'`)
  })

  it('gives each Auto Run launch its own fresh session', () => {
    const lane: SwimLane = { id: 'dev', name: 'Dev', agentPrompt: 'Build it.', agentFilePath: '' }
    const ticket = ticketWithRun()
    const first = buildAutoRunLaunch(ticket, lane, DEFAULT_AGENT, {}, false)
    const second = buildAutoRunLaunch(ticket, lane, DEFAULT_AGENT, {}, false)
    expect(isUuid(first.sessionId)).toBe(true)
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.launch.command).toContain(`--session-id ${first.sessionId}`)
    expect(buildAutoRunLaunch(ticket, lane, CODEX, {}, false).sessionId).toBeUndefined()
  })
})

describe('agentResumeCommand', () => {
  it('resumes in the directory the session started in, every part quoted', () => {
    const cwd = "/Users/me/My Project's/wt"
    const command = agentResumeCommand(DEFAULT_AGENT, { sessionId: SESSION_ID, cwd }, "Check `git status`, don't stop")
    expect(command).toBe(
      `cd '/Users/me/My Project'\\''s/wt' && claude --resume ${SESSION_ID} 'Check \`git status\`, don'\\''t stop'`
    )
  })

  it('refuses a session id that is not a uuid', () => {
    expect(() => agentResumeCommand(DEFAULT_AGENT, { sessionId: "'; rm -rf ~'", cwd: '/tmp' }, 'go')).toThrow()
  })

  it('refuses an agent without resumeArgs', () => {
    expect(() => agentResumeCommand(CODEX, { sessionId: SESSION_ID, cwd: '/tmp' }, 'go')).toThrow()
  })
})

describe('canResume', () => {
  it('offers Resume for an interrupted or failed run with a session, in its own lane', () => {
    expect(canResume(ticketWithRun({ status: 'interrupted', sessionId: SESSION_ID }), DEFAULT_AGENT)).toBe(true)
    expect(canResume(ticketWithRun({ status: 'failed', sessionId: SESSION_ID }), DEFAULT_AGENT)).toBe(true)
  })

  it('hides it for a running or finished run, no session, another lane, or a CLI that cannot resume', () => {
    expect(canResume(ticketWithRun({ status: 'running', sessionId: SESSION_ID }), DEFAULT_AGENT)).toBe(false)
    expect(canResume(ticketWithRun({ status: 'succeeded', sessionId: SESSION_ID }), DEFAULT_AGENT)).toBe(false)
    expect(canResume(ticketWithRun({ status: 'failed' }), DEFAULT_AGENT)).toBe(false)
    expect(canResume(ticketWithRun({ status: 'failed', sessionId: SESSION_ID, laneId: 'prd' }), DEFAULT_AGENT)).toBe(false)
    expect(canResume(ticketWithRun({ status: 'interrupted', sessionId: SESSION_ID }), CODEX)).toBe(false)
  })
})

describe('agentRunBadge with run status', () => {
  it('shows a persisted running run, even once the ticket was opened', () => {
    const ticket = ticketWithRun({ status: 'running', seenAt: '2026-01-02T00:01:00.000Z' })
    expect(agentRunBadge(ticket, false)).toBe('running')
    expect(hasUnseenAgentResult(ticket)).toBe(false)
  })

  it('shows interrupted until seen', () => {
    expect(agentRunBadge(ticketWithRun({ status: 'interrupted', succeeded: false }), false)).toBe('interrupted')
    expect(hasUnseenAgentResult(ticketWithRun({ status: 'interrupted' }))).toBe(true)
    expect(agentRunBadge(ticketWithRun({ status: 'interrupted', seenAt: 'x' }), false)).toBeNull()
  })

  it('reads a record saved before status existed by succeeded alone', () => {
    expect(agentRunBadge(ticketWithRun({ succeeded: false }), false)).toBe('failed')
    expect(agentRunBadge(ticketWithRun({ succeeded: true }), false)).toBe('succeeded')
    expect(agentRunBadge(ticketWithRun(), false)).toBeNull()
  })

  it('stays lane-scoped for a running record', () => {
    expect(agentRunBadge(ticketWithRun({ status: 'running', laneId: 'prd' }), false)).toBeNull()
  })
})

describe('runsToInterrupt', () => {
  const APP_STARTED_AT = Date.parse('2026-01-02T12:00:00.000Z')
  const BEFORE_APP = '2026-01-02T11:59:00.000Z'
  const AFTER_APP = '2026-01-02T12:01:00.000Z'
  const now = (startedAt: string, ageMs: number) => Date.parse(startedAt) + ageMs
  const fresh = 60_000
  const stale = STALE_RUN_MS + 1

  const interrupts = (run: Partial<TicketAgentRun>, liveness?: 'alive' | 'gone' | 'unknown', ageMs = fresh) => {
    const startedAt = run.startedAt ?? AFTER_APP
    const ticket = ticketWithRun({ status: 'running', startedAt, ...run })
    const livenessByTicketId = liveness ? { [ticket.id]: liveness } : {}
    return runsToInterrupt([ticket], livenessByTicketId, now(startedAt, ageMs), APP_STARTED_AT).length === 1
  }

  it('interrupts a headless run started before this app launch, and only that', () => {
    expect(interrupts({ mode: 'headless', startedAt: BEFORE_APP })).toBe(true)
    expect(interrupts({ mode: 'headless', startedAt: AFTER_APP }, undefined, stale)).toBe(false)
  })

  it('leaves a terminal run whose tab is alive, however old', () => {
    expect(interrupts({ mode: 'terminal', startedAt: BEFORE_APP }, 'alive', stale)).toBe(false)
  })

  it('interrupts a terminal run whose tab is gone once the app restarted or the run went stale', () => {
    expect(interrupts({ mode: 'terminal', startedAt: BEFORE_APP }, 'gone')).toBe(true)
    expect(interrupts({ mode: 'terminal', startedAt: AFTER_APP }, 'gone', stale)).toBe(true)
    expect(interrupts({ mode: 'terminal', startedAt: AFTER_APP }, 'gone')).toBe(false)
  })

  it('treats a terminal it cannot ask by age alone, never as gone on app start', () => {
    expect(interrupts({ mode: 'terminal', startedAt: BEFORE_APP }, 'unknown')).toBe(false)
    expect(interrupts({ mode: 'terminal', startedAt: AFTER_APP }, 'unknown', stale)).toBe(true)
    expect(interrupts({ mode: 'terminal', startedAt: AFTER_APP }, undefined, stale)).toBe(true)
  })

  it('ignores a run that is not running, or belongs to a lane the ticket left', () => {
    expect(interrupts({ mode: 'headless', startedAt: BEFORE_APP, status: 'succeeded' })).toBe(false)
    expect(interrupts({ mode: 'headless', startedAt: BEFORE_APP, laneId: 'prd' })).toBe(false)
  })
})
