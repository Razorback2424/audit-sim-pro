import { Timestamp } from 'firebase/firestore';

/**
 * @typedef {'not_started' | 'in_progress' | 'submitted'} ProgressState
 */

/**
 * @typedef {'selection' | 'testing' | 'results'} ProgressStep
 */

/**
 * @typedef {{
 *   selectedPaymentIds: string[],
 *   classificationDraft: Record<string, any>,
 *   fixedAssetDraft?: Record<string, any>,
 *   cashLinkMap?: Record<string, any>,
 *   cashAdjustments?: any[],
 *   cashSummary?: Record<string, any>,
 *   [key: string]: any
 * }} ProgressDraft
 */

/**
 * @typedef {object} ProgressModel
 * @property {string} caseId
 * @property {ProgressState} state
 * @property {number} percentComplete
 * @property {Timestamp} updatedAt
 * @property {ProgressStep} step
 * @property {ProgressDraft} draft
 */

const VALID_STATES = ['not_started', 'in_progress', 'submitted'];
const DEFAULT_STATE = 'not_started';
const DEFAULT_STEP = 'selection';

const isRecord = (value) => typeof value === 'object' && value !== null;
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

const normalizeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeDraft = (draft) => {
  const raw = isRecord(draft) ? draft : {};
  return {
    ...raw,
    selectedPaymentIds: isStringArray(raw.selectedPaymentIds) ? raw.selectedPaymentIds : [],
    classificationDraft: isRecord(raw.classificationDraft) ? raw.classificationDraft : {},
    fixedAssetDraft: isRecord(raw.fixedAssetDraft) ? raw.fixedAssetDraft : {},
    cashLinkMap: isRecord(raw.cashLinkMap) ? raw.cashLinkMap : {},
    cashAdjustments: Array.isArray(raw.cashAdjustments) ? raw.cashAdjustments : [],
    cashSummary: isRecord(raw.cashSummary) ? raw.cashSummary : {},
  };
};

/**
 * Safely converts a Firestore document to a ProgressModel, with defaults.
 * @param {any} data The firestore document data.
 * @param {string} caseId The case id.
 * @returns {ProgressModel}
 */
export const toProgressModel = (data, caseId) => {
  const { state, percentComplete, updatedAt, step, draft } = data || {};

  const normalizedDraft = normalizeDraft(draft);

  return {
    caseId: caseId,
    state: VALID_STATES.includes(state) ? state : DEFAULT_STATE,
    percentComplete: normalizeNumber(percentComplete, 0),
    updatedAt: updatedAt instanceof Timestamp ? updatedAt : new Timestamp(0, 0),
    step: typeof step === 'string' ? step : DEFAULT_STEP,
    draft: normalizedDraft,
  };
};
