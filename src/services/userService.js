import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db, FirestorePaths } from '../AppCore';

export const fetchUsersWithProfiles = async () => {
  const usersCollectionRef = collection(db, FirestorePaths.USERS_COLLECTION());
  const userDocsSnapshot = await getDocs(usersCollectionRef);
  const usersData = [];
  for (const userDoc of userDocsSnapshot.docs) {
    const userId = userDoc.id;
    const profileRef = doc(db, FirestorePaths.USER_PROFILE(userId));
    const profileSnap = await getDoc(profileRef);
    if (profileSnap.exists()) {
      usersData.push({ id: userId, ...profileSnap.data() });
    } else {
      usersData.push({ id: userId, role: 'N/A (No profile data)' });
    }
  }
  return usersData;
};

export const fetchUserProfile = async (userId) => {
  const ref = doc(db, FirestorePaths.USER_PROFILE(userId));
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
};

export const setUserRole = async (userId, role) => {
  const ref = doc(db, FirestorePaths.ROLE_DOCUMENT(userId));
  await setDoc(ref, { role }, { merge: true });
};

export const upsertUserProfile = async (userId, data) => {
  const ref = doc(db, FirestorePaths.USER_PROFILE(userId));
  await setDoc(ref, data, { merge: true });
};
