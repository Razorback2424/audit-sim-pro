## Phase 4 - Checkout Unlock Reliability

Date:

Checklist:
- Checkout success page loads with `session_id` in URL.
- confirmCheckoutSession callable returns paid for the current user.
- Billing doc flips to `status: paid` within polling window.
- Trainee landing route (`/trainee?autostart=1`) loads paid cases.
- Webhook still updates billing if confirm step is skipped.

Results:
- Not run (per request).
