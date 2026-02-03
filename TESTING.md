# TESTING.md

This file defines how changes are verified in this repo. It exists to prevent “looks good” merges that break core flows, and to make agent work deterministic and reviewable.

Rules:
- Do not mark work “done” without running the applicable checks below.
- Do not guess commands. If a command isn’t present, locate the correct one in package.json / functions package.json / README and update this file.
- For any change that touches access control, document delivery, or attempts/submissions, you must run at least one positive and one negative scenario test.

---

## 1) Quick start: what to run before you claim “done”
Pick the lowest section that matches what you changed and run everything listed there.

A) UI-only changes (no logic changes)
1) Lint
2) Unit tests (if present)
3) Build

B) Frontend logic changes (state/derivations, dashboard logic, selection behavior)
1) Lint
2) Unit tests (if present)
3) Build
4) Manual scenario test: trainee end-to-end happy path (see section 4)

C) Backend/Cloud Functions changes
1) Lint/typecheck functions
2) Emulator or local function test (if available)
3) Manual scenario test for the specific function path
4) If webhooks/auth touched: negative tests (invalid signature / unauthorized user)

D) Firestore/Storage rules or access control changes
1) Rules compile/validate
2) At least 1 allow + 1 deny test for each affected permission surface
3) Manual doc-access negative test (unauthorized must fail)

---

## 2) Standard commands (filled in for THIS repo)
These are the confirmed commands in this repository. If any of these change, update this file.

Frontend (from repo root):
- Install: `npm install`
- Lint: Not configured (no `lint` script in `package.json`).
- Tests: `npm test`
- Build: `npm run build`
- Dev: `npm start`

Functions (separate package):
- Install: `cd functions && npm install`
- Lint: Not configured (no scripts in `functions/package.json`).
- Typecheck: Not configured (no scripts in `functions/package.json`).
- Tests: Not configured (no scripts in `functions/package.json`).

Emulators:
- Firestore/Storage/Auth emulator: `firebase emulators:start --only firestore,storage,auth`
- Emulator + seed script (if any): Not documented.

If this repo adopts Yarn/pnpm or a monorepo tool, update this section accordingly.

---

## 3) Required “manual scenario tests” (core flows)
These are the minimum manual tests required when touching core simulator behavior. Each scenario should take <5 minutes once environments are set up.

### 3.1 Trainee: end-to-end happy path (core product loop)
Use a test trainee with access to a published case that has:
- A dataset with at least 20 disbursement rows
- At least 5 rows mapped to 1 PDF each
- At least 1 row mapped to 2+ PDFs (one-to-many)

Steps:
1) Log in as trainee.
2) Open dashboard → confirm assigned case appears with correct status.
3) Open the case → confirm instructions render.
4) Open disbursement listing → confirm table loads, search/sort still works if present.
5) Select required number of rows (or a small sample if no rule).
6) Submit selections.
7) Verify delivered documents:
   - Each selected row returns the correct PDF(s).
   - One-to-many row returns multiple PDFs, clearly linked to that disbursement.
8) Open at least 2 PDFs in-app (or download via signed link).
9) Refresh the page:
   - Attempt state should persist correctly (submitted/completed/in-progress as expected).

Expected result:
- No errors.
- Document access works only within authorized session.
- Attempt state is consistent and resumable.

### 3.2 Trainee: unmapped selection handling
Use a case where at least 1 disbursement is intentionally unmapped.

Steps:
1) Select at least 1 mapped row + 1 unmapped row.
2) Submit selections.
3) Observe behavior:
   - If strict mode: submission should be blocked with a clear message.
   - If realism mode: submission allowed but explicitly flags missing support.

Expected result:
- No silent failure.
- Admin-visible log/flag exists (see section 5).

### 3.3 Admin: dataset import validation
Steps:
1) Log in as admin.
2) Import a dataset file (CSV/Excel).
3) Confirm:
   - Column mapping is correct (date/amount/ID).
   - Validation catches obvious errors (missing IDs, non-numeric amounts).
4) Publish or save as draft.

Expected result:
- Dataset is stored as a versioned artifact and usable by a case.

### 3.4 Admin: document upload + mapping
Steps:
1) Upload a set of PDFs (at least 5).
2) Map:
   - 3 disbursements → 1 PDF each
   - 1 disbursement → 2 PDFs
3) Open “mapping health” view (if present) and confirm:
   - Unmapped items are visible
   - Missing-file mappings are visible if applicable

Expected result:
- Mapping is durable and trainee retrieval uses it correctly.

---

## 4) Security tests (required when rules/auth/doc delivery touched)
These must be run whenever you touch RBAC, rules, or document delivery.

### 4.1 Unauthorized trainee cannot access unassigned case
Steps:
1) Log in as trainee A (not assigned to case X).
2) Try to open case X by URL or ID (if possible).

Expected result:
- Access denied (UI message + backend denial).

### 4.2 Unauthorized user cannot access a PDF
Steps:
1) Obtain a PDF URL or viewer reference from an authorized session.
2) Log out or switch to unauthorized account.
3) Attempt to open the same PDF.

Expected result:
- Access denied (403 / permission error / viewer blocks).
- No public bucket or permanent URL exposure.

### 4.3 Rules compile/validate
Steps:
- Run the repo’s rules validation/compile command (document the exact command here).

Expected result:
- Rules compile successfully.
- Deny rules behave as expected for unauthorized access.

---

## 5) Observability expectations (what must be logged)
When core flows change, confirm logs/analytics still capture:

Attempt lifecycle:
- attempt_started
- attempt_resumed
- attempt_submitted
- attempt_completed (if distinct)

Document access:
- document_opened (viewer) and/or document_downloaded
- timestamps and attempt/case identifiers

Mapping failures:
- unmapped_selection_detected (or equivalent)
- missing_document_detected
- includes: caseId, datasetVersion, disbursementRowKey, userId (or anonymized ID), timestamp

If event naming differs in this repo, list the actual names here.

---

## 6) Regression checklist (use when touching high-risk zones)
If you touch any high-risk zone from AGENTS.md, also verify:

RBAC:
- Trainee only sees own attempts
- Admin can see cohort analytics
- No cross-tenant leakage (if multi-tenant)

Versioning:
- Old submissions still render the same delivered-doc snapshot (no drift)

Performance:
- Large disbursement table loads without lag
- No per-row network calls introduced

---

## 7) “Done means done” checklist
Before you mark work complete, you must provide:
- The exact commands you ran and whether they passed
- Which manual scenarios you executed (by section number)
- Any scenarios you did NOT run and why
- Any risk remaining (and what would catch it)

End of file.
