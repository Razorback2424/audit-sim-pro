import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db, FirestorePaths } from '../AppCore';

export const saveSubmission = async (userId, caseId, data) => {
  const ref = doc(db, FirestorePaths.USER_CASE_SUBMISSION(userId, caseId));
  await setDoc(ref, data, { merge: true });
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
