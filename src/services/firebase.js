import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

/* global __firebase_config, __app_id */

if (!window.__firebase_config) {
  window.__firebase_config = process.env.REACT_APP_FIREBASE_CONFIG ?? '{}';
}
if (!window.__app_id) {
  window.__app_id = process.env.REACT_APP_APP_ID ?? 'auditsim-pro-default-dev';
}
if (!window.__initial_auth_token) {
  window.__initial_auth_token = null;
}

const firebaseConfigString =
  typeof __firebase_config !== 'undefined' ? __firebase_config : window.__firebase_config;

let firebaseConfig;
try {
  firebaseConfig = JSON.parse(firebaseConfigString);
  if (!firebaseConfig.apiKey || /<apiKey>/i.test(firebaseConfig.apiKey)) {
    throw new Error(
      "Missing or invalid Firebase API key. Ensure .env contains your project's credentials."
    );
  }
} catch (err) {
  console.error('Invalid Firebase configuration:', err.message || err);
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

export const appId = typeof __app_id !== 'undefined' ? __app_id : window.__app_id;

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
const functionsRegion =
  process.env.REACT_APP_FUNCTIONS_REGION ||
  firebaseConfig.functionsRegion ||
  process.env.REACT_APP_FIREBASE_FUNCTIONS_REGION ||
  'us-central1';

export const functions = getFunctions(firebaseApp, functionsRegion);

const resolveStorageBucketUrl = (rawBucket) => {
  if (!rawBucket || typeof rawBucket !== 'string') return null;
  const trimmed = rawBucket.trim();
  if (!trimmed) return null;
  if (/^gs:\/\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) return trimmed;
  if (/\.firebasestorage\.app$/i.test(trimmed)) {
    console.info('[storage] Using firebasestorage.app bucket', { rawBucket });
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
  console.warn('Firebase storage bucket not defined; falling back to default bucket binding.');
}

export const storage = storageBucketUrl
  ? getStorage(firebaseApp, storageBucketUrl)
  : getStorage(firebaseApp);

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

export const FirestorePaths = {
  USER_PROFILE: (userId) => `artifacts/${appId}/users/${userId}/userProfileData/profile`,
  CASES_COLLECTION: () => `artifacts/${appId}/public/data/cases`,
  CASE_DOCUMENT: (caseId) => `artifacts/${appId}/public/data/cases/${caseId}`,
  RECIPES_COLLECTION: () => `artifacts/${appId}/public/data/recipes`,
  RECIPE_DOCUMENT: (recipeId) => `artifacts/${appId}/public/data/recipes/${recipeId}`,
  // Keys are stored under /private/data/case_keys (keep doc/collection parity for Firestore).
  CASE_KEYS_COLLECTION: () => `artifacts/${appId}/private/data/case_keys`,
  CASE_KEYS_DOCUMENT: (caseId) => `artifacts/${appId}/private/data/case_keys/${caseId}`,
  CASE_GENERATION_PLAN_DOCUMENT: (caseId) =>
    `artifacts/${appId}/private/data/case_generation_plans/${caseId}`,
  USERS_COLLECTION: () => `artifacts/${appId}/users`,
  USER_SUBMISSIONS_COLLECTION: (appIdValue, userId) =>
    `artifacts/${appIdValue}/users/${userId}/caseSubmissions`,
  USER_CASE_SUBMISSION: (userId, caseId) =>
    `artifacts/${appId}/users/${userId}/caseSubmissions/${caseId}`,
  BILLING_DOCUMENT: (appIdValue, userId) =>
    `artifacts/${appIdValue || appId}/users/${userId}/billing`,
  ROLE_DOCUMENT: (userId) => `roles/${userId}`,
  STUDENT_PROGRESS_COLLECTION: (appIdValue, uid) =>
    `artifacts/${appIdValue}/student_progress/${uid}/cases`,
  STUDENT_RECIPE_PROGRESS_COLLECTION: (appIdValue, uid) =>
    `artifacts/${appIdValue}/student_progress/${uid}/recipes`,
  STUDENT_RECIPE_PROGRESS_DOCUMENT: (appIdValue, uid, recipeId) =>
    `artifacts/${appIdValue}/student_progress/${uid}/recipes/${recipeId}`,
  GLOBAL_TAG_SETTINGS: (appIdValue = appId) =>
    `artifacts/${appIdValue}/settings/global_tags`,
};
