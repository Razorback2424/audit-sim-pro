const test = require('node:test');
const assert = require('node:assert/strict');

const { queuePoolReplenishmentJob, shouldQueuePoolReplenishment } = require('./poolBackfill');

const serverTimestamp = Symbol('serverTimestamp');
const deleteField = Symbol('deleteField');

const buildAdmin = () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => serverTimestamp,
      delete: () => deleteField,
    },
  },
});

const buildFirestore = (currentData = null) => {
  const tx = {
    get: async () => ({
      exists: currentData !== null,
      data: () => currentData,
    }),
    set: (...args) => {
      tx.setCalls.push(args);
    },
    setCalls: [],
  };

  const firestore = {
    docCalls: [],
    doc(path) {
      this.docCalls.push(path);
      return { path };
    },
    async runTransaction(callback) {
      return callback(tx);
    },
  };

  return { firestore, tx };
};

test('shouldQueuePoolReplenishment only queues when remaining inventory is at threshold', () => {
  assert.equal(shouldQueuePoolReplenishment(2), true);
  assert.equal(shouldQueuePoolReplenishment(1), true);
  assert.equal(shouldQueuePoolReplenishment(3), false);
  assert.equal(shouldQueuePoolReplenishment('2'), true);
  assert.equal(shouldQueuePoolReplenishment('not-a-number'), false);
});

test('queuePoolReplenishmentJob creates a queued job when none exists', async () => {
  const { firestore, tx } = buildFirestore(null);
  const result = await queuePoolReplenishmentJob({
    firestore,
    admin: buildAdmin(),
    appId: 'app-1',
    moduleId: 'module-1',
    requestedBy: 'user-1',
    orgId: 'org-1',
  });

  assert.deepEqual(result, { queued: true, status: 'queued' });
  assert.deepEqual(firestore.docCalls, ['artifacts/app-1/private/data/case_pool_jobs/module-1']);
  assert.equal(tx.setCalls.length, 1);
  const [jobRef, payload, options] = tx.setCalls[0];
  assert.equal(jobRef.path, 'artifacts/app-1/private/data/case_pool_jobs/module-1');
  assert.equal(payload.moduleId, 'module-1');
  assert.equal(payload.appId, 'app-1');
  assert.equal(payload.status, 'queued');
  assert.equal(payload.requestedBy, 'user-1');
  assert.equal(payload.orgId, 'org-1');
  assert.equal(payload.requestCount, 1);
  assert.equal(payload.requestedAt, serverTimestamp);
  assert.equal(payload.createdAt, serverTimestamp);
  assert.equal(payload.updatedAt, serverTimestamp);
  assert.equal(payload.lastError, deleteField);
  assert.deepEqual(options, { merge: true });
});

test('queuePoolReplenishmentJob preserves an active queued job and increments the request count', async () => {
  const { firestore, tx } = buildFirestore({
    status: 'queued',
    requestCount: 2,
    requestedBy: 'existing-user',
    orgId: 'existing-org',
  });

  const result = await queuePoolReplenishmentJob({
    firestore,
    admin: buildAdmin(),
    appId: 'app-1',
    moduleId: 'module-1',
    requestedBy: 'new-user',
    orgId: 'new-org',
  });

  assert.deepEqual(result, { queued: false, status: 'queued' });
  assert.equal(tx.setCalls.length, 1);
  const [, payload, options] = tx.setCalls[0];
  assert.equal(payload.requestCount, 3);
  assert.equal(payload.requestedBy, 'new-user');
  assert.equal(payload.orgId, 'new-org');
  assert.equal(payload.requestedAt, serverTimestamp);
  assert.equal(payload.updatedAt, serverTimestamp);
  assert.deepEqual(options, { merge: true });
});

test('queuePoolReplenishmentJob does not overwrite a processing job status', async () => {
  const { firestore, tx } = buildFirestore({
    status: 'processing',
    requestCount: 7,
    requestedBy: 'existing-user',
    orgId: 'existing-org',
  });

  const result = await queuePoolReplenishmentJob({
    firestore,
    admin: buildAdmin(),
    appId: 'app-1',
    moduleId: 'module-1',
    requestedBy: '',
    orgId: '',
  });

  assert.deepEqual(result, { queued: false, status: 'processing' });
  assert.equal(tx.setCalls.length, 1);
  const [, payload] = tx.setCalls[0];
  assert.equal(payload.requestCount, 8);
  assert.equal(payload.requestedBy, 'existing-user');
  assert.equal(payload.orgId, 'existing-org');
  assert.equal(payload.requestedAt, serverTimestamp);
  assert.equal(payload.updatedAt, serverTimestamp);
});
