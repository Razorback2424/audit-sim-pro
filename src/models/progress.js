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
 *   classificationDraft: Record<string, Record<string, string>>,
 *   fixedAssetDraft?: Record<string, any>
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

/**
 * Safely converts a Firestore document to a ProgressModel, with defaults.
 * @param {any} data The firestore document data.
 * @param {string} caseId The case id.
 * @returns {ProgressModel}
 */
export const toProgressModel = (data, caseId) => {
  const { state, percentComplete, updatedAt, step, draft } = data || {};

  const normalizedDraft = isRecord(draft)
    ? {
        selectedPaymentIds: isStringArray(draft.selectedPaymentIds) ? draft.selectedPaymentIds : [],
        classificationDraft: isRecord(draft.classificationDraft)
          ? Object.keys(draft.classificationDraft).reduce((acc, key) => {
              const value = draft.classificationDraft[key];
              if (isRecord(value)) {
                const normalizedEntry = {};
                Object.keys(value).forEach((fieldKey) => {
                  if (typeof value[fieldKey] === 'string') {
                    normalizedEntry[fieldKey] = value[fieldKey];
                  }
                });
                acc[key] = normalizedEntry;
              }
              return acc;
            }, {})
          : {},
        fixedAssetDraft: isRecord(draft.fixedAssetDraft) ? { ...draft.fixedAssetDraft } : {},
      }
    : { selectedPaymentIds: [], classificationDraft: {}, fixedAssetDraft: {} };

  return {
    caseId: caseId,
    state: VALID_STATES.includes(state) ? state : DEFAULT_STATE,
    percentComplete: typeof percentComplete === 'number' ? percentComplete : 0,
    updatedAt: updatedAt instanceof Timestamp ? updatedAt : new Timestamp(0, 0),
    step: typeof step === 'string' ? step : DEFAULT_STEP,
    draft: normalizedDraft,
  };
};
