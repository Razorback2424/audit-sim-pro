import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  arrayUnion,
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
