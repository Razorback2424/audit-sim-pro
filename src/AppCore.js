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
  doc,
  setDoc,
  getDoc,
  Timestamp
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage'; // << MOVED IMPORT TO TOP
import { XCircle, Loader2 } from 'lucide-react';
import { getRole } from './services/roleService';

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
const firebaseConfig = JSON.parse(firebaseConfigString);
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

const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const { showModal } = useModal(); // Ensure useModal is available

  useEffect(() => {
    setLoadingAuth(true); // Set loading true at the start of the effect

    const attemptInitialAuth = async () => {
      const tokenToUse = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : window.__initial_auth_token;
      let signedIn = false;

      if (tokenToUse) {
        try {
          await signInWithCustomToken(auth, tokenToUse);
          signedIn = true; // onAuthStateChanged will pick this up
        } catch (customTokenError) {
          console.error('Custom token sign-in error:', customTokenError);
          // Will fall through to anonymous sign-in if custom token fails
        }
      }

      // If not signed in via custom token (either no token or it failed)
      // and if there isn't already a current user (e.g. from a previous session restored by Firebase)
      if (!signedIn && !auth.currentUser) {
        try {
          await signInAnonymously(auth);
          // onAuthStateChanged will pick this up
        } catch (anonError) {
          console.error('Failed to sign in anonymously during initial attempt:', anonError);
          if (showModal) showModal(`Failed to authenticate: ${anonError.message}. Please try refreshing.`, "Authentication Error");
          setLoadingAuth(false); // Explicitly set loading to false if all auth attempts fail
        }
      } else if (auth.currentUser) {
          // If there's already a currentUser (e.g. session restored),
          // onAuthStateChanged will fire for them. We don't need to do another sign-in.
          // setLoadingAuth(false) will be handled by onAuthStateChanged
      }
    };

    attemptInitialAuth(); // Call the initial auth attempt

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        // --- START OF DIAGNOSTIC LOGGING ---
        console.log('----------------------------------------------------');
        console.log('[AUTH STATE CHANGED - USER EXISTS]');
        if (db && db.app && db.app.options) {
          console.log('Firebase App Project ID (from client config):', db.app.options.projectId);
        } else {
          console.error('Firestore `db` object or its config is not available for logging projectId.');
        }
        if (auth && auth.currentUser) {
          console.log('Auth Service currentUser object:', auth.currentUser);
        } else {
          console.log('Auth Service currentUser object is null/undefined at this point.');
        }
        console.log('onAuthStateChanged user.uid:', user.uid);
        console.log('onAuthStateChanged user.email:', user.email);
        console.log('onAuthStateChanged user.isAnonymous:', user.isAnonymous);
        const S_appId = typeof __app_id !== 'undefined' ? __app_id : window.__app_id;
        console.log('Client-side App ID variable (__app_id):', S_appId);
        let profilePath = "ERROR: FirestorePaths.USER_PROFILE is not defined or user.uid is missing";
        if (FirestorePaths && typeof FirestorePaths.USER_PROFILE === 'function' && user.uid) {
          profilePath = FirestorePaths.USER_PROFILE(user.uid);
        } else if (user.uid && S_appId) {
          profilePath = `artifacts/${S_appId}/users/${user.uid}/userProfileData/profile`;
        }
        console.log('Constructed Firestore Path for getDoc:', profilePath);
        console.log('----------------------------------------------------');
        // --- END OF DIAGNOSTIC LOGGING ---

        const ref = doc(db, profilePath);
        try {
          const snap = await getDoc(ref);
          if (snap.exists()) {
            setUserProfile({ uid: user.uid, ...snap.data() });
          } else {
            setUserProfile(null);
            console.log(`User profile for ${user.uid} does not exist yet (snap.exists() is false). This is NOT a permission error.`);
          }
        } catch (err) {
          console.error(`Fetching profile failed for UID ${user.uid} (raw error object):`, err);
          console.error('Error Code:', err.code);
          console.error('Error Name:', err.name);
          console.error('Error Message:', err.message);
          setUserProfile(null);
          if (showModal) showModal(`Error fetching your profile for UID ${user.uid}: ${err.message} (Code: ${err.code})`, 'Profile Error');
        }
      } else {
        setUserProfile(null);
      }
      setLoadingAuth(false); // Set loading to false after auth state is processed
    });

    return () => unsubscribe();
  }, [showModal]);

  const setRole = async (role) => {
    if (!currentUser) {
      if (showModal) showModal('Cannot set role: not signed in.', 'Authentication Error');
      return;
    }
    const ref = doc(db, FirestorePaths.USER_PROFILE(currentUser.uid));
    try {
      const snap = await getDoc(ref); // Check if profile exists before deciding to create or update
      if (!snap.exists()) {
        const newProfile = {
          uid: currentUser.uid,
          email: currentUser.email ?? `anon-${currentUser.uid}@example.com`, // Fallback for anonymous
          role,
          createdAt: Timestamp.now(),
          lastUpdatedAt: Timestamp.now()
        };
        await setDoc(ref, newProfile);
        setUserProfile(newProfile);
      } else {
        const update = { role, lastUpdatedAt: Timestamp.now() };
        await setDoc(ref, update, { merge: true });
        setUserProfile((prev) => ({ ...prev, ...update }));
      }
    } catch (err) {
      console.error('setRole error:', err);
      if (showModal) showModal(`Error setting role: ${err.message} (Code: ${err.code})`, 'Error Setting Role');
    }
  };

  const logout = async () => {
    try {
      await auth.signOut();
      // onAuthStateChanged will handle setting currentUser and userProfile to null
    } catch (err) {
      console.error('Logout error:', err);
      if (showModal) showModal(`Error signing out: ${err.message} (Code: ${err.code})`, 'Error');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        loadingAuth,
        userId: currentUser ? currentUser.uid : null,
        setRole,
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
const UserContext = createContext({ role: null, loadingRole: true });

const UserProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const [role, setRole] = useState(null);
  const [loadingRole, setLoadingRole] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!currentUser) {
        if (active) { setRole(null); setLoadingRole(false); }
        return;
      }
      setLoadingRole(true);
      try {
        const r = await getRole(db, currentUser.uid);
        if (active) setRole(r);
      } catch (e) {
        if (active) setRole(null);
      } finally {
        if (active) setLoadingRole(false);
      }
    };
    load();
    return () => { active = false; };
  }, [currentUser]);

  return (
    <UserContext.Provider value={{ role, loadingRole }}>
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
