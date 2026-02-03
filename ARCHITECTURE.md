# ARCHITECTURE.md

This file is the canonical “how the system fits together” reference for humans and agents. It exists to prevent architecture drift when multiple threads/agents work in parallel.

Rules:
- This is a descriptive document, not aspirational. It should reflect how the repo works today or the intended near-term architecture for the current milestone.
- If you change architecture, update this file in the same PR.
- Prefer clarity over completeness. Preserve invariants and ownership boundaries.

---

## 1) System overview (what the app does)
AuditSim Pro is a training simulator. A trainee opens an assigned case, reviews a disbursement listing, selects disbursements, and the system instantly retrieves the correct invoice support (PDFs). Admins author cases by importing datasets, uploading PDFs, and mapping disbursements to documents.

Primary system qualities:
- Fidelity: feels like the real workflow (selection → evidence retrieval)
- Correctness: mapping returns the right document(s)
- Security: PDFs are non-public and access is role-limited
- Observability: attempts and evidence access are measurable
- Admin throughput: mapping and authoring scale without brittle spreadsheets

---

## 2) Architectural layers (responsibilities and boundaries)
This app is logically split into four layers:

A) UI layer (frontend)
Responsibilities:
- Render screens and capture user intent
- Present disbursement listings and selection UX
- Present document viewer / download links
- Display case/attempt state derived from backend data

Hard rule:
- UI must not become the source-of-truth for business logic. Derivations should be centralized (one place) and reused across UI surfaces.

B) Domain layer (business rules / derivations)
Responsibilities:
- Define attempt state transitions and what each status means
- Define selection rules (min/max sample, duplicates, allowed submission states)
- Define mapping resolution semantics (one-to-many, missing docs)
- Define “what counts as progress”

Hard rule:
- Changes to business rules must be traceable and not duplicated across components.

C) Backend services (server functions / API)
Responsibilities:
- Enforce authorization (RBAC) on sensitive operations
- Produce secure document access (viewer sessions or signed URLs)
- Record attempts, submissions, and analytics events
- Optionally: run validations, mapping health checks, imports

Hard rule:
- Security-sensitive logic (entitlement, doc access) must be enforced server-side and/or via rules, not only in the client.

D) Data + storage (database + document storage)
Responsibilities:
- Persist cases, datasets, disbursements, mappings, attempts
- Store PDFs securely
- Enforce read/write via rules

Hard rule:
- PDFs must not be publicly accessible. Access must be authenticated and time-limited where applicable.

---

## 3) Primary entities (conceptual data model)
These are conceptual objects; actual collection names may differ. Any new features should map to this model rather than invent new parallel concepts.

User
- id, role(s), cohort memberships, entitlements (if applicable)

Cohort (optional but common)
- id, name, members

Case
- id, title, instructions, state (draft/published/archived)
- currentVersion pointer (if versioning is implemented)

CaseVersion (recommended)
- id, caseId
- datasetVersionId
- selection rules (min/max, strict/unmapped policy)
- delivery mode configuration (viewer vs signed downloads)
- scoring config (optional)

DatasetVersion
- id, caseId (or global)
- source metadata (filename, importedAt)
- canonical field mapping
- row count

DisbursementRow
- id (row key), datasetVersionId
- canonical fields (date, amount, payee, reference, etc.)

Document
- id, storage pointer/path, filename, hash, tags (vendor/date), uploadedAt
- version metadata (if versioning implemented)

Mapping
- disbursementRowId → [documentId...]
- metadata: mappedBy, mappedAt, mappingVersion or caseVersionId
- supports one-to-many mappings

Attempt
- id, userId, caseVersionId
- status: not_started | in_progress | submitted | completed (example)
- startedAt, lastActivityAt, submittedAt, completedAt

Submission (or AttemptSubmission snapshot)
- attemptId
- selected disbursementRowIds (snapshot)
- resolved documentIds (snapshot)
- delivery mode used
- errors/warnings (unmapped items, missing docs)

DocumentAccessEvent (analytics)
- attemptId, userId, documentId
- openedAt, duration (if measurable)
- action: opened | downloaded

AuditLogEvent (admin ops)
- actorId, action, target, timestamp, metadata

---

## 4) Invariants (must always be true)
These are non-negotiable system truths. New code must preserve them.

Security invariants:
1) A trainee can only access:
   - cases they are assigned/allowed to access
   - their own attempts/submissions
   - PDFs that were delivered to them through an authorized pathway
2) PDFs are never publicly readable. Access is authenticated and/or time-limited.
3) RBAC enforcement does not depend solely on client UI checks.

Data integrity invariants:
4) Submissions are historical snapshots. Changing mappings later must not silently rewrite what a trainee received previously (unless a controlled migration is performed).
5) Mapping resolution is deterministic: the same inputs yield the same delivered document set for that case version.
6) One-to-many mappings are supported and preserved end-to-end.

UX invariants:
7) The trainee always sees explicit handling of missing evidence (block or warn) — no silent failure.
8) Attempt state is unambiguous and consistent across dashboard, case view, and analytics.

Performance invariants:
9) Disbursement listing must remain responsive for large datasets.
10) No per-row network calls introduced in listing rendering.

---

## 5) Key flows (end-to-end)
### 5.1 Trainee: open case → select → submit → view PDFs
1) Authenticated trainee opens dashboard and sees assigned cases.
2) Trainee opens a case and views instructions.
3) Disbursement listing loads from dataset version linked to the case version.
4) Trainee selects disbursement rows.
5) Submit triggers:
   - authorization check
   - selection rule validation
   - mapping resolution to document IDs
   - secure access generation (viewer session / signed links)
   - attempt/submission persistence
   - analytics event emission
6) Trainee views PDFs and system records access events.

### 5.2 Admin: author case → import dataset → upload PDFs → map → assign
1) Admin creates a draft case.
2) Admin imports dataset (CSV/Excel), maps columns, validates types.
3) Admin uploads PDFs to document library.
4) Admin creates mappings between disbursement rows and documents (one-to-many supported).
5) Admin checks “mapping health” until completeness is acceptable.
6) Admin publishes and assigns to cohorts/users.

---

## 6) Where core logic should live (ownership rules)
This section prevents duplicated logic.

Attempt state derivation:
- Must be derived in exactly one place (domain/helper module). UI components consume it.

Selection rules (min/max, strictness):
- Must be enforced server-side (on submit) and mirrored client-side only for UX (disable/guide), not for security.

Document access:
- Must be generated server-side or via a secure mechanism enforced by rules (signed URLs with expiry or secure viewer).
- Client must never construct privileged storage URLs.

Mapping resolution:
- Prefer server-side resolution during submission so the submission snapshot is authoritative.

---

## 7) Versioning strategy (recommended default)
If versioning is implemented:
- CaseVersion points to DatasetVersion
- Submissions store:
  - selectedRowIds snapshot
  - resolvedDocumentIds snapshot
  - caseVersionId
This prevents history drift when mappings or datasets change later.

If versioning is NOT implemented yet:
- Treat it as a known risk; do not introduce changes that worsen drift.
- Prefer adding versioning before adding complex scoring/feedback.

---

## 8) Observability (what must be measurable)
Minimum required analytics coverage:
- attempt_started / attempt_resumed / attempt_submitted / attempt_completed
- document_opened / document_downloaded
- mapping_failure (unmapped selection, missing document)
- admin mapping changes (mapped/unmapped actions)

---

## 9) Deployment/environment assumptions (filled in for this repo)
Document the reality here once confirmed:
- Hosting: Not documented in repo (frontend is Create React App).
- Backend: Firebase client SDK with Firestore/Storage/Auth; Cloud Functions folder exists but no documented scripts.
- Database: Firestore.
- Storage: Firebase Storage.
- Auth: Firebase Auth (anonymous sign-in after role selection).
- Local dev: `npm start` for the app; Firebase emulators via `firebase emulators:start --only firestore,storage,auth`.
- Staging/prod differences: `.env` contains `REACT_APP_FIREBASE_CONFIG` and `REACT_APP_APP_ID`.

---

## 10) Known architectural risks (keep current)
- Mapping bottleneck risk: ensure bulk mapping and health views exist.
- History drift risk: implement submission snapshots / versioning.
- Rules complexity risk: keep RBAC enforcement centralized and tested.
- Performance risk: large datasets require pagination/virtualization and minimal reads.

End of file.
