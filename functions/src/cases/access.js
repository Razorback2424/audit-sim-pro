const { toSafeDate } = require('../shared/utils');

const normalizeBillingStatus = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const hasPaidBillingAccess = (billingData) => {
  const status = normalizeBillingStatus(billingData?.status);
  return status === 'active' || status === 'no_payment_required';
};

const normalizeAccessLevel = (value) =>
  typeof value === 'string' && value.trim().toLowerCase() === 'demo' ? 'demo' : 'paid';

const normalizeCaseStatus = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const toMillis = (value) => {
  if (!value) return null;
  if (typeof value?.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  const seconds =
    typeof value?.seconds === 'number'
      ? value.seconds
      : typeof value?._seconds === 'number'
      ? value._seconds
      : null;
  if (typeof seconds === 'number') {
    const nanoseconds =
      typeof value?.nanoseconds === 'number'
        ? value.nanoseconds
        : typeof value?._nanoseconds === 'number'
        ? value._nanoseconds
        : 0;
    return seconds * 1000 + Math.floor(nanoseconds / 1e6);
  }
  const safeDate = toSafeDate(value);
  return safeDate ? safeDate.getTime() : null;
};

const evaluateTraineeCaseAccess = ({ caseData, uid, hasPaidAccess, nowMs = Date.now() }) => {
  if (!caseData || typeof caseData !== 'object') {
    return { allowed: false, reason: 'case_missing' };
  }

  if (caseData._deleted === true) {
    return { allowed: false, reason: 'case_deleted' };
  }

  if (normalizeCaseStatus(caseData.status) === 'draft') {
    return { allowed: false, reason: 'case_draft' };
  }

  const opensAtMs = toMillis(caseData.opensAt);
  if (Number.isFinite(opensAtMs) && opensAtMs > nowMs) {
    return { allowed: false, reason: 'case_not_open' };
  }

  const isPublicVisible = caseData.publicVisible === true;
  const visibleToUserIds = Array.isArray(caseData.visibleToUserIds) ? caseData.visibleToUserIds : [];
  const accessLevel = normalizeAccessLevel(caseData.accessLevel);

  if (hasPaidAccess) {
    if (isPublicVisible || (uid && visibleToUserIds.includes(uid))) {
      return { allowed: true, reason: null };
    }
    return { allowed: false, reason: 'case_not_assigned' };
  }

  if (isPublicVisible && accessLevel === 'demo') {
    return { allowed: true, reason: null };
  }

  return { allowed: false, reason: 'demo_only' };
};

const evaluateAnonymousDemoCaseAccess = ({ caseData, nowMs = Date.now() }) => {
  if (!caseData || typeof caseData !== 'object') {
    return { allowed: false, reason: 'case_missing' };
  }

  if (caseData._deleted === true) {
    return { allowed: false, reason: 'case_deleted' };
  }

  if (normalizeCaseStatus(caseData.status) === 'draft') {
    return { allowed: false, reason: 'case_draft' };
  }

  const opensAtMs = toMillis(caseData.opensAt);
  if (Number.isFinite(opensAtMs) && opensAtMs > nowMs) {
    return { allowed: false, reason: 'case_not_open' };
  }

  const isPublicVisible = caseData.publicVisible === true;
  const accessLevel = normalizeAccessLevel(caseData.accessLevel);
  if (isPublicVisible && accessLevel === 'demo') {
    return { allowed: true, reason: null };
  }

  return { allowed: false, reason: 'demo_only' };
};

module.exports = {
  evaluateAnonymousDemoCaseAccess,
  evaluateTraineeCaseAccess,
  hasPaidBillingAccess,
  normalizeBillingStatus,
  toMillis,
};
