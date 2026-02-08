/* eslint-disable no-console */
const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.PROJECT_ID || '';
const FUNCTIONS_REGION = process.env.FUNCTIONS_REGION || 'us-central1';
const APP_ID = process.env.APP_ID || 'auditsim-pro-default-dev';
const API_KEY = process.env.FIREBASE_API_KEY || process.env.API_KEY || '';
const FUNCTIONS_EMULATOR_URL = process.env.FUNCTIONS_EMULATOR_URL || '';
const AUTH_EMULATOR_HOST = process.env.AUTH_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST || '';
const APP_CHECK_TOKEN = process.env.APP_CHECK_TOKEN || '';

const AUTHORIZED_UID = process.env.AUTHORIZED_UID || '';
const UNAUTHORIZED_UID = process.env.UNAUTHORIZED_UID || '';
const CASE_ID = process.env.CASE_ID || '';
const STORAGE_PATH = process.env.STORAGE_PATH || '';
const INVALID_STORAGE_PATH = process.env.INVALID_STORAGE_PATH || 'artifacts/invalid/path.pdf';

const ensureEnv = (name, value) => {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
};

const resolveFunctionsUrl = () => {
  if (FUNCTIONS_EMULATOR_URL) return FUNCTIONS_EMULATOR_URL.replace(/\/$/, '');
  return `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net`;
};

const resolveAuthBase = () => {
  if (!AUTH_EMULATOR_HOST) return 'https://identitytoolkit.googleapis.com';
  const normalized = AUTH_EMULATOR_HOST.startsWith('http')
    ? AUTH_EMULATOR_HOST.replace(/\/$/, '')
    : `http://${AUTH_EMULATOR_HOST}`;
  return `${normalized}/identitytoolkit.googleapis.com`;
};

const getIdToken = async (uid, role = 'trainee') => {
  const customToken = await admin.auth().createCustomToken(uid, { role });
  const baseUrl = resolveAuthBase();
  const url = `${baseUrl}/v1/accounts:signInWithCustomToken?key=${API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to exchange custom token (${response.status}): ${text}`);
  }
  const data = await response.json();
  if (!data.idToken) {
    throw new Error('No idToken returned from signInWithCustomToken.');
  }
  return data.idToken;
};

const callSignedUrl = async ({ idToken, caseId, storagePath }) => {
  const endpoint = `${resolveFunctionsUrl()}/${PROJECT_ID}/${FUNCTIONS_REGION}/getSignedDocumentUrl`;
  const headers = {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
  if (APP_CHECK_TOKEN) {
    headers['X-Firebase-AppCheck'] = APP_CHECK_TOKEN;
  }
  const payload = {
    data: {
      appId: APP_ID,
      caseId,
      storagePath: storagePath || null,
    },
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, raw: text };
};

const assertCondition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async () => {
  ensureEnv('PROJECT_ID', PROJECT_ID);
  ensureEnv('FIREBASE_API_KEY', API_KEY);
  ensureEnv('AUTHORIZED_UID', AUTHORIZED_UID);
  ensureEnv('UNAUTHORIZED_UID', UNAUTHORIZED_UID);
  ensureEnv('CASE_ID', CASE_ID);
  ensureEnv('STORAGE_PATH', STORAGE_PATH);

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }

  console.log('[self-check] Using functions endpoint:', resolveFunctionsUrl());
  if (APP_CHECK_TOKEN) {
    console.log('[self-check] App Check token provided.');
  } else {
    console.warn('[self-check] No APP_CHECK_TOKEN provided. If App Check is enforced, requests may fail.');
  }

  const authorizedToken = await getIdToken(AUTHORIZED_UID, 'trainee');
  const unauthorizedToken = await getIdToken(UNAUTHORIZED_UID, 'trainee');

  console.log('[self-check] 1) Authorized user should receive signed URL');
  const authorizedResponse = await callSignedUrl({
    idToken: authorizedToken,
    caseId: CASE_ID,
    storagePath: STORAGE_PATH,
  });
  assertCondition(
    authorizedResponse.status === 200 && authorizedResponse.body?.result?.url,
    `Expected signed URL, got status ${authorizedResponse.status}: ${authorizedResponse.raw}`
  );
  console.log('  ✅ Authorized received URL.');

  console.log('[self-check] 2) Unauthorized user should be denied');
  const unauthorizedResponse = await callSignedUrl({
    idToken: unauthorizedToken,
    caseId: CASE_ID,
    storagePath: STORAGE_PATH,
  });
  assertCondition(
    unauthorizedResponse.status !== 200,
    `Expected denial for unauthorized user, got success: ${unauthorizedResponse.raw}`
  );
  console.log('  ✅ Unauthorized denied.');

  console.log('[self-check] 3) Missing storagePath should fail closed');
  const missingPathResponse = await callSignedUrl({
    idToken: authorizedToken,
    caseId: CASE_ID,
    storagePath: '',
  });
  assertCondition(
    missingPathResponse.status !== 200,
    `Expected failed-precondition, got success: ${missingPathResponse.raw}`
  );
  console.log('  ✅ Missing storagePath denied.');

  console.log('[self-check] 4) Invalid storagePath should be denied');
  const invalidResponse = await callSignedUrl({
    idToken: authorizedToken,
    caseId: CASE_ID,
    storagePath: INVALID_STORAGE_PATH,
  });
  assertCondition(
    invalidResponse.status !== 200,
    `Expected denial for invalid storagePath, got success: ${invalidResponse.raw}`
  );
  console.log('  ✅ Invalid storagePath denied.');
};

run().catch((err) => {
  console.error('[self-check] FAILED:', err.message || err);
  process.exit(1);
});
