import { doc, getDoc } from 'firebase/firestore';

const roleCache = {};

function readSession(uid) {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(`role_${uid}`);
}

function writeSession(uid, role) {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(`role_${uid}`, role);
  }
}

export async function getRole(db, uid) {
  if (roleCache[uid]) return roleCache[uid];
  const stored = readSession(uid);
  if (stored) {
    roleCache[uid] = stored;
    return stored;
  }
  const snap = await getDoc(doc(db, 'roles', uid));
  if (!snap.exists()) {
    throw new Error('Role not found');
  }
  const data = snap.data();
  roleCache[uid] = data.role;
  writeSession(uid, data.role);
  return data.role;
}

export function cacheRole(uid, role) {
  roleCache[uid] = role;
  writeSession(uid, role);
}
