# Open Questions (Blocking)

1) Observability: Are we allowed to introduce new analytics events or collections for attempt lifecycle and document access, given AGENTS.md prohibits analytics taxonomy and schema changes without explicit approval? `AGENTS.MD:58-66`

2) Document delivery: Should we implement short-lived signed URLs or an authenticated blob fetch path, and are Storage rules changes in scope for this MVP work? `AGENTS.MD:68-93`, `ARCHITECTURE.md:47-65`

3) Versioning: Do you want caseVersion/datasetVersion fields added to case and submission documents to prevent history drift, even though this is a schema change? `AGENTS.MD:63-66`, `ARCHITECTURE.md:140-143,198-205`

4) Admin onboarding: Should role selection for owner/admin remain in the UI for production, or should it be restricted to admin-controlled provisioning? `src/pages/RoleSelectionPage.jsx:48-55`, `firestore.rules:291-301`
