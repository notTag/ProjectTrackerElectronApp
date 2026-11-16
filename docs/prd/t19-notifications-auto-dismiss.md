# PRD: Notifications auto-dismiss after 30 seconds (#19)

## Problem
The Board and Dashboard each show two banners from the shared Pinia store: `store.error` (red) and `store.notice` (cyan). The only ways to clear one are the × button or some later action that resets it. So stale messages like "Imported 3 issues." or "Auto Run opened 4 tabs in Ghostty." stay pinned under the titlebar until you dismiss them.

## Decisions
- D1. Errors do NOT auto-dismiss. They stay until the user clicks ×, so a failure is never missed by someone who stepped away. Only the notice banner auto-dismisses (changed after #74 merged)
- D2. `Agent running on #N…` auto-dismisses like any other notice. No special case for messages that end in `…`. The card already shows a running indicator (`BoardView.vue:579`, `store.agentRunning[ticket.id]`), so hiding the banner doesn't remove the only "running" signal
- D3. No pause on hover. No toast stack. The duration is a constant
- D4. One `watch`, on `store.notice` only, in `src/App.vue`. `App.vue` wraps `<RouterView />`, so the clock survives Board ↔ Dashboard switches. `MessageBanners.vue` is mounted per view, so a timer there (as in #45) restarted on every switch; it is now render-only. The store setters and both views stay unchanged.
- D5. No separate check that the value is unchanged. The watcher runs on every change and clears the pending timer before it starts a new one, so an old timer can never wipe a newer message. Known gap: setting the exact same string twice in a row doesn't trigger the watcher, so the clock doesn't restart. Acceptable for this ticket

## Code facts (verified 2026-11-09 on `ebdfcd5`)
- State: `src/stores/projects.ts:51-52` defines `error: null` and `notice: null`
- Render: `src/components/MessageBanners.vue`, mounted by both `BoardView.vue` and `DashboardView.vue`. The × buttons set the value to `null`
- `runTicketAgent` (`projects.ts:401`) sets `notice` to `Agent running…`, then to `Agent finished` (or sets `error` on failure). Every new value restarts its own banner's 30 s clock

## Requirements
### R1. `src/App.vue`
- `NOTICE_LIFETIME_MS = 30_000`; one `watch` on `store.notice` that clears the pending timer on every change and re-arms it when non-null; cleared in `onBeforeUnmount`
- No error timer (#74's watcher also cleared `store.error`; removed)

### R2. `src/components/MessageBanners.vue`
- Render only: the #45 notice timer is removed (it stacked with #74's and reset on every view switch)

## Acceptance criteria
- [ ] A notice disappears 30 s after it appears, with no user action
- [ ] An error stays until the user clicks ×
- [ ] When a new message replaces the current one, the new notice gets a full 30 s
- [ ] × still dismisses right away, and the timer that was pending does nothing afterwards
- [ ] Works on both the Board and the Dashboard views
- [ ] Switching views doesn't reset or duplicate the notice timer

## Verification
- Manual: trigger a notice (Auto Run or Import) and an error (for example, Import on a project with no GitHub repo, `projects.ts:140`) on the Board. Watch the notice clear at about 30 s and the error stay until ×. Repeat on the Dashboard. Switch views mid-countdown and check the original deadline still holds
- Optional unit test: mount `App.vue` (with a stub router) using `vi.useFakeTimers()`, set `store.notice`, advance 29 s (still set), then advance 1 s more (now `null`). Set a new value at 20 s and check it lasts its own full 30 s

## Out of scope
- Replacing the banners with a toast stack or queue
- Native OS notifications
- A user setting for the duration
- Pausing on hover

## Effort
About 1 hour, including the manual check on both views.

## Branch
- `t19-notifications-should-dismiss` (#74, merged)
- `t19-errors-persist` (errors sticky)
