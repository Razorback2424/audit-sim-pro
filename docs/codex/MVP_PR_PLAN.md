# MVP PR Plan

This plan sequences small, reviewable PRs to reach MVP alignment while respecting AGENTS.md constraints.

## PR 1: Secure Document Delivery (Stop Persisting Public URLs)
Objective:
- Ensure invoice/reference access uses authenticated, time-limited access instead of stored `downloadURL` values.

Files to touch:
- `src/hooks/useCaseFormUploads.js` to stop persisting `downloadURL` in case data and mappings.
- `src/pages/TraineeCaseViewPage.jsx` to request access at view time instead of using stored `downloadURL`.
- `src/pages/AdminCaseOverviewPage.jsx` to use the same access path for admin previews.
- `functions/index.js` to add a callable for generating short-lived signed URLs, if needed.

What will NOT change:
- No schema migrations or backfills.
- No changes to RBAC/roles or Storage rules unless explicitly approved.
- No UI redesigns.

Verification plan:
- `npm test`.
- `npm run build`.
- Manual scenario 3.1 (Trainee happy path) and 4.2 (Unauthorized PDF access) from `TESTING.md`.

Risks and edge cases:
- Signed URL TTL needs to be long enough for viewing but short enough for security.
- Existing cases may still have persisted `downloadURL` values; behavior must be predictable without data migration.

## PR 2: Mapping Health Visibility (Per-Case Summary)
Objective:
- Make mapping completeness visible per case, not only in dashboard alerts.

Files to touch:
- `src/pages/AdminCaseOverviewPage.jsx` to add a mapping health summary.
- `src/services/caseService.js` if additional mapping health helpers are needed.

What will NOT change:
- No changes to mapping storage model.
- No changes to rules, auth, or analytics.

Verification plan:
- `npm test`.
- `npm run build`.
- Manual scenario 3.4 (Admin document upload + mapping) from `TESTING.md`.

Risks and edge cases:
- Avoid per-row network calls; reuse already-loaded case data.

## PR 3: CSV Import Validation (Admin Authoring)
Objective:
- Improve CSV import validation to catch missing IDs, non-numeric amounts, and invalid dates.

Files to touch:
- `src/hooks/useCaseFormCsvImport.js` for parsing and validation.
- `src/components/caseForm/TransactionsStep.jsx` for any messaging changes.

What will NOT change:
- No new dependencies.
- No Excel import unless explicitly requested.

Verification plan:
- `npm test`.
- `npm run build`.
- Manual scenario 3.3 (Admin dataset import validation) from `TESTING.md`.

Risks and edge cases:
- Ensure validation errors are actionable and do not block manual entry.

## PR 4: Observability Events (Approval Required)
Objective:
- Add attempt lifecycle and document access events.

Blocked by:
- AGENTS.md prohibits changing analytics taxonomy or schema without explicit request. `AGENTS.MD:58-66`

Files to touch once approved:
- `functions/index.js` to accept additional event types or write to a dedicated collection.
- `src/pages/TraineeCaseViewPage.jsx` to emit attempt/document access events.

Verification plan:
- `npm test`.
- `npm run build`.
- Manual scenarios 3.1 and 4.1/4.2 from `TESTING.md`.

Risks and edge cases:
- Event volume and cost on hot paths.

## PR 5: Submission Snapshot Versioning (Approval Required)
Objective:
- Add version identifiers to case/submission data to prevent historical drift.

Blocked by:
- AGENTS.md prohibits schema changes without explicit request. `AGENTS.MD:63-66`

Files to touch once approved:
- `src/models/case.js` and `src/services/caseService.js` to add caseVersion or datasetVersion.
- `src/services/submissionService.js` and `src/pages/TraineeCaseViewPage.jsx` to persist version fields.

Verification plan:
- `npm test`.
- `npm run build`.
- Manual scenario 3.1 from `TESTING.md`.

Risks and edge cases:
- Backward compatibility with existing submission documents.
