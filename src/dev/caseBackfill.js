import { Timestamp } from 'firebase/firestore';
import { isTimestamp, nullSafeDate } from '../utils/dates';

/**
 * Identify data quality issues for a case document.
 * @param {{ id: string } & Record<string, any>} caseDoc
 * @returns {{ id: string, issues: string[] }}
 */
export const analyzeCase = (caseDoc) => {
  const issues = [];

  if (typeof caseDoc.publicVisible !== 'boolean') {
    issues.push('Missing publicVisible flag');
  }

  if (caseDoc.visibleToUserIds != null && !Array.isArray(caseDoc.visibleToUserIds)) {
    issues.push('visibleToUserIds is not an array');
  }

  if (!caseDoc.dueAt) {
    issues.push('dueAt is missing');
  }

  if (caseDoc.opensAt && !isTimestamp(caseDoc.opensAt)) {
    issues.push('opensAt is not a Timestamp');
  }

  if (caseDoc.dueAt && !isTimestamp(caseDoc.dueAt)) {
    issues.push('dueAt is not a Timestamp');
  }

  return { id: caseDoc.id, issues };
};

/**
 * Build a safe backfill payload to normalize legacy case documents.
 * Nothing is written automatically; call updateCase manually with the result if desired.
 * @param {{ id: string } & Record<string, any>} caseDoc
 * @returns {{ id: string, updates: Record<string, any> } | null}
 */
export const buildBackfillUpdate = (caseDoc) => {
  const updates = {};

  if (typeof caseDoc.publicVisible !== 'boolean') {
    updates.publicVisible = false;
  }

  if (caseDoc.visibleToUserIds != null && !Array.isArray(caseDoc.visibleToUserIds)) {
    if (typeof caseDoc.visibleToUserIds === 'string') {
      updates.visibleToUserIds = caseDoc.visibleToUserIds
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    } else {
      updates.visibleToUserIds = [];
    }
  }

  const handleTemporalField = (key) => {
    const value = caseDoc[key];
    if (!value) return;
    if (isTimestamp(value)) return;
    const parsed = nullSafeDate(value);
    if (parsed) {
      updates[key] = Timestamp.fromDate(parsed);
    }
  };

  handleTemporalField('opensAt');
  handleTemporalField('dueAt');

  if (Object.keys(updates).length === 0) {
    return null;
  }

  return { id: caseDoc.id, updates };
};

/**
 * Build backfill payloads for a collection of case documents.
 * @param {Array<{ id: string } & Record<string, any>>} cases
 * @returns {Array<{ id: string, updates: Record<string, any> }>}
 */
export const buildBackfillPlan = (cases) => {
  return cases
    .map((caseDoc) => buildBackfillUpdate(caseDoc))
    .filter(Boolean);
};
