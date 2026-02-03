# AGENTS.md

This repository is optimized for Codex-style, multi-threaded work (app, CLI, IDE). These rules are non-negotiable. If a request conflicts with any rule below, stop and ask before proceeding.

## 0) Mission of this repo (what we are building)
AuditSim Pro is a training simulator where a trainee selects disbursements and instantly retrieves the correct invoice support (PDFs). The core value is fidelity, speed, correctness, and observability. Anything that does not improve those is likely out of scope.

## 1) Operating principles (always)
1) Smallest change that achieves the goal (YAGNI, KISS).
2) No speculative refactors. No “cleanup” unless it is required for the task and tied to a concrete bug, risk, or measurable benefit.
3) Preserve behavior unless the task explicitly requires a behavior change. If behavior changes, call it out clearly.
4) Single-source-of-truth for business logic. Do not duplicate core rules in multiple places (especially UI).
5) “Every pixel must serve a purpose.” No decorative UI additions. Anything new must reduce confusion, reduce steps, or prevent mistakes.

## 2) Default work loop (how you should operate)
Follow this every time unless explicitly told otherwise.

Step A: Orient
- Identify the exact user goal and “definition of done.”
- Identify which files/modules are the likely source-of-truth for the behavior.

Step B: Plan (required before non-trivial edits)
In the thread, write a short plan:
- Objective (1 sentence)
- Scope (what will change)
- Non-scope (what will NOT change)
- Approach (3–7 bullets)
- Verification (exact commands / steps)

Step C: Implement
- Make the smallest changes possible.
- Prefer incremental diffs over large rewrites.
- Keep changes localized; do not ripple across modules unless necessary.

Step D: Verify
- Run the required checks for the change type (see section 9).
- If you cannot run them, explain why and provide an alternative verification method.

Step E: Review package (always)
When done, provide:
- Objective
- What changed (bullets)
- What did NOT change (explicit)
- Files touched (with one-line reason each)
- How verified (commands + results)
- Risks / edge cases
- Follow-ups (only if necessary)

## 3) Hard scope boundaries (do not cross)
Do not do any of the following unless explicitly requested:

Architecture / structure:
- No broad folder reorganizations.
- No mass renames.
- No “modernization passes.”
- No changing state management approach.

Product behavior:
- No changes to pricing, paywalls, gating, plans, or entitlement rules.
- No changes to roles/permissions definitions (RBAC) or enforcement model.
- No changes to analytics event taxonomy/names/shapes.

Data:
- No schema changes (Firestore collections/fields) or migrations.
- No rewriting historical data semantics (attempts/submissions snapshots).
- No “backfills” unless explicitly requested.

## 4) When you MUST ask before proceeding (stop points)
Ask first if any of the following becomes necessary:

Dependencies/tooling:
- Adding a new dependency or upgrading a major version
- Changing bundler/build tooling, linting, formatting, or test frameworks

Security/access:
- Authentication flow changes
- Roles/RBAC changes
- Firestore rules or Storage rules changes
- Any change that widens access to data or documents

Billing:
- Touching Stripe checkout, webhook handlers, customer portal, subscription logic, or payment gating

Data operations:
- Data migrations, backfills, destructive deletes, or changes that affect historical submissions

Ops:
- Deployments, environment config, secrets, CI changes, cron/schedulers/background jobs

Performance-sensitive changes:
- Anything that increases per-row reads/calls in large tables
- Any new logging/analytics on hot paths

If you’re unsure whether something qualifies, ask.

## 5) High-risk zones (extra caution)
These areas must be treated as fragile and security-critical. Make minimal edits and add explicit verification notes.

- Auth, RBAC, entitlement/gating (paid vs demo, accessLevel logic)
- Firestore rules, Storage rules
- Stripe + billing state transitions + webhook handling
- Document delivery: secure PDF access, signed URLs, viewer permissions
- Case attempt lifecycle: start/resume/submit/complete
- Dataset import and mapping (disbursement → document links), especially one-to-many mappings
- Any “admin authoring” workflows that can break content at scale

## 6) Coding standards (pragmatic)
- Prefer plain, readable code over clever abstractions.
- Avoid introducing new patterns unless the repo already uses them.
- Keep functions small and explicit in inputs/outputs.
- Do not create generalized frameworks for one-off use cases.
- Add comments only when they explain non-obvious intent or invariants.

## 7) UI rules (strict)
Trainee UX:
- Remove ambiguity. A trainee should always know: what to do next, what is required, and what state they are in.
- Do not add UI noise. No decorative badges/cards unless they encode real state or prevent mistakes.
- Microcopy must be plain-English and action-oriented.

Admin UX:
- Optimize for throughput and error prevention (mapping health, validation, bulk ops).
- Show actionable errors (e.g., unmapped items) rather than silent failure.

General:
- If you add a status label, it must map to a real backend state or a clearly defined computed invariant.
- Do not change visual style/theme unless requested.

## 8) Behavior-change policy
If your change alters behavior in any way, you must:
- Explicitly state the behavior change in the review package
- Explain why it is necessary for the task
- Identify who it affects (trainee/admin)
- Call out any migration or backward-compat risk (even if you are not doing a migration)

## 9) Verification requirements (required before marking done)
Do not guess commands. Locate the repo’s actual scripts (package.json, functions package.json, README) and run those.

Typical verification expectations (adapt to this repo’s real scripts):

Frontend-only changes:
- Lint (repo command)
- Unit tests (repo command, if present)
- Build (repo command)

Backend/Cloud Functions changes:
- Lint/typecheck functions (repo command)
- Emulator run or minimal local flow test (if present)
- For webhooks: verify signature verification path and event handling (at least one happy path + one failure path)

Rules/security changes:
- Validate rules compile
- Verify at least:
  - 1 positive allow case (expected access works)
  - 1 negative deny case (unauthorized access blocked)

If you cannot run verification:
- Say exactly what you could not run and why
- Provide alternative evidence (static reasoning + targeted code pointers)

## 10) Performance guardrails
- Large disbursement listings must stay responsive.
- Avoid per-row network reads; prefer batched reads or pre-aggregated views when the repo already supports them.
- Do not introduce expensive analytics logging in render loops.
- Any new indexing requirement must be documented.

## 11) Git hygiene (for multi-agent parallelism)
Branches:
- `agent/<short-task-name>`
- `feat/<short-task-name>`
- `fix/<short-task-name>`

Commits:
- Small, reviewable commits.
- Use prefixes: `feat:`, `fix:`, `chore:`, `refactor:` (refactor only when behavior does not change).

Worktrees:
- One agent thread = one branch/worktree = one objective.
- Do not mix unrelated objectives in one branch.

## 12) Output format (the required “review package” template)
When delivering work, use exactly this template:

Objective:
- <1 sentence>

What changed:
- <bullets>

What did NOT change:
- <bullets>

Files touched (reason):
- <path> — <reason>
- ...

How verified:
- <command> — <result>
- <manual check> — <result>

Risks / edge cases:
- <bullets>

Follow-ups (only if necessary):
- <bullets>

## 13) Security and secrets
- Never commit secrets or credentials.
- Never print secrets in logs/output.
- Do not modify `.env*` or secret manager config unless explicitly requested.
- Do not widen access “to make it work.”
- Documents must remain non-public. Use secure viewer access or time-limited signed URLs where applicable.

## 14) If you are unsure
Stop and ask. Provide:
- The specific decision you are stuck on
- The options you see
- Your smallest recommendation and why
- The risk of proceeding without confirmation

## 15) Preferred posture
Be blunt and execution-focused. Optimize for correctness, minimalism, and reviewability.

End of file.
