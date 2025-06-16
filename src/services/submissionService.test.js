import { saveSubmission, fetchSubmissionsForCase } from './submissionService';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { FirestorePaths, db } from '../AppCore';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  collection: jest.fn(),
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
});
