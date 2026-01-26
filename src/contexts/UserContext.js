import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { useAuth } from './AuthContext';
import { useModal } from './ModalContext';
import { cacheRole, getCachedRole } from '../services/roleService';
import { fetchUserProfile, upsertUserProfile, ensureOrgIdForUser } from '../services/userService';
import { db, FirestorePaths } from '../services/firebase';

const ROLE_PRIORITY = {
  trainee: 1,
  instructor: 2,
  admin: 3,
  owner: 4,
};

const normalizeRoleValue = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
};

const shouldUpdateRoleDoc = (existingRole, incomingRole) => {
  const normalizedExisting = normalizeRoleValue(existingRole);
  const normalizedIncoming = normalizeRoleValue(incomingRole);
  if (!normalizedIncoming) return false;
  if (!normalizedExisting) return true;
  if (normalizedExisting === normalizedIncoming) return false;
  const existingRank = ROLE_PRIORITY[normalizedExisting] ?? 0;
  const incomingRank = ROLE_PRIORITY[normalizedIncoming] ?? 0;
  return incomingRank >= existingRank;
};

const UserContext = createContext({
  role: null,
  loadingRole: true,
  userProfile: null,
  setRole: () => {},
});

export const UserProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const { showModal } = useModal();
  const [role, setRoleState] = useState(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => {
    let active = true;
    let unsubscribeRole = null;

    const load = async () => {
      if (!currentUser || !currentUser.uid) {
        if (active) {
          setRoleState(null);
          setUserProfile(null);
          setLoadingRole(false);
          console.info('[UserProvider] No authenticated user; role reset.');
        }
        return;
      }

      setLoadingRole(true);
      const cachedRole = normalizeRoleValue(getCachedRole(currentUser.uid));
      if (cachedRole) {
        setRoleState(cachedRole);
        console.info('[UserProvider] Using cached role for initial render', { cachedRole });
      }

      let claimRole = cachedRole;
      let roleFromDoc = null;

      try {
        const idTokenResult = await currentUser.getIdTokenResult(true);
        claimRole = normalizeRoleValue(idTokenResult.claims.role ?? null);
        console.info('[UserProvider] Retrieved token role', { claimRole });
        if (claimRole) {
          cacheRole(currentUser.uid, claimRole);
        }
      } catch (e) {
        console.warn('[UserProvider] Failed to refresh ID token role claim:', e);
      }

      try {
        const roleRef = doc(db, FirestorePaths.ROLE_DOCUMENT(currentUser.uid));

        try {
          const roleSnap = await getDoc(roleRef);
          roleFromDoc = roleSnap.exists() ? normalizeRoleValue(roleSnap.data()?.role ?? null) : null;
          if (roleFromDoc) {
            setRoleState(roleFromDoc);
            cacheRole(currentUser.uid, roleFromDoc);
          }
        } catch (err) {
          console.warn('[UserProvider] Failed to fetch role document:', err);
        }

        unsubscribeRole = onSnapshot(
          roleRef,
          (snapshot) => {
            if (!active) return;
            const docRole = snapshot.exists() ? normalizeRoleValue(snapshot.data()?.role ?? null) : null;
            roleFromDoc = docRole ?? roleFromDoc;
            const nextRole = docRole ?? claimRole ?? null;
            const normalizedRole = normalizeRoleValue(nextRole);
            console.info('[UserProvider] Role snapshot update', {
              docRole,
              claimRole,
              normalizedRole,
            });
            setRoleState(normalizedRole);
            if (normalizedRole) cacheRole(currentUser.uid, normalizedRole);
            setLoadingRole(false);
          },
          (error) => {
            if (!active) return;
            console.error('[UserProvider] Role snapshot error:', error);
            const fallbackRole = roleFromDoc ?? claimRole ?? cachedRole ?? null;
            const normalizedRole = normalizeRoleValue(fallbackRole);
            setRoleState(normalizedRole);
            if (normalizedRole) cacheRole(currentUser.uid, normalizedRole);
            setLoadingRole(false);
            console.info('[UserProvider] Role snapshot error fallback', {
              claimRole,
              normalizedRole,
            });
          }
        );
      } catch (err) {
        if (active) {
          console.error('[UserProvider] Failed to subscribe to role document:', err);
          const fallbackRole = roleFromDoc ?? claimRole ?? cachedRole ?? null;
          const normalizedRole = normalizeRoleValue(fallbackRole);
          setRoleState(normalizedRole);
          if (normalizedRole) cacheRole(currentUser.uid, normalizedRole);
          setLoadingRole(false);
          console.info('[UserProvider] Subscribe failure fallback', { claimRole, normalizedRole });
        }
      }

      try {
        const profile = await fetchUserProfile(currentUser.uid);
        if (active) {
          let nextProfile = profile ? { uid: currentUser.uid, ...profile } : null;
          if (nextProfile && !nextProfile.orgId) {
            try {
              const resolvedOrgId = await ensureOrgIdForUser(currentUser.uid, {
                role: nextProfile?.role ?? claimRole ?? null,
              });
              nextProfile = { ...nextProfile, orgId: resolvedOrgId };
            } catch (orgErr) {
              console.warn('[UserProvider] Failed to ensure orgId for user', orgErr);
            }
          }
          setUserProfile(nextProfile);
          console.info('[UserProvider] Loaded profile', {
            hasProfile: !!nextProfile,
            profileRole: nextProfile?.role ?? null,
            orgId: nextProfile?.orgId ?? null,
          });
          // Fall back to profile role if we still don't have a resolved role from claims/doc.
          setRoleState((prev) => {
            if (prev) return prev;
            const profileRole = normalizeRoleValue(nextProfile?.role ?? null);
            if (profileRole) {
              cacheRole(currentUser.uid, profileRole);
              return profileRole;
            }
            return prev;
          });
        }
      } catch (err) {
        console.error('[UserProvider] Profile fetch error:', err);
        if (active) setUserProfile(null);
      }
    };

    load();

    return () => {
      active = false;
      if (unsubscribeRole) {
        unsubscribeRole();
      }
    };
  }, [currentUser]);

  const profileRole = userProfile?.role;

  useEffect(() => {
    let cancelled = false;

    const mirrorProfileRole = async () => {
      if (!currentUser || !currentUser.uid || !profileRole) return;

      try {
        const roleRef = doc(db, 'roles', currentUser.uid);
        const roleSnap = await getDoc(roleRef);
        if (cancelled) return;

        const existingRole = roleSnap.exists() ? roleSnap.data()?.role ?? null : null;
        if (shouldUpdateRoleDoc(existingRole, profileRole)) {
          await setDoc(roleRef, { role: profileRole }, { merge: true });
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('Mirror role to roles/{uid} skipped:', e);
        }
      }
    };

    mirrorProfileRole();

    return () => {
      cancelled = true;
    };
  }, [currentUser, profileRole]);

  useEffect(() => {
    let cancelled = false;

    const mirrorRoleState = async () => {
      if (!currentUser || !currentUser.uid || !role) return;

      try {
        const roleRef = doc(db, 'roles', currentUser.uid);
        const roleSnap = await getDoc(roleRef);
        if (cancelled) return;

        const existingRole = roleSnap.exists() ? roleSnap.data()?.role ?? null : null;
        if (shouldUpdateRoleDoc(existingRole, role)) {
          await setDoc(roleRef, { role }, { merge: true });
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('Mirror role (from state) effect error:', e);
        }
      }
    };

    mirrorRoleState();

    return () => {
      cancelled = true;
    };
  }, [currentUser, role]);

  const setRole = async (newRole, userOverride = null) => {
    const normalizedRole = normalizeRoleValue(newRole);
    const user = userOverride || currentUser;
    if (!user) {
      if (showModal) showModal('Cannot set role: not signed in.', 'Authentication Error');
      return;
    }

    try {
      const roleRef = doc(db, FirestorePaths.ROLE_DOCUMENT(user.uid));
      const roleSnap = await getDoc(roleRef);
      const existingRole = roleSnap.exists() ? roleSnap.data()?.role ?? null : null;

      if (shouldUpdateRoleDoc(existingRole, normalizedRole)) {
        await setDoc(roleRef, { role: normalizedRole }, { merge: true });
        console.info('[UserProvider] Role document updated', { uid: user.uid, normalizedRole });
      } else {
        console.info('[UserProvider] Role document already up-to-date', {
          uid: user.uid,
          existingRole,
          normalizedRole,
        });
      }

      const existingProfile = await fetchUserProfile(user.uid);
      if (!existingProfile) {
        const newProfile = {
          uid: user.uid,
          email: user.email ?? `anon-${user.uid}@example.com`,
          role: normalizedRole,
          createdAt: serverTimestamp(),
          lastUpdatedAt: serverTimestamp(),
        };
        await upsertUserProfile(user.uid, newProfile);
        setUserProfile(newProfile);
      } else {
        const update = { role: normalizedRole, lastUpdatedAt: serverTimestamp() };
        await upsertUserProfile(user.uid, update);
        setUserProfile((prev) => ({ ...prev, ...update }));
      }

      setRoleState(normalizedRole);
      cacheRole(user.uid, normalizedRole);
      await user.getIdToken(true);
      console.log('ID token refreshed after role set.');
    } catch (err) {
      console.error('setRole error:', err);
      if (err.code === 'permission-denied') {
        if (showModal) {
          showModal(
            'You do not have permission to change your role once it has been set. Please contact an administrator.',
            'Permission Denied'
          );
        }
      } else if (showModal) {
        showModal(`Error setting role: ${err.message} (Code: ${err.code})`, 'Error Setting Role');
      }
    }
  };

  return (
    <UserContext.Provider value={{ role, loadingRole, userProfile, setRole }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const ctx = useContext(UserContext);
  if (ctx === undefined) throw new Error('useUser must be used within a UserProvider');
  return ctx;
};
