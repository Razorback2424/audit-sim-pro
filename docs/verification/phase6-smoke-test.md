## Phase 6 - Smoke Test Checklist

Date:

Checklist:
- Register a new trainee user.
- Open trainee dashboard and verify demo case list shows.
- Complete Stripe checkout; land on success page with `session_id`.
- Confirm unlock: billing status flips to `paid/active` and trainee view loads paid cases.
- Start a paid case; submit a case attempt.
- Verify scoring results returned (server-side).
- Verify dashboard updates with submission/attempt summary.

Results:
- Not run (requires local dev + Stripe sandbox + emulator/prod env).
