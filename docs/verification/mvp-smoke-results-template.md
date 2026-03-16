# MVP Smoke Results Template (Real-User Feedback Launch)

Use this template while running the checklist in `docs/verification/mvp-feedback-beta-launch-checklist.md`.

## Run Metadata

- Date:
- Environment: (staging / production)
- Domain:
- Frontend build hash:
- Firebase project:
- `REACT_APP_APP_ID`:
- Tester:

## Results (Pass / Fail + notes)

### 1) Public / logged-out
- Landing page loads:
- Demo path accessible:

### 2) Self-signup / auth
- Register new trainee account:
- Login:
- Logout:

### 3) Demo / paywall boundary
- Non-paid user can access demo:
- Non-paid user blocked/gated from paid content:
- Invite-only assigned case access works:

### 4) Billing (Stripe)
- Checkout starts:
- Checkout success redirect:
- Billing status doc updated:
- Paid access unlocks:

### 5) Core trainee flow
- Open case:
- Select/classify:
- Submit:
- Submission history shows new attempt:
- Reference docs open:

### 6) Core admin flow
- Case submissions page:
- Submission detail page:
- Case progress page:
- Admin beta dashboard:

### 7) Feedback / observability
- Problem report submit:
- Problem report visible to admin:
- Analytics events visible:

## Findings Triage

### SHIP-BLOCKER
- 

### SHOULD-FIX
- 

### NICE-TO-HAVE / Deferred
- 

## Launch Decision

- Status: `NOT READY` / `CLOSE` / `SHIP NOW`
- Decision owner:
- Notes:
