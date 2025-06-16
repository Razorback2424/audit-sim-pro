import { collection, doc, getDoc, getDocs, addDoc, setDoc, query, onSnapshot, where, Timestamp } from 'firebase/firestore';
import { db, FirestorePaths } from '../AppCore';

export const subscribeToCases = (onData, onError) => {
  const q = query(collection(db, FirestorePaths.CASES_COLLECTION()));
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onData(data);
  }, onError);
};

export const subscribeToActiveCases = (onData, onError) => {
  const q = query(collection(db, FirestorePaths.CASES_COLLECTION()), where('_deleted', '!=', true));
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onData(data);
  }, onError);
};

export const subscribeToCase = (caseId, onData, onError) => {
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      onData(null);
    } else {
      onData({ id: snap.id, ...snap.data() });
    }
  }, onError);
};

export const fetchCase = async (caseId) => {
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
};

export const createCase = async (data) => {
  const collectionRef = collection(db, FirestorePaths.CASES_COLLECTION());
  const docRef = await addDoc(collectionRef, { ...data, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  return docRef.id;
};

export const updateCase = async (caseId, data) => {
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  await setDoc(ref, { ...data, updatedAt: Timestamp.now() }, { merge: true });
};

export const markCaseDeleted = async (caseId) => {
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  await setDoc(ref, { _deleted: true, updatedAt: Timestamp.now() }, { merge: true });
};
