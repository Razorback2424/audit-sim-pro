import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { cacheRole, getCachedRole } from '../services/roleService';
import { fetchUserProfile, ensureOrgIdForUser } from '../services/userService';
import { fetchUserBilling, subscribeUserBilling } from '../services/billingService';
import { db, FirestorePaths } from '../services/firebase';

const DEBUG_LOGS = process.env.REACT_APP_DEBUG_LOGS === 'true';

const normalizeRoleValue = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
};

const UserContext = createContext({
  role: null,
  loadingRole: true,
  userProfile: null,
  billing: null,
  loadingBilling: true,
});

export const UserProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const [role, setRoleState] = useState(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [userProfile, setUserProfile] = useState(null);
  const [billing, setBilling] = useState(null);
  const [loadingBilling, setLoadingBilling] = useState(true);

  useEffect(() => {
    let active = true;
    let unsubscribeBilling = null;

    const load = async () => {
      if (!currentUser || !currentUser.uid) {
        if (active) {
          setRoleState(null);
          setUserProfile(null);
          setLoadingRole(false);
          setBilling(null);
          setLoadingBilling(false);
          if (DEBUG_LOGS) {
            console.info('[UserProvider] No authenticated user; role reset.');
          }
        }
        return;
      }

      setLoadingRole(true);
      const cachedRole = normalizeRoleValue(getCachedRole(currentUser.uid));
      if (cachedRole) {
        setRoleState(cachedRole);
        if (DEBUG_LOGS) {
          console.info('[UserProvider] Using cached role for initial render', { cachedRole });
        }
      }

      let claimRole = cachedRole;
      try {
        const idTokenResult = await currentUser.getIdTokenResult(true);
        claimRole = normalizeRoleValue(idTokenResult.claims.role ?? null);
        if (DEBUG_LOGS) {
          console.info('[UserProvider] Retrieved token role', { claimRole });
        }
        if (claimRole) {
          cacheRole(currentUser.uid, claimRole);
          setRoleState(claimRole);
          setLoadingRole(false);
        }
      } catch (e) {
        if (DEBUG_LOGS) {
          console.warn('[UserProvider] Failed to refresh ID token role claim:', e);
        }
      }

      if (active && claimRole) {
        setRoleState(claimRole);
        setLoadingRole(false);
      }

      if (!claimRole && active) {
        setRoleState(null);
        setLoadingRole(false);
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
              if (DEBUG_LOGS) {
                console.warn('[UserProvider] Failed to ensure orgId for user', orgErr);
              }
            }
          }
          setUserProfile(nextProfile);
          if (DEBUG_LOGS) {
            console.info('[UserProvider] Loaded profile', {
              hasProfile: !!nextProfile,
              profileRole: nextProfile?.role ?? null,
              orgId: nextProfile?.orgId ?? null,
            });
          }
        }
      } catch (err) {
        if (DEBUG_LOGS) {
          console.error('[UserProvider] Profile fetch error:', err);
        }
        if (active) setUserProfile(null);
      }

      try {
        setLoadingBilling(true);
        const initialBilling = await fetchUserBilling({ uid: currentUser.uid });
        if (active) {
          setBilling(initialBilling);
        }
        unsubscribeBilling = subscribeUserBilling(
          { uid: currentUser.uid },
          (nextBilling) => {
            if (!active) return;
            setBilling(nextBilling);
            setLoadingBilling(false);
          },
          (error) => {
            if (!active) return;
            if (DEBUG_LOGS) {
              console.error('[UserProvider] Billing subscription error:', error);
            }
            setBilling(initialBilling || null);
            setLoadingBilling(false);
          }
        );
      } catch (err) {
        if (active) {
          if (DEBUG_LOGS) {
            console.error('[UserProvider] Billing fetch error:', err);
          }
          setBilling(null);
          setLoadingBilling(false);
        }
      }
    };

    load();

    return () => {
      active = false;
      if (unsubscribeBilling) {
        unsubscribeBilling();
      }
    };
  }, [currentUser]);

  return (
    <UserContext.Provider value={{ role, loadingRole, userProfile, billing, loadingBilling }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const ctx = useContext(UserContext);
  if (ctx === undefined) throw new Error('useUser must be used within a UserProvider');
  return ctx;
};
