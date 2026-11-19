# PRD — Ticket #90: Closing the window during a hung scan blocks scanning until restart

## Context
- macOS keeps the app alive after the last window closes (`window-all-closed` doesn't quit on darwin); Dock click → `activate` → `createWindow()`
- `projects:scan` (`electron/ipcHandlers.ts:442`) guards one app-wide `activeScan`; cleared only in `finally` (`:463`)
- `:453` `onPageGone(() => scan.abort())` — only escape hatch once the renderer loses its Cancel button
- Electron `onPageGone` (`electron/main.ts:242-251`) listens to main-frame cross-document `did-start-navigation` only
	- Reload → aborts (#6 / PR #115)
	- Window close → sender destroyed, no navigation → no abort → `activeScan` stuck → "A scan is already running." forever
- Web path already fine: `dropClient` (`electron/web/server.ts:167`) fires `pageGoneListeners`

## Verified assumption
- Abort settles the scan immediately even when `readdir` is hung
	- `electron/scanner/projectScanner.ts:216` races the walk against an abort rejection
	- → `finally` runs → `activeScan = null`
	- So firing `abort()` on destroy is sufficient; no scanner change needed

## Goal
- Closing the window mid-scan aborts that scan, same as reload

## Requirements
1. New helper `electron/pageGone.ts`
	- `watchPageGone(sender, listener): () => void`
	- `sender` typed as minimal interface: `on`/`once`/`off`/`isDestroyed` (Electron `WebContents` satisfies it structurally)
	- Fires `listener` on main-frame cross-document `did-start-navigation` (existing rule, moved verbatim)
	- Fires `listener` on `destroyed` (`once`)
	- Returned cleanup removes both listeners; skips `off` when `isDestroyed()` (as today)
2. `electron/main.ts` `onPageGone: (listener) => watchPageGone(sender, listener)` — no other change
3. `ipcHandlers.ts` untouched — `CallContext.onPageGone` contract unchanged

## Edge cases
- Reload then close → listener can fire twice → `scan.abort()` is idempotent, fine; no dedupe needed
- Close after scan finished → cleanup already ran → no listener left → nothing fires
- Cleanup called after destroy → must not throw (guard)
- Other `did-start-navigation` / `destroyed` listeners on the sender → untouched (remove only our own fns)

## Acceptance
- Hung scan + Cmd+W + Dock reopen → Scan starts, no "A scan is already running."
- Cmd+R mid-scan still aborts (no regression)
- Finished scan leaves zero listeners from the helper on the sender (no leak across scans)

## Tests — `electron/pageGone.test.ts` (vitest, Node `EventEmitter` fake with `isDestroyed`)
- `destroyed` emitted → listener called once
- Main-frame, cross-document navigation → fires
- Same-document nav → no fire; subframe nav → no fire
- Cleanup → `listenerCount` 0 for both events; later emits don't fire
- Cleanup after destroyed (`isDestroyed()` true) → no throw, `off` not called

## Manual checks
- Hung scan: scan dir `~` (reaches `~/Library/CloudStorage`) → wait for progress stall → Cmd+W → Dock → Scan works
- Cmd+R mid-scan → scan aborts, Scan works after reload

## Out of scope
- Web server path (already handled)
- Making hung `readdir` cancellable (orphaned walk still exits at its next `throwIfAborted`)
- Per-window scans / multiple concurrent scans

## Branch / worktree
- Branch: `t90-closing-the-window`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t90`
