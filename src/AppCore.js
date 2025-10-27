import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithCustomToken,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage'; // << MOVED IMPORT TO TOP
import { XCircle, Loader2 } from 'lucide-react'; // << MOVED IMPORT TO TOP
import { cacheRole, getCachedRole, clearRoleCache } from './services/roleService';
import { fetchUserProfile, upsertUserProfile } from './services/userService';

/* global __firebase_config, __app_id, __initial_auth_token */

// ---------- Firebase Config (env‑driven) ----------
// These are injected via your `.env` at build time:
//   REACT_APP_FIREBASE_CONFIG='{"apiKey":"…","projectId":"…"}'
//   REACT_APP_APP_ID='auditsim-pro-default-dev'
if (!window.__firebase_config) {
  window.__firebase_config = process.env.REACT_APP_FIREBASE_CONFIG ?? '{}';
}
if (!window.__app_id) {
  window.__app_id = process.env.REACT_APP_APP_ID ?? 'auditsim-pro-default-dev';
}
if (!window.__initial_auth_token) {
  window.__initial_auth_token = null;
}

// ---------- Firebase Initialization ----------
const firebaseConfigString =
  typeof __firebase_config !== 'undefined' ? __firebase_config : window.__firebase_config;
let firebaseConfig;
try {
  firebaseConfig = JSON.parse(firebaseConfigString);
  if (!firebaseConfig.apiKey || /<apiKey>/i.test(firebaseConfig.apiKey)) {
    throw new Error(
      'Missing or invalid Firebase API key. Ensure .env contains your project\'s credentials.'
    );
  }
} catch (err) {
  console.error(
    'Invalid Firebase configuration:',
    err.message || err
  );
  if (typeof document !== 'undefined') {
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.innerHTML =
        '<div style="font-family:sans-serif;padding:1rem"><h1>Configuration Error</h1><pre>' +
        String(err.message || err) +
        '</pre></div>';
    }
  }
  throw err;
}
const appId = typeof __app_id !== 'undefined' ? __app_id : window.__app_id;

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const functionsInstance = getFunctions(firebaseApp);

const resolveStorageBucketUrl = (rawBucket) => {
  if (!rawBucket || typeof rawBucket !== 'string') return null;
  const trimmed = rawBucket.trim();
  if (!trimmed) return null;
  if (/^gs:\/\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) return trimmed;
  if (/\.firebasestorage\.app$/i.test(trimmed)) {
    console.info('[storage] Normalizing firebasestorage.app name');
    return `gs://${trimmed}`;
  }
  return `gs://${trimmed}`;
};

const storageBucketRaw =
  process.env.REACT_APP_STORAGE_BUCKET_URL ??
  process.env.REACT_APP_STORAGE_BUCKET ??
  firebaseConfig.storageBucket;
const storageBucketUrl = resolveStorageBucketUrl(storageBucketRaw);

if (!storageBucketUrl && !firebaseConfig.storageBucket) {
  console.warn(
    'Firebase storage bucket not defined; falling back to default bucket binding.'
  );
}

const storage = storageBucketUrl
  ? getStorage(firebaseApp, storageBucketUrl)
  : getStorage(firebaseApp); // Explicitly bind storage to the configured bucket if available

try {
  const configuredBucket = firebaseApp?.options?.storageBucket;
  if (configuredBucket) {
    console.info('[storage] Firebase config bucket:', configuredBucket);
  }
  const boundBucket = storageBucketUrl || storage.bucket;
  console.info('[storage] Bound to bucket:', boundBucket || '(default)');
} catch (e) {
  console.warn('[storage] Unable to determine bound bucket', e);
}

// ---------- Firestore Paths ----------
const FirestorePaths = {
  USER_PROFILE: (userId) => `artifacts/${appId}/users/${userId}/userProfileData/profile`,
  CASES_COLLECTION: () => `artifacts/${appId}/public/data/cases`,
  CASE_DOCUMENT: (caseId) => `artifacts/${appId}/public/data/cases/${caseId}`,
  USERS_COLLECTION: () => `artifacts/${appId}/users`,
  USER_SUBMISSIONS_COLLECTION: (appIdValue, userId) => `artifacts/${appIdValue}/users/${userId}/caseSubmissions`,
  USER_CASE_SUBMISSION: (userId, caseId) => `artifacts/${appId}/users/${userId}/caseSubmissions/${caseId}`,
  ROLE_DOCUMENT: (userId) => `roles/${userId}`,
  STUDENT_PROGRESS_COLLECTION: (appId, uid) => `artifacts/${appId}/student_progress/${uid}/cases`,
  // Add any other paths here as needed for your project
};

const ROLE_PRIORITY = {
  trainee: 1,
  admin: 2,
};

const normalizeRoleValue = (value) => (typeof value === 'string' ? value.toLowerCase() : value);

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

// ---------- Constants ----------
const CLASSIFICATION_OPTIONS = [
  { value: '', label: 'Select Classification…', disabled: true },
  { value: 'Properly Included', label: 'Properly Included' },
  { value: 'Properly Excluded', label: 'Properly Excluded' },
  { value: 'Improperly Included', label: 'Improperly Included' },
  { value: 'Improperly Excluded', label: 'Improperly Excluded' },
];


// ---------- Reusable UI Components ----------
const Button = React.forwardRef(({
  onClick,
  children,
  variant = 'primary',
  className = '',
  type = 'button',
  disabled = false,
  isLoading = false,
  ...props
}, ref) => {
  const baseStyle =
    'px-4 py-2 rounded-md font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-opacity-75 transition-colors duration-150 inline-flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
    secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-800 focus:ring-gray-400',
    danger: 'bg-red-500 hover:bg-red-600 text-white focus:ring-red-500',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      className={`${baseStyle} ${variants[variant] || variants.primary} ${className}`}
      disabled={disabled || isLoading}
      ref={ref}
      {...props}
    >
      {isLoading && <Loader2 size={18} className="animate-spin mr-2" />}
      {children}
    </button>
  );
});
Button.displayName = 'Button';

// Minimal Input component (Placeholder - replace with your styled component)
const Input = React.forwardRef(({ className, ...props }, ref) => <input ref={ref} className={`w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${className}`} {...props} />);
Input.displayName = 'Input';

// Minimal Textarea component (Placeholder - replace with your styled component)
const Textarea = React.forwardRef(({ className, ...props }, ref) => <textarea ref={ref} className={`w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${className}`} {...props} />);
Textarea.displayName = 'Textarea';

// Minimal Select component (Placeholder - replace with your styled component)
const Select = React.forwardRef(({ className, options = [], children, ...props }, ref) => (
  <select
    ref={ref}
    className={`w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white ${className}`}
    {...props}
  >
    {options.length > 0
      ? options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))
      : children}
  </select>
));
Select.displayName = 'Select';


// ---------- Modal Context ----------
const ModalContext = createContext({
  showModal: () => {},
  hideModal: () => {}
});

const ModalProvider = ({ children }) => {
  const [modalContent, setModalContent] = useState(null);

  const showModal = useCallback((message, title = 'Notification', customActions = null) => {
    setModalContent({ title, message, customActions });
  }, []);

  const hideModal = useCallback(() => {
    setModalContent(null);
  }, []);

  return (
    <ModalContext.Provider value={{ showModal, hideModal }}>
      {children}
      {modalContent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md transform transition-all">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-800">{modalContent.title}</h3>
              <button
                onClick={hideModal}
                className="p-1 rounded-md hover:bg-gray-200 transition-colors"
              >
                <XCircle size={24} className="text-gray-600" />
              </button>
            </div>
            <div>
              {React.isValidElement(modalContent.message) ? (
                modalContent.message
              ) : (
                <p className="text-gray-700 whitespace-pre-wrap">{modalContent.message}</p>
              )}
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              {modalContent.customActions ? (
                modalContent.customActions(hideModal)
              ) : (
                <Button onClick={hideModal} variant="primary">Close</Button>
              )}
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
};

const useModal = () => useContext(ModalContext);

// ---------- Router Context (Placeholder - replace with your full implementation) ----------
const RouterContext = createContext({ route: '/', path: '/', query: {}, navigate: () => {}, setQuery: () => {} });

const ensureLeadingSlash = (path) => {
  if (!path || typeof path !== 'string') return '/';
  return path.startsWith('/') ? path : `/${path}`;
};

const parseQueryString = (searchString) => {
  const params = new URLSearchParams(searchString || '');
  const result = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

const sanitizeQueryObject = (query) => {
  const sanitized = {};
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) sanitized[key] = trimmed;
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = String(value);
      return;
    }
    if (Array.isArray(value)) {
      const joined = value
        .map((item) => (item === undefined || item === null ? '' : String(item).trim()))
        .filter(Boolean)
        .join(',');
      if (joined) sanitized[key] = joined;
      return;
    }
    const stringified = String(value).trim();
    if (stringified) sanitized[key] = stringified;
  });
  return sanitized;
};

const buildHashFromParts = (path, query) => {
  const normalizedPath = ensureLeadingSlash(path);
  const params = new URLSearchParams();
  Object.entries(sanitizeQueryObject(query)).forEach(([key, value]) => {
    params.set(key, value);
  });
  const search = params.toString();
  return `#${normalizedPath}${search ? `?${search}` : ''}`;
};

const parseHashLocation = (hashValue) => {
  const rawHash = typeof hashValue === 'string' ? hashValue : window.location.hash;
  const trimmed = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const [rawPath = '', queryString = ''] = trimmed.split('?');
  const path = ensureLeadingSlash(rawPath || '/');
  const query = parseQueryString(queryString);
  const route = `${path}${queryString ? `?${queryString}` : ''}`;
  return { path, query, route };
};

const RouterProvider = ({ children }) => {
  const [location, setLocation] = useState(() => parseHashLocation());

  useEffect(() => {
    const handleHashChange = () => setLocation(parseHashLocation());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const commitLocation = useCallback(
    ({ path, query, replace = false }) => {
      const nextHash = buildHashFromParts(path ?? location.path, query ?? location.query);
      if (replace) {
        window.history.replaceState(null, '', nextHash);
        setLocation(parseHashLocation(nextHash));
      } else if (window.location.hash === nextHash) {
        setLocation(parseHashLocation(nextHash));
      } else {
        window.location.hash = nextHash;
      }
    },
    [location.path, location.query]
  );

  const navigate = useCallback(
    (target, options = {}) => {
      const { replace = false, query: queryOverrides, preserveQuery = false } = options;
      let path = location.path;
      let query = preserveQuery ? { ...location.query } : {};

      if (typeof target === 'string') {
        const [rawPath, queryString = ''] = target.split('?');
        path = ensureLeadingSlash(rawPath || '/');
        if (queryString) {
          const parsed = parseQueryString(queryString);
          query = preserveQuery ? { ...query, ...parsed } : parsed;
        } else if (!preserveQuery) {
          query = {};
        }
      }

      if (queryOverrides && typeof queryOverrides === 'object') {
        query = { ...query, ...queryOverrides };
      }

      commitLocation({ path, query, replace });
    },
    [commitLocation, location.path, location.query]
  );

  const setQuery = useCallback(
    (updates, { replace = false, merge = true, path } = {}) => {
      const baseQuery = merge ? { ...location.query } : {};
      const nextQuery = typeof updates === 'function' ? updates(baseQuery) : { ...baseQuery, ...updates };
      commitLocation({ path: ensureLeadingSlash(path ?? location.path), query: nextQuery, replace });
    },
    [commitLocation, location.path, location.query]
  );

  return (
    <RouterContext.Provider value={{ route: location.route, path: location.path, query: location.query, navigate, setQuery }}>
      {children}
    </RouterContext.Provider>
  );
};

const useRoute = () => {
  const context = useContext(RouterContext);
  if (context === undefined) throw new Error('useRoute must be used within a RouterProvider');
  return context;
};


// ---------- Authentication Context ----------
const AuthContext = createContext(null);

// Guest sign-in is disabled to ensure a stable UID across sessions.
let signInAsGuest = async () => {
  throw new Error('Guest sign-in is disabled. Please log in with email/password.');
};

const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const { showModal } = useModal();

  useEffect(() => {
    setLoadingAuth(true); // Set loading true at the start of the effect

    const attemptInitialAuth = async () => {
      // Ensure session persistence is LOCAL so the same UID is reused across reloads
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (e) {
        console.warn('[AuthProvider] Failed to set auth persistence (will fall back to default):', e);
      }
      const tokenToUse = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : window.__initial_auth_token;

      if (tokenToUse) {
        try {
          await signInWithCustomToken(auth, tokenToUse);
        } catch (customTokenError) {
          console.error('[AuthProvider] Custom token sign-in error:', customTokenError);
          // If custom token fails we'll fall back to Firebase session restoration
        }
      }
      // If no token is provided we rely on Firebase to restore any existing session.
    };

    attemptInitialAuth(); // Call the initial auth attempt

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.info('[AuthProvider] onAuthStateChanged', {
        uid: user?.uid ?? null,
        isAnonymous: user?.isAnonymous ?? null,
      });
      // If a legacy anonymous session is restored, clear it so we require real login
      if (user && user.isAnonymous) {
        try { signOut(auth); } catch {}
        setCurrentUser(null);
        setLoadingAuth(false);
        return;
      }
      setCurrentUser(user);
      setLoadingAuth(false);
      console.info('[AuthProvider] auth state resolved', { loadingAuth: false, uid: user?.uid ?? null });
      clearRoleCache(user?.uid);
    });

    return () => unsubscribe();
  }, [showModal]);


  const logout = async () => {
    try {
      await signOut(auth);
      // onAuthStateChanged will handle setting currentUser and userProfile to null
    } catch (err) {
      console.error('Logout error:', err);
      if (showModal) showModal(`Error signing out: ${err.message} (Code: ${err.code})`, 'Error');
    }
  };


  const login = async (email, password) => {
    try {
      await setPersistence(auth, browserLocalPersistence);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return cred.user;
    } catch (err) {
      console.error('Email/password sign-in error:', err);
      if (showModal) showModal(`Failed to sign in: ${err.message} (Code: ${err.code})`, 'Authentication Error');
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        loadingAuth,
        userId: currentUser ? currentUser.uid : null,
        login,
        logout,
        signInAsGuest,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};

// ---------- User Context ----------
const UserContext = createContext({ role: null, loadingRole: true, userProfile: null, setRole: () => {} });

const UserProvider = ({ children }) => {
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
      const cachedRole = getCachedRole(currentUser.uid);
      if (cachedRole) {
        setRoleState(cachedRole);
        console.info('[UserProvider] Using cached role for initial render', { cachedRole });
      }

      let claimRole = cachedRole;

      try {
        const idTokenResult = await currentUser.getIdTokenResult(true);
        claimRole = idTokenResult.claims.role ?? null;
        console.info('[UserProvider] Retrieved token role', { claimRole });
        if (claimRole) {
          cacheRole(currentUser.uid, claimRole);
        }
      } catch (e) {
        console.warn('[UserProvider] Failed to refresh ID token role claim:', e);
      }

      try {
        const roleRef = doc(db, FirestorePaths.ROLE_DOCUMENT(currentUser.uid));
        unsubscribeRole = onSnapshot(
          roleRef,
          (snapshot) => {
            if (!active) return;
            const docRole = snapshot.exists() ? snapshot.data()?.role ?? null : null;
            const nextRole = docRole ?? claimRole ?? null;
            const normalizedRole = typeof nextRole === 'string' ? nextRole.toLowerCase() : nextRole;
            console.info('[UserProvider] Role snapshot update', { docRole, claimRole, normalizedRole });
            setRoleState(normalizedRole);
            if (normalizedRole) cacheRole(currentUser.uid, normalizedRole);
            setLoadingRole(false);
          },
          (error) => {
            if (!active) return;
            console.error('[UserProvider] Role snapshot error:', error);
            const fallbackRole = claimRole ?? null;
            const normalizedRole = typeof fallbackRole === 'string' ? fallbackRole.toLowerCase() : fallbackRole;
            setRoleState(normalizedRole);
            if (normalizedRole) cacheRole(currentUser.uid, normalizedRole);
            setLoadingRole(false);
            console.info('[UserProvider] Role snapshot error fallback', { claimRole, normalizedRole });
          }
        );
      } catch (err) {
        if (active) {
          console.error('[UserProvider] Failed to subscribe to role document:', err);
          const fallbackRole = claimRole ?? null;
          const normalizedRole = typeof fallbackRole === 'string' ? fallbackRole.toLowerCase() : fallbackRole;
          setRoleState(normalizedRole);
          if (normalizedRole) cacheRole(currentUser.uid, normalizedRole);
          setLoadingRole(false);
          console.info('[UserProvider] Subscribe failure fallback', { claimRole, normalizedRole });
        }
      }

      try {
        const profile = await fetchUserProfile(currentUser.uid);
        if (active) {
          setUserProfile(profile ? { uid: currentUser.uid, ...profile } : null);
          console.info('[UserProvider] Loaded profile', { hasProfile: !!profile, profileRole: profile?.role ?? null });
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
  // --- Ensure Storage rules can see the role in roles/{uid} (self-healing) ---
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

  // --- Also mirror from in-memory role (custom claim) in case profile hasn't loaded ---
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
    const normalizedRole = typeof newRole === 'string' ? newRole.toLowerCase() : newRole;
    const user = userOverride || currentUser;
    if (!user) {
      if (showModal) showModal('Cannot set role: not signed in.', 'Authentication Error');
      return;
    }

    try {
      // Check if the role document exists BEFORE trying to write.
      const roleRef = doc(db, FirestorePaths.ROLE_DOCUMENT(user.uid));
      const roleSnap = await getDoc(roleRef);

        const existingRole = roleSnap.exists() ? roleSnap.data()?.role ?? null : null;

      if (shouldUpdateRoleDoc(existingRole, normalizedRole)) {
        await setDoc(roleRef, { role: normalizedRole }, { merge: true });
        console.info('[UserProvider] Role document updated', { uid: user.uid, normalizedRole });
      } else {
        console.info('[UserProvider] Role document already up-to-date', { uid: user.uid, existingRole, normalizedRole });
      }

      // The rest of the logic for profile update can proceed.
      const existingProfile = await fetchUserProfile(user.uid);
      if (!existingProfile) {
        const newProfile = {
          uid: user.uid,
          email: user.email ?? `anon-${user.uid}@example.com`,
          role: normalizedRole,
          createdAt: serverTimestamp(),
          lastUpdatedAt: serverTimestamp(),
        };
        await upsertUserProfile(user.uid, newProfile); // This is allowed by rules
        setUserProfile(newProfile);
      } else {
        const update = { role: normalizedRole, lastUpdatedAt: serverTimestamp() };
        await upsertUserProfile(user.uid, update); // This is allowed by rules
        setUserProfile((prev) => ({ ...prev, ...update }));
      }

      // Update local state and refresh token
      setRoleState(normalizedRole);
      cacheRole(user.uid, normalizedRole);
      await user.getIdToken(true); // Force refresh to get latest custom claims
      console.log("ID token refreshed after role set.");
    } catch (err) {
      console.error('setRole error:', err);
      if (err.code === 'permission-denied') {
        if (showModal) showModal('You do not have permission to change your role once it has been set. Please contact an administrator.', 'Permission Denied');
      } else {
        if (showModal) showModal(`Error setting role: ${err.message} (Code: ${err.code})`, 'Error Setting Role');
      }
    }
  };

  return (
    <UserContext.Provider value={{ role, loadingRole, userProfile, setRole }}>
      {children}
    </UserContext.Provider>
  );
};

const useUser = () => {
  const ctx = useContext(UserContext);
  if (ctx === undefined) throw new Error('useUser must be used within a UserProvider');
  return ctx;
};

// ---------- Exports ----------
export {
  // Firebase services and core variables
  firebaseApp,
  auth,
  db,
  functionsInstance as functions,
  storage,
  appId,
  FirestorePaths,
  CLASSIFICATION_OPTIONS,

  // Modal related
  ModalProvider,
  useModal,

  // Auth related
  AuthProvider,
  useAuth,
  signInAsGuest,

  // User related
  UserProvider,
  useUser,

  // UI Components
  Button,
  Input,
  Textarea,
  Select,

  // Router related
  RouterProvider,
  useRoute,
};
