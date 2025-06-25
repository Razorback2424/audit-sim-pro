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

export async function getRole(uid) { // Removed 'db' parameter as it's no longer needed for direct Firestore read
  if (roleCache[uid]) return roleCache[uid];
  const stored = readSession(uid);
  if (stored) {
    roleCache[uid] = stored;
    return stored;
  }
  return null; // If not in cache/session, return null. The UserProvider will get it from custom claims.
}

export function cacheRole(uid, role) {
  roleCache[uid] = role;
  writeSession(uid, role);
}
