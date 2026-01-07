/* global __initial_auth_token */
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from '../services/firebase';
import { useModal } from './ModalContext';
import { clearRoleCache } from '../services/roleService';

const AuthContext = createContext(null);
const LOGIN_TIMEOUT_MS = 15000;

const isAuthDebugEnabled = () => {
  if (process.env.NODE_ENV === 'test') return false;
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem('debugAuth') === '1';
  } catch {
    return false;
  }
};

const authDebug = (message, meta) => {
  if (!isAuthDebugEnabled()) return;
  const payload = meta && typeof meta === 'object' ? meta : undefined;
  // Keep this as console.info so it can be filtered easily.
  console.info(`[AuthDebug] ${message}`, payload || '');
};

const withTimeout = (promise, timeoutMs, timeoutError) =>
  new Promise((resolve, reject) => {
    let didFinish = false;
    const timeoutId = setTimeout(() => {
      if (didFinish) return;
      didFinish = true;
      reject(timeoutError);
    }, timeoutMs);

    promise
      .then((value) => {
        if (didFinish) return;
        didFinish = true;
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((err) => {
        if (didFinish) return;
        didFinish = true;
        clearTimeout(timeoutId);
        reject(err);
      });
  });

// Guest sign-in is disabled to ensure a stable UID across sessions.
export let signInAsGuest = async () => {
  throw new Error('Guest sign-in is disabled. Please log in with email/password.');
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const { showModal } = useModal();

  useEffect(() => {
    setLoadingAuth(true);

    const attemptInitialAuth = async () => {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (e) {
        console.warn(
          '[AuthProvider] Failed to set auth persistence (will fall back to default):',
          e
        );
      }
      const tokenToUse =
        typeof __initial_auth_token !== 'undefined'
          ? __initial_auth_token
          : window.__initial_auth_token;

      if (tokenToUse) {
        try {
          await signInWithCustomToken(auth, tokenToUse);
        } catch (customTokenError) {
          console.error('[AuthProvider] Custom token sign-in error:', customTokenError);
        }
      }
    };

    attemptInitialAuth();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      authDebug('onAuthStateChanged fired', {
        uid: user?.uid ?? null,
        isAnonymous: user?.isAnonymous ?? null,
        providerIds: Array.isArray(user?.providerData) ? user.providerData.map((p) => p?.providerId).filter(Boolean) : [],
      });
      console.info('[AuthProvider] onAuthStateChanged', {
        uid: user?.uid ?? null,
        isAnonymous: user?.isAnonymous ?? null,
      });
      if (user && user.isAnonymous) {
        try {
          signOut(auth);
        } catch (err) {
          console.warn('[AuthProvider] Failed to sign out anonymous session', err);
        }
        setCurrentUser(null);
        setLoadingAuth(false);
        return;
      }
      setCurrentUser(user);
      setLoadingAuth(false);
      console.info('[AuthProvider] auth state resolved', {
        loadingAuth: false,
        uid: user?.uid ?? null,
      });
      clearRoleCache(user?.uid);
    });

    return () => unsubscribe();
  }, [showModal]);

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout error:', err);
      if (showModal) {
        showModal(`Error signing out: ${err.message} (Code: ${err.code})`, 'Error');
      }
    }
  };

  const login = async (email, password) => {
    try {
      authDebug('login() called', { email: (email || '').trim() });
      await setPersistence(auth, browserLocalPersistence);
      authDebug('setPersistence resolved', {});
      console.info('[AuthProvider] Starting email/password sign-in', { email: (email || '').trim() });
      const cred = await withTimeout(
        signInWithEmailAndPassword(auth, email, password),
        LOGIN_TIMEOUT_MS,
        Object.assign(new Error('Sign-in timed out. Please check your connection and try again.'), {
          code: 'auth/timeout',
        })
      );
      authDebug('signInWithEmailAndPassword resolved', { uid: cred?.user?.uid ?? null });
      console.info('[AuthProvider] Email/password sign-in resolved', { uid: cred?.user?.uid ?? null });
      return cred.user;
    } catch (err) {
      authDebug('login() failed', { code: err?.code ?? null, message: err?.message ?? String(err) });
      console.error('Email/password sign-in error:', err);
      if (showModal) {
        showModal(`Failed to sign in: ${err.message} (Code: ${err.code})`, 'Authentication Error');
      }
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

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
