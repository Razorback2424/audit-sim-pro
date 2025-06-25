const roleCache = {};

function writeSession(uid, role) {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(`role_${uid}`, role);
  }
}

export function cacheRole(uid, role) {
  roleCache[uid] = role;
  writeSession(uid, role);
}
