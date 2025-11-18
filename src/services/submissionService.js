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
  Timestamp,
  where,
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

export const subscribeToSubmission = (userId, caseId, onData, onError) => {
  if (!userId || !caseId) {
    if (typeof onData === 'function') {
      onData(null);
    }
    return () => {};
  }
  const ref = doc(db, FirestorePaths.USER_CASE_SUBMISSION(userId, caseId));
  return onSnapshot(
    ref,
    (snapshot) => {
      if (typeof onData === 'function') {
        onData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      }
    },
    (error) => {
      console.error('[SubmissionService] Failed to subscribe to submission', error);
      if (typeof onError === 'function') {
        onError(error);
      }
    }
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

const toTimestampOrNull = (value) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (value instanceof Timestamp) {
    return value;
  }

  const { seconds, nanoseconds } = value;
  if (typeof seconds === 'number' && typeof nanoseconds === 'number') {
    try {
      return new Timestamp(seconds, nanoseconds);
    } catch (error) {
      console.warn('[SubmissionService] Failed to construct Timestamp from value', {
        error: error?.message,
      });
    }
  }

  return null;
};

const coerceSubmittedAtFromAttempts = (attempts) => {
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return null;
  }

  let latest = null;
  attempts.forEach((attempt) => {
    const coerced = toTimestampOrNull(attempt?.submittedAt);
    if (!coerced) {
      return;
    }
    if (!latest) {
      latest = coerced;
      return;
    }
    if (coerced.toMillis() > latest.toMillis()) {
      latest = coerced;
    }
  });

  return latest;
};

export const coerceSubmittedAt = (data = {}) => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const directTimestamp = toTimestampOrNull(data.submittedAt);
  if (directTimestamp) {
    return directTimestamp;
  }

  return coerceSubmittedAtFromAttempts(data.attempts);
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
  const fallbackErrorCodes = new Set(['failed-precondition', 'invalid-argument']);

  const buildEntries = (docs, { preferCoercedTimestamp = false } = {}) => {
    const filteredDocs = docs.filter((docSnap) =>
      docSnap.ref.path.includes(`/artifacts/${appId}/users/`)
    );

    if (filteredDocs.length !== docs.length) {
      console.info('[SubmissionService] Filtered submissions by app scope', {
        totalDocs: docs.length,
        filteredDocs: filteredDocs.length,
      });
    }

    const mapped = filteredDocs.map((docSnap) => {
      const data = docSnap.data() || {};
      const parent = docSnap.ref.parent?.parent;
      const coercedSubmittedAt = coerceSubmittedAt(data);
      const submittedAt = preferCoercedTimestamp
        ? coercedSubmittedAt
        : data.submittedAt ?? coercedSubmittedAt ?? null;
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
        _coercedSubmittedAt: coercedSubmittedAt,
      };
    });

    if (!preferCoercedTimestamp) {
      return mapped;
    }

    return mapped
      .filter((entry) => entry._coercedSubmittedAt)
      .sort((a, b) => {
        const aTime = a._coercedSubmittedAt.toMillis();
        const bTime = b._coercedSubmittedAt.toMillis();
        return bTime - aTime;
      });
  };

  const handleSnapshot = (snapshot, options) => {
    console.info('[SubmissionService] Snapshot received for recent submission activity', {
      totalDocs: snapshot.size,
      limitCount,
    });

    const entries = buildEntries(snapshot.docs, options)
      .slice(0, limitCount)
      .map(({ _coercedSubmittedAt, ...entry }) => entry);

    onData(entries);
  };

  let activeUnsubscribe = null;

  const subscribe = (queryRef, { preferCoercedTimestamp = false, isFallback = false } = {}) => {
    if (typeof activeUnsubscribe === 'function') {
      activeUnsubscribe();
    }

    activeUnsubscribe = onSnapshot(
      queryRef,
      (snapshot) => handleSnapshot(snapshot, { preferCoercedTimestamp }),
      (error) => {
        if (!isFallback && fallbackErrorCodes.has(error?.code)) {
          console.warn('[SubmissionService] Falling back to client-side timestamp sorting', {
            code: error?.code,
            message: error?.message,
          });
          onError?.(error);
          const fallbackQuery = query(groupRef, limitConstraint(limitCount * 5));
          subscribe(fallbackQuery, { preferCoercedTimestamp: true, isFallback: true });
          return;
        }

        console.error('[SubmissionService] Recent submission activity snapshot error', {
          code: error?.code,
          message: error?.message,
        });
        onError?.(error);
      }
    );
  };

  const primaryQuery = query(
    groupRef,
    where('submittedAt', '!=', null),
    orderBy('submittedAt', 'desc'),
    limitConstraint(limitCount * 3)
  );

  subscribe(primaryQuery);

  return () => {
    if (typeof activeUnsubscribe === 'function') {
      activeUnsubscribe();
    }
  };
};
