import { saveSubmission, fetchSubmissionsForCase, fetchSubmission } from './submissionService';
import { doc, setDoc, getDoc, getDocs, collection, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { FirestorePaths, db } from '../AppCore';

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
  FirestorePaths: {
    USER_CASE_SUBMISSION: (uid, cid) => `users/${uid}/subs/${cid}`,
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
});
