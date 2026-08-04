const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'demo-auditsim';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

const appId = 'test-app';
const uid = 'trainee-1';
const caseId = 'case-1';
const submissionPath = `artifacts/${appId}/users/${uid}/caseSubmissions/${caseId}`;
const progressPath = `artifacts/${appId}/student_progress/${uid}/cases/${caseId}`;
const otherUserProgressPath = `artifacts/${appId}/student_progress/other-user/cases/${caseId}`;
const demoDraftCasePath = `artifacts/${appId}/public/data/cases/demo-draft`;
const demoLiveCasePath = `artifacts/${appId}/public/data/cases/demo-live`;
const orgId = 'org-1';
const instructorCasePath = `artifacts/${appId}/public/data/cases/instructor-case-1`;

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

const getDocument = async (path, token = null) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`http://${emulatorHost}/v1/${firestoreDocName(path)}`, {
    method: 'GET',
    headers,
  });
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
  return { ok: response.ok, status: response.status, payload };
};

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
const adminToken = buildAuthToken('admin-1', { role: 'admin' });
const instructorToken = buildAuthToken('instructor-1', { role: 'instructor', orgId });

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

const mutateAttemptHistory = {
  update: {
    name: firestoreDocName(submissionPath),
    fields: {
      attempts: {
        arrayValue: {
          values: [{ mapValue: { fields: { attemptId: { stringValue: 'forged-attempt' } } } }],
        },
      },
    },
  },
  currentDocument: { exists: true },
};

const mutateRecipeProgress = {
  update: {
    name: firestoreDocName(`artifacts/${appId}/student_progress/${uid}/recipes/recipe-1`),
    fields: { passedVersion: { integerValue: '99' } },
  },
};

const buildProgressWrite = ({ path, step }) => ({
  update: {
    name: firestoreDocName(path),
    fields: {
      state: { stringValue: 'in_progress' },
      percentComplete: { integerValue: '10' },
      step: { stringValue: step },
      draft: {
        mapValue: {
          fields: {
            selectedPaymentIds: {
              arrayValue: { values: [{ stringValue: 'P-1001' }] },
            },
          },
        },
      },
    },
  },
  updateTransforms: [
    {
      fieldPath: 'updatedAt',
      setToServerValue: 'REQUEST_TIME',
    },
  ],
});

const buildCaseWrite = ({ path, status }) => ({
  update: {
    name: firestoreDocName(path),
    fields: {
      title: { stringValue: status === 'draft' ? 'Draft Demo Case' : 'Live Demo Case' },
      status: { stringValue: status },
      publicVisible: { booleanValue: true },
      accessLevel: { stringValue: 'demo' },
      _deleted: { booleanValue: false },
    },
  },
});

const seedInstructorCase = {
  update: {
    name: firestoreDocName(instructorCasePath),
    fields: {
      title: { stringValue: 'Instructor Org Case' },
      status: { stringValue: 'assigned' },
      publicVisible: { booleanValue: true },
      accessLevel: { stringValue: 'demo' },
      _deleted: { booleanValue: false },
      orgId: { stringValue: orgId },
    },
  },
};

const directCaseAssignmentWrite = {
  update: {
    name: firestoreDocName(instructorCasePath),
    fields: {
      status: { stringValue: 'assigned' },
      publicVisible: { booleanValue: false },
      _deleted: { booleanValue: false },
      updatedAt: { timestampValue: new Date().toISOString() },
      createdAt: { timestampValue: new Date().toISOString() },
      visibleToUserIds: { arrayValue: { values: [{ stringValue: 'unassigned-trainee' }] } },
    },
  },
  currentDocument: { exists: true },
};

const run = async () => {
  const seedDemoCases = await commitWrites(
    [
      buildCaseWrite({ path: demoDraftCasePath, status: 'draft' }),
      buildCaseWrite({ path: demoLiveCasePath, status: 'assigned' }),
      seedInstructorCase,
    ],
    adminToken
  );
  assertStatus(seedDemoCases, 200, 'seed demo cases for anonymous access checks');

  const denyDirectCaseAssignment = await commitWrites([directCaseAssignmentWrite], instructorToken);
  assertStatus(denyDirectCaseAssignment, 403, 'deny instructor direct write of case visibleToUserIds');

  const allowCreate = await commitWrites([createSubmission], traineeToken);
  assertStatus(allowCreate, 200, 'allow trainee create without protected fields');

  const denyGradeMutation = await commitWrites([mutateProtectedField], traineeToken);
  assertStatus(denyGradeMutation, 403, 'deny trainee mutation of protected grade field');

  const denyAttemptMutation = await commitWrites([mutateAttemptHistory], traineeToken);
  assertStatus(denyAttemptMutation, 403, 'deny trainee mutation of finalized attempt history');

  const denyRecipeProgressMutation = await commitWrites([mutateRecipeProgress], traineeToken);
  assertStatus(denyRecipeProgressMutation, 403, 'deny trainee mutation of recipe gate progress');

  const allowInstructionProgress = await commitWrites(
    [buildProgressWrite({ path: progressPath, step: 'instruction' })],
    traineeToken
  );
  assertStatus(allowInstructionProgress, 200, 'allow progress write with instruction step');

  const allowCaCheckProgress = await commitWrites(
    [buildProgressWrite({ path: progressPath, step: 'ca_check' })],
    traineeToken
  );
  assertStatus(allowCaCheckProgress, 200, 'allow progress write with ca_check step');

  const denyInvalidStep = await commitWrites(
    [buildProgressWrite({ path: progressPath, step: 'support' })],
    traineeToken
  );
  assertStatus(denyInvalidStep, 403, 'deny progress write with invalid step');

  const denyCrossUserProgress = await commitWrites(
    [buildProgressWrite({ path: otherUserProgressPath, step: 'instruction' })],
    traineeToken
  );
  assertStatus(denyCrossUserProgress, 403, 'deny cross-user progress write');

  const denyAnonymousDraftDemoRead = await getDocument(demoDraftCasePath);
  assertStatus(denyAnonymousDraftDemoRead, 403, 'deny anonymous read of draft demo case');

  const allowAnonymousLiveDemoRead = await getDocument(demoLiveCasePath);
  assertStatus(allowAnonymousLiveDemoRead, 200, 'allow anonymous read of live demo case');

  console.log('[rules-regression] submission rules regression checks completed');
};

run().catch((error) => {
  console.error('[rules-regression] unexpected failure', error);
  process.exit(1);
});
