# Gap Analysis

## Step 0: Repo Rules Summary
Key constraints I must obey, per `AGENTS.MD`, `PLANS.md`, `TESTING.md`, and `ARCHITECTURE.md`.

- Smallest change only, no speculative refactors, no behavior changes unless explicitly required. `AGENTS.MD:8-13`
- Ask before dependencies, auth/RBAC changes, rules changes, billing changes, data migrations, ops changes, or performance-sensitive changes. `AGENTS.MD:68-93`
- Do not change analytics event taxonomy or schema unless explicitly requested. `AGENTS.MD:58-66`
- Document delivery must be secure and non-public. `AGENTS.MD:206-211`, `ARCHITECTURE.md:57-65`
- Submissions should be snapshots and mapping resolution should be deterministic. `ARCHITECTURE.md:140-143`
- Verification must use actual repo commands, and manual scenarios are required for core flows. `TESTING.md:5-35`

## Step 1: Target Vision (Source of Truth)
AuditSim Pro is a training simulator where trainees select disbursements and instantly retrieve correct invoice PDFs. Admins can author cases by importing datasets, uploading PDFs, and mapping disbursements to documents including one-to-many. The system must be secure, observable, and stable with snapshot submissions to prevent history drift. MVP means trainee end-to-end works, admin authoring works, mapping health is visible, RBAC is enforced, and basic analytics exist.

## Step 2: Inventory of Current Implementation
Each area lists relevant files and what they currently do.

### Auth and roles / RBAC
Files:
- `src/contexts/AuthContext.js:1-179` manages Firebase Auth, blocks anonymous sessions, and handles email/password login.
- `src/contexts/UserContext.js:1-220` loads role from token + Firestore, mirrors role into `roles/{uid}`.
- `src/routes/RoleRoute.jsx:1-27` gates routes by role.
- `src/pages/RoleSelectionPage.jsx:41-58` presents role selection UI for owner/admin/trainee.
- `firestore.rules:291-301` restricts role document create to trainee, update to admin.
- `firestore.rules:304-338` enforces case access rules.
- `storage.rules:52-120` enforces document access rules for storage paths.

Current behavior:
- Role selection UI allows choosing owner/admin/trainee, but Firestore rules only allow self-create as trainee. `src/pages/RoleSelectionPage.jsx:48-55`, `firestore.rules:291-301`
- RBAC enforcement is primarily in Firestore and Storage rules with role doc lookup and case visibility checks. `firestore.rules:304-338`, `storage.rules:52-120`

### Case model + lifecycle
Files:
- `src/models/case.js:1-210` defines case shape with disbursements, invoiceMappings, referenceDocuments, status, visibility.
- `src/services/caseService.js:1000-1160` fetches and normalizes cases and merges private case keys.
- `src/pages/CaseFormPage.jsx:210-520` manages admin case authoring flow, review, and generation.
- `src/pages/AdminCaseManagementPage.jsx` manages case listing and actions.

Current behavior:
- Cases are stored in `artifacts/{appId}/public/data/cases` with status, visibility, and disbursement arrays. `src/services/firebase.js:66-140`, `src/models/case.js:64-150`
- Admin case authoring flow builds disbursement data, mappings, and reference documents with a review checklist. `src/pages/CaseFormPage.jsx:210-520`

### Dataset import and canonicalization
Files:
- `src/components/caseForm/TransactionsStep.jsx:118-190` exposes CSV import UI.
- `src/hooks/useCaseFormCsvImport.js:1-90` parses CSV into disbursements with minimal validation.

Current behavior:
- CSV import expects fixed headers `PaymentID, Payee, Amount, PaymentDate` and directly sets disbursement rows. `src/hooks/useCaseFormCsvImport.js:19-72`
- No Excel support and no column mapping beyond header matching. `src/components/caseForm/TransactionsStep.jsx:154-190`

### Disbursement listing UI (trainee)
Files:
- `src/pages/TraineeCaseViewPage.jsx:2440-2545` manages selection, testing, and submission.
- `src/components/trainee/steps/SelectionStep.jsx` renders selection UI.

Current behavior:
- Trainee flow loads disbursements, supports selection, and enforces missing-document gating before testing. `src/pages/TraineeCaseViewPage.jsx:2350-2420`
- Selection and classification are handled in client state within `TraineeCaseViewPage.jsx`. `src/pages/TraineeCaseViewPage.jsx:2050-2320`

### Mapping system (disbursement → documents, one-to-many)
Files:
- `src/services/caseService.js:318-672` normalizes invoiceMappings and merges into disbursements with supportingDocuments.
- `src/components/caseForm/DisbursementItem.jsx:1-220` manages mapping UI per disbursement and supports multiple attachments.
- `src/pages/CaseFormPage.jsx:210-260` counts mappings in review.
- `src/services/caseService.js:1270-1322` computes disbursement alerts for missing mappings or answer keys.

Current behavior:
- Mappings are stored as `invoiceMappings` and merged into `supportingDocuments` on disbursements. `src/services/caseService.js:318-672`
- One-to-many is supported by grouping multiple mappings per paymentId. `src/services/caseService.js:375-404`
- Admin mapping health is surfaced via alerts for unmapped disbursements. `src/services/caseService.js:1270-1322`, `src/pages/AdminDashboardPage.jsx:520-610`

### Document storage + delivery
Files:
- `src/hooks/useCaseFormUploads.js:238-258` uploads to Firebase Storage and stores `downloadURL` and `storagePath`.
- `src/pages/TraineeCaseViewPage.jsx:1802-1910` renders evidence by direct `downloadURL` or `getDownloadURL` from `storagePath`.
- `src/pages/AdminCaseOverviewPage.jsx:33-50` opens invoice documents using downloadURL or Storage SDK.
- `storage.rules:92-178` governs storage access for case documents.

Current behavior:
- Admin uploads set both `storagePath` and `downloadURL` in case data. `src/hooks/useCaseFormUploads.js:238-258`
- Trainee viewer prefers `downloadURL` when present, otherwise uses `getDownloadURL` on `storagePath`. `src/pages/TraineeCaseViewPage.jsx:1807-1910`

### Attempt lifecycle and persistence
Files:
- `src/services/progressService.js:1-200` saves per-case progress to `student_progress` documents.
- `src/services/submissionService.js:1-150` saves submissions with attempt arrays and retrieved documents.
- `src/pages/TraineeCaseViewPage.jsx:1975-2545` orchestrates progress saving and submission write.
- `src/models/progress.js:1-120` defines progress states and draft payloads.

Current behavior:
- Progress state is client-derived and saved to `student_progress`, including draft selections. `src/services/progressService.js:162-240`, `src/models/progress.js:1-120`
- Submission snapshots include selectedPaymentIds and retrievedDocuments in the case submission document. `src/pages/TraineeCaseViewPage.jsx:2459-2533`, `src/services/submissionService.js:90-150`

### Analytics and events
Files:
- `src/services/analyticsService.js:1-40` calls `trackAnalyticsEvent` cloud function.
- `functions/index.js:3334-3359` limits allowed analytics events to marketing/demo events.
- `src/pages/TraineeCaseViewPage.jsx:2493-2497` sends `demo_submitted` only for demo flow.

Current behavior:
- Analytics tracking exists for registration, checkout, and demo events only. `functions/index.js:3334-3359`
- No attempt lifecycle or document access event logging found in client or functions. `functions/index.js:3334-3359`, `src/pages/TraineeCaseViewPage.jsx:2493-2497`

### Admin workflows
Files:
- `src/pages/CaseFormPage.jsx` and `src/components/caseForm/*` for case authoring and mapping uploads.
- `src/pages/AdminCaseManagementPage.jsx` for case listing and actions.
- `src/pages/AdminCaseOverviewPage.jsx` for viewing case documents.
- `src/pages/AdminCaseProgressPage.jsx` and `src/pages/AdminCaseSubmissionsPage.jsx` for trainee progress and submissions.
- `src/pages/AdminCaseDataAuditPage.jsx` for case data audits.

Current behavior:
- Admin can create/edit cases, upload invoices, and map disbursements. `src/pages/CaseFormPage.jsx:210-520`, `src/components/caseForm/DisbursementItem.jsx:1-220`
- Admin dashboards show case progress and submissions. `src/pages/AdminCaseProgressPage.jsx:1-220`, `src/pages/AdminCaseSubmissionsPage.jsx:1-140`
- Case data audit surfaces missing data but does not update data automatically. `src/pages/AdminCaseDataAuditPage.jsx:1-120`

## Step 3: Gap Analysis vs Vision and Invariants

### A) Meets vision
- Trainee selection and submission flow exists with disbursement selection, classification, and submission snapshot capture. `src/pages/TraineeCaseViewPage.jsx:2440-2535`
- One-to-many document mappings are supported through grouped `invoiceMappings` and `supportingDocuments`. `src/services/caseService.js:318-672`
- Admin can author cases, upload invoice documents, and map disbursements. `src/pages/CaseFormPage.jsx:210-520`, `src/components/caseForm/DisbursementItem.jsx:1-220`

### B) Partially meets vision
- Secure document delivery is partially enforced via Storage rules, but document URLs are stored and used directly in the client with no additional access checks in code. `src/hooks/useCaseFormUploads.js:238-258`, `src/pages/TraineeCaseViewPage.jsx:1807-1910`, `storage.rules:92-178`
  Smallest fix: avoid persisting `downloadURL` in case data and fetch documents through a server-controlled or auth-checked path. Likely touch `src/hooks/useCaseFormUploads.js`, `src/pages/TraineeCaseViewPage.jsx`, and possibly `functions/index.js` for signed URLs.
- Dataset import exists but is limited to CSV with fixed headers and minimal validation. `src/hooks/useCaseFormCsvImport.js:19-72`, `src/components/caseForm/TransactionsStep.jsx:154-190`
  Smallest fix: add header mapping + validation for missing IDs, numeric amount parsing, and date format checks in `src/hooks/useCaseFormCsvImport.js`.
- Mapping health is surfaced via alerts but not as a dedicated mapping health view. `src/services/caseService.js:1270-1322`, `src/pages/AdminDashboardPage.jsx:520-610`
  Smallest fix: add a focused per-case mapping health summary on the admin case overview page. `src/pages/AdminCaseOverviewPage.jsx`
- Attempt lifecycle is persisted via `student_progress` and submissions, but start/resume/submit/complete is derived client-side only. `src/services/progressService.js:162-240`, `src/pages/TraineeCaseViewPage.jsx:1975-2545`
  Smallest fix: formalize attempt lifecycle state transitions in one helper and ensure progress writes consistently use it.

### C) Missing for MVP
- Observability for attempt lifecycle and document access is not implemented. The analytics function only allows marketing/demo events. `functions/index.js:3334-3359`, `src/services/analyticsService.js:1-40`
  Smallest fix: add a dedicated attempt/document event log path or extend analytics. This is blocked by AGENTS constraints on schema and analytics taxonomy.
- Submission snapshot versioning for dataset/mapping changes is not present. Case model and submission payloads lack version identifiers. `src/models/case.js:64-170`, `src/services/submissionService.js:90-150`
  Smallest fix: add caseVersion or datasetVersion identifiers to case and submission docs. This is a schema change and requires approval.

### D) Risks
- Document access risk: `downloadURL` is persisted and used directly, and the client does not add additional access checks before opening it. `src/hooks/useCaseFormUploads.js:238-258`, `src/pages/TraineeCaseViewPage.jsx:1807-1815`
- Role assignment risk: UI offers owner/admin role selection, but rules only allow self-create as trainee. This creates an unclear admin onboarding path. `src/pages/RoleSelectionPage.jsx:48-55`, `firestore.rules:291-301`
- Performance risk: cases embed full disbursement arrays in a single case document, which may be large and loaded wholesale for trainees. `src/models/case.js:64-150`, `src/services/caseService.js:1068-1085`
- Mapping drift risk: submissions store retrieved documents, but there is no versioning on case or dataset to guard against historical drift if mappings change. `src/services/submissionService.js:90-150`, `src/models/case.js:64-170`

## Step 4: Rule Mismatches

- ARCH invariant: document access should be secure and time-limited, but the client uses stored `downloadURL` values directly. `ARCHITECTURE.md:47-65`, `src/hooks/useCaseFormUploads.js:238-258`, `src/pages/TraineeCaseViewPage.jsx:1807-1815`
- ARCH invariant: mapping resolution should be server-side, but mapping resolution and submission document selection happen client-side. `ARCHITECTURE.md:180-195`, `src/services/caseService.js:318-672`, `src/pages/TraineeCaseViewPage.jsx:2459-2523`
- TESTING expectations: lint/typecheck commands are referenced but not present in `package.json` or `functions/package.json`. `TESTING.md:2`, `package.json:9-20`, `functions/package.json:1-14`
