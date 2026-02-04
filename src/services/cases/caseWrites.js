import {
  addDoc,
  doc,
  setDoc,
  collection,
  writeBatch,
  getDocs,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, FirestorePaths, appId, auth, functions } from '../../AppCore';
import { DEBUG_LOGS } from './caseDebug';
import { sanitizeCaseWriteData, buildCaseRepairPatch, VALID_CASE_STATUSES } from './caseTransforms';

export const createCase = async (data) => {
  const { caseData, caseKeysDoc } = sanitizeCaseWriteData(data, { isCreate: true });
  const collectionRef = collection(db, FirestorePaths.CASES_COLLECTION());
  const debugContext = {
    path: FirestorePaths.CASES_COLLECTION(),
    appId,
    publicVisible: caseData?.publicVisible,
    visibleToUserIdsCount: Array.isArray(caseData?.visibleToUserIds) ? caseData.visibleToUserIds.length : 0,
    status: caseData?.status,
    uid: auth?.currentUser?.uid || 'unknown',
  };
  try {
    if (DEBUG_LOGS) {
      console.info('[caseService] createCase: begin', debugContext);
      console.debug('[caseService] createCase: payload snapshot', {
        visibleToUserIds: caseData?.visibleToUserIds,
        _deleted: caseData?._deleted,
        caseLevel: caseData?.caseLevel,
        auditArea: caseData?.auditArea,
        moduleId: caseData?.moduleId,
        pathId: caseData?.pathId,
        tier: caseData?.tier,
        hasInstruction: Boolean(caseData?.instruction),
        referenceDocumentsCount: Array.isArray(caseData?.referenceDocuments)
          ? caseData.referenceDocuments.length
          : 0,
        invoiceMappingsCount: Array.isArray(caseData?.invoiceMappings)
          ? caseData.invoiceMappings.length
          : 0,
      });
    }
    const payloadSnapshot = {
      visibleToUserIds: caseData?.visibleToUserIds,
      _deleted: caseData?._deleted,
      caseLevel: caseData?.caseLevel,
      auditArea: caseData?.auditArea,
      moduleId: caseData?.moduleId,
      pathId: caseData?.pathId,
      tier: caseData?.tier,
      hasInstruction: Boolean(caseData?.instruction),
      referenceDocumentsCount: Array.isArray(caseData?.referenceDocuments)
        ? caseData.referenceDocuments.length
        : 0,
      invoiceMappingsCount: Array.isArray(caseData?.invoiceMappings)
        ? caseData.invoiceMappings.length
        : 0,
    };
    if (DEBUG_LOGS) {
      console.debug('[caseService] createCase: payload snapshot json', JSON.stringify(payloadSnapshot));
    }
    const visibleToUserIds = Array.isArray(caseData?.visibleToUserIds) ? caseData.visibleToUserIds : [];
    const currentUid = auth?.currentUser?.uid || null;
    if (DEBUG_LOGS) {
      console.debug('[caseService] createCase: rule check', {
        authPresent: Boolean(auth?.currentUser),
        uid: currentUid,
        publicVisible: caseData?.publicVisible,
        deleted: caseData?._deleted,
        status: caseData?.status,
        statusValid: VALID_CASE_STATUSES.includes(caseData?.status),
        visibleToUserIdsCount: visibleToUserIds.length,
        visibleToUserIdsIncludesUid: currentUid ? visibleToUserIds.includes(currentUid) : false,
        auditItemsCount: Array.isArray(caseData?.auditItems) ? caseData.auditItems.length : 0,
        auditItemTypeSample: caseData?.auditItems?.[0]?.type,
        auditItemIdSample: caseData?.auditItems?.[0]?.id,
        updatedAtType: typeof caseData?.updatedAt,
        createdAtType: typeof caseData?.createdAt,
        updatedAtIsTimestamp: caseData?.updatedAt instanceof Timestamp,
        createdAtIsTimestamp: caseData?.createdAt instanceof Timestamp,
      });
    }
    const ruleCheckSnapshot = {
      authPresent: Boolean(auth?.currentUser),
      uid: currentUid,
      publicVisible: caseData?.publicVisible,
      deleted: caseData?._deleted,
      status: caseData?.status,
      statusValid: VALID_CASE_STATUSES.includes(caseData?.status),
      visibleToUserIdsCount: visibleToUserIds.length,
      visibleToUserIdsIncludesUid: currentUid ? visibleToUserIds.includes(currentUid) : false,
      auditItemsCount: Array.isArray(caseData?.auditItems) ? caseData.auditItems.length : 0,
      auditItemTypeSample: caseData?.auditItems?.[0]?.type,
      auditItemIdSample: caseData?.auditItems?.[0]?.id,
      updatedAtType: typeof caseData?.updatedAt,
      createdAtType: typeof caseData?.createdAt,
      updatedAtIsTimestamp: caseData?.updatedAt instanceof Timestamp,
      createdAtIsTimestamp: caseData?.createdAt instanceof Timestamp,
    };
    if (DEBUG_LOGS) {
      console.debug('[caseService] createCase: rule check json', JSON.stringify(ruleCheckSnapshot));
    }
    const docRef = await addDoc(collectionRef, caseData);
    await setDoc(doc(db, FirestorePaths.CASE_KEYS_DOCUMENT(docRef.id)), caseKeysDoc);
    if (DEBUG_LOGS) {
      console.info('[caseService] createCase: success', { caseId: docRef.id });
    }
    return docRef.id;
  } catch (err) {
    if (DEBUG_LOGS) {
      console.error('[caseService] createCase: failed', { ...debugContext, error: err?.message, code: err?.code });
    }
    throw err;
  }
};

export const updateCase = async (caseId, data) => {
  const { caseData, caseKeysDoc } = sanitizeCaseWriteData(data, { isCreate: false });
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  const debugContext = {
    caseId,
    path: FirestorePaths.CASE_DOCUMENT(caseId),
    appId,
    publicVisible: caseData?.publicVisible,
    visibleToUserIdsCount: Array.isArray(caseData?.visibleToUserIds) ? caseData.visibleToUserIds.length : 0,
    status: caseData?.status,
    uid: auth?.currentUser?.uid || 'unknown',
    orgId: caseData?.orgId ?? null,
  };
  try {
    const sampleItem = Array.isArray(caseData?.auditItems) ? caseData.auditItems[0] : null;
    const sampleMapping = Array.isArray(caseData?.invoiceMappings) ? caseData.invoiceMappings[0] : null;

    if (DEBUG_LOGS) {
      console.info('[caseService] updateCase: begin', {
        ...debugContext,
        auditItemCount: Array.isArray(caseData?.auditItems) ? caseData.auditItems.length : 0,
        invoiceMappingCount: Array.isArray(caseData?.invoiceMappings) ? caseData.invoiceMappings.length : 0,
        sampleItem,
        sampleMapping,
      });
    }

    await setDoc(ref, caseData, { merge: true });
    if (DEBUG_LOGS) {
      console.info('[caseService] updateCase: wrote case doc', {
        caseId,
        path: debugContext.path,
        keysPath: FirestorePaths.CASE_KEYS_DOCUMENT(caseId),
        hasOrgId: !!caseData?.orgId,
        publicVisible: caseData?.publicVisible,
        status: caseData?.status,
      });
    }
    const keysPath = FirestorePaths.CASE_KEYS_DOCUMENT(caseId);
    await setDoc(doc(db, keysPath), caseKeysDoc);
    if (DEBUG_LOGS) {
      console.info('[caseService] updateCase: wrote keys doc', { caseId, path: keysPath });
      console.info('[caseService] updateCase: success', { caseId });
    }
  } catch (err) {
    if (DEBUG_LOGS) {
      console.error('[caseService] updateCase: failed', {
        ...debugContext,
        error: err?.message,
        code: err?.code,
        stack: err?.stack,
        caseKeysPath: FirestorePaths.CASE_KEYS_DOCUMENT(caseId),
        hasOrgId: !!caseData?.orgId,
        hasVisibleIds: Array.isArray(caseData?.visibleToUserIds) ? caseData.visibleToUserIds.length : 0,
      });
    }
    throw err;
  }
};

export const markCaseDeleted = async (caseId) => {
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  await setDoc(ref, { _deleted: true, updatedAt: serverTimestamp() }, { merge: true });
};

export const deleteRetakeAttempt = async ({ caseId }) => {
  if (!caseId) {
    throw new Error('deleteRetakeAttempt requires a caseId.');
  }
  const callable = httpsCallable(functions, 'deleteRetakeAttempt');
  const result = await callable({ appId, caseId });
  return result?.data || null;
};

const BATCH_WRITE_LIMIT = 450;

const commitUpdatesInChunks = async (updates) => {
  for (let i = 0; i < updates.length; i += BATCH_WRITE_LIMIT) {
    const batch = writeBatch(db);
    updates.slice(i, i + BATCH_WRITE_LIMIT).forEach(({ ref, data }) => {
      batch.set(ref, data, { merge: true });
    });
    await batch.commit();
  }
};

export const repairLegacyCases = async () => {
  const casesCollection = collection(db, FirestorePaths.CASES_COLLECTION());
  const snap = await getDocs(casesCollection);
  const updates = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const patch = buildCaseRepairPatch(data);

    if (Object.keys(patch).length > 0) {
      patch.updatedAt = serverTimestamp();
      updates.push({ ref: docSnap.ref, data: patch });
    }
  });

  if (updates.length === 0) {
    return { repaired: 0 };
  }

  await commitUpdatesInChunks(updates);

  return { repaired: updates.length };
};
