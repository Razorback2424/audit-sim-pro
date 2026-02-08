# AuditSim Pro — MVP Progress

## MVP Definition
- Trainee can complete one full “safe-to-fail” practice loop: open case, work support docs, submit, receive coaching, retry.
- Product provides specific coaching notes (not only a score) to emulate senior workpaper review.
- Admin can author and publish case content (dataset + PDFs + mappings + lightweight answer key) without developer intervention.
- Access is role-gated and billing-gated.
- Core trainee/admin actions and outcomes are observable enough to assess readiness.

## MVP Checklist Status
- Source of truth: `docs/mvp/MVP_CHECKLIST.md`
- Completed items since last run:
  - Marked trainee attempt lifecycle analytics (start, submit, results viewed, restart) as complete.
  - Added restart lifecycle analytics event wiring and backend allowlist support.

## Current Slice (this run)
- Slice title: Complete trainee restart lifecycle analytics
- Done when:
  - [x] Restart action emits a dedicated analytics event from trainee flows.
  - [x] Analytics backend allowlist accepts the restart event.
  - [x] Targeted test coverage verifies restart-event emission.

## Work Completed (this run)
- Added `ATTEMPT_RESTARTED` event constant in client analytics service.
- Added `attempt_restarted` to analytics backend allowlist.
- Emitted restart analytics from `TraineeSubmissionHistoryPage` for both “restart with draft” and “fresh retake” paths.
- Emitted restart analytics from `TraineeCaseViewPage` retake reset flow.
- Extended `TraineeSubmissionHistoryPage` tests to verify restart event emission in both restart paths.
- Updated MVP checklist status for trainee lifecycle analytics.

## Evidence
- Commands executed:
  - `npm test -- --watch=false --runInBand src/pages/TraineeSubmissionHistoryPage.test.jsx`
  - `npm test -- --watch=false --runInBand src/pages/TraineeCaseViewPage.test.jsx`
  - `npm run build`
- Results (short):
  - Submission history tests passed (`7 passed`, `0 failed`).
  - Trainee case view tests passed (`13 passed`, `2 skipped`, `0 failed`).
  - Build succeeded with existing repo ESLint warnings unrelated to this slice.

## Files Changed
- Modified:
  - src/services/analyticsService.js
  - functions/src/analytics/events.js
  - src/pages/TraineeSubmissionHistoryPage.jsx
  - src/pages/TraineeCaseViewPage.jsx
  - src/pages/TraineeSubmissionHistoryPage.test.jsx
  - docs/mvp/MVP_CHECKLIST.md
  - progress.md
- Added:
  - (none)
- Deleted:
  - (none)

## Next Slice (next run)
- Add admin visibility of generated review notes in submission detail so coaching output is reviewable by instructors/admins.
- Done when:
  - [ ] Admin submission detail page renders `virtualSeniorFeedback` per attempt when present.
  - [ ] Admin submissions list indicates whether review notes exist for each learner attempt set.
  - [ ] Targeted admin submission page test coverage validates review-note rendering behavior.

## Blockers / Open Questions
- None.
