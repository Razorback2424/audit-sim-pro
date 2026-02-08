import { isBillingPaid } from './billingService';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(),
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(),
}));

jest.mock('../AppCore', () => ({
  appId: 'test-app',
  functions: {},
  db: {},
  FirestorePaths: {
    BILLING_DOCUMENT: (appIdValue, uid) => `artifacts/${appIdValue}/users/${uid}/billing/status`,
  },
}));

describe('billingService.isBillingPaid', () => {
  test('returns true for active status', () => {
    expect(isBillingPaid({ status: 'active' })).toBe(true);
  });

  test('returns true for no_payment_required status', () => {
    expect(isBillingPaid({ status: 'no_payment_required' })).toBe(true);
  });

  test('returns false for unpaid or missing status', () => {
    expect(isBillingPaid({ status: 'unpaid' })).toBe(false);
    expect(isBillingPaid({})).toBe(false);
    expect(isBillingPaid(null)).toBe(false);
  });
});
