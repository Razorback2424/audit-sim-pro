import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import {
  getFirestore,
  serverTimestamp,
  doc,
  getDoc
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage'; // << MOVED IMPORT TO TOP
import { XCircle, Loader2 } from 'lucide-react'; // << MOVED IMPORT TO TOP
import { getRole, cacheRole } from './services/roleService';
import { fetchUserProfile, setUserRole, upsertUserProfile } from './services/userService';

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
const storage = getStorage(firebaseApp); // Initialize storage

// ---------- Firestore Paths ----------
const FirestorePaths = {
  USER_PROFILE: (userId) => `artifacts/${appId}/users/${userId}/userProfileData/profile`,
  CASES_COLLECTION: () => `artifacts/${appId}/public/data/cases`,
  CASE_DOCUMENT: (caseId) => `artifacts/${appId}/public/data/cases/${caseId}`,
  USERS_COLLECTION: () => `artifacts/${appId}/users`,
  USER_CASE_SUBMISSION: (userId, caseId) => `artifacts/${appId}/users/${userId}/caseSubmissions/${caseId}`,
  ROLE_DOCUMENT: (userId) => `roles/${userId}`,
  // Add any other paths here as needed for your project
};

// ---------- Constants ----------
const CLASSIFICATION_OPTIONS = [
  { value: '', label: 'Select Classification…', disabled: true },
  { value: "Properly Included", label: "Properly Included" },
];


// ---------- Reusable UI Components ----------
const Button = ({
  onClick,
  children,
  variant = 'primary',
  className = '',
  type = 'button',
  disabled = false,
  isLoading = false
}) => {
  const baseStyle =
    'px-4 py-2 rounded-md font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-opacity-75 transition-colors duration-150 inline-flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed';
  const variants = { // Ensure all variants used by your app (secondary, danger etc.) are defined here or passed via className
    primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
    secondary: "bg-gray-200 hover:bg-gray-300 text-gray-800 focus:ring-gray-400", // Added for completeness
  };
  return (
    <button
      type={type}
      onClick={onClick}
      className={`${baseStyle} ${variants[variant] || variants.primary} ${className}`}
      disabled={disabled || isLoading}
    >
      {isLoading && <Loader2 size={18} className="animate-spin mr-2" />}
      {children}
    </button>
  );
};

// Minimal Input component (Placeholder - replace with your styled component)
const Input = React.forwardRef(({ className, ...props }, ref) => <input ref={ref} className={`w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${className}`} {...props} />);
Input.displayName = 'Input';

// Minimal Textarea component (Placeholder - replace with your styled component)
const Textarea = React.forwardRef(({ className, ...props }, ref) => <textarea ref={ref} className={`w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${className}`} {...props} />);
Textarea.displayName = 'Textarea';

// Minimal Select component (Placeholder - replace with your styled component)
const Select = React.forwardRef(({ className, options = [], ...props }, ref) => (
    <select ref={ref} className={`w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white ${className}`} {...props}>
        {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
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
const RouterContext = createContext({ route: '', navigate: () => {} });

const RouterProvider = ({ children }) => {
    const [route, setRoute] = useState(window.location.hash.substring(1) || '/');
    useEffect(() => {
        const handleHashChange = () => setRoute(window.location.hash.substring(1) || '/');
        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);
    const navigate = useCallback((path) => { window.location.hash = path; }, []);
    return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>;
};

const useRoute = () => {
    const context = useContext(RouterContext);
    if (context === undefined) throw new Error('useRoute must be used within a RouterProvider');
    return context;
};


// ---------- Authentication Context ----------
const AuthContext = createContext(null);

let signInAsGuest = async () => {
  throw new Error('AuthProvider not mounted');
};

const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const { showModal } = useModal();

  useEffect(() => {
    setLoadingAuth(true); // Set loading true at the start of the effect

    const attemptInitialAuth = async () => {
      const tokenToUse = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : window.__initial_auth_token;

      if (tokenToUse) {
        try {
          await signInWithCustomToken(auth, tokenToUse);
        } catch (customTokenError) {
          console.error('Custom token sign-in error:', customTokenError);
          // If custom token fails we'll fall back to Firebase session restoration
        }
      }
      // If no token is provided we rely on Firebase to restore any existing session.
    };

    attemptInitialAuth(); // Call the initial auth attempt

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoadingAuth(false);
    });

    return () => unsubscribe();
  }, [showModal]);


  const logout = async () => {
    try {
      await auth.signOut();
      // onAuthStateChanged will handle setting currentUser and userProfile to null
    } catch (err) {
      console.error('Logout error:', err);
      if (showModal) showModal(`Error signing out: ${err.message} (Code: ${err.code})`, 'Error');
    }
  };

  const signInAsGuestInternal = async () => {
    try {
      setLoadingAuth(true);
      const cred = await signInAnonymously(auth);
      return cred.user;
    } catch (err) {
      console.error('Anonymous sign-in error:', err);
      if (showModal) showModal(`Failed to sign in anonymously: ${err.message} (Code: ${err.code})`, 'Authentication Error');
      setLoadingAuth(false);
      throw err;
    }
  };

  signInAsGuest = signInAsGuestInternal;

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        loadingAuth,
        userId: currentUser ? currentUser.uid : null,
        signInAsGuest,
        logout,
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
    const load = async () => {
      if (!currentUser) {
        if (active) { setRoleState(null); setUserProfile(null); setLoadingRole(false); }
        return;
      }
      setLoadingRole(true);
      try {
        // Get the latest ID token result to ensure custom claims are up-to-date
        const idTokenResult = await currentUser.getIdTokenResult(true);
        const r = idTokenResult.claims.role;
        // Cache the role locally for immediate use, though custom claims are primary source for rules
        cacheRole(currentUser.uid, r);
        if (active) setRoleState(r);
      } catch (e) {
        if (active) setRoleState(null);
      } finally {
        if (active) setLoadingRole(false);
      }
      try {
        const profile = await fetchUserProfile(currentUser.uid);
        if (active) {
          setUserProfile(profile ? { uid: currentUser.uid, ...profile } : null);
        }
      } catch (err) {
        console.error('Profile fetch error:', err);
        if (active) setUserProfile(null);
      }
    };
    load();
    return () => { active = false; };
  }, [currentUser]);

  const setRole = async (newRole, userOverride = null) => {
    const user = userOverride || currentUser;
    if (!user) {
      if (showModal) showModal('Cannot set role: not signed in.', 'Authentication Error');
      return;
    }

    try {
      // Check if the role document exists BEFORE trying to write.
      const roleRef = doc(db, FirestorePaths.ROLE_DOCUMENT(user.uid));
      const roleSnap = await getDoc(roleRef);

      // Only attempt to write to the role document if it doesn't exist,
      // or if the role is actually changing. The security rule will handle
      // the admin check for updates.
      if (!roleSnap.exists() || roleSnap.data().role !== newRole) {
        await setUserRole(user.uid, newRole); // This will be a create or an update.
      } else {
        console.log("Role document already exists with the correct role. Skipping write.");
      }

      // The rest of the logic for profile update can proceed.
      const existingProfile = await fetchUserProfile(user.uid);
      if (!existingProfile) {
        const newProfile = {
          uid: user.uid,
          email: user.email ?? `anon-${user.uid}@example.com`,
          role: newRole,
          createdAt: serverTimestamp(),
          lastUpdatedAt: serverTimestamp(),
        };
        await upsertUserProfile(user.uid, newProfile); // This is allowed by rules
        setUserProfile(newProfile);
      } else {
        const update = { role: newRole, lastUpdatedAt: serverTimestamp() };
        await upsertUserProfile(user.uid, update); // This is allowed by rules
        setUserProfile((prev) => ({ ...prev, ...update }));
      }

      // Update local state and refresh token
      setRoleState(newRole);
      cacheRole(user.uid, newRole);
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
