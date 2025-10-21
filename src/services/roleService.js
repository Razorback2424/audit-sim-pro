const roleCache = {};

function writeSession(uid, role) {
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(`role_${uid}`, role);
    } catch (err) {
      console.warn('[roleCache] sessionStorage.setItem failed', err);
    }
  }
}

export function cacheRole(uid, role) {
  if (!uid) return;
  roleCache[uid] = role;
  writeSession(uid, role);
}

export function getCachedRole(uid) {
  if (!uid) return null;
  if (roleCache[uid]) return roleCache[uid];

  if (typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(`role_${uid}`);
      if (stored) {
        roleCache[uid] = stored;
        return stored;
      }
    } catch (err) {
      console.warn('[roleCache] sessionStorage.getItem failed', err);
      return null;
    }
  }

  return null;
}

export function clearRoleCache(uid) {
  if (!uid) return;
  delete roleCache[uid];
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(`role_${uid}`);
    } catch (err) {
      console.warn('[roleCache] sessionStorage.removeItem failed', err);
    }
  }
}
