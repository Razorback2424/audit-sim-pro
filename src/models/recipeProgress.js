import { Timestamp } from 'firebase/firestore';

/**
 * @typedef {Object} RecipeProgressModel
 * @property {string} recipeId
 * @property {number} passedVersion
 * @property {Timestamp|null} passedAt
 */

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeTimestamp = (value) => (value instanceof Timestamp ? value : null);

/**
 * Normalize Firestore data into a RecipeProgressModel.
 * @param {any} data
 * @param {string} recipeId
 * @returns {RecipeProgressModel}
 */
export const toRecipeProgressModel = (data, recipeId) => {
  const { passedVersion, passedAt } = data || {};

  return {
    recipeId,
    passedVersion: normalizeNumber(passedVersion, 0),
    passedAt: normalizeTimestamp(passedAt),
  };
};
