import { Timestamp } from 'firebase/firestore';

/**
 * @typedef {Object} RecipeWorkflow
 * @property {string[]} [steps]
 * @property {'once' | 'per_attempt'} [gateScope]
 */

/**
 * @typedef {Object} RecipeModel
 * @property {string} id
 * @property {string} moduleId
 * @property {string} title
 * @property {string} moduleTitle
 * @property {string} pathId
 * @property {'foundations' | 'core' | 'advanced'} tier
 * @property {string} auditArea
 * @property {string} primarySkill
 * @property {Record<string, any>} instruction
 * @property {RecipeWorkflow} workflow
 * @property {Record<string, any>} generationConfig
 * @property {number} recipeVersion
 * @property {boolean} isActive
 * @property {Timestamp|null} [createdAt]
 * @property {Timestamp|null} [updatedAt]
 */

const normalizeTimestamp = (value) => (value instanceof Timestamp ? value : null);

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
  const gateScope = gateScopeRaw === 'per_attempt' ? 'per_attempt' : 'once';
  return {
    steps: steps.length > 0 ? steps : ['instruction', 'selection', 'testing', 'results'],
    gateScope,
  };
};

/**
 * Normalize Firestore data into a RecipeModel shape.
 * @param {string} id
 * @param {Record<string, any>} data
 * @returns {RecipeModel}
 */
export const toRecipeModel = (id, data) => {
  const raw = data && typeof data === 'object' ? { ...data } : {};
  const moduleId = toTrimmedString(raw.moduleId) || id;
  const title = toTrimmedString(raw.title || raw.moduleTitle);
  const moduleTitle = toTrimmedString(raw.moduleTitle || raw.title);
  const instruction =
    raw.instruction && typeof raw.instruction === 'object' ? { ...raw.instruction } : {};
  const generationConfig =
    raw.generationConfig && typeof raw.generationConfig === 'object' ? raw.generationConfig : {};

  return {
    id,
    moduleId,
    title,
    moduleTitle,
    pathId: toTrimmedString(raw.pathId),
    tier: normalizeTier(raw.tier),
    auditArea: toTrimmedString(raw.auditArea),
    primarySkill: toTrimmedString(raw.primarySkill),
    instruction,
    workflow: normalizeWorkflow(raw.workflow),
    generationConfig,
    recipeVersion: normalizeRecipeVersion(raw.recipeVersion ?? instruction.version),
    isActive: typeof raw.isActive === 'boolean' ? raw.isActive : true,
    createdAt: normalizeTimestamp(raw.createdAt),
    updatedAt: normalizeTimestamp(raw.updatedAt),
  };
};
