const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateAnonymousDemoCaseAccess,
  evaluateTraineeCaseAccess,
  hasPaidBillingAccess,
} = require('./access');

test('hasPaidBillingAccess accepts active and no_payment_required', () => {
  assert.equal(hasPaidBillingAccess({ status: 'active' }), true);
  assert.equal(hasPaidBillingAccess({ status: 'no_payment_required' }), true);
  assert.equal(hasPaidBillingAccess({ status: 'unpaid' }), false);
  assert.equal(hasPaidBillingAccess(null), false);
});

test('evaluateTraineeCaseAccess allows a paid trainee on assigned private cases', () => {
  const result = evaluateTraineeCaseAccess({
    caseData: {
      _deleted: false,
      publicVisible: false,
      visibleToUserIds: ['u-1'],
      accessLevel: 'paid',
    },
    uid: 'u-1',
    hasPaidAccess: true,
  });

  assert.deepEqual(result, { allowed: true, reason: null });
});

test('evaluateTraineeCaseAccess denies a paid trainee on unassigned private cases', () => {
  const result = evaluateTraineeCaseAccess({
    caseData: {
      _deleted: false,
      publicVisible: false,
      visibleToUserIds: ['u-2'],
      accessLevel: 'paid',
    },
    uid: 'u-1',
    hasPaidAccess: true,
  });

  assert.deepEqual(result, { allowed: false, reason: 'case_not_assigned' });
});

test('evaluateTraineeCaseAccess denies cases that are not open yet', () => {
  const result = evaluateTraineeCaseAccess({
    caseData: {
      _deleted: false,
      publicVisible: true,
      accessLevel: 'demo',
      opensAt: { seconds: 1_900_000_000, nanoseconds: 0 },
    },
    uid: 'u-1',
    hasPaidAccess: false,
    nowMs: 1_800_000_000 * 1000,
  });

  assert.deepEqual(result, { allowed: false, reason: 'case_not_open' });
});

test('evaluateTraineeCaseAccess denies draft cases even when assigned', () => {
  const result = evaluateTraineeCaseAccess({
    caseData: {
      _deleted: false,
      status: 'draft',
      publicVisible: false,
      visibleToUserIds: ['u-1'],
      accessLevel: 'paid',
    },
    uid: 'u-1',
    hasPaidAccess: true,
  });

  assert.deepEqual(result, { allowed: false, reason: 'case_draft' });
});

test('evaluateTraineeCaseAccess keeps unpaid users limited to public demo cases', () => {
  const allowed = evaluateTraineeCaseAccess({
    caseData: {
      _deleted: false,
      publicVisible: true,
      accessLevel: 'demo',
    },
    uid: 'u-1',
    hasPaidAccess: false,
  });
  const denied = evaluateTraineeCaseAccess({
    caseData: {
      _deleted: false,
      publicVisible: true,
      accessLevel: 'paid',
    },
    uid: 'u-1',
    hasPaidAccess: false,
  });

  assert.deepEqual(allowed, { allowed: true, reason: null });
  assert.deepEqual(denied, { allowed: false, reason: 'demo_only' });
});

test('evaluateAnonymousDemoCaseAccess denies draft public demo cases', () => {
  const result = evaluateAnonymousDemoCaseAccess({
    caseData: {
      _deleted: false,
      status: 'draft',
      publicVisible: true,
      accessLevel: 'demo',
    },
  });

  assert.deepEqual(result, { allowed: false, reason: 'case_draft' });
});

test('evaluateAnonymousDemoCaseAccess allows open public demo cases', () => {
  const result = evaluateAnonymousDemoCaseAccess({
    caseData: {
      _deleted: false,
      status: 'assigned',
      publicVisible: true,
      accessLevel: 'demo',
    },
  });

  assert.deepEqual(result, { allowed: true, reason: null });
});
