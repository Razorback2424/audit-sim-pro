import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
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
      const profileData = profileSnap.data();
      usersData.push({
        id: userId,
        ...profileData,
        role: profileData.role ?? null,
      });
    } else {
      usersData.push({ id: userId, role: null, profileMissing: true });
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
  const currentRoleSnap = await getDoc(ref);
  const existingRole = currentRoleSnap.exists() ? currentRoleSnap.data()?.role ?? null : null;
  if (existingRole === role) return existingRole;
  await setDoc(ref, { role }, { merge: true });
  return role;
};

export const upsertUserProfile = async (userId, data) => {
  const ref = doc(db, FirestorePaths.USER_PROFILE(userId));
  await setDoc(ref, data, { merge: true });
};

export const adminUpdateUserRole = async (userId, role) => {
  const roleRef = doc(db, FirestorePaths.ROLE_DOCUMENT(userId));
  const currentRoleSnap = await getDoc(roleRef);
  const existingRole = currentRoleSnap.exists() ? currentRoleSnap.data()?.role ?? null : null;

  if (existingRole !== role) {
    await setDoc(roleRef, { role }, { merge: true });
  }

  const profileRef = doc(db, FirestorePaths.USER_PROFILE(userId));
  await setDoc(
    profileRef,
    { role, lastUpdatedAt: serverTimestamp() },
    { merge: true }
  );
};
