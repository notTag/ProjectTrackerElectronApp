# PRD: Notifications auto-dismiss after 30 seconds (#19)

## Problem
The Board and Dashboard each show two banners from the shared Pinia store: `store.error` (red) and `store.notice` (cyan). The only ways to clear one are the × button or some later action that resets it. So stale messages like "Imported 3 issues." or "Auto Run opened 4 tabs in Ghostty." stay pinned under the titlebar until you dismiss them.

## Decisions
- D1. Errors auto-dismiss too, after the same 30 s. The ticket says "notifications", and the failure doesn't get lost: agent failures are also saved on the ticket (`agentRun.succeeded = false`, shown as the card's last-run state)
- D2. `Agent running on #N…` auto-dismisses like any other notice. No special case for messages that end in `…`. The card already shows a running indicator (`BoardView.vue:579`, `store.agentRunning[ticket.id]`), so hiding the banner doesn't remove the only "running" signal
- D3. No pause on hover. No toast stack. The duration is a constant
- D4. One `watch` per banner in `src/App.vue`. The store setters (about 12 `this.notice` / `this.error` assignments in `src/stores/projects.ts`) and both views stay unchanged. `App.vue` wraps `<RouterView />`, so switching between Board and Dashboard doesn't remount the watchers or reset the clock
- D5. No separate check that the value is unchanged. The watcher runs on every change and clears the pending timer before it starts a new one, so an old timer can never wipe a newer message. Known gap: setting the exact same string twice in a row doesn't trigger the watcher, so the clock doesn't restart. Acceptable for this ticket

## Code facts (verified 2026-11-09 on `ebdfcd5`)
- State: `src/stores/projects.ts:51-52` defines `error: null` and `notice: null`
- Render: `src/views/BoardView.vue:463-472` and `src/views/DashboardView.vue:382-391` use the same `.message-row` markup. The × buttons set the value to `null`
- `src/App.vue` already imports `watch` and `onBeforeUnmount` and holds `projectsStore = useProjectsStore()`
- `runTicketAgent` (`projects.ts:401`) sets `notice` to `Agent running…`, then to `Agent finished` (or sets `error` on failure). Every new value restarts its own banner's 30 s clock

## Requirements
### R1. `src/App.vue`
- Add `const MESSAGE_LIFETIME_MS = 30_000`
- Write one helper that does the following for a single store key (`'notice' | 'error'`):
  - `watch(() => projectsStore[key], ...)`
  - On every change, `clearTimeout` the pending timer
  - If the new value is non-null, start `setTimeout(() => { projectsStore[key] = null }, MESSAGE_LIFETIME_MS)`
  - Return a function that clears the pending timer
- Call it for `notice` and `error`. Clear both timers in the existing `onBeforeUnmount`
- Roughly 15 lines in total, with no new files

### R2. No other changes
- The × buttons, styles and store actions all stay as they are

## Acceptance criteria
- [ ] A notice disappears 30 s after it appears, with no user action
- [ ] An error disappears 30 s after it appears
- [ ] When a new message replaces the current one, the new message gets a full 30 s
- [ ] × still dismisses right away, and the timer that was pending does nothing afterwards
- [ ] Works on both the Board and the Dashboard views
- [ ] Switching views doesn't reset or duplicate the timer

## Verification
- Manual: trigger a notice (Auto Run or Import) and an error (for example, Import on a project with no GitHub repo, `projects.ts:140`) on the Board. Watch both clear at about 30 s. Repeat on the Dashboard. Switch views mid-countdown and check the original deadline still holds
- Optional unit test: mount `App.vue` with `vi.useFakeTimers()`, set `store.notice`, advance 29 s (still set), then advance 1 s more (now `null`). Set a new value at 20 s and check it lasts its own full 30 s

## Out of scope
- Replacing the banners with a toast stack or queue
- Native OS notifications
- A user setting for the duration
- Pausing on hover

## Effort
About 1 hour, including the manual check on both views.

## Branch
- `t19-notifications-should-dismiss`
