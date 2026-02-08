# Analytics Events

This document is the source of truth for the analytics taxonomy and event envelope used in AuditSim Pro.
It is intentionally small and query-driven so the funnel and reliability questions can be answered directly
in Firestore.

## Collection

Events are stored at:

`artifacts/{appId}/analytics/events`

All writes go through a callable (client) or server helper (functions). Clients cannot write directly.

## Common Event Envelope (all events)

Fields are appended server-side and must not be supplied by clients.

- `eventName` (string)
- `appId` (string)
- `uid` (string | null)
- `caseId` (string | null)
- `attemptId` (string | null)
- `sessionId` (string | null)
- `ts` (server timestamp)
- `props` (map | null)
- `source` (`client` | `server`)

## Event Taxonomy

| eventName | emittedBy | when | required props | optional props | PII notes |
| --- | --- | --- | --- | --- | --- |
| `attempt_started` | client | Trainee starts a case attempt | `isDemo` (bool) | `caseVersion` (string), `datasetVersion` (string) | `uid` only |
| `attempt_submitted` | client | Trainee submits selections | `isDemo` (bool), `selectedCount` (number) | `unmappedCount` (number), `missingDocsCount` (number) | `uid` only |
| `attempt_results_viewed` | client | Trainee views results | `isDemo` (bool) | `resultState` (string: `pass`/`fail`/`partial`) | `uid` only |
| `cta_save_report_clicked` | client | User clicks “Save report” CTA | `isDemo` (bool) | `format` (string: `pdf`/`csv`) | `uid` only |
| `cta_checkout_clicked` | client | User clicks checkout CTA | `isDemo` (bool), `intent` (string: `save-report`/`unlock-case`/`unlock-dashboard`), `plan` (string) | `ctaLocation` (string) | `uid` only |
| `checkout_session_create_failed` | server | Checkout session creation fails | `intent` (string), `plan` (string), `errorCode` (string) | `errorType` (string), `provider` (string: `stripe`) | No PII |
| `checkout_confirm_failed` | server | `confirmCheckoutSession` fails | `errorCode` (string) | `errorType` (string), `provider` (string: `stripe`) | `uid` if available |
| `entitlement_activated` | server | Entitlement becomes true | `source` (string: `webhook`/`confirm`/`reconcile`) | `plan` (string), `entitlementId` (string) | `uid` only |
| `guided_review_opened` | client | Guided review panel first shown | `step` (string: `highlights`/`summary`/`details`) | `section` (string) | `uid` only |
| `evidence_signed_url_issued` | server | Signed URL generated for evidence | `docKind` (string), `docLabel` (string) | `attemptId` (string) | No doc path or PII |
| `evidence_open_failed` | server | Evidence open/serve fails | `docKind` (string), `reason` (string: `missing_storage_path`/`permission_denied`/`signing_error`) | `docLabel` (string) | No doc path or PII |
| `webhook_failed` | server | Webhook handler fails | `eventType` (string), `errorCode` (string) | `provider` (string: `stripe`), `stage` (string) | No PII |
| `reconcile_invoked` | server | Entitlement reconcile endpoint used | `by` (string: `self`/`admin`), `result` (string: `activated`/`noop`/`failed`), `lookupMethod` (string) | `plan` (string) | `uid` only |
