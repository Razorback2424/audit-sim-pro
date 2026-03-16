import { fetchProgressRosterForCase, saveProgress } from './progressService';
import { deleteField, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDocs: jest.fn(),
  onSnapshot: jest.fn(),
  doc: jest.fn((...args) => ({ path: args.join('/') })),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'server-ts'),
  deleteField: jest.fn(() => '__DELETE__'),
  Timestamp: class MockTimestamp {
    constructor(seconds, nanoseconds) {
      this.seconds = seconds;
      this.nanoseconds = nanoseconds;
    }

    toMillis() {
      return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
    }

    toDate() {
      return new Date(this.toMillis());
    }

    static fromDate(date) {
      const millis = date.getTime();
      const seconds = Math.floor(millis / 1000);
      const nanoseconds = (millis % 1000) * 1e6;
      return new MockTimestamp(seconds, nanoseconds);
    }
  },
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(),
}));

jest.mock('../AppCore', () => ({
  db: {},
  functions: {},
  FirestorePaths: {
    STUDENT_PROGRESS_COLLECTION: (appId, uid) => `artifacts/${appId}/student_progress/${uid}/cases`,
  },
}));

describe('progressService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    doc.mockImplementation((...args) => ({ path: args.join('/') }));
    deleteField.mockReturnValue('__DELETE__');
    serverTimestamp.mockReturnValue('server-ts');
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  test('fetchProgressRosterForCase normalizes callable results', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: {
        roster: [
          {
            userId: 'u1',
            progress: {
              percentComplete: 75,
              state: 'in_progress',
              step: 'testing',
              updatedAt: { seconds: 12, nanoseconds: 0 },
            },
          },
        ],
      },
    });
    httpsCallable.mockReturnValue(callable);

    const result = await fetchProgressRosterForCase({ appId: 'app-1', caseId: 'case-1' });

    expect(httpsCallable).toHaveBeenCalledWith({}, 'listCaseProgressRoster');
    expect(callable).toHaveBeenCalledWith({ appId: 'app-1', caseId: 'case-1' });
    expect(result[0].progress.updatedAt.toMillis()).toBe(12_000);
  });

  test('saveProgress writes reconciled state instead of stale patch state', async () => {
    getDoc.mockResolvedValue({
      data: () => ({
        updatedAt: { toMillis: () => 100 },
        percentComplete: 80,
        step: 'testing',
        hasSuccessfulAttempt: true,
      }),
    });

    await saveProgress({
      appId: 'app-1',
      uid: 'u1',
      caseId: 'case-1',
      patch: {
        percentComplete: 40,
        step: 'testing',
        state: 'not_started',
        updatedAt: { toMillis: () => 50 },
      },
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload, options] = setDoc.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        percentComplete: 80,
        state: 'in_progress',
        hasSuccessfulAttempt: true,
      })
    );
    expect(options).toEqual({ merge: true });
  });

  test('saveProgress clears activeAttempt when requested', async () => {
    getDoc.mockResolvedValue({
      data: () => ({}),
    });

    await saveProgress({
      appId: 'app-1',
      uid: 'u1',
      caseId: 'case-1',
      patch: {
        percentComplete: 100,
        step: 'results',
      },
      clearActiveAttempt: true,
    });

    expect(deleteField).toHaveBeenCalledTimes(1);
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload, options] = setDoc.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        activeAttempt: '__DELETE__',
        state: 'submitted',
      })
    );
    expect(options).toEqual({ merge: true });
  });

  test('saveProgress flushes queued offline progress when the browser comes back online', async () => {
    getDoc.mockResolvedValue({
      data: () => ({}),
    });
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    await saveProgress({
      appId: 'app-1',
      uid: 'u1',
      caseId: 'case-1',
      patch: {
        percentComplete: 20,
        step: 'selection',
      },
    });

    expect(setDoc).not.toHaveBeenCalled();

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload, options] = setDoc.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        percentComplete: 20,
        state: 'in_progress',
      })
    );
    expect(options).toEqual({ merge: true });
    expect(serverTimestamp).toHaveBeenCalled();
  });

  test('saveProgress keeps queued offline progress when reconnect flush fails', async () => {
    getDoc.mockResolvedValue({
      data: () => ({}),
    });
    setDoc.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(undefined);
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    await saveProgress({
      appId: 'app-1',
      uid: 'u1',
      caseId: 'case-1',
      patch: {
        percentComplete: 20,
        step: 'selection',
      },
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setDoc).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setDoc).toHaveBeenCalledTimes(2);
  });

  test('saveProgress merges newer offline patches for the same case before flush', async () => {
    getDoc.mockResolvedValue({
      data: () => ({}),
    });
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    await saveProgress({
      appId: 'app-1',
      uid: 'u1',
      caseId: 'case-1',
      patch: {
        percentComplete: 20,
        step: 'selection',
        draft: {
          selectedPaymentIds: ['P-1'],
        },
      },
    });

    await saveProgress({
      appId: 'app-1',
      uid: 'u1',
      caseId: 'case-1',
      patch: {
        percentComplete: 45,
        step: 'testing',
        draft: {
          classificationDraft: {
            'P-1': { properlyIncluded: '100' },
          },
        },
      },
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = setDoc.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        percentComplete: 45,
        step: 'testing',
        draft: expect.objectContaining({
          selectedPaymentIds: ['P-1'],
          classificationDraft: {
            'P-1': { properlyIncluded: '100' },
          },
        }),
      })
    );
  });
});
