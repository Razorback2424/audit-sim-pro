import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { db, FirestorePaths } from '../AppCore';
import { toRecipeModel } from '../models/recipe';

const toTrimmedString = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const normalizeTier = (value) => {
  const normalized = toTrimmedString(value).toLowerCase();
  if (normalized === 'foundations' || normalized === 'core' || normalized === 'advanced') {
    return normalized;
  }
  return 'foundations';
};

const normalizeRecipeVersion = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.floor(parsed);
};

const normalizeWorkflow = (value) => {
  const workflow = value && typeof value === 'object' ? { ...value } : {};
  const steps = Array.isArray(workflow.steps)
    ? workflow.steps.map((step) => toTrimmedString(step)).filter(Boolean)
    : [];
  const gateScopeRaw = toTrimmedString(workflow.gateScope);
  return {
    steps: steps.length > 0 ? steps : ['instruction', 'selection', 'testing', 'results'],
    gateScope: gateScopeRaw === 'per_attempt' ? 'per_attempt' : 'once',
  };
};

const sanitizeRecipeWriteData = (rawData = {}, { isCreate = false } = {}) => {
  const { createdAt: _ignoredCreatedAt, updatedAt: _ignoredUpdatedAt, ...data } = rawData;
  const sanitized = { ...data };

  sanitized.moduleId = toTrimmedString(sanitized.moduleId);
  sanitized.title = toTrimmedString(sanitized.title || sanitized.moduleTitle);
  sanitized.moduleTitle = toTrimmedString(sanitized.moduleTitle || sanitized.title);
  sanitized.pathId = toTrimmedString(sanitized.pathId);
  sanitized.tier = normalizeTier(sanitized.tier);
  sanitized.auditArea = toTrimmedString(sanitized.auditArea);
  sanitized.primarySkill = toTrimmedString(sanitized.primarySkill);
  sanitized.workflow = normalizeWorkflow(sanitized.workflow);

  const recipeVersion = normalizeRecipeVersion(sanitized.recipeVersion ?? sanitized.instruction?.version);
  sanitized.recipeVersion = recipeVersion;

  if (sanitized.instruction && typeof sanitized.instruction === 'object') {
    sanitized.instruction = { ...sanitized.instruction, version: recipeVersion };
  } else {
    sanitized.instruction = { version: recipeVersion };
  }

  if (!sanitized.generationConfig || typeof sanitized.generationConfig !== 'object') {
    sanitized.generationConfig = {};
  }

  if (typeof sanitized.isActive !== 'boolean') {
    sanitized.isActive = true;
  }

  sanitized.updatedAt = serverTimestamp();
  if (isCreate) {
    sanitized.createdAt = serverTimestamp();
  } else if ('createdAt' in sanitized) {
    sanitized.createdAt = sanitized.createdAt ?? serverTimestamp();
  }

  return sanitized;
};

export const fetchRecipe = async (recipeId) => {
  if (!recipeId) return null;
  const ref = doc(db, FirestorePaths.RECIPE_DOCUMENT(recipeId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return toRecipeModel(snap.id, snap.data());
};

export const listRecipes = async ({ pageSize = 50 } = {}) => {
  const collectionRef = collection(db, FirestorePaths.RECIPES_COLLECTION());
  const q = query(collectionRef, orderBy('updatedAt', 'desc'), limit(pageSize));
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => toRecipeModel(docSnap.id, docSnap.data()));
};

export const createRecipe = async (data) => {
  const moduleId = toTrimmedString(data?.moduleId);
  if (!moduleId) {
    throw new Error('Recipe moduleId is required.');
  }
  const ref = doc(db, FirestorePaths.RECIPE_DOCUMENT(moduleId));
  const existing = await getDoc(ref);
  if (existing.exists()) {
    return { id: moduleId, created: false, existingId: moduleId };
  }
  const payload = sanitizeRecipeWriteData(data, { isCreate: true });
  await setDoc(ref, payload);
  return { id: moduleId, created: true };
};

export const updateRecipe = async (recipeId, data) => {
  if (!recipeId) {
    throw new Error('updateRecipe requires a recipeId.');
  }
  const payload = sanitizeRecipeWriteData(data, { isCreate: false });
  const ref = doc(db, FirestorePaths.RECIPE_DOCUMENT(recipeId));
  await setDoc(ref, payload, { merge: true });
};

export const toTimestampOrNull = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value?.seconds === 'number' && typeof value?.nanoseconds === 'number') {
    try {
      return new Timestamp(value.seconds, value.nanoseconds);
    } catch (err) {
      return null;
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return Timestamp.fromDate(parsed);
    }
  }
  return null;
};
