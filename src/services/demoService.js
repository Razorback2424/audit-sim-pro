import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { appId, db, functions, FirestorePaths } from '../AppCore';

export const fetchDemoConfig = async ({ appId: appIdOverride } = {}) => {
  const ref = doc(db, FirestorePaths.DEMO_CONFIG_DOCUMENT(appIdOverride || appId));
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
};

export const setDemoCase = async ({
  caseId,
  appId: appIdOverride,
  backfillPaid = true,
  queueDocuments = true,
} = {}) => {
  if (!caseId) {
    throw new Error('Missing demo case ID.');
  }
  const callable = httpsCallable(functions, 'setDemoCase');
  const result = await callable({
    appId: appIdOverride || appId,
    caseId,
    backfillPaid,
    queueDocuments,
  });
  return result?.data || {};
};
