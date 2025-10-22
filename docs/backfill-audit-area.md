# Backfill Guidance — Case `auditArea`

Existing Firestore documents for `artifacts/<appId>/public/data/cases/*` will not have the new `auditArea` (and optional `caseGroupId`) fields until they are updated. Use the following steps to populate the field on historical data.

## 1. Choose a default value

The application defaults to `general` (see `DEFAULT_AUDIT_AREA` in `src/models/caseConstants.js`). Decide whether you want every legacy case to use this value or whether some cases should receive a more specific area (e.g., `payables`, `receivables`).

## 2. Run the scripted backfill

1. Install project dependencies if you have not already:

   ```bash
   npm install
   ```

2. Save the script below as `scripts/backfillAuditArea.mjs` (or run it ad-hoc with `node --input-type=module`):

   ```javascript
   import 'dotenv/config';
   import { initializeApp, applicationDefault } from 'firebase-admin/app';
   import { getFirestore, FieldValue } from 'firebase-admin/firestore';

   const APP_ID = process.env.REACT_APP_APP_ID || 'auditsim-pro-default-dev';
   const DEFAULT_AUDIT_AREA = 'general';

   initializeApp({
     credential: applicationDefault(),
   });

   const db = getFirestore();
   const casesRef = db.collection(`artifacts/${APP_ID}/public/data/cases`);

   const snapshot = await casesRef.get();
   console.log(`[backfill] Found ${snapshot.size} case documents`);

   const batch = db.batch();
   snapshot.forEach((doc) => {
     const data = doc.data() || {};
     if (typeof data.auditArea === 'string' && data.auditArea.trim()) {
       return;
     }
     batch.set(
       doc.ref,
       {
         auditArea: DEFAULT_AUDIT_AREA,
         updatedAt: FieldValue.serverTimestamp(),
       },
       { merge: true }
     );
   });

   await batch.commit();
   console.log('[backfill] Completed auditArea population');
   process.exit(0);
   ```

3. Authenticate with Firebase so the Admin SDK can connect:

   ```bash
   gcloud auth application-default login
   # or set GOOGLE_APPLICATION_CREDENTIALS pointing to a service-account JSON
   ```

4. Execute the script:

   ```bash
   node scripts/backfillAuditArea.mjs
   ```

5. Verify a sample document in Firestore now includes the `auditArea` field.

## 3. (Optional) Populate `caseGroupId`

If you plan to group cases, you can extend the script above to set `caseGroupId`. Recommended pattern:

```javascript
const GROUP_BY_TITLE = new Map([
  ['Case A', 'core-training'],
  ['Case B', 'advanced-scenarios'],
]);

const groupId = GROUP_BY_TITLE.get(data.title?.trim());
if (groupId && doc.get('caseGroupId') !== groupId) {
  batch.set(doc.ref, { caseGroupId: groupId }, { merge: true });
}
```

## 4. Keep documentation up to date

- Record which audit areas and group IDs you use (see `src/models/caseConstants.js`).
- Whenever you add new cases via the admin UI, make sure to provide an `auditArea` so further backfills aren’t required.
