# PRD — #136 Lane settings modal: collapsable sections

Branch `t136-swimlane-settings-collapsable` · Worktree `.worktrees/t136`

## Problem
The lane settings modal (⚙ on a lane) is one long flat column of ~16 fields plus two long hints. It's hard to scan. Group the fields under the lane name into 3 collapsable sections: **Agent**, **Orchestrator**, **Auto Run**.

## Decisions
- Native `<details>/<summary>`. No new component, no JS beyond one `@toggle` handler per section. Enter/Space toggle, focus and the expanded state for screen readers all come with the element.
- Field → section mapping lives on `LANE_MODAL_FIELDS` (a `section` key per entry). One source of truth for "which fields belong to which section", so a section header can't drift from the fields it holds.
- `orchestratorAgent` + `orchestratorModel` move from Auto Run to Orchestrator. Their `LANE_MODAL_FIELDS` entries move too (after `orchestratorPoll`), so the Display modal and closed-eye lists show the same order as the modal. Ids don't change, so saved `hiddenLaneModalFields` / `hiddenLaneModalFieldsByLane` keep working.
- Open/closed state: module-scope `reactive` in `src/modalWidth.ts`, next to `laneModalExpanded`. Shared by every lane, lasts until the app restarts, never saved.
- All sections start open.

## Change (4 files)

### 1. `src/shared/projectTypes.ts` (`LANE_MODAL_FIELDS`, ~l.1869)
- Add `section: 'agent' | 'orchestrator' | 'autoRun'` to every entry:
  - agent: `agentPrompt`, `agentFile`, `output`
  - orchestrator: `orchestratorPrompt`, `orchestratorFile`, `orchestratorPoll`, `orchestratorAgent`, `orchestratorModel`
  - autoRun: `autoRunAgent`, `autoRunShell`, `autoRunModel`, `worktrees`, `fullAuto`, `nextLane`, `agentSetsVersion`, `closesTicket`
- Move the `orchestratorAgent` + `orchestratorModel` entries up, right after `orchestratorPoll`
- Export `type LaneModalSection = (typeof LANE_MODAL_FIELDS)[number]['section']`

### 2. `src/modalWidth.ts`
```ts
// Shared by every lane's modal: collapsing a section on one lane collapses it on all.
// ponytail: app-session only, same as laneModalExpanded.
export const laneModalSectionsOpen = reactive<Record<LaneModalSection, boolean>>({
  agent: true,
  orchestrator: true,
  autoRun: true
})
```

### 3. `src/views/BoardView.vue`
- Script, beside `showsLaneField` (~l.210):
  ```ts
  const showsLaneSection = (section: LaneModalSection, laneId: string) =>
    LANE_MODAL_FIELDS.some((field) => field.section === section && showsLaneField(field.id, laneId))
  const rememberLaneSectionOpen = (section: LaneModalSection, event: Event) => {
    const details = event.target as HTMLDetailsElement
    laneModalSectionsOpen[section] = details.open
  }
  ```
- Template (lane modal, ~l.2488–2752). Lane name `<input class="ticket-title-input">` stays where it is, outside every section. Each section:
  ```vue
  <details
    v-if="showsLaneSection('agent', openLane.id)"
    class="lane-settings-section"
    :open="laneModalSectionsOpen.agent"
    @toggle="rememberLaneSectionOpen('agent', $event)"
  >
    <summary class="eyebrow">Agent</summary>
    <div class="lane-settings-section-body">
      <!-- existing fields, unchanged, each keeps its own showsLaneField v-if -->
    </div>
  </details>
  ```
  - **Agent** body: Agent prompt, Agent markdown file, Output
  - **Orchestrator** body: Orchestrator prompt, missing-token error, Reset to default, Agent Orchestrator markdown file, Orchestrator poll row, then Orchestrator agent + Orchestrator model (moved out of Auto Run)
  - **Auto Run**: replaces `<section class="ticket-agent"><p class="eyebrow">Auto Run</p>`. Body div gets `class="lane-settings-section-body ticket-agent"` so its current layout (`align-items: flex-start`, 8px gap) stays. Holds `.auto-run-pickers` (Agent, Shell), Model, Worktrees, Full auto, Next Lane, Agent sets semantic version, Counts as closed, both hints
- Field markup moves as-is: no id, handler, label or `v-if` changes

### 4. `src/styles.css` (near `.lane-modal`, ~l.1557)
```css
.lane-settings-section-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 8px;
}

.lane-settings-section > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  cursor: pointer;
  list-style: none;
}

.lane-settings-section > summary::-webkit-details-marker {
  display: none;
}

.lane-settings-section > summary::before {
  content: '›';
  transition: transform 120ms ease;
}

.lane-settings-section[open] > summary::before {
  transform: rotate(90deg);
}

.lane-settings-section > summary:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .lane-settings-section > summary::before {
    transition: none;
  }
}
```
- Body is a wrapper `<div>`, not `display: flex` on `<details>`: flex on `<details>` only works in recent Chromium, and the wrapper works everywhere.
- Focus ring copies `.lane-heading-movable:focus-visible`.
- The Auto Run body keeps `.ticket-agent`'s 8px gap (it overrides the wrapper's 12px). That's the current look.

### 5. `feature-map.md` §3.9 (~l.454)
- New bullet after **Lane name**: "Fields below the name sit in 3 collapsable sections, **Agent**, **Orchestrator**, **Auto Run** (native `<details>`: click the header, or Enter/Space with it focused). All open by default. Open/closed is shared by every lane and kept until the app restarts (`laneModalSectionsOpen`, #136). A section with every field hidden (closed-eye or Display) isn't shown."
- Move the **Orchestrator agent / model** sub-bullet from **Auto Run** to after **Orchestrator poll**
- Nest Agent prompt…Output under "Agent section", Orchestrator prompt…model under "Orchestrator section", and Full auto / Next Lane / Agent sets semantic version under **Auto Run**, where the modal shows them (today they sit at the top level)
- §3.5 Display bullet ("Orchestrator prompt/file/poll, Auto Run pickers…"): change to "grouped as Agent / Orchestrator / Auto Run"

## Behavior notes / gotchas
- **Pending saves flush on collapse.** Clicking a `<summary>` focuses it, so a focused textarea blurs and its `change` (`storeTypedPrompts`) fires before the toggle. Keyboard toggling needs focus on the summary already. Either way the prompt is stored. The 1s markdown autosave timer keeps running (it isn't tied to focus).
- **Hidden fields keep their values.** A collapsed `<details>` still renders its content, just hidden. `laneMarkdownDraft` / autosave state isn't torn down. Only `showsLaneSection === false` removes a section from the DOM, the same as hiding every field one by one does today.
- **Missing-token error** stays ungated, inside Orchestrator. If the Orchestrator section itself isn't shown (every orchestrator field hidden), the error goes with it. Accepted: the user chose to hide all of it.
- **Auto Run hints** have no field id. They show while any Auto Run field shows and go away with the section. Today they show even with every Auto Run field hidden, which is the empty-header case this ticket removes.
- **Orchestrator agent/model width**: in Auto Run they sat in `.ticket-agent` (`align-items: flex-start`, so shrink-to-content). In the Orchestrator body they stretch full width like the other Orchestrator fields. Intended.
- `:open` binding + `@toggle` sync: Vue sets `open` from state; a user toggle fires `toggle` → state updates → the binding matches what the DOM already shows (no loop, no flicker).
- Unchanged: Expand toggle, closed-eye popover, Delete lane / Done, Escape / backdrop close, `.lane-modal label` styles (summary isn't a `label`).

## Tests
- `src/shared/projectTypes.test.ts`: one test that every `LANE_MODAL_FIELDS` entry has a `section` and that the three sections hold exactly the ids listed above. This catches a new field added without a section, which would never render.
- No BoardView component tests exist. Do the UI checks below by hand in the app (isolated DB copy, per run-app-before-merge).

## Acceptance checks
- [ ] Lane name input at top, outside every section
- [ ] 3 sections in order Agent / Orchestrator / Auto Run, each with a chevron header; fields as mapped above
- [ ] All open on first open after launch
- [ ] Click header toggles; Tab to header + Enter/Space toggles; focus ring visible on header
- [ ] Collapse Orchestrator on lane A → open lane B's modal → Orchestrator collapsed. Restart app → all open again
- [ ] Closed-eye: hide Agent prompt, Agent markdown file, Output → no Agent header. Show one again → header back. Same via Display modal
- [ ] Type in Agent prompt, click the Agent header to collapse → reopen modal → text kept; markdown file updated
- [ ] Expand toggle, Delete lane, Done, Reset to default, poll stepper unchanged
- [ ] Display modal + closed-eye lists show Orchestrator agent/model right after Orchestrator poll
- [ ] `feature-map.md` §3.9 describes the sections
- [ ] `bun run typecheck`, `bun run test`, `bun run build` pass (no lint script in package.json)

## Out of scope
- Collapsable sections in the ticket modals or the Display modal
- Saving collapse state across restarts
- Renaming fields or changing what any field does

## Open questions
None.
