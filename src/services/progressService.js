import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, FirestorePaths, functions } from '../AppCore';
import { deriveProgressState, toProgressModel } from '../models/progress';

const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

const offlineQueue = new Map();
const offlineFlushWarnings = new Set();

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const mergeProgressPatches = (currentPatch = {}, nextPatch = {}) => {
  const merged = { ...currentPatch, ...nextPatch };

  if (isRecord(currentPatch.draft) || isRecord(nextPatch.draft)) {
    merged.draft = {
      ...(isRecord(currentPatch.draft) ? currentPatch.draft : {}),
      ...(isRecord(nextPatch.draft) ? nextPatch.draft : {}),
    };
  }

  if (isRecord(currentPatch.activeAttempt) || isRecord(nextPatch.activeAttempt)) {
    merged.activeAttempt = {
      ...(isRecord(currentPatch.activeAttempt) ? currentPatch.activeAttempt : {}),
      ...(isRecord(nextPatch.activeAttempt) ? nextPatch.activeAttempt : {}),
    };
  }

  return merged;
};

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const markerKey = '__auditsimProgressOnlineListenerBound';
  if (!window[markerKey]) {
    window[markerKey] = true;
    window.addEventListener('online', () => {
      offlineQueue.forEach((patch, key) => {
        const [appId, uid, caseId] = String(key).split('|');
        if (!appId || !uid || !caseId) return;
        saveProgress({ appId, uid, caseId, patch })
          .then(() => {
            if (offlineQueue.get(key) === patch) {
              offlineQueue.delete(key);
            }
            offlineFlushWarnings.delete(key);
          })
          .catch((err) => {
            if (!offlineFlushWarnings.has(key)) {
              console.warn('[progressService] Failed to flush offline progress patch', {
                key,
                error: err?.message,
              });
              offlineFlushWarnings.add(key);
            }
          });
      });
    });
  }
}

/**
 * Fetches progress for a list of cases.
 * @param {{ appId: string, uid: string, caseIds: string[] }} params
 * @returns {Promise<Map<string, import('../models/progress').ProgressModel>>}
 */
export const fetchProgressForCases = async ({ appId, uid, caseIds }) => {
  if (!caseIds || caseIds.length === 0) {
    return new Map();
  }

  const progressMap = new Map();
  const caseIdBatches = [];

  for (let i = 0; i < caseIds.length; i += BATCH_SIZE) {
    caseIdBatches.push(caseIds.slice(i, i + BATCH_SIZE));
  }

  const fetchPromises = caseIdBatches.map(async (batch) => {
    const progressCollection = collection(db, FirestorePaths.STUDENT_PROGRESS_COLLECTION(appId, uid));
    const q = query(progressCollection, where('__name__', 'in', batch));
    const snapshot = await getDocs(q);

    snapshot.docs.forEach((doc) => {
      progressMap.set(doc.id, toProgressModel(doc.data(), doc.id));
    });
  });

  await Promise.all(fetchPromises);

  // Ensure all requested caseIds are in the map, with default values if not found
  caseIds.forEach((caseId) => {
    if (!progressMap.has(caseId)) {
      progressMap.set(caseId, toProgressModel(null, caseId));
    }
  });

  return progressMap;
};

/**
 * Subscribes to progress for a list of cases.
 * @param {{ appId: string, uid: string, caseIds: string[] }} params
 * @param {(progressMap: Map<string, import('../models/progress').ProgressModel>) => void} onUpdate
 * @param {(error: Error) => void} onError
 * @returns {() => void} Unsubscribe function
 */
export const subscribeProgressForCases = ({ appId, uid, caseIds }, onUpdate, onError) => {
  if (!caseIds || caseIds.length === 0) {
    onUpdate(new Map());
    return () => {};
  }

  const progressMap = new Map();
  const unsubscribes = [];

  // Initialize map with default values
  caseIds.forEach((caseId) => {
    progressMap.set(caseId, toProgressModel(null, caseId));
  });

  const caseIdBatches = [];
  for (let i = 0; i < caseIds.length; i += BATCH_SIZE) {
    caseIdBatches.push(caseIds.slice(i, i + BATCH_SIZE));
  }

  caseIdBatches.forEach((batch) => {
    const progressCollection = collection(db, FirestorePaths.STUDENT_PROGRESS_COLLECTION(appId, uid));
    const q = query(progressCollection, where('__name__', 'in', batch));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
          // Reset to default if removed
          progressMap.set(change.doc.id, toProgressModel(null, change.doc.id));
        } else {
          progressMap.set(change.doc.id, toProgressModel(change.doc.data(), change.doc.id));
        }
      });
      onUpdate(new Map(progressMap));
    }, onError);

    unsubscribes.push(unsubscribe);
  });

  return () => {
    unsubscribes.forEach((unsub) => unsub());
  };
};

/**
 * Aggregates progress for every user with progress for the supplied case.
 * @param {{ appId: string, caseId: string }} params
 * @returns {Promise<Array<{ userId: string, progress: import('../models/progress').ProgressModel }>>}
 */
export const fetchProgressRosterForCase = async ({ appId, caseId }) => {
  if (!appId || !caseId) {
    throw new Error('fetchProgressRosterForCase requires both appId and caseId.');
  }

  const callable = httpsCallable(functions, 'listCaseProgressRoster');
  const result = await callable({ appId, caseId });
  const roster = Array.isArray(result?.data?.roster) ? result.data.roster : [];
  return roster
    .map((entry) => ({
      userId: entry?.userId || '',
      progress: toProgressModel(entry?.progress || null, caseId),
    }))
    .filter((entry) => Boolean(entry.userId))
    .sort((a, b) => a.userId.localeCompare(b.userId));
};

/**
 * Saves progress for a case.
 * @param {{ appId: string, uid: string, caseId: string, patch: Partial<import('../models/progress').ProgressModel> }} params
 */
export const saveProgress = async ({
  appId,
  uid,
  caseId,
  patch,
  forceOverwrite = false,
  clearActiveAttempt = false,
}) => {
  if (!appId || !uid || !caseId) {
    throw new Error('saveProgress requires appId, uid, and caseId.');
  }
  if (!patch || typeof patch !== 'object') {
    throw new Error('saveProgress requires a patch object.');
  }

  const isOffline = typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' && !navigator.onLine;
  if (isOffline) {
    const queueKey = `${appId}|${uid}|${caseId}`;
    const existingPatch = offlineQueue.get(queueKey);
    offlineQueue.set(queueKey, mergeProgressPatches(existingPatch, patch));
    return;
  }

  const percentCompleteRaw = patch.percentComplete ?? 0;
  const percentComplete = Number(percentCompleteRaw);

  if (!Number.isFinite(percentComplete) || percentComplete < 0 || percentComplete > 100) {
    throw new Error('percentComplete must be between 0 and 100.');
  }
  patch.percentComplete = percentComplete;

  const progressRef = doc(db, FirestorePaths.STUDENT_PROGRESS_COLLECTION(appId, uid), caseId);
  const shouldClearActiveAttempt = clearActiveAttempt === true;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const nextPatch = { ...patch, percentComplete };
      const serverDoc = await getDoc(progressRef);
      const serverData = serverDoc.data();
      const serverHasSuccess = Boolean(serverData?.hasSuccessfulAttempt);

      const serverUpdatedAtMs =
        serverData?.updatedAt && typeof serverData.updatedAt.toMillis === 'function'
          ? serverData.updatedAt.toMillis()
          : 0;
      const patchUpdatedAtMs =
        nextPatch?.updatedAt && typeof nextPatch.updatedAt.toMillis === 'function'
          ? nextPatch.updatedAt.toMillis()
          : 0;

      if (!forceOverwrite && serverData && serverUpdatedAtMs > patchUpdatedAtMs) {
        nextPatch.percentComplete = Math.max(nextPatch.percentComplete, serverData.percentComplete);
        nextPatch.state = deriveProgressState({
          step: nextPatch.step ?? serverData?.step,
          percentComplete: nextPatch.percentComplete,
        });
      }

      if (nextPatch.hasSuccessfulAttempt === undefined) {
        nextPatch.hasSuccessfulAttempt = serverHasSuccess;
      } else if (!forceOverwrite && serverHasSuccess) {
        nextPatch.hasSuccessfulAttempt = true;
      }

      if (shouldClearActiveAttempt) {
        nextPatch.activeAttempt = deleteField();
      } else if (nextPatch.activeAttempt === undefined && isRecord(nextPatch.draft)) {
        const existingStartedAt = serverData?.activeAttempt?.startedAt;
        nextPatch.activeAttempt = {
          draft: nextPatch.draft,
          startedAt: existingStartedAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
      } else if (
        !shouldClearActiveAttempt &&
        isRecord(nextPatch.activeAttempt) &&
        !nextPatch.activeAttempt.updatedAt
      ) {
        nextPatch.activeAttempt = {
          ...nextPatch.activeAttempt,
          updatedAt: serverTimestamp(),
        };
      } else if (
        !shouldClearActiveAttempt &&
        isRecord(nextPatch.activeAttempt) &&
        !nextPatch.activeAttempt.startedAt
      ) {
        nextPatch.activeAttempt = {
          ...nextPatch.activeAttempt,
          startedAt: serverData?.activeAttempt?.startedAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
      }

      const finalState =
        nextPatch.state ||
        deriveProgressState({
          step: nextPatch.step,
          percentComplete: nextPatch.percentComplete,
        });
      await setDoc(
        progressRef,
        { ...nextPatch, state: finalState, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return;
    } catch (err) {
      if (i === MAX_RETRIES - 1) {
        throw err;
      }
      await new Promise((res) => setTimeout(res, RETRY_DELAY_MS * Math.pow(2, i)));
    }
  }
};
