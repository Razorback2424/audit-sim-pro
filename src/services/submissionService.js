import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  arrayUnion,
  query,
  orderBy,
  limit as limitConstraint,
  onSnapshot,
} from 'firebase/firestore';
import { db, FirestorePaths, appId as defaultAppId } from '../AppCore';

export const saveSubmission = async (userId, caseId, data) => {
  const ref = doc(db, FirestorePaths.USER_CASE_SUBMISSION(userId, caseId));
  // The `data` object already contains a client-side timestamp.
  // Do not use serverTimestamp() inside an arrayUnion element.
  const attemptData = { ...data };
  await setDoc(
    ref,
    {
      submittedAt: serverTimestamp(), // This sets the last update time for the document itself.
      attempts: arrayUnion(attemptData),
    },
    { merge: true }
  );
};

export const fetchSubmission = async (userId, caseId) => {
  const ref = doc(db, FirestorePaths.USER_CASE_SUBMISSION(userId, caseId));
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const fetchSubmissionsForCase = async (caseId) => {
  const usersRef = collection(db, FirestorePaths.USERS_COLLECTION());
  const userDocs = await getDocs(usersRef);
  const submissions = [];
  for (const userDoc of userDocs.docs) {
    const userId = userDoc.id;
    const submissionRef = doc(db, FirestorePaths.USER_CASE_SUBMISSION(userId, caseId));
    const submissionSnap = await getDoc(submissionRef);
    if (submissionSnap.exists()) {
      submissions.push({ id: submissionSnap.id, userId, ...submissionSnap.data() });
    }
  }
  return submissions;
};

const normalizeAttemptList = (docData) => {
  const attempts = Array.isArray(docData.attempts) ? docData.attempts : [];
  if (attempts.length > 0) {
    return attempts.map((attempt) => ({
      ...attempt,
      submittedAt: attempt.submittedAt || docData.submittedAt || null,
      retrievedDocuments: Array.isArray(attempt.retrievedDocuments) ? attempt.retrievedDocuments : [],
      selectedPaymentIds: Array.isArray(attempt.selectedPaymentIds) ? attempt.selectedPaymentIds : docData.selectedPaymentIds || [],
      disbursementClassifications: attempt.disbursementClassifications || docData.disbursementClassifications || {},
      expectedClassifications: attempt.expectedClassifications || docData.expectedClassifications || {},
    }));
  }

  return [
    {
      submittedAt: docData.submittedAt || null,
      retrievedDocuments: Array.isArray(docData.retrievedDocuments) ? docData.retrievedDocuments : [],
      selectedPaymentIds: Array.isArray(docData.selectedPaymentIds) ? docData.selectedPaymentIds : [],
      disbursementClassifications: docData.disbursementClassifications || {},
      expectedClassifications: docData.expectedClassifications || {},
      overallGrade: docData.overallGrade,
    },
  ];
};

export const listUserSubmissions = async ({ uid, appId = defaultAppId } = {}) => {
  if (!uid) {
    throw new Error('listUserSubmissions requires a uid.');
  }
  if (!appId) {
    throw new Error('listUserSubmissions requires an appId.');
  }
  const submissionsRef = collection(db, FirestorePaths.USER_SUBMISSIONS_COLLECTION(appId, uid));
  const snapshot = await getDocs(submissionsRef);

  const submissions = snapshot.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      caseId: docSnap.id,
      caseName: data.caseName || '',
      submittedAt: data.submittedAt || null,
      attempts: normalizeAttemptList(data),
    };
  });

  submissions.sort((a, b) => {
    const aTime = a.submittedAt?.toMillis ? a.submittedAt.toMillis() : 0;
    const bTime = b.submittedAt?.toMillis ? b.submittedAt.toMillis() : 0;
    return bTime - aTime;
  });

  return submissions;
};

export const subscribeToRecentSubmissionActivity = (
  onData,
  onError,
  { appId = defaultAppId, limit: limitCount = 5 } = {}
) => {
  console.info('[SubmissionService] Subscribing to recent submission activity', {
    appId,
    limitCount,
  });
  const groupRef = collectionGroup(db, 'caseSubmissions');
  const q = query(groupRef, orderBy('submittedAt', 'desc'), limitConstraint(limitCount * 3));
  return onSnapshot(
    q,
    (snapshot) => {
      console.info('[SubmissionService] Snapshot received for recent submission activity', {
        totalDocs: snapshot.size,
        limitCount,
      });
      const filteredDocs = snapshot.docs.filter((docSnap) =>
        docSnap.ref.path.includes(`/artifacts/${appId}/users/`)
      );
      if (filteredDocs.length !== snapshot.docs.length) {
        console.info('[SubmissionService] Filtered submissions by app scope', {
          totalDocs: snapshot.docs.length,
          filteredDocs: filteredDocs.length,
        });
      }
      const entries = filteredDocs.slice(0, limitCount).map((docSnap) => {
        const data = docSnap.data() || {};
        const parent = docSnap.ref.parent?.parent;
        const submittedAt = data.submittedAt ?? null;
        const userId = parent?.id || data.userId || null;
        const sanitizedUserId = typeof userId === 'string' ? `${userId.slice(0, 6)}…` : null;
        console.debug('[SubmissionService] Preparing submission activity entry', {
          docPath: docSnap.ref.path,
          hasSubmittedAt: Boolean(submittedAt),
          sanitizedUserId,
        });
        return {
          caseId: docSnap.id,
          caseName: data.caseName || '',
          userId,
          submittedAt,
          attempts: normalizeAttemptList(data),
        };
      });
      onData(entries);
    },
    (error) => {
      console.error('[SubmissionService] Recent submission activity snapshot error', {
        code: error?.code,
        message: error?.message,
      });
      onError?.(error);
    }
  );
};
