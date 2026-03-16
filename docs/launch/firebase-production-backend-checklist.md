# Firebase Production Backend Checklist (MVP)

Bluehost hosts only the frontend bundle. The backend launch still requires Firebase production deployment.

## Deploy artifacts

- Firestore rules: `firestore.rules`
- Storage rules: `storage.rules`
- Firestore indexes: `firestore.indexes.json`
- Cloud Functions: `functions/`

## Required production services/settings

- Firebase Auth enabled (Email/Password)
- Firestore database created
- Storage bucket created and matches frontend config
- Functions runtime configured with Stripe secrets if billing is enabled

## Commands to run (from repo root)

```bash
npm run validate:env:functions
CI=true npm test -- --watchAll=false
npm run build
npm run verify:rules:submissions
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

## Billing/Stripe runtime configuration (functions)

Verify production Functions config/secrets include:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_INDIVIDUAL`
- `STRIPE_PRICE_INDIVIDUAL_ANNUAL`
- `APP_BASE_URL` (your real domain)
- `APP_ID` (matches `REACT_APP_APP_ID`)

## Post-deploy verification (required)

- Stripe checkout session can be created from production app
- Stripe webhook signature verification passes
- Billing status doc updates under:
  - `artifacts/{appId}/users/{uid}/billing/status`
- Paid user access unlocks without manual DB edits

## Demo + paywall boundary checks (required)

- Logged-out user can access demo flow
- Non-paid signed-in user can access demo but not paid-only content
- Paid user can access paid content
- Invited user can access assigned case(s)
