# Evals — lane agent prompts

Two tiers check that a lane prompt still does its job after an edit.

## Static — part of `bun run test`
- `static/lint.test.ts` — every `agent-context/*.md`: not empty, names only lane ids on `fixtures/board.json`, no hard-coded real DB path; assembled prompts never start with `-`.
- `static/snapshots.test.ts` — `ticketAgentPrompt` per prompted lane × 4 ticket variants. A prompt edit shows as a snapshot diff; accept it with `bunx vitest run evals/static -u`.

## Behavioral — `bun run eval` (opt-in, real agent runs, costs tokens)
Each case runs the lane's real agent against a throwaway world: fixture git repo with a local bare `origin`, temp Project Tracker DB, stubbed `gh` / `osascript` / `mise`. Each run is graded twice:

1. **Outcome (deterministic):** end lane, move count (a trigger logs every lane change), required fields, required stub calls.
2. **Quality and process (LLM judge, `judge.ts`):** runs only when the outcome passed. Claude grades the case's `rubric` against the evidence: ticket before and after, new git commits, stub log (including `--body-file` PR bodies), the agent's full tool-call trajectory from stream-json, and its final message. Every criterion must pass. A criterion the judge skips or garbles counts as a fail.

A run passes only if both pass. Per-criterion verdicts with reasons go into the results JSON. Failing runs also store their trajectory.

| Env var | Default | Meaning |
|---|---|---|
| `EVAL_LANE` | all | Only cases under `fixtures/cases/<lane>/` |
| `EVAL_RUNS` | 3 | Runs per case; pass at ≥ ⌈2N/3⌉ |
| `EVAL_AGENT` | `claude` | Agent id from the app's agent list |
| `EVAL_EXTRA_ARGS` | none | Appended to the agent's headless args |
| `EVAL_KEEP` | off | `1` keeps sandboxes; failing runs report their path |
| `EVAL_JUDGE` | on | `0` skips the LLM judge (outcome checks only) |
| `EVAL_JUDGE_MODEL` | CLI default | Passed to the judge as `--model` |

```sh
EVAL_LANE=prd EVAL_RUNS=1 bun run eval
EVAL_EXTRA_ARGS='--allowedTools Bash(sqlite3:*) Bash(/usr/bin/sqlite3:*) Bash(git:*) Bash(gh:*) Bash(rtk:*)' bun run eval
```

The production args (`-p --permission-mode acceptEdits`) don't let headless Claude run `sqlite3`, `git` or `gh`, so with no extra args every case that must move a ticket fails. That's the Run button's behavior too. Pass `EVAL_EXTRA_ARGS` to grade the prompt itself. `Bash(rtk:*)` is needed where the RTK hook rewrites `gh …` to `rtk gh …`. The stubs still answer, since `rtk` resolves `gh` from PATH.

`behavioral/sync.eval.test.ts` also checks that each committed `agent-context/*.md` matches its lane's prompt in the live DB (skipped when there's no DB). It isn't part of `bun run test`, because a prompt edited in the app would fail every worktree's tests until the re-saved file got merged. Fix drift with **Save to Agent Markdown** in the lane's ⚙ settings, then commit the file.

Results: a table on stdout plus `results/<timestamp>.json` (gitignored). The real DB is guarded: any row with the eval ticket number (9046) or a sandbox project path fails the case.
