import {
  saveSubmission,
  fetchSubmissionsForCase,
  fetchSubmission,
  listUserSubmissions,
} from './submissionService';
import { doc, setDoc, getDoc, getDocs, collection, serverTimestamp, arrayUnion } from 'firebase/firestore';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  collection: jest.fn(),
  serverTimestamp: jest.fn(() => 'now'),
  arrayUnion: jest.fn((v) => v),
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
    await saveSubmission('u1', 'c1', { a: 1 });
    expect(setDoc).toHaveBeenCalled();
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
});
