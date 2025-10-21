import { fetchCase, markCaseDeleted } from './caseService';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { FirestorePaths, db } from '../AppCore';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  collection: jest.fn(),
  addDoc: jest.fn(),
  query: jest.fn(),
  onSnapshot: jest.fn(),
  where: jest.fn(),
  serverTimestamp: jest.fn(() => 'serverTimestamp'),
  Timestamp: { now: jest.fn(() => 'now'), fromDate: jest.fn() },
  writeBatch: jest.fn(() => ({
    set: jest.fn(),
    commit: jest.fn(),
  })),
}));

jest.mock('../AppCore', () => ({
  db: {},
  FirestorePaths: {
    CASE_DOCUMENT: (id) => `cases/${id}`
  }
}));

describe('caseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetchCase returns data when found', async () => {
    getDoc.mockResolvedValue({ exists: () => true, id: '1', data: () => ({ a: 1 }) });
    const result = await fetchCase('1');
    expect(doc).toHaveBeenCalledWith({}, 'cases/1');
    expect(result).toMatchObject({
      id: '1',
      a: 1,
      title: '',
      caseName: '',
      publicVisible: true,
      visibleToUserIds: [],
      referenceDocuments: [],
    });
  });

  test('markCaseDeleted calls setDoc', async () => {
    await markCaseDeleted('2');
    expect(setDoc).toHaveBeenCalled();
  });
});
