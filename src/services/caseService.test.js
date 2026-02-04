import { fetchCase, markCaseDeleted, updateCase } from './caseService';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { FirestorePaths, db } from '../AppCore';
import { DEFAULT_AUDIT_AREA } from '../models/caseConstants';

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
    CASE_DOCUMENT: (id) => `cases/${id}`,
    CASE_KEYS_DOCUMENT: (id) => `caseKeys/${id}`,
  },
}));

describe('caseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetchCase returns data when found', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, id: '1', data: () => ({ a: 1 }) });
    const result = await fetchCase('1');
    expect(doc).toHaveBeenNthCalledWith(1, {}, 'cases/1');
    expect(result).toMatchObject({
      id: '1',
      a: 1,
      title: '',
      caseName: '',
      publicVisible: true,
      visibleToUserIds: [],
      referenceDocuments: [],
      auditArea: DEFAULT_AUDIT_AREA,
      caseGroupId: null,
    });
  });

  test('fetchCase preserves hasAnswerKey flag from case doc', async () => {
    getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        id: '1',
        data: () => ({
          caseName: 'Case',
          publicVisible: true,
          _deleted: false,
          status: 'draft',
          auditItems: [{ paymentId: 'p1', payee: 'Vendor', amount: '100', paymentDate: '2024-01-01', hasAnswerKey: true }],
        }),
      });

    const result = await fetchCase('1');
    expect(Array.isArray(result.disbursements)).toBe(true);
    expect(result.disbursements[0].hasAnswerKey).toBe(true);
  });

  test('fetchCase loads private keys when requested', async () => {
    getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        id: '1',
        data: () => ({
          caseName: 'Case',
          publicVisible: true,
          _deleted: false,
          status: 'draft',
          auditItems: [{ paymentId: 'p1', payee: 'Vendor', amount: '100', paymentDate: '2024-01-01' }],
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          items: {
            p1: {
              answerKey: { properlyIncluded: 1 },
              correctClassification: 'included',
            },
          },
        }),
      });

    const result = await fetchCase('1', { includePrivateKeys: true });
    expect(doc).toHaveBeenNthCalledWith(1, {}, 'cases/1');
    expect(doc).toHaveBeenNthCalledWith(2, {}, 'caseKeys/1');
    expect(result.disbursements[0].hasAnswerKey).toBe(true);
    expect(result.disbursements[0].correctClassification).toBe('included');
  });

  test('markCaseDeleted calls setDoc', async () => {
    await markCaseDeleted('2');
    expect(setDoc).toHaveBeenCalled();
  });

  test('updateCase persists highlightedDocument on auditItems', async () => {
    doc.mockImplementation((_db, path) => ({ path }));
    setDoc.mockResolvedValueOnce();

    await updateCase('case-1', {
      caseName: 'Case',
      publicVisible: true,
      status: 'draft',
      _deleted: false,
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          highlightedDocument: {
            storagePath: 'artifacts/app/case_highlight/case-1/highlight.pdf',
            fileName: 'highlight.pdf',
            contentType: 'application/pdf',
          },
        },
      ],
    });

    const [, payload] = setDoc.mock.calls[0];
    expect(payload.auditItems).toHaveLength(1);
    expect(payload.auditItems[0].highlightedDocument).toEqual({
      storagePath: 'artifacts/app/case_highlight/case-1/highlight.pdf',
      fileName: 'highlight.pdf',
      contentType: 'application/pdf',
    });
  });

  test('updateCase trims paymentIds for auditItems', async () => {
    doc.mockImplementation((_db, path) => ({ path }));
    setDoc.mockResolvedValueOnce();

    await updateCase('case-1', {
      caseName: 'Case',
      publicVisible: true,
      status: 'draft',
      _deleted: false,
      disbursements: [
        {
          paymentId: '  P-001  ',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
        },
      ],
      invoiceMappings: [{ paymentId: 'P-001', storagePath: 'path', fileName: 'inv.pdf' }],
    });

    const [, payload] = setDoc.mock.calls[0];
    expect(payload.auditItems[0].paymentId).toBe('P-001');
  });
});
