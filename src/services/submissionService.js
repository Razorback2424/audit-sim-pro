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
  const attemptData = { ...data }; // `data` already contains `submittedAt: Timestamp.now()` from client.
  await setDoc(
    ref,
    {
      // This `submittedAt` is for the document itself, not the array element.
      submittedAt: serverTimestamp(), // Use serverTimestamp for the document's last update time.
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
