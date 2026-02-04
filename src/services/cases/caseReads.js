import { doc, getDoc } from 'firebase/firestore';
import { db, FirestorePaths } from '../../AppCore';
import { DEBUG_LOGS } from './caseDebug';
import { toNormalizedCaseModel, mergeCaseKeysIntoCaseModel } from './caseTransforms';

export const fetchCase = async (caseId, options = {}) => {
  const { includePrivateKeys = false } = options || {};
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  const caseSnap = await getDoc(ref);
  if (!caseSnap.exists()) return null;

  const baseModel = toNormalizedCaseModel(caseSnap.id, caseSnap.data());
  if (!includePrivateKeys) return baseModel;

  const caseKeysSnap = await getDoc(doc(db, FirestorePaths.CASE_KEYS_DOCUMENT(caseId))).catch((err) => {
    if (DEBUG_LOGS) {
      console.warn('[caseService] Failed to load private case keys', { caseId, error: err?.message });
    }
    return null;
  });
  const caseKeysData =
    caseKeysSnap && typeof caseKeysSnap.exists === 'function' && caseKeysSnap.exists()
      ? caseKeysSnap.data()
      : null;
  return mergeCaseKeysIntoCaseModel(baseModel, caseKeysData);
};
