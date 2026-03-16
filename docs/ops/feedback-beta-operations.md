# Feedback Beta Operations Runbook (V1 MVP)

Use this runbook during the real-user feedback beta.

## Daily operating cadence (recommended)

### 1) Review user feedback (10 minutes)
- Open `/admin/beta`
- Review:
  - recent problem reports
  - recent event counts
  - checkout-related failures (`checkout_session_create_failed`, `webhook_failed`)
- Classify each item:
  - `BLOCKER` (crash, billing failure, security/privacy issue)
  - `UX issue` (workaround exists)
  - `Content issue` (bad case mapping/data)

### 2) Review launch-path health (5 minutes)
- Spot check:
  - `/demo/surl`
  - `/checkout`
  - `/login`
- Confirm no obvious production outage or route 404 on direct refresh

### 3) Review billing unlock health (5 minutes)
- Check for recent entitlement updates under:
  - `artifacts/{appId}/users/{uid}/billing/status`
- Investigate if users report successful payment but no access unlock

## Where to look when something breaks

### Checkout starts fail
- Production client console/network
- Cloud Functions logs for `createStripeCheckoutSession`
- `/admin/beta` analytics counts for `checkout_session_create_failed`
- Validate Functions env:
  - `APP_BASE_URL`
  - Stripe price IDs
  - `STRIPE_SECRET_KEY`

### Checkout succeeds but access does not unlock
- Cloud Functions logs for:
  - `stripeWebhook`
  - `confirmCheckoutSession`
- Confirm webhook secret and endpoint registration in Stripe
- Check user billing doc:
  - `artifacts/{appId}/users/{uid}/billing/status`
- Confirm status is `active` or `no_payment_required`

### User reports missing document access
- Confirm case `accessLevel` and assignment visibility
- Confirm user billing status (paid vs demo-only)
- Confirm Storage rules are deployed
- Verify referenced `storagePath` exists in bucket

## Emergency controls (reduce risk without code changes)

### Temporarily disable new self-signups
Fastest operational option:
- Firebase Console -> Authentication -> Sign-in method -> disable Email/Password provider

Impact:
- Existing users can usually continue authenticated sessions
- New registrations blocked until re-enabled

### Temporarily pause paid conversion (if Stripe issue)
- Remove/rotate Stripe secrets in Functions runtime OR disable webhook endpoint in Stripe (short-term only)
- Update landing/checkout CTA copy in next patch if issue persists

## Evidence to retain during beta

- Screenshot or note of `/admin/beta` daily counts
- Any problem report IDs tied to releases/hotfixes
- Stripe webhook delivery status screenshots for production endpoint
- Launch checklist results from `docs/verification/mvp-feedback-beta-launch-checklist.md`
