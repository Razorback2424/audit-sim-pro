import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, FirestorePaths, functions, appId } from '../AppCore';

const isPermissionError = (error) => {
  const code = error?.code || error?.message;
  if (!code) return false;
  return (
    String(code).includes('permission-denied') ||
    String(code).includes('Missing or insufficient permissions')
  );
};

const mapUserRecord = (userId, userDocData = {}, profileData = {}, profileExists = false) => {
  const rawDisplayName = [
    profileData?.displayName,
    userDocData?.displayName,
    profileData?.fullName,
    userDocData?.fullName,
  ].find((value) => typeof value === 'string' && value.trim());
  const normalizedDisplayName = rawDisplayName ? rawDisplayName.trim() : null;
  const rawEmail = [
    profileData?.email,
    userDocData?.email,
    profileData?.emailAddress,
    userDocData?.emailAddress,
  ].find((value) => typeof value === 'string' && value.trim());
  const normalizedEmail = rawEmail ? rawEmail.trim() : null;
  const displayLabel = normalizedDisplayName || normalizedEmail || userId;

  return {
    id: userId,
    ...userDocData,
    ...profileData,
    role: profileData?.role ?? userDocData?.role ?? null,
    displayName: normalizedDisplayName ?? profileData?.displayName ?? null,
    email: normalizedEmail ?? profileData?.email ?? null,
    displayLabel,
    profileMissing: profileExists ? false : true,
  };
};

const fetchUsersFromFirestore = async () => {
  const usersCollectionRef = collection(db, FirestorePaths.USERS_COLLECTION());
  const userDocsSnapshot = await getDocs(usersCollectionRef);
  const usersData = [];
  for (const userDoc of userDocsSnapshot.docs) {
    const userId = userDoc.id;
    const userDocData = userDoc.data() || {};
    const profileRef = doc(db, FirestorePaths.USER_PROFILE(userId));
    const profileSnap = await getDoc(profileRef);
    const profileExists = profileSnap.exists();
    const profileData = profileExists ? profileSnap.data() || {} : {};
    usersData.push(mapUserRecord(userId, userDocData, profileData, profileExists));
  }
  return usersData;
};

const fetchUsersViaCallable = async () => {
  if (!functions) {
    throw new Error('Firebase functions instance is not initialized.');
  }
  const callable = httpsCallable(functions, 'listRosterOptions');
  const response = await callable({ appId });
  const roster = Array.isArray(response?.data?.roster) ? response.data.roster : [];
  return roster.map((entry) =>
    mapUserRecord(
      entry.id,
      { role: entry.role ?? null, displayName: entry.displayName ?? null, email: entry.email ?? null },
      {},
      true
    )
  );
};

export const fetchUsersWithProfiles = async () => {
  try {
    return await fetchUsersFromFirestore();
  } catch (error) {
    if (!isPermissionError(error)) {
      throw error;
    }
    console.warn('[userService] Direct roster fetch denied, falling back to callable.', error);
    return await fetchUsersViaCallable();
  }
};

export const fetchUserRosterOptions = async () => {
  const users = await fetchUsersWithProfiles();
  return users.map((user) => ({
    id: user.id,
    label: user.displayLabel || user.displayName || user.email || user.id,
    displayName: user.displayName ?? null,
    email: user.email ?? null,
  }));
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
