# AuditSim Pro MVP Gap Analysis

Updated: 2026-02-08
Source checklist: `docs/mvp/MVP_CHECKLIST.md`

## Scope Of This Update
- This run re-baselines **Commercial/Ops MVP** status against implemented code paths.
- Product MVP sections are not re-audited in depth here.

## Commercial/Ops Status (Code-Verified)

### Marked Complete
1. Billing and entitlements end-to-end
- Evidence:
  - Checkout session creation and plan wiring: `functions/src/billing/checkout.js`
  - Success confirmation + entitlement write: `functions/src/billing/checkout.js`
  - Renewal/cancel/failed payment handling via Stripe webhooks: `functions/src/billing/webhooks.js`
  - Status normalization (`active`, `past_due`, `unpaid`, `canceled`): `functions/src/billing/entitlements.js`
  - Client recovery path (`Restore access` + reconcile): `src/pages/CheckoutSuccessPage.jsx`

2. Reliability/observability baseline
- Evidence:
  - Central analytics ingestion + allowlist: `functions/src/analytics/events.js`
  - Attempt/feedback/doc-access events emitted server-side: `functions/src/cases/index.js`
  - Billing failure instrumentation (`checkout_confirm_failed`, `webhook_failed`): `functions/src/billing/checkout.js`, `functions/src/billing/webhooks.js`

3. Production reliability basics with operator visibility
- Evidence:
  - Admin beta dashboard with funnel counts + recent events + problem reports: `src/pages/AdminBetaDashboardPage.jsx`
  - Backend aggregator for events/reports: `functions/src/analytics/events.js` (`getBetaDashboard`)
  - In-app issue reporting to private store: `src/components/ReportProblemModal.jsx`, `functions/src/analytics/events.js` (`submitProblemReport`)

### Still Open (Not Fully Implemented)
1. Onboarding and success path
- Gap: no dedicated guided first-session flow that explicitly teaches how to interpret feedback and what to do next.
- Current partials: autostart + next-case start behavior in `src/pages/TraineeDashboardPage.jsx`.

2. Enough content to justify payment
- Gap: code confirms platform capability, but this cannot be proven from repo alone as a deployed content guarantee.

3. Support and trust basics
- Gap: issue reporting exists, but explicit in-app data-collection messaging/help center coverage is incomplete.

4. Legal/admin basics
- Gap: privacy policy + terms pages/routes are missing.
- Partials: admin assignment/progress surfaces exist (`src/components/caseForm/AudienceScheduleStep.jsx`, `src/pages/AdminCaseProgressPage.jsx`).

5. Firm/organization layer and seat assignment
- Gap: assignment/progress by person exists, but explicit invite/seat lifecycle flow is incomplete.

6. True first-run onboarding
- Gap: no explicit first-run “complete one attempt + understand feedback” tutorialized path.

7. Content QA gates before publish
- Gap: pre-publish checks exist, but checklist definition should be tightened to confirm full requirement coverage.
- Current partials: review checklist and readiness indicators in `src/components/caseForm/CaseFormNavigation.jsx`.

8. Payment lifecycle completeness under edge cases
- Gap: core lifecycle exists, but edge-case hardening/verification matrix remains incomplete.

9. Scoring/readiness semantics and thresholds
- Gap: readiness logic exists in places, but not yet codified as a single explicit pass/fail/mastery contract.

10. Attempt record durability / audit-friendliness
- Gap: attempt snapshots are stored, but trainee-writable submission updates still allow post-submit mutation outside protected grade fields.
- Evidence: `firestore.rules` (`submissionSystemFieldsUnchanged` only protects grading fields).

11. Content QA for feedback quality (known-good/known-bad)
- Gap: no explicit pre-publish validation path proving review-note quality on both good and bad scenario paths.

## Recommended Next Slice
- Define and enforce a single readiness semantics contract (pass/fail/mastery thresholds + mapping from feedback/attempt summary), then render it consistently in admin and trainee surfaces.
