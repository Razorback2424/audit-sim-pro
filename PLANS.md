# PLANS.md

This file is the persistent “long-running work contract” for this repo. It exists to keep multi-agent work coherent, reviewable, and low-risk. Any non-trivial effort should start by updating the relevant plan section here.

Rules:
- Keep scope tight and explicit.
- Prefer small, reviewable steps that each produce a working state.
- Every step must have a verification method.
- Record decisions that constrain future work (and link to DECISIONS.md if/when it exists).

---

## How to use this file (required)
When starting a new workstream:
1) Create a new plan section using the template below.
2) Keep it updated as steps complete or scope changes.
3) If you discover new risks or dependencies, add them immediately.
4) Do not implement large changes without a plan that has:
   - explicit scope + non-scope
   - a step list
   - verification per step

---

## Plan template (copy/paste)

### Plan: <short name>
Owner: <human owner if known>
Created: <YYYY-MM-DD>
Status: Draft | Active | Blocked | Complete

Goal (1 sentence):
- <what outcome are we trying to achieve>

Why (business value):
- <why this matters to trainees/admins, fidelity, speed, correctness, observability>

Scope (in):
- <bullet list of what will change>

Non-scope (out):
- <bullet list of what will not change; be explicit>

Success criteria (acceptance):
- <bullet list of observable pass/fail outcomes>

Risks / gotchas:
- <bullet list; include security, data integrity, performance, UX regression risks>

Dependencies / approvals needed:
- <bullets; include “requires approval” items from AGENTS.md>

Implementation steps (each step produces a reviewable diff):
1) <step>
   - Output: <what artifact changes; files/modules>
   - Verification: <exact command(s) or manual scenario>
2) <step>
   - Output:
   - Verification:
...

Rollback plan:
- <how to revert safely; what to watch out for>

Notes:
- <anything else that prevents thrash>

---

## Active plans

### Plan: Robust Analytics Pipeline
Owner: Sean
Created: 2026-02-05
Status: Active

Goal (1 sentence):
- Implement a minimal analytics pipeline that answers core conversion, value, and reliability questions via Firestore queries.

Why (business value):
- Enables pricing and funnel decisions without guesswork.
- Surfaces reliability failures that break trust and block revenue.
- Keeps analytics scoped to actionable, queryable signals.

Scope (in):
- Dedicated analytics collection at `artifacts/{appId}/analytics/events`.
- Callable-only logging with server-stamped envelope and allowlist.
- Event emission for attempt lifecycle, results view, checkout CTAs, checkout failures, entitlement activation, evidence access failures, webhook failures.
- Documentation of taxonomy and envelope in `docs/analytics/analytics-events.md`.
- Add analytics smoke verification to `TESTING.md`.

Non-scope (out):
- No RBAC or rules changes.
- No billing flow changes.
- No UI redesigns or new analytics dashboards.
- No data migrations or backfills.

Success criteria (acceptance):
- Events are written only via callable or server helper.
- The 10 “must answer” analytics questions can be answered with Firestore queries.
- Event envelopes contain server timestamps and do not accept client-supplied UID/appId/ts/source.

Risks / gotchas:
- Event volume on hot paths; keep emissions minimal.
- Double-counting if events are emitted in multiple places.

Dependencies / approvals needed:
- Approved: dedicated analytics collection.
- Approved: event taxonomy in `docs/analytics/analytics-events.md`.
- Approved: callable-only logging.

Implementation steps (each step produces a reviewable diff):
1) Add analytics taxonomy doc
   - Output: `docs/analytics/analytics-events.md`
   - Verification: peer review
2) Update PLANS + TESTING documentation
   - Output: `PLANS.md`, `TESTING.md`
   - Verification: peer review
3) Implement callable + shared helper + emissions
   - Output: `functions/src/analytics/events.js`, `functions/src/cases/index.js`, `functions/src/billing/*`,
             client event emission updates in `src/`
   - Verification: `npm test`, `npm run build`, manual scenarios 3.1 + 4.2 + analytics smoke

Rollback plan:
- Revert to previous analytics callable and disable new event emissions.

Notes:
- Event payloads must remain small; enforce props size caps server-side.

### Plan: AuditSim Pro MVP simulator core
Owner: Sean
Created: 2026-02-02
Status: Draft

Goal (1 sentence):
- Deliver a realistic “select disbursements → instantly retrieve correct invoice PDFs” training simulator with minimal admin authoring friction and strong access control.

Why (business value):
- Trainees learn the workflow by doing it, with immediate evidence retrieval.
- Admins eliminate brittle spreadsheet-based mapping and manual PDF delivery.
- The platform becomes measurable (attempts, time on task, document access).

Scope (in):
- Trainee: view assigned case(s), open disbursement listing, select items, submit, view/download mapped PDFs.
- Admin: create/publish cases, import disbursement dataset, upload PDFs, map disbursements to PDFs (including one-to-many), assign to cohorts/users.
- Access control: trainees only see permitted cases and their own attempts; PDFs are non-public.
- Basic analytics: started/in-progress/submitted/completed + time on task at case level.

Non-scope (out):
- Advanced grading/rubrics (unless explicitly requested)
- LMS integrations (SSO/LTI) unless explicitly requested
- Gamification, badges, leaderboards
- Broad UI redesign unrelated to core workflows

Success criteria (acceptance):
- A trainee can complete a case end-to-end without admin intervention after setup.
- Every selected disbursement returns the correct PDF(s) based on mapping.
- Unmapped selections are handled explicitly (block or warn per case policy) and logged for admin.
- Admin can reach 100% mapping completeness with clear “mapping health” visibility.
- No public PDF access; signed/viewer-only access is enforced.

Risks / gotchas:
- Mapping bottleneck: admin workflows must support bulk/fast mapping.
- Versioning/history: submissions should snapshot delivered docs to avoid historical drift.
- Performance: large tables must remain responsive; avoid per-row network calls.
- Security: rules/gating mistakes can leak docs or cases.

Dependencies / approvals needed:
- Any change to RBAC, Firestore/Storage rules, billing/gating requires explicit approval.
- Any new dependency requires explicit approval.

Implementation steps (each step produces a reviewable diff):
1) Define canonical data contracts and invariants
   - Output: document or code comments establishing case/dataset/disbursement/document/mapping/attempt invariants
   - Verification: peer review; ensure all consumers reference same contract

2) Stabilize trainee case attempt lifecycle (start/resume/submit)
   - Output: single source-of-truth attempt state transitions; UI uses the same derived state
   - Verification: manual scenario: start → leave → resume → submit → see completion state

3) Implement secure document delivery
   - Output: in-app viewer or signed URL flow with expiry; storage paths and rules enforced
   - Verification: negative test: unauthorized user cannot access PDF; positive test: authorized can

4) Build admin dataset import with validation
   - Output: import wizard, column mapping, preview, dataset versioning
   - Verification: import a known dataset; verify row count, parsed types, required IDs

5) Build admin document library upload + indexing
   - Output: bulk upload, metadata capture, duplicate detection if feasible
   - Verification: upload sample set; verify retrieval and non-public access

6) Build mapping UI + mapping health
   - Output: map disbursement row → document(s); unmapped/missing/orphan views
   - Verification: map 10 rows including one-to-many; confirm trainee receives correct PDFs

7) Assignment workflow (cohorts/users → cases)
   - Output: assign/unassign; trainee dashboard reflects assignments
   - Verification: assign case to cohort; trainee sees it immediately; unassign removes access

8) Basic analytics events and admin reporting view
   - Output: case progress and time-on-task view for admin
   - Verification: run 2 trainees through 1 case; admin view shows both with correct states

Rollback plan:
- Keep changes behind feature flags where possible.
- Use versioned case/dataset documents; do not overwrite historical submission snapshots.
- Revert by disabling new flows and restoring previous routes/components if needed.

Notes:
- If “email delivery of PDFs” is required, add as a separate plan section; it increases operational complexity.
- If “paid vs demo gating” is in play, treat it as a separate plan section and verify it with denial tests.
- Progress log:
- 2026-02-02 — PR #1 Secure Document Delivery: Complete. Replaced persisted `downloadURL` usage with storage paths + signed URL flow and added backend authorization. Verification: `npm test` (failed: multiple existing test failures incl. `useUser` mock missing), `npm run build` (failed: eslint `globalThis` in `src/services/firebase.js`). Manual scenarios not run (requires running app with auth + storage).
- 2026-02-02 — PR #2 Mapping Health Visibility: Complete. Added per-case mapping health summary on admin case overview. Verification: `npm test` (timed out; react-scripts test), `CI=true npm test` (timed out), `npm run build` (succeeded with existing eslint warnings). Manual scenario 3.4 not run.
- 2026-02-02 — PR #3 CSV Import Validation: Complete. Added CSV row validation for missing PaymentID, invalid Amount, and invalid PaymentDate. Verification: `npm test` (timed out; react-scripts test), `npm run build` (succeeded with existing eslint warnings). Manual scenario 3.3 not run.
- 2026-02-02 — PR #4 Attempt Lifecycle State Derivation: Complete. Centralized progress state/complete checks and reused in trainee view and progress service. Verification: `npm test` (timed out; react-scripts test), `npm run build` (succeeded with existing eslint warnings). Manual scenario 3.1 not run.

---

## Backlog plans (not active yet)
- Plan: Automated scoring / rubric feedback
- Plan: Advanced scenario authoring (distractors, incomplete evidence)
- Plan: Integrations (SSO/LMS)
- Plan: Automations (daily health checks, mapping completeness reports)
