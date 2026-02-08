---
name: auditsim-mvp-loop
description: |
  Advance AuditSim Pro toward the MVP by completing ONE small vertical slice per run and recording durable state in progress.md.
  Use when the user says “keep going”, “continue”, “advance MVP”, “ship next slice”, or asks to move the project forward against the vision.
  Do NOT use for unrelated refactors, broad rewrites, styling-only changes, or speculative architecture work without a slice-sized deliverable.
---

# AuditSim MVP Loop

Goal
- Make steady, testable progress toward MVP by delivering one small, end-to-end slice per run.
- Use repo state (progress.md + MVP checklist) as the “memory” so the user can simply say “keep going”.

Inputs (read in this order)
1) progress.md (required)
2) docs/mvp/MVP_CHECKLIST.md (required; create if missing)
3) Only the minimal code/docs needed for the current slice (do not roam)

Outputs (produce every run)
- Working code for exactly one slice
- Updated progress.md (must follow the exact schema below)
- Evidence: commands run + results (build/test/smoke)
- Clear “Next Slice” written so the user can just say “keep going”

Hard rules
- One slice per run. Stop after completing it and updating progress.md.
- Keep the slice small: ≤ 3 “done when” bullets.
- Prefer instructions over new scripts unless a script is required to make verification deterministic.
- Do not reread large vision docs each run; rely on MVP_CHECKLIST.md unless a gap requires consulting the vision.

Required files and schemas

A) docs/mvp/MVP_CHECKLIST.md
If missing, create it with:
- A short MVP definition (bullets)
- A checkbox list grouped into:
  - Trainee flow (case list → open → disbursement table → select → submit → doc access)
  - Admin flow (case mgmt → dataset import → PDF mgmt → mapping)
  - Security (RBAC / access gating)
  - Minimal analytics (events for key trainee/admin actions)

B) progress.md
If missing, create it with this exact structure (headings must match):

# AuditSim Pro — MVP Progress

## MVP Definition
- (1–5 bullets) What “MVP is done” means.

## MVP Checklist Status
- Link/summary to docs/mvp/MVP_CHECKLIST.md
- Completed items since last run (bullets)

## Current Slice (this run)
- Slice title:
- Done when:
  - [ ] bullet 1
  - [ ] bullet 2
  - [ ] bullet 3 (optional)

## Work Completed (this run)
- Bullet list of what changed and why (tie to “done when”)

## Evidence
- Commands executed:
  - `...`
- Results (short):
  - ...

## Files Changed
- Modified:
  - path
- Added:
  - path
- Deleted:
  - path

## Next Slice (next run)
- Single sentence imperative.
- Done when:
  - [ ] bullet 1
  - [ ] bullet 2
  - [ ] bullet 3 (optional)

## Blockers / Open Questions
- Keep short. If a question is blocking, phrase it so the user can answer in one line.

Workflow (do these steps in order)

Step 0 — Sanity check
- Confirm you are in the correct repo.
- Locate progress.md and docs/mvp/MVP_CHECKLIST.md.
- If either is missing, create it per schemas above, then proceed.

Step 1 — Determine the slice to execute
- If progress.md has “Next Slice (next run)”, that is the slice. Use it as-is.
- Otherwise, derive a slice by comparing MVP_CHECKLIST.md vs completed items and pick the smallest vertical slice that increases end-to-end usability.

Step 2 — Define “done when” precisely
- Convert the slice into 2–3 checkboxes that are objectively verifiable.
- If verification requires a quick smoke path, state it now (e.g., “open case → select 1 item → submit → document viewer shows 1 PDF”).

Step 3 — Implement with minimal surface area
- Identify the smallest set of files to touch.
- Implement only what is required to satisfy “done when”.
- Avoid broad refactors and unrelated cleanup.

Step 4 — Verify
- Run the fastest relevant checks (in priority order):
  1) build (or typecheck/lint if that’s the fastest equivalent)
  2) minimal smoke path for the slice
- Capture commands + results for progress.md Evidence.

Step 5 — Update docs/state
- Update docs/mvp/MVP_CHECKLIST.md checkboxes if this slice completes an item.
- Update progress.md:
  - Mark “done when” as completed
  - Record work completed, evidence, and files changed
  - Write exactly one “Next Slice” (small, testable, imperative)

Step 6 — Stop
- Do not begin the next slice in the same run.
- End with a short summary: what was delivered + what “Next Slice” is.