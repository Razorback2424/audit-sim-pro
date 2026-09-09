// This copy stays inside the deployed Functions bundle. Do not require client
// source from functions/src; Firebase uploads only the functions directory.
const normalizeCaseStatus = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const toMillis = (value) => {
  if (!value) return null;
  if (typeof value?.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value?.seconds === 'number') {
    const nanoseconds = typeof value?.nanoseconds === 'number' ? value.nanoseconds : 0;
    return value.seconds * 1000 + Math.floor(nanoseconds / 1e6);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const hasReadyFile = (doc) => {
  if (!doc || typeof doc !== 'object') return false;
  return Boolean(doc.downloadURL || doc.storagePath);
};

const hasPendingGeneratedDoc = (doc) => {
  if (!doc || typeof doc !== 'object') return false;
  const hasSpec = Boolean(doc.generationSpec || doc.generationSpecId);
  return hasSpec && !hasReadyFile(doc);
};

const hasMissingArtifact = (doc) => {
  if (!doc || typeof doc !== 'object') return false;
  const hasFileName = typeof doc.fileName === 'string' && doc.fileName.trim();
  return Boolean(hasFileName) && !hasReadyFile(doc);
};

const isCaseReadyForDemo = (caseData) => {
  if (!caseData || typeof caseData !== 'object') return false;
  const referenceDocuments = Array.isArray(caseData.referenceDocuments) ? caseData.referenceDocuments : [];
  const invoiceMappings = Array.isArray(caseData.invoiceMappings) ? caseData.invoiceMappings : [];
  const cashArtifacts = Array.isArray(caseData.cashArtifacts) ? caseData.cashArtifacts : [];

  const pendingGenerated =
    referenceDocuments.some(hasPendingGeneratedDoc) || invoiceMappings.some(hasPendingGeneratedDoc);
  if (pendingGenerated) return false;

  const missingCashArtifacts = cashArtifacts.some((doc) => {
    const type = typeof doc?.type === 'string' ? doc.type.trim() : '';
    if (!type) return false;
    return hasMissingArtifact(doc);
  });
  if (missingCashArtifacts) return false;

  return true;
};

const evaluateDemoCaseEligibility = ({ caseData, nowMs = Date.now() }) => {
  if (!caseData || typeof caseData !== 'object') {
    return { eligible: false, reason: 'case_missing' };
  }

  if (caseData._deleted === true) {
    return { eligible: false, reason: 'case_deleted' };
  }

  const status = normalizeCaseStatus(caseData.status);
  if (status === 'draft') {
    return { eligible: false, reason: 'case_draft' };
  }
  if (status === 'archived') {
    return { eligible: false, reason: 'case_archived' };
  }

  const opensAtMs = toMillis(caseData.opensAt);
  if (Number.isFinite(opensAtMs) && opensAtMs > nowMs) {
    return { eligible: false, reason: 'case_not_open' };
  }

  if (!isCaseReadyForDemo(caseData)) {
    return { eligible: false, reason: 'case_not_ready' };
  }

  return { eligible: true, reason: null };
};

module.exports = {
  evaluateDemoCaseEligibility,
  isCaseReadyForDemo,
  normalizeCaseStatus,
  toMillis,
};
