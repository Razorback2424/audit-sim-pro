# AuditSim Pro MVP Gap Analysis

Updated: 2026-02-08
Source checklist: `docs/mvp/MVP_CHECKLIST.md`

## Summary
- Checklist items complete: 19 / 31
- Trainee flow: 5 / 7 complete
- Virtual Senior loop: 2 / 3 complete
- Admin flow: 5 / 7 complete
- Security: 5 / 5 complete
- Analytics: 1 / 4 complete

## Completed Areas (Evidence)
- Trainee dashboard/open-case flow exists in `src/pages/TraineeDashboardPage.jsx` and routes in `src/App.js`.
- Selection gating blocks progression when support is missing in `src/pages/TraineeCaseViewPage.jsx`.
- Support documents open via signed URL path through `src/services/documentService.js` and callable `functions/src/cases/index.js` (`getSignedDocumentUrl`, 10-minute expiry).
- Classification includes rationale fields (`assertion`, `reason`, workpaper note) in `src/pages/TraineeCaseViewPage.jsx` and result review in `src/components/trainee/ResultsAnalysis.jsx`.
- Server-side scoring and feedback generation are implemented in `functions/src/cases/index.js` (`scoreCaseAttempt`, `computeGradingOutput`, `virtualSeniorFeedback`).
- Admin authoring path covers metadata, dataset import, upload, mapping, and answer-key fields in `src/pages/CaseFormPage.jsx`, `src/components/caseForm/TransactionsStep.jsx`, `src/components/caseForm/DisbursementItem.jsx`, and `src/components/caseForm/AnswerKeyCard.jsx`.
- Mapping health is visible in `src/pages/AdminCaseOverviewPage.jsx` via `getCaseMappingHealth`.
- Route-level RBAC exists in `src/routes/RequireAuth.jsx`, `src/routes/RoleRoute.jsx`, and `src/App.js`.
- Billing gating exists in trainee and server scoring paths (`src/pages/TraineeDashboardPage.jsx`, `functions/src/cases/index.js`).
- Trainee document access analytics is tracked (`attempt_document_opened`) in `src/pages/TraineeCaseViewPage.jsx` with allowlist support in `functions/src/analytics/events.js`.

## Open Gaps

### 1) Attempt lifecycle completeness (includes restart signal)
- Checklist impact:
  - Trainee flow: "Starting a case creates an attempt..."
  - Analytics: "start, submit, results viewed, restart"
- Current state:
  - `attempt_started`, `attempt_submitted`, `attempt_results_viewed` are tracked.
  - Restart-specific analytics is not tracked.
  - Attempts are concretely persisted at submit time; start is currently an event/progress state, not a durable attempt row.
- Evidence:
  - `src/pages/TraineeCaseViewPage.jsx`
  - `src/pages/TraineeSubmissionHistoryPage.jsx`
  - `src/services/submissionService.js`

### 2) Cross-attempt improvement visibility for trainees
- Checklist impact:
  - Trainee flow: "see whether outcomes/notes improve across attempts"
- Current state:
  - History shows attempts and latest outcomes.
  - Explicit improvement/trend view (attempt-over-attempt comparison of outcomes/notes) is missing.
- Evidence:
  - `src/pages/TraineeSubmissionHistoryPage.jsx`

### 3) Feedback immutability risk (forgeability)
- Checklist impact:
  - Virtual Senior loop: "not editable/forgeable by trainees"
- Current state:
  - Server writes `virtualSeniorFeedback` during scoring.
  - Firestore rules still allow trainee-owned submission updates (blocking grade fields only), so feedback fields are not fully immutable.
- Evidence:
  - `functions/src/cases/index.js`
  - `firestore.rules`

### 4) Admin visibility of generated review notes
- Checklist impact:
  - Admin flow: "view trainee attempts and generated review notes"
- Current state:
  - Admin can view attempts and detailed selections.
  - Dedicated rendering of generated `virtualSeniorFeedback` is not present in admin submission pages.
- Evidence:
  - `src/pages/AdminCaseSubmissionsPage.jsx`
  - `src/pages/AdminSubmissionDetailPage.jsx`

### 5) Readiness/progress summary (pass/fail/mastery + top feedback codes)
- Checklist impact:
  - Admin flow readiness view requirement
- Current state:
  - Progress roster exists (percent, step, timestamp).
  - No compact readiness panel with pass/fail/mastery and top feedback-code aggregates.
- Evidence:
  - `src/pages/AdminCaseProgressPage.jsx`
  - `src/pages/AdminBetaDashboardPage.jsx`

### 6) Analytics gaps beyond document open/download
- Checklist impact:
  - Senior Review note-code/severity analytics
  - Admin authoring milestones analytics
- Current state:
  - No note-code/severity event taxonomy yet.
  - No import/upload/mapping/publish analytics events emitted on admin authoring flows.
- Evidence:
  - `src/services/analyticsService.js`
  - `functions/src/analytics/events.js`
  - `src/pages/CaseFormPage.jsx`

## Priority Order (MVP)
1. Protect feedback immutability in submission writes.
2. Add restart lifecycle signal and complete attempt lifecycle instrumentation.
3. Expose generated review notes in admin submission detail.
4. Add basic trainee improvement view across attempts.
5. Add admin readiness rollup (attempt count + mastery/pass/fail + top feedback codes).
6. Add note-code/severity and admin authoring milestone analytics.

## Recommended Next Slice
- Implement restart lifecycle analytics + event allowlist support, and verify with targeted trainee tests.
