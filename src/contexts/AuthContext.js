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
      await setPersistence(auth, browserLocalPersistence);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return cred.user;
    } catch (err) {
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
