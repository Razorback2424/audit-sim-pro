import { doc, getDoc } from 'firebase/firestore';
import { db, FirestorePaths, functions } from '../AppCore';
import { httpsCallable } from 'firebase/functions';
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

export const saveRecipeProgress = async ({ appId, uid, caseId, recipeId, passedVersion, selectedOptionId }) => {
  if (!appId || !uid || !recipeId) {
    throw new Error('saveRecipeProgress requires appId, uid, and recipeId.');
  }
  const normalizedVersion = Number(passedVersion);
  if (!Number.isFinite(normalizedVersion) || normalizedVersion <= 0) {
    throw new Error('saveRecipeProgress requires a valid passedVersion.');
  }

  if (!caseId || !selectedOptionId) {
    throw new Error('saveRecipeProgress requires caseId and selectedOptionId.');
  }
  const callable = httpsCallable(functions, 'recordRecipeGateCompletion');
  const result = await callable({ appId, caseId, recipeId, recipeVersion: normalizedVersion, selectedOptionId });
  return result?.data || null;
};

export const recordRecipeGateCompletion = async ({ appId, caseId, recipeId, recipeVersion, selectedOptionId }) => {
  const callable = httpsCallable(functions, 'recordRecipeGateCompletion');
  const result = await callable({ appId, caseId, recipeId, recipeVersion, selectedOptionId });
  return result?.data || null;
};
