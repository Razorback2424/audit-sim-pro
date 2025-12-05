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
} from 'firebase/firestore';
import { db, FirestorePaths } from '../AppCore';
import { toProgressModel } from '../models/progress';

const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

const offlineQueue = new Map();

window.addEventListener('online', () => {
  offlineQueue.forEach((patch, key) => {
    const [appId, uid, caseId] = key.split('|');
    saveProgress({ appId, uid, caseId, patch });
  });
  offlineQueue.clear();
});

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

  const rosterRoot = collection(db, `artifacts/${appId}/student_progress`);
  const rosterSnapshot = await getDocs(rosterRoot);
  const roster = [];

  await Promise.all(
    rosterSnapshot.docs.map(async (userDoc) => {
      const userId = userDoc.id;
      const progressRef = doc(db, FirestorePaths.STUDENT_PROGRESS_COLLECTION(appId, userId), caseId);
      const progressSnap = await getDoc(progressRef);
      if (!progressSnap.exists()) return;
      roster.push({
        userId,
        progress: toProgressModel(progressSnap.data(), progressSnap.id),
      });
    })
  );

  roster.sort((a, b) => a.userId.localeCompare(b.userId));
  return roster;
};

/**
 * Saves progress for a case.
 * @param {{ appId: string, uid: string, caseId: string, patch: Partial<import('../models/progress').ProgressModel> }} params
 */
export const saveProgress = async ({ appId, uid, caseId, patch, forceOverwrite = false }) => {
  if (!navigator.onLine) {
    offlineQueue.set(`${appId}|${uid}|${caseId}`, patch);
    return;
  }

  const { percentComplete } = patch;

  if (percentComplete < 0 || percentComplete > 100) {
    throw new Error('percentComplete must be between 0 and 100.');
  }

  let { state } = patch;
  if (!state) {
    if (percentComplete === 0) {
      state = 'not_started';
    } else if (percentComplete === 100) {
      state = 'submitted';
    } else {
      state = 'in_progress';
    }
  }

  const progressRef = doc(db, FirestorePaths.STUDENT_PROGRESS_COLLECTION(appId, uid), caseId);

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const serverDoc = await getDoc(progressRef);
      const serverData = serverDoc.data();

      if (!forceOverwrite && serverData && serverData.updatedAt.toMillis() > (patch.updatedAt?.toMillis() || 0)) {
        patch.percentComplete = Math.max(patch.percentComplete, serverData.percentComplete);
        if (patch.percentComplete === 100) {
          patch.state = 'submitted';
        } else if (patch.percentComplete > 0) {
          patch.state = 'in_progress';
        } else {
          patch.state = 'not_started';
        }
      }

      await setDoc(progressRef, { ...patch, state, updatedAt: serverTimestamp() }, { merge: true });
      return;
    } catch (err) {
      if (i === MAX_RETRIES - 1) {
        throw err;
      }
      await new Promise((res) => setTimeout(res, RETRY_DELAY_MS * Math.pow(2, i)));
    }
  }
};
