const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'demo-auditsim';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

const appId = 'test-app';
const uid = 'trainee-1';
const caseId = 'case-1';
const submissionPath = `artifacts/${appId}/users/${uid}/caseSubmissions/${caseId}`;

const toBase64Url = (value) =>
  Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const buildAuthToken = (authUid, claims = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'none', typ: 'JWT' };
  const payload = {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    auth_time: now,
    user_id: authUid,
    sub: authUid,
    iat: now,
    exp: now + 60 * 60,
    firebase: { sign_in_provider: 'custom' },
    ...claims,
  };
  return `${toBase64Url(header)}.${toBase64Url(payload)}.`;
};

const firestoreDocName = (path) =>
  `projects/${projectId}/databases/(default)/documents/${path}`;

const commitWrites = async (writes, token) => {
  const response = await fetch(
    `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents:commit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ writes }),
    }
  );
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
  return { ok: response.ok, status: response.status, payload };
};

const assertStatus = (result, expectedStatus, label) => {
  if (result.status !== expectedStatus) {
    console.error(`[rules-regression] ${label} failed`, {
      expectedStatus,
      actualStatus: result.status,
      payload: result.payload,
    });
    process.exit(1);
  }
  console.log(`[rules-regression] ${label} passed (${result.status})`);
};

const traineeToken = buildAuthToken(uid, { role: 'trainee' });

const createSubmission = {
  update: {
    name: firestoreDocName(submissionPath),
    fields: {
      selectedPaymentIds: {
        arrayValue: { values: [{ stringValue: 'P-1001' }] },
      },
      disbursementClassifications: {
        mapValue: { fields: {} },
      },
    },
  },
};

const mutateProtectedField = {
  update: {
    name: firestoreDocName(submissionPath),
    fields: {
      grade: { integerValue: '100' },
    },
  },
  currentDocument: { exists: true },
};

const run = async () => {
  const allowCreate = await commitWrites([createSubmission], traineeToken);
  assertStatus(allowCreate, 200, 'allow trainee create without protected fields');

  const denyGradeMutation = await commitWrites([mutateProtectedField], traineeToken);
  assertStatus(denyGradeMutation, 403, 'deny trainee mutation of protected grade field');

  console.log('[rules-regression] submission rules regression checks completed');
};

run().catch((error) => {
  console.error('[rules-regression] unexpected failure', error);
  process.exit(1);
});
