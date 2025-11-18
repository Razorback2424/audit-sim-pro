import { DEFAULT_AUDIT_AREA, DEFAULT_ITEM_TYPE } from './caseConstants';

/**
 * @typedef {import('firebase/firestore').Timestamp} FirestoreTimestamp
 */

/**
 * @typedef {Object} CaseDisbursement
 * @property {string} paymentId
 * @property {string} payee
 * @property {string|number} amount
 * @property {string} paymentDate
 * @property {string|null} [expectedClassification]
 * @property {{
 *   properlyIncluded?: number,
 *   properlyExcluded?: number,
 *   improperlyIncluded?: number,
 *   improperlyExcluded?: number,
 *   explanation?: string,
 * }} [answerKey]
 * @property {string|null} [storagePath]
 * @property {string|null} [downloadURL]
 * @property {string|null} [fileName]
 * @property {string|null} [contentType]
 * @property {Array<{ storagePath: string|null, downloadURL: string|null, fileName: string|null, contentType: string|null }>} [supportingDocuments]
 * @property {string} [description]
 * @property {string} [notes]
 * @property {Record<string, any>} [meta]
 */

/**
 * @typedef {Object} CaseReferenceDocument
 * @property {string} fileName
 * @property {string|null} [storagePath]
 * @property {string|null} [downloadURL]
 * @property {string|null} [contentType]
 */

/**
 * @typedef {Object} CaseModel
 * @property {string} id
 * @property {string} title
 * @property {string} caseName
 * @property {boolean} publicVisible
 * @property {string[]} [visibleToUserIds]
 * @property {FirestoreTimestamp} [opensAt]
 * @property {FirestoreTimestamp} [dueAt]
 * @property {'assigned' | 'in_progress' | 'submitted' | 'archived'} [status]
 * @property {FirestoreTimestamp} [createdAt]
 * @property {FirestoreTimestamp} [updatedAt]
 * @property {CaseDisbursement[]} [disbursements]
 * @property {Array<{ paymentId: string, storagePath: string|null, downloadURL: string|null, fileName: string|null, contentType: string|null }>} [invoiceMappings]
 * @property {CaseReferenceDocument[]} [referenceDocuments]
 * @property {string} auditArea
 * @property {string|null} [caseGroupId]
 */

export {}; // eslint-disable-line

/**
 * Coerce Firestore data into a CaseModel shape.
 * @param {string} id
 * @param {Record<string, any>} data
 * @returns {CaseModel}
 */
export const toCaseModel = (id, data) => {
  const rawItems = Array.isArray(data?.auditItems)
    ? data.auditItems
    : Array.isArray(data?.disbursements)
    ? data.disbursements
    : [];

  const auditItems = rawItems
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const normalized = { ...item };
      const fallbackId = `item-${index + 1}`;
      const inferredId = normalized.id || normalized.paymentId || fallbackId;
      normalized.id = inferredId;
      if (!normalized.paymentId) {
        normalized.paymentId = inferredId;
      }
      normalized.type = normalized.type || DEFAULT_ITEM_TYPE;
      return normalized;
    })
    .filter(Boolean);

  return {
    id,
    ...data,
    title: data?.title || data?.caseName || '',
    caseName: data?.caseName || data?.title || '',
    publicVisible: data?.publicVisible === false ? false : true,
    visibleToUserIds: Array.isArray(data?.visibleToUserIds) ? data.visibleToUserIds : [],
    opensAt: data?.opensAt,
    dueAt: data?.dueAt,
    status: data?.status,
    createdAt: data?.createdAt,
    updatedAt: data?.updatedAt,
    auditItems,
    disbursements: auditItems,
    invoiceMappings: Array.isArray(data?.invoiceMappings) ? data.invoiceMappings : [],
    referenceDocuments: Array.isArray(data?.referenceDocuments) ? data.referenceDocuments : [],
    auditArea: typeof data?.auditArea === 'string' && data.auditArea.trim()
      ? data.auditArea.trim()
      : DEFAULT_AUDIT_AREA,
    caseGroupId:
      typeof data?.caseGroupId === 'string' && data.caseGroupId.trim()
        ? data.caseGroupId.trim()
        : null,
    workflow:
      Array.isArray(data?.workflow) && data.workflow.length > 0
        ? data.workflow
        : ['selection', 'testing', 'results'],
  };
};
