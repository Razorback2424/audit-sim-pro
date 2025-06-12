import { doc, getDoc } from 'firebase/firestore';

const roleCache = {};

export async function getRole(db, uid) {
  if (roleCache[uid]) return roleCache[uid];
  const snap = await getDoc(doc(db, 'roles', uid));
  if (!snap.exists()) {
    throw new Error('Role not found');
  }
  const data = snap.data();
  roleCache[uid] = data.role;
  return data.role;
}
