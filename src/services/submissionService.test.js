import {
  saveSubmission,
  fetchSubmissionsForCase,
  fetchSubmission,
  listUserSubmissions,
  subscribeToRecentSubmissionActivity,
} from './submissionService';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp,
  arrayUnion,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  collection: jest.fn(),
  serverTimestamp: jest.fn(() => 'now'),
  arrayUnion: jest.fn((v) => v),
  collectionGroup: jest.fn(() => 'collectionGroup'),
  query: jest.fn((...args) => ({ type: 'query', args })),
  orderBy: jest.fn((...args) => ({ type: 'orderBy', args })),
  where: jest.fn((...args) => ({ type: 'where', args })),
  limit: jest.fn((value) => ({ type: 'limit', value })),
  onSnapshot: jest.fn(),
  Timestamp: class MockTimestamp {
    constructor(seconds, nanoseconds) {
      this.seconds = seconds;
      this.nanoseconds = nanoseconds;
    }

    toMillis() {
      return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
    }

    static fromDate(date) {
      const millis = date.getTime();
      const seconds = Math.floor(millis / 1000);
      const nanoseconds = (millis % 1000) * 1e6;
      return new MockTimestamp(seconds, nanoseconds);
    }

    static now() {
      return MockTimestamp.fromDate(new Date());
    }
  },
}));

jest.mock('../AppCore', () => ({
  db: {},
  appId: 'test-app',
  FirestorePaths: {
    USER_CASE_SUBMISSION: (uid, cid) => `users/${uid}/subs/${cid}`,
    USER_SUBMISSIONS_COLLECTION: (appId, uid) => `artifacts/${appId}/users/${uid}/caseSubmissions`,
    USERS_COLLECTION: () => 'users'
  }
}));

describe('submissionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('saveSubmission calls setDoc', async () => {
    getDoc.mockResolvedValue({ data: () => ({ attempts: [] }) });
    await saveSubmission('u1', 'c1', { a: 1 });
    expect(setDoc).toHaveBeenCalled();
  });

  test('saveSubmission normalizes attempt metadata', async () => {
    getDoc.mockResolvedValue({ data: () => ({ attempts: [{}, {}] }) });
    await saveSubmission('u1', 'c1', {
      caseId: 'c1',
      caseName: 'Case',
      attemptSummary: {
        score: 90,
        totalConsidered: 5,
        missedExceptionsCount: 0,
        falsePositivesCount: 0,
        wrongClassificationCount: 0,
        criticalIssuesCount: 0,
      },
      submittedAt: Timestamp.now(),
    });

    const [, payload] = setDoc.mock.calls[0];
    expect(arrayUnion).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptIndex: 3,
        attemptType: 'practice',
        attemptSummary: expect.objectContaining({
          attemptIndex: 3,
          attemptType: 'practice',
          isBaseline: false,
        }),
      })
    );
  });

  test('fetchSubmissionsForCase returns submissions', async () => {
    const userDocs = { docs: [{ id: 'u1' }] };
    getDocs.mockResolvedValue(userDocs);
    getDoc.mockResolvedValue({ exists: () => true, id: 'sub', data: () => ({ x: 2 }) });
    const result = await fetchSubmissionsForCase('c1');
    expect(collection).toHaveBeenCalled();
    expect(result[0].userId).toBe('u1');
  });

  test('fetchSubmission returns single submission', async () => {
    getDoc.mockResolvedValue({ exists: () => true, id: 'sub', data: () => ({ a: 1 }) });
    const result = await fetchSubmission('u1', 'c1');
    expect(doc).toHaveBeenCalled();
    expect(result.id).toBe('sub');
  });

  test('listUserSubmissions normalizes attempts with fallback', async () => {
    getDocs.mockResolvedValueOnce({
      docs: [
        {
          id: 'case-1',
          data: () => ({
            caseName: 'Case One',
            submittedAt: { toMillis: () => 1 },
            selectedPaymentIds: ['p1'],
            disbursementClassifications: { p1: { properlyIncluded: 100 } },
            retrievedDocuments: [{ paymentId: 'p1', fileName: 'doc.pdf' }],
          }),
        },
        {
          id: 'case-2',
          data: () => ({
            caseName: 'Case Two',
            submittedAt: { toMillis: () => 2 },
            attempts: [
              {
                submittedAt: { toMillis: () => 3 },
                selectedPaymentIds: ['p2'],
                retrievedDocuments: [],
              },
            ],
          }),
        },
      ],
    });

    const results = await listUserSubmissions({ uid: 'u1', appId: 'app-x' });
    expect(collection).toHaveBeenCalledWith({}, 'artifacts/app-x/users/u1/caseSubmissions');
    expect(results).toHaveLength(2);
    expect(results[0].caseId).toBe('case-2');
    expect(results[1].attempts[0].selectedPaymentIds).toEqual(['p1']);
  });

  test('subscribeToRecentSubmissionActivity falls back when submittedAt missing', () => {
    const legacyTimestamp = (millis) => {
      const seconds = Math.floor(millis / 1000);
      const nanoseconds = (millis % 1000) * 1e6;
      return new Timestamp(seconds, nanoseconds);
    };

    const createDocSnap = (caseId, userId, data) => ({
      id: caseId,
      data: () => ({ ...data }),
      ref: {
        path: `/artifacts/test-app/users/${userId}/caseSubmissions/${caseId}`,
        parent: {
          parent: { id: userId },
        },
      },
    });

    const primaryUnsubscribe = jest.fn();
    const fallbackUnsubscribe = jest.fn();
    const primaryError = { code: 'failed-precondition', message: 'index missing' };
    const fallbackSnapshot = {
      size: 2,
      docs: [
        createDocSnap('case-old', 'user-1', {
          caseName: 'Legacy Case',
          attempts: [
            { submittedAt: legacyTimestamp(1_000) },
            { submittedAt: legacyTimestamp(3_000) },
          ],
        }),
        createDocSnap('case-new', 'user-2', {
          caseName: 'Modern Case',
          attempts: [{ submittedAt: legacyTimestamp(5_000) }],
        }),
      ],
    };

    onSnapshot
      .mockImplementationOnce((queryRef, onNext, onError) => {
        onError(primaryError);
        return primaryUnsubscribe;
      })
      .mockImplementationOnce((queryRef, onNext) => {
        onNext(fallbackSnapshot);
        return fallbackUnsubscribe;
      });

    const onData = jest.fn();
    const onError = jest.fn();
    const unsubscribe = subscribeToRecentSubmissionActivity(onData, onError, { limit: 5 });

    expect(onError).toHaveBeenCalledWith(primaryError);
    expect(onData).toHaveBeenCalledTimes(1);
    const entries = onData.mock.calls[0][0];
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.caseId)).toEqual(['case-new', 'case-old']);
    expect(entries[0].submittedAt.toMillis()).toBeGreaterThan(entries[1].submittedAt.toMillis());

    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(primaryUnsubscribe).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
  });
});
