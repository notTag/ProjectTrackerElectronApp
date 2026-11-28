# PRD — Ticket #78: Move DB to cloud — provider cost analysis

Branch: `t78-move-db-to`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t78`

## Context

Research ticket. No app code changes. The deliverable is a PDF comparing cloud DB options on AWS, Azure, GCP and Cloudflare, priced for 1 → 1M users, with per-user budget benchmarks as tickets, workflows and swimlanes scale up.

The Idea lane already produced it. This PRD checks it against the ticket and scopes what In Development still has to do: land the research in the repo and settle the duplicate draft. The actual migration is a separate, later ticket.

## State today (verified 2026-11-28 on `5d99574`)

- Canonical deliverable (linked on the ticket), in `~/Library/Application Support/Project Tracker/attachments/413fa06f-61a5-468d-83ad-2d58b0bef9b9/`:
  - `t78-cloud-db-cost-analysis.pdf`: 7 pages
  - `t78-cost-model.py`: stdlib Python model you can re-run
  - `t78-cost-model-template.html`: the model renders it to `report.html`, which headless Chrome prints to the PDF
- Worktree `docs/research/` holds only `t78-cloud-db-pricing.pdf` (untracked, 3 pages). It is a second, earlier draft from a different model: 4 providers × 1 option each, "typical user" 1k tickets / 3 workflows / 12 lanes. The ticket doesn't link it.
- Nothing from #78 is committed yet.

## Spec check — canonical PDF vs ticket

| Ticket asks | PDF has | OK |
|---|---|---|
| AWS, Azure, GCP, Cloudflare | AWS DynamoDB / RDS Postgres / S3 file · Azure Cosmos serverless / Postgres Flexible · GCP Firestore / Cloud SQL · Cloudflare D1+Workers / R2 file | ✓ |
| Costs in a table for 1, 10, 100, 1k, 10k … 1M users | 1, 10, 100, 1k, 10k, 100k, 1M. Total + per-user cost per cell. Light / Medium / Heavy profiles | ✓ |
| Per-user benchmarks: tickets scaling up | 100 → 100k tickets/user, with MB/user | ✓ |
| Workflows scaling up | 1 → 500 workflows/user | ✓ |
| Swimlanes scaling up | 5 → 1,000 lanes/user | ✓ |
| Recommendation | Recommendation section, unit-price table, accuracy note | ✓ |

The benchmark tables are priced at 1k users only (the per-user cost flattens by then, so other counts add little). Fine as is.

## Findings (from the PDF)

- ≤100 users: serverless free tiers (DynamoDB / Cosmos / Firestore) cost $0–3/mo. Cloudflare has a $5 floor. Postgres instances cost $10–14.
- ≥1k users: Cloudflare D1 + Workers is the cheapest real DB. Medium profile @1M users ≈ $12.7k/mo, against $21k–34k on the hyperscalers, thanks to free egress and cheap row reads.
- Hyperscalers: Cosmos serverless / Firestore are cheapest up to ~10k users, managed Postgres beyond that.
- R2/S3 holding the SQLite file is cheapest, but it is single-writer sync only. Not a shared DB.
- Biggest cost lever = polling (today a 10 s `data_version` poll). The cloud needs push.
- Workflows and swimlanes barely move cost. Ticket count drives it.

## In Development scope

1. Copy the canonical files from the attachment dir into `docs/research/`:
   - `t78-cloud-db-cost-analysis.pdf`
   - `t78-cost-model.py`
   - `t78-cost-model-template.html`
2. Re-run the model from the worktree to prove it reproduces:
   - `python3 -I docs/research/t78-cost-model.py` → `report.html`
   - print to PDF with headless Chrome, check the totals match the attached PDF
   - delete the generated `report.html` / scratch PDF afterwards; don't commit them
3. Settle the duplicate draft `docs/research/t78-cloud-db-pricing.pdf`:
   - The canonical PDF lacks a few points the draft has. Add them as lines in the canonical template's Recommendation, then regenerate the PDF:
     - the $5 Workers Paid quota covers about 750 typical users, and the 10M-request allowance runs out first
     - D1 allows 50k databases per account by default (raisable) and 1 TB per account
     - a cheapest first step: a nightly per-user SQLite snapshot to R2 (backup + new-device restore), about $0 up to 1k users
   - Then delete `t78-cloud-db-pricing.pdf`. Two PDFs with different numbers confuse readers.
   - If the regenerated PDF changes, copy it back over the ticket attachment so the ticket link stays current.
4. Commit only `docs/research/*` and this PRD, staged by path. Open a PR against `main` that changes docs only.
   - Every number in the PR body should match the PDF.

No app code, no schema, no dependencies.

## Out of scope → follow-up ticket "Cloud sync: pick backend + storage seam"

This PRD records the recommended defaults below. None of them block #78.

- **Target backend: Cloudflare Durable Objects with SQLite, one per team/board.** It's SQLite (the schema carries over), has no 50k database-count cap (D1 has one), and its websockets give push for free. D1 per-tenant is the fallback. Postgres only if the product goes hyperscaler-only.
- **Auth/accounts.** Desktop clients can't hold shared DB credentials, so a Worker API layer with per-user tokens is needed. The provider is still open.
- **Conflict model.** Per-field last-writer-wins today (`docs/storage-seam.md`). Multi-user needs at least an `updated_at` check on write.
- **Storage seam.** `StateRepository` goes async. The `data_version` poll gets replaced by a push event that emits the same `project-state:external-change`. `user_paths` stays per machine.

## Acceptance

- `docs/research/` holds exactly one PDF and it matches the ticket link. The model and template sit next to it, and re-running the model reproduces the totals.
- The PR changes only docs. `git diff --stat main` shows no files under `src/` or `electron/`.
- The ticket links the PDF and the PR.

## Open questions

- None.
