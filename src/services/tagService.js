import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db, FirestorePaths, appId as defaultAppId } from '../AppCore';

export const TAG_FIELDS = Object.freeze({
  SKILL_CATEGORIES: 'skillCategories',
  ERROR_REASONS: 'errorReasons',
});

export const DEFAULT_SKILL_CATEGORIES = [
  'Completeness',
  'Existence',
  'Accuracy / Valuation',
  'Cutoff',
  'Classification',
  'Rights & Obligations',
  'Fraud Risk',
  'Professional Skepticism',
  'Documentation',
];

export const DEFAULT_ERROR_REASONS = [
  'Service date in prior period',
  'Invoice date in subsequent period',
  'Liability incurred but not recorded',
  'Capital asset improperly expensed',
  'Expense improperly capitalized',
  'Duplicate payment',
  'Missing supporting invoice',
  'Outstanding check never cleared',
  'Deposit in transit delayed',
  'Bank fee not recorded',
  'Check amount differs from ledger',
  'Cost below capitalization threshold',
  'Useful life estimate unreasonable',
  'Physical count differs from book',
  'Obsolete or damaged inventory',
];

export const DEFAULT_GLOBAL_TAGS = Object.freeze({
  [TAG_FIELDS.SKILL_CATEGORIES]: DEFAULT_SKILL_CATEGORIES,
  [TAG_FIELDS.ERROR_REASONS]: DEFAULT_ERROR_REASONS,
});

const cleanTagValue = (value) => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).replace(/\s+/g, ' ').trim();
  }
  return '';
};

const normalizeTagList = (input, fallback = []) => {
  const sourceList = Array.isArray(input) && input.length > 0 ? input : fallback;
  const seen = new Set();
  const normalized = [];

  sourceList.forEach((entry) => {
    const cleaned = cleanTagValue(entry);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(cleaned);
  });

  return normalized;
};

const findExistingTag = (list, candidate) => {
  const target = cleanTagValue(candidate).toLowerCase();
  if (!target) return null;
  return list.find((entry) => cleanTagValue(entry).toLowerCase() === target) || null;
};

const resolveDocPath = (appIdOverride) =>
  FirestorePaths.GLOBAL_TAG_SETTINGS(appIdOverride || defaultAppId);

/**
 * Fetches the global tag lists, normalizing casing/whitespace and falling back to defaults.
 */
export const fetchGlobalTags = async ({ appId } = {}) => {
  const docRef = doc(db, resolveDocPath(appId));
  const snapshot = await getDoc(docRef);
  const data = snapshot.exists() ? snapshot.data() : {};

  return {
    [TAG_FIELDS.SKILL_CATEGORIES]: normalizeTagList(
      data[TAG_FIELDS.SKILL_CATEGORIES],
      DEFAULT_GLOBAL_TAGS[TAG_FIELDS.SKILL_CATEGORIES]
    ),
    [TAG_FIELDS.ERROR_REASONS]: normalizeTagList(
      data[TAG_FIELDS.ERROR_REASONS],
      DEFAULT_GLOBAL_TAGS[TAG_FIELDS.ERROR_REASONS]
    ),
    updatedAt: data.updatedAt,
  };
};

/**
 * Adds a new tag to the requested list, honoring existing matches case-insensitively.
 * Returns the resolved tag and the updated list for the caller to sync local state.
 */
export const addGlobalTag = async ({ field, value, appId } = {}) => {
  const fieldName =
    field === TAG_FIELDS.ERROR_REASONS || field === TAG_FIELDS.SKILL_CATEGORIES
      ? field
      : field === 'errorReasons' || field === 'skillCategories'
      ? field
      : null;

  if (!fieldName) {
    throw new Error('Unknown field. Use TAG_FIELDS.SKILL_CATEGORIES or TAG_FIELDS.ERROR_REASONS.');
  }

  const cleanedValue = cleanTagValue(value);
  if (!cleanedValue) {
    throw new Error('Tag value is required.');
  }

  const docRef = doc(db, resolveDocPath(appId));

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const data = snapshot.exists() ? snapshot.data() : {};
    const currentList = normalizeTagList(data[fieldName]);
    const existing = findExistingTag(currentList, cleanedValue);

    if (existing) {
      return { tag: existing, created: false, list: currentList };
    }

    const nextList = [...currentList, cleanedValue];
    transaction.set(
      docRef,
      { ...data, [fieldName]: nextList, updatedAt: serverTimestamp() },
      { merge: true }
    );

    return { tag: cleanedValue, created: true, list: nextList };
  });
};

/**
 * Normalizes free-form input and resolves to a canonical existing tag when possible.
 */
export const normalizeTagInput = (value, existingList = []) => {
  const cleaned = cleanTagValue(value);
  if (!cleaned) {
    return { resolved: '', matchedExisting: null };
  }

  const match = findExistingTag(existingList, cleaned);
  return {
    resolved: match || cleaned,
    matchedExisting: match,
  };
};
