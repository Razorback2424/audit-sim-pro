import { fetchUsersWithProfiles, fetchUserProfile, setUserRole, upsertUserProfile } from './userService';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { FirestorePaths, db } from '../AppCore';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  getDocs: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
}));

jest.mock('../AppCore', () => ({
  db: {},
  FirestorePaths: {
    USERS_COLLECTION: () => 'users',
    USER_PROFILE: (id) => `profile/${id}`,
    ROLE_DOCUMENT: (id) => `roles/${id}`
  }
}));

describe('userService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetchUsersWithProfiles returns list', async () => {
    const docs = { docs: [{ id: 'u1' }] };
    getDocs.mockResolvedValueOnce(docs);
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ role: 'r' }) });
    const result = await fetchUsersWithProfiles();
    expect(collection).toHaveBeenCalled();
    expect(result[0].id).toBe('u1');
  });

  test('fetchUserProfile returns data or null', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ role: 'r' }) });
    const result = await fetchUserProfile('u1');
    expect(result).toEqual({ role: 'r' });

    getDoc.mockResolvedValueOnce({ exists: () => false });
    const result2 = await fetchUserProfile('u2');
    expect(result2).toBeNull();
  });

  test('setUserRole calls setDoc', async () => {
    await setUserRole('u1', 'admin');
    expect(setDoc).toHaveBeenCalled();
  });

  test('upsertUserProfile calls setDoc', async () => {
    await upsertUserProfile('u1', { role: 'admin' });
    expect(setDoc).toHaveBeenCalled();
  });
});
