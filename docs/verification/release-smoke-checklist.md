# Release Smoke Checklist (V1)

Use this checklist for final ship/no-ship decisions on the current MVP scope.

## 1) Automated gates

- [ ] `CI=true npm test -- --watchAll=false` passes.
- [ ] `npm run build` succeeds.
- [ ] `npm run verify:rules:submissions` passes (1 allow + 1 deny regression check).

## 2) Core trainee flow (manual, 3-5 minutes)

- [ ] Sign in as trainee with an assigned case.
- [ ] Open case and select at least one disbursement.
- [ ] Submit attempt successfully (no crash, no blocked action).
- [ ] Open submission history and confirm the new attempt appears.

## 3) Core admin flow (manual, 3-5 minutes)

- [ ] Open admin case submissions page for the same case.
- [ ] Confirm trainee submission is visible.
- [ ] Open submission detail and confirm selections and review notes render.
- [ ] Open case progress and confirm roster/readiness renders.

## 4) Decision rule

- Ship if all items above pass.
- If a check fails, classify as:
  - SHIP-BLOCKER: core flow broken, crash/data loss/security issue, or build/test failure.
  - SHOULD-FIX: workaround exists and core flow still completes.
  - NICE-TO-HAVE: does not impact core flow reliability.
