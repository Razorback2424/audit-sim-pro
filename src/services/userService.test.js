import { fetchUsersWithProfiles, fetchUserProfile, setUserRole, upsertUserProfile } from './userService';
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  getDocs: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'ts'),
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(),
}));

jest.mock('../AppCore', () => ({
  db: {},
  functions: {},
  appId: 'test-app',
  FirestorePaths: {
    USERS_COLLECTION: () => 'users',
    USER_PROFILE: (id) => `profile/${id}`,
    ROLE_DOCUMENT: (id) => `roles/${id}`
  }
}));

describe('userService', () => {
  let originalWarn;

  beforeAll(() => {
    originalWarn = console.warn;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    doc.mockImplementation((...args) => ({ __key: args.join('/') }));
    console.warn = jest.fn();
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  test('fetchUsersWithProfiles returns list', async () => {
    const docs = { docs: [{ id: 'u1', data: () => ({}) }] };
    getDocs.mockResolvedValueOnce(docs);
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ role: 'r' }) });
    const result = await fetchUsersWithProfiles();
    expect(collection).toHaveBeenCalled();
    expect(result[0].id).toBe('u1');
  });

  test('fetchUsersWithProfiles falls back to callable on permission error', async () => {
    getDocs.mockRejectedValueOnce({ code: 'permission-denied' });
    const callableMock = jest.fn().mockResolvedValue({
      data: { roster: [{ id: 'u2', displayName: 'User Two', email: 'two@example.com', role: 'admin' }] },
    });
    httpsCallable.mockReturnValueOnce(callableMock);
    const result = await fetchUsersWithProfiles();
    expect(httpsCallable).toHaveBeenCalledWith({}, 'listRosterOptions');
    expect(callableMock).toHaveBeenCalledWith({ appId: 'test-app' });
    expect(result[0].id).toBe('u2');
    expect(result[0].displayName).toBe('User Two');
  });

  test('fetchUserProfile returns data or null', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ role: 'r' }) });
    const result = await fetchUserProfile('u1');
    expect(result).toEqual({ role: 'r' });

    getDoc.mockResolvedValueOnce({ exists: () => false });
    const result2 = await fetchUserProfile('u2');
    expect(result2).toBeNull();
  });

  test('setUserRole calls adminSetUserRole callable', async () => {
    const callableMock = jest.fn().mockResolvedValue({ data: { role: 'admin' } });
    httpsCallable.mockReturnValueOnce(callableMock);
    await setUserRole('u1', 'admin');
    expect(httpsCallable).toHaveBeenCalledWith({}, 'adminSetUserRole');
    expect(callableMock).toHaveBeenCalledWith({ targetUid: 'u1', role: 'admin' });
  });

  test('upsertUserProfile calls setDoc', async () => {
    await upsertUserProfile('u1', { role: 'admin' });
    expect(setDoc).toHaveBeenCalled();
  });
});
