import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, FirestorePaths } from './firebase';

export const saveCaseGenerationPlan = async ({ caseId, plan }) => {
  if (!caseId || !plan) return;
  const ref = doc(db, FirestorePaths.CASE_GENERATION_PLAN_DOCUMENT(caseId));
  const payload = {
    plan,
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload, { merge: true });
};

export const queueCaseGenerationJob = async ({ caseId, plan, appId, phaseId }) => {
  if (!caseId || !plan) {
    throw new Error('Missing caseId or generation plan.');
  }
  if (!appId) {
    throw new Error('Missing appId for generation job.');
  }
  const callable = httpsCallable(functions, 'queueCaseDocGeneration');
  const result = await callable({ caseId, plan, appId, phaseId: phaseId || null });
  return result?.data || null;
};

export const fetchCaseGenerationPlan = async ({ caseId }) => {
  if (!caseId) return null;
  const ref = doc(db, FirestorePaths.CASE_GENERATION_PLAN_DOCUMENT(caseId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  const plan = data.plan || null;
  const lastJob = data.lastJob || null;
  if (!plan) {
    return lastJob ? { referenceDocumentSpecs: [], lastJob } : null;
  }
  return {
    ...plan,
    lastJob,
  };
};
