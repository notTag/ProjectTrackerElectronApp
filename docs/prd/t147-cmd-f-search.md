# PRD — #147 CMD+F search bar is buggy and slow

Branch `t147-cmd-f-search` · worktree `.worktrees/t147`

## Problem
⌘F find bar (`src/components/PageFind.vue`) lags behind typing, shows stale counts, and Enter / ↑ / ↓ don't step through matches. It resets to "1 of N" on every press instead.

## Root causes (verified)
1. **`findNext` flag inverted.** Electron 35.7.5 `FindInPageOptions.findNext` typings say: "Whether to begin a new text finding session with this request. Should be `true` for initial requests, and `false` for follow-up requests."
   - `search(forward = true, next = false)` → typing and ⌘F reopen send `findNext: false`. Chromium treats that as a follow-up to the *previous* query's session → stale counts, highlight lags the query.
   - Enter / Shift+Enter / ↑ / ↓ send `next = true`. Each press starts a *new* session → counter resets to 1 instead of stepping.
   - Main side (`electron/main.ts:183`, `findNext: next === true`) and preload (`electron/preload.cts:33`) pass the flag through as-is. The bug is entirely in the renderer's call sites.
2. **300 ms debounce** (`watch(query)` → `setTimeout(..., 300)`) plus the IPC round trip → visible delay before anything highlights.
3. **Possible self-match** [~70% confidence, would need a manual check in the running app to be certain]: Chromium find-in-page also matches text inside `<input>` values. The bar's own input holds the query → count may be +1, and the active match may land on the bar.

## Requirements
- R1. New query (typing, ⌘F open/reopen) → new find session: `findInPage(q, true, true)`.
- R2. Enter / ↓ → `findInPage(q, true, false)`; Shift+Enter / ↑ → `findInPage(q, false, false)`. Follow-up of current session.
- R3. Rename the param from `next` to `newSession` in `PageFind.vue` so the call sites read correctly. Defaults: `search(forward = true, newSession = true)`. Follow-up call sites pass `false` explicitly. Keep the preload/main param name as-is (or rename for consistency; no behavior change either way).
- R4. Debounce drops from 300 ms to ~100 ms. Keep `cancelPendingSearch` (still needed so Enter doesn't race a pending new-session search). Enter while a search is pending → run the pending new-session search first, not a follow-up on the old query. Simplest: if `searchTimer` is set when Enter fires, call `search(forward, true)`.
- R5. Empty query → `stopFindInPage` + counter cleared (existing behavior, keep).
- R6. Self-match check (root cause 3). Verify in the running app: type a word that appears once on the board and check the count shows "1 of 1".
   - Doesn't reproduce → nothing to do.
   - Reproduces → default fallback: subtract the bar's own hit from the count. Only if that proves unreliable (e.g. active match still lands on the input), escalate to the renderer-side search in "Upgrade path" as its own ticket. Do not grow this ticket into it.
- R7. No main-process change needed. `found-in-page` → `page-find:result` relay stays.

## Acceptance criteria
- Typing a query highlights matches within ~100 ms. The count updates on every change, never showing the previous query's count.
- Enter steps 1 → 2 → 3 … of N; Shift+Enter steps back; wraps at both ends. ↑ / ↓ buttons match.
- ⌘F with the bar already open re-selects the input text and re-runs as a new session.
- Clearing the query clears highlights and the counter.
- Count does not include the search bar's own text (R6).
- Escape / × closes, clears highlights, restores previous focus (existing).
- Route change closes the bar (existing).
- Board ⌘⇧F ticket filter unaffected.
- `feature-map.md` §1.4 updated: "300 ms" → new debounce value.

## Verification
- Typecheck + existing tests pass.
- No DOM test env in the repo (component tests use SSR `renderToString`), so there's no unit test for the call args. Verify by driving the app on an isolated DB copy (see the "drive app via CDP" recipe): type, Enter ×3, Shift+Enter, clear, Escape. Note the counter values in the PR body.

## Files
- `src/components/PageFind.vue`: all behavior changes.
- `feature-map.md`: §1.4 debounce wording.
- `electron/main.ts`, `electron/preload.cts`: reference only (optional param rename).

## Out of scope / upgrade path
- Replacing Electron `findInPage` with renderer-side search (TreeWalker + CSS Custom Highlight API). Would remove self-matching and also give the web build a find bar (t85 D8 parity). Separate ticket, only if R6's fallback is insufficient.
- Case-sensitive toggle, regex, whole-word.
