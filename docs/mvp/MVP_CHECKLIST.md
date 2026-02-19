# AuditSim Pro MVP Checklist

## MVP Definition
- Productize senior workpaper review with realistic, workpaper-like practice tasks plus specific senior-style feedback on what was wrong, why it matters, and how to improve.
- Deliver unlimited safe-to-fail repetition so trainees improve off-client before taking on higher-risk responsibilities.
- Teach audit process through pedagogically sound microlearning: short focused loops, clear objectives, minimal friction, and immediate coaching.
- Enable firm leadership to see defensible readiness signals that staff can execute procedures reliably and are ready for greater responsibility.
- Keep admin publishing practical: case content (dataset + PDFs + mappings + lightweight rubric/answer-key fields) can be prepared without developer intervention.

## Trainee flow (case list -> open -> select -> evidence -> classify + rationale -> submit -> feedback -> retry)
- [x] Trainee dashboard lists assigned/available cases and allows opening a case.
- [ ] Starting a case creates an "attempt" (fresh run) and the trainee can restart to generate a new attempt.
- [x] Trainee can select items and proceed only when required support exists (or the case explicitly allows missing-support scenarios).
- [x] Trainee can open support PDFs from the items (document access works reliably).
- [x] Trainee can classify selected items AND provide a minimal "why" (e.g., reason/assertion selection or short rationale).
- [x] Trainee can submit an attempt and immediately see results + "Senior Review Notes" (actionable coaching, not just right/wrong).
- [x] Trainee can retry the same case and see whether outcomes/notes improve across attempts (basic progress signal).

## Virtual Senior feedback loop (MVP slice of "workpaper review")
- [x] System generates deterministic review notes tied to the attempt (e.g., missing rationale, evidence not viewed before conclusion, common directional mistakes for the case).
- [x] Review notes are specific and instructional (what happened + what to do differently next time).
- [x] Feedback is stored with the attempt and is not editable/forgeable by trainees.

## Admin flow (case mgmt -> dataset import -> PDF mgmt -> mapping -> rubric/answer key -> publish -> view attempts)
- [x] Admin can create/edit case metadata and publish case availability.
- [x] Admin can import/update datasets for a case.
- [x] Admin can upload/manage PDF support documents.
- [x] Admin can map items to one or more support documents and validate mapping health.
- [x] Admin can set minimal rubric/answer-key fields required for feedback (per item or per case; keep it lightweight).
- [x] Admin can view trainee attempts and the generated review notes (basic coaching visibility).
- [x] Admin can see a simple "readiness/progress" view (attempt count + pass/fail or mastery flag + top feedback codes).

## Security (RBAC / access gating / protected evaluation)
- [x] Trainee routes enforce authenticated trainee access only.
- [x] Admin routes enforce admin/instructor access only.
- [x] Billing/access level gating blocks paid features when entitlements are missing.
- [x] Rubric/answer key and evaluation logic are not exposed to trainees (server-side evaluation; trainees only see outcomes/notes).
- [x] Document delivery is access-checked and time-limited (no permanent public URLs).

## Minimal analytics (events for key trainee/admin actions + readiness signals)
- [x] Track trainee attempt lifecycle (start, submit, results viewed, restart).
- [x] Track trainee document open/download actions.
- [x] Track "Senior Review Notes" signals (note codes + severity; enough to aggregate common mistakes).
- [x] Track admin authoring milestones (import, upload, mapping completion, publish).

## Commercial/Ops MVP (paid pilot readiness)
- [x] Billing and entitlements end-to-end: checkout -> entitlement applied immediately -> renewal/cancel -> expired access behavior -> graceful failure states.
- [ ] Onboarding and success path: first-session flow gets a trainee from zero to one completed attempt with clear feedback interpretation and a next action.
- [ ] Enough content to justify payment: a non-trivial starter set of cases with consistent feedback quality and low false-guidance risk.
- [ ] Support and trust basics: in-app help, issue reporting path, and clear data-collection messaging.
- [x] Reliability/observability baseline: error tracking, basic monitoring, and production checks for attempts/feedback/document access.
- [ ] Legal/admin basics: privacy policy + terms, plus admin workflow for inviting/assigning trainees and reviewing progress.
- [ ] Firm/organization layer and seat assignment: admin can invite trainees, assign cases, and view progress by person.
- [ ] True first-run onboarding: a brand-new trainee can complete one attempt and interpret feedback in one session without live guidance.
- [ ] Content QA gates before publish: ready/not-ready checks for mappings, required rubric fields, document accessibility, and evaluation safety.
- [x] Production reliability basics with operator visibility: error reporting plus an admin-facing status view for attempt submitted, feedback generated, and document delivery success.
- [ ] Payment lifecycle completeness under edge cases: valid users remain entitled through renewals/cancellations/transient billing states without incorrect lockout.
- [ ] Scoring/readiness semantics are explicit and consistent: pass/fail/mastery thresholds are defined per case and mapped clearly from review-note outcomes.
- [ ] Attempt record model is durable and audit-friendly: immutable attempt identifiers, timestamps, case/version linkage, status, and feedback summary fields support review and dispute resolution.
- [ ] Content QA validates feedback quality (not only publish readiness): each case is checked against at least one known-good path and one known-bad path to verify intended review-note behavior.

## Broader Self-Serve Launch (post-pilot)
- [ ] Polished marketing site and clear trial/free-demo packaging.
- [ ] Stronger security hardening beyond pilot baseline.
- [ ] Cost controls for generation, storage, and support operations.
- [ ] More robust content-authoring workflow with QA gates before publish.
