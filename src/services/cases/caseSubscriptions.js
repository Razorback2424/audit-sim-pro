import { collection, query, onSnapshot, where, doc } from 'firebase/firestore';
import { db, FirestorePaths } from '../../AppCore';
import { DEFAULT_AUDIT_AREA } from '../../models/caseConstants';
import {
  toNormalizedCaseModel,
  computeDisbursementAlerts,
  toMillis,
} from './caseTransforms';

export const subscribeToCases = (onData, onError) => {
  const q = query(collection(db, FirestorePaths.CASES_COLLECTION()));
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => toNormalizedCaseModel(d.id, d.data()));
    onData(data);
  }, onError);
};

export const subscribeToActiveCases = (onData, onError) => {
  const q = query(collection(db, FirestorePaths.CASES_COLLECTION()), where('_deleted', '==', false));
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => toNormalizedCaseModel(d.id, d.data()));
    onData(data);
  }, onError);
};

export const subscribeToCase = (caseId, onData, onError) => {
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      onData(null);
    } else {
      onData(toNormalizedCaseModel(snap.id, snap.data()));
    }
  }, onError);
};

const subscribeToActiveCaseModels = (onData, onError) =>
  subscribeToCases(
    (cases) => {
      const activeCases = cases.filter((item) => !item._deleted);
      onData(activeCases);
    },
    onError
  );

export const subscribeToAdminCaseSummary = (onData, onError) =>
  subscribeToActiveCaseModels((cases) => {
    const summary = cases.reduce(
      (acc, current) => {
        acc.activeCases += 1;
        acc.totalDisbursements += Array.isArray(current.disbursements) ? current.disbursements.length : 0;
        acc.totalMappings += Array.isArray(current.invoiceMappings) ? current.invoiceMappings.length : 0;
        if (current.status === 'draft') {
          acc.draftCases += 1;
        }
        if (current.publicVisible === false) {
          acc.restrictedCases += 1;
        }
        if (current.publicVisible === false && Array.isArray(current.visibleToUserIds) && current.visibleToUserIds.length > 0) {
          acc.privateAudiences += 1;
        }
        const rawArea = typeof current.auditArea === 'string' ? current.auditArea.trim() : '';
        const area = rawArea || DEFAULT_AUDIT_AREA;
        acc.auditAreaCounts[area] = (acc.auditAreaCounts[area] || 0) + 1;
        return acc;
      },
      {
        activeCases: 0,
        totalDisbursements: 0,
        totalMappings: 0,
        privateAudiences: 0,
        draftCases: 0,
        restrictedCases: 0,
        auditAreaCounts: {},
      }
    );
    onData(summary);
  }, onError);

export const subscribeToAdminCaseAlerts = (onData, onError) =>
  subscribeToActiveCaseModels((cases) => {
    const allAlerts = cases.flatMap((caseData) => computeDisbursementAlerts(caseData));
    onData(allAlerts);
  }, onError);

export const subscribeToRecentCaseActivity = (onData, onError, { limit: limitCount = 5 } = {}) =>
  subscribeToActiveCaseModels((cases) => {
    const items = cases
      .map((caseData) => {
        const timestamp = toMillis(caseData.updatedAt) ?? toMillis(caseData.createdAt) ?? 0;
        return {
          id: `case-${caseData.id}`,
          title: caseData.caseName || 'Untitled case',
          description: `Status: ${caseData.status || 'assigned'}`,
          actionPath: `/admin/case-overview/${caseData.id}`,
          timestamp,
        };
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limitCount);
    onData(items);
  }, onError);
