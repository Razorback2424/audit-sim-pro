import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, FirestorePaths } from '../AppCore';
import { toRecipeProgressModel } from '../models/recipeProgress';

export const fetchRecipeProgress = async ({ appId, uid, recipeId }) => {
  if (!appId || !uid || !recipeId) {
    throw new Error('fetchRecipeProgress requires appId, uid, and recipeId.');
  }

  const progressRef = doc(db, FirestorePaths.STUDENT_RECIPE_PROGRESS_DOCUMENT(appId, uid, recipeId));
  const snapshot = await getDoc(progressRef);
  if (!snapshot.exists()) {
    return toRecipeProgressModel(null, recipeId);
  }
  return toRecipeProgressModel(snapshot.data(), recipeId);
};

export const saveRecipeProgress = async ({ appId, uid, recipeId, passedVersion }) => {
  if (!appId || !uid || !recipeId) {
    throw new Error('saveRecipeProgress requires appId, uid, and recipeId.');
  }
  const normalizedVersion = Number(passedVersion);
  if (!Number.isFinite(normalizedVersion) || normalizedVersion <= 0) {
    throw new Error('saveRecipeProgress requires a valid passedVersion.');
  }

  const progressRef = doc(db, FirestorePaths.STUDENT_RECIPE_PROGRESS_DOCUMENT(appId, uid, recipeId));
  await setDoc(
    progressRef,
    {
      passedVersion: normalizedVersion,
      passedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};
