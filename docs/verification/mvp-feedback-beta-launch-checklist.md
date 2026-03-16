# MVP Feedback Beta Launch Checklist

Use this checklist for the real-user feedback launch (hybrid demo + billing + invite/self-signup).

## 1) Frontend production build (Bluehost)

- [ ] `.env.production.local` created from `.env.production.example`
- [ ] `npm run validate:env:prod` passes
- [ ] `npm run build:prod:bluehost` succeeds
- [ ] Bluehost upload complete (`build/` contents only)
- [ ] SPA route fallback configured (`.htaccess` rewrite to `index.html`)
- [ ] HTTPS enabled on domain

## 2) Firebase backend deploy

- [ ] `firestore.rules` deployed
- [ ] `storage.rules` deployed
- [ ] `firestore.indexes.json` deployed
- [ ] Functions deployed
- [ ] Firebase Auth Email/Password enabled
- [ ] Production Storage bucket confirmed

## 3) Security/rules regression

- [ ] `npm run verify:rules:submissions` passes (allow + deny)
- [ ] Trainee can open authorized/demo document
- [ ] Unauthorized user cannot access protected paid document (spot-check)

## 4) Billing configuration and checkout

- [ ] Stripe secrets configured in Functions runtime
- [ ] Stripe price IDs configured (`individual`, `individual_annual`)
- [ ] `APP_BASE_URL` matches production domain
- [ ] Stripe webhook registered to deployed `stripeWebhook` endpoint
- [ ] Test checkout succeeds and returns to `/checkout/success`
- [ ] Entitlement doc updates and paid access unlocks

## 5) Demo + paid gating (hybrid access model)

- [ ] Logged-out user can access demo flow
- [ ] Self-registered user without payment is limited to demo/paywalled experience
- [ ] Invite/assigned user can access assigned case(s)
- [ ] Paid user can access paid cases and save progress

## 6) Core trainee flow

- [ ] Open assigned/paid case
- [ ] Select/classify items
- [ ] Submit attempt successfully
- [ ] Submission history shows attempt
- [ ] Reference/support documents open for authorized user

## 7) Core admin + feedback observability

- [ ] Admin case submissions page loads
- [ ] Admin submission detail page loads
- [ ] Admin case progress page loads
- [ ] Admin beta dashboard (`/admin/beta`) loads
- [ ] Problem report can be submitted from production client
- [ ] Problem report appears in admin beta dashboard / Firestore
- [ ] Analytics events appear for attempt and checkout actions

## 8) Launch decision rule

- Launch for feedback only when all sections above pass.
- If any item fails, classify it:
  - `SHIP-BLOCKER`: crash, security/privacy issue, billing failure, or core flow blocked
  - `SHOULD-FIX`: workaround exists and real-user feedback can still be gathered safely
  - `NICE-TO-HAVE`: polish/non-critical improvements for V1.1
