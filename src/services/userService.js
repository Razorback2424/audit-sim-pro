import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
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
