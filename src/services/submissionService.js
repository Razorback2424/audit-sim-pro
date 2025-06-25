import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore';
import { db, FirestorePaths } from '../AppCore';

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
