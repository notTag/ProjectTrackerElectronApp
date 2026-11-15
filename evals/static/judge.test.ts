import { describe, expect, it } from 'vitest'

import { parseTrajectory, parseVerdicts } from '../judge.js'

describe('parseVerdicts', () => {
  const rubric = ['has acceptance criteria', 'no invented scope']

  it('reads verdicts out of surrounding prose', () => {
    const output = 'Sure.\n{"verdicts":[{"criterion":"a","pass":true,"reason":"listed"},{"criterion":"b","pass":false,"reason":"adds CSV"}]}\nDone.'
    expect(parseVerdicts(rubric, output)).toEqual([
      { criterion: 'has acceptance criteria', pass: true, reason: 'listed' },
      { criterion: 'no invented scope', pass: false, reason: 'adds CSV' }
    ])
  })

  it('fails a criterion the judge skipped instead of passing it', () => {
    const output = '{"verdicts":[{"criterion":"a","pass":true,"reason":"ok"}]}'
    expect(parseVerdicts(rubric, output)[1]).toEqual({
      criterion: 'no invented scope',
      pass: false,
      reason: 'judge gave no usable verdict'
    })
  })

  it('fails every criterion when the reply is not JSON', () => {
    expect(parseVerdicts(rubric, 'I cannot grade this.').every((verdict) => !verdict.pass)).toBe(true)
    expect(parseVerdicts(rubric, '{"verdicts": [').every((verdict) => !verdict.pass)).toBe(true)
  })

  it('does not count a string "true" as a pass', () => {
    const output = '{"verdicts":[{"pass":"true"},{"pass":true}]}'
    expect(parseVerdicts(rubric, output).map((verdict) => verdict.pass)).toEqual([false, true])
  })
})

describe('parseTrajectory', () => {
  it('turns stream-json into one line per tool call and text, plus the final message', () => {
    const events = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Checking worktrees.' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git worktree list' } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/r/README.md' } }] } },
      { type: 'result', result: 'Moved to in-pr.' }
    ]
    const streamJson = [...events.map((event) => JSON.stringify(event)), 'not json'].join('\n')
    expect(parseTrajectory(streamJson)).toEqual({
      steps: ['says: Checking worktrees.', '→ Bash: git worktree list', '→ Read: {"file_path":"/r/README.md"}'],
      finalMessage: 'Moved to in-pr.'
    })
  })
})
