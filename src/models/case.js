import { DEFAULT_AUDIT_AREA, DEFAULT_ITEM_TYPE, AUDIT_AREAS } from './caseConstants';

/**
 * @typedef {import('firebase/firestore').Timestamp} FirestoreTimestamp
 */

/**
 * @typedef {Object} AuditEvidencePoint
 * @property {string} label - e.g., "Invoice Date"
 * @property {string} value - e.g., "2023-12-28"
 * @property {string} assertion - e.g., "cutoff", "existence"
 * @property {number} [toleranceDays] - Allowed date variance
 */

/**
 * @typedef {Object} GroundTruths
 * @property {string} [invoiceDate] - Actual invoice date (YYYY-MM-DD)
 * @property {string} [servicePeriodEnd] - Actual service period end date (YYYY-MM-DD)
 * @property {number} [actualCount] - Verified physical count (inventory)
 * @property {number} [confirmedValue] - Confirmed amount from third party
 * @property {string} [condition] - Qualitative notes (e.g., damaged)
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
 *   assertion?: string,
 *   reason?: string,
 * }} [answerKey]
 * @property {string|null} [storagePath]
 * @property {string|null} [downloadURL]
 * @property {string|null} [fileName]
 * @property {string|null} [contentType]
 * @property {Array<{ storagePath: string|null, downloadURL: string|null, fileName: string|null, contentType: string|null }>} [supportingDocuments]
 * @property {string} [description]
 * @property {string} [notes]
 * @property {Record<string, any>} [meta]
 * @property {string} [trapType]
 * @property {AuditEvidencePoint[]} [evidencePoints]
 * @property {string} [auditArea]
 * @property {string[]} [requiredAssertions]
 * @property {string[]} [errorReasons]
 * @property {boolean} [shouldFlag]
 * @property {'low' | 'medium' | 'high'} [riskLevel]
 * @property {{ allowVouching?: boolean, allowTracing?: boolean }} [directionalFlags]
 * @property {boolean} [hasAnswerKey]
 * @property {GroundTruths} [groundTruths]
 * @property {{ type?: string, config?: Record<string, any> }} [validator] - client-side validation rule
*/

/**
 * @typedef {Object} CaseReferenceDocument
 * @property {string} fileName
 * @property {string|null} [storagePath]
 * @property {string|null} [downloadURL]
 * @property {string|null} [contentType]
 */

/**
 * @typedef {Object} CaseInstruction
 * @property {string} title
 * @property {string} moduleCode
 * @property {{ headline: string, body: string, risk: string }} hook
 * @property {{ type: 'VIDEO'|'IMAGE', source_id?: string, url?: string }} visualAsset
 * @property {{ rule_text: string, reminder?: string }} heuristic
 * @property {{ question: string, options: Array<{ id: string, text: string, correct: boolean }>, success_message?: string, failure_message?: string }} gateCheck
 */

/**
 * @typedef {Object} CaseWorkpaper
 * @property {string} [layoutType]
 * @property {Record<string, any>} [layoutConfig]
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
 * @property {CaseWorkpaper} [workpaper]
 * @property {CaseInstruction} [instruction]
 */

export {}; // eslint-disable-line

/**
 * Coerce Firestore data into a CaseModel shape.
 * @param {string} id
 * @param {Record<string, any>} data
 * @returns {CaseModel}
 */
export const toCaseModel = (id, data) => {
  const sanitizedCase = data && typeof data === 'object' ? { ...data } : {};
  if ('groundTruths' in sanitizedCase) {
    delete sanitizedCase.groundTruths;
  }

  const rawItems = Array.isArray(sanitizedCase?.auditItems)
    ? sanitizedCase.auditItems
    : Array.isArray(sanitizedCase?.disbursements)
    ? sanitizedCase.disbursements
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
      if ('groundTruths' in normalized) {
        delete normalized.groundTruths;
      }
      return normalized;
    })
    .filter(Boolean);

  return {
    id,
    ...sanitizedCase,
    title: sanitizedCase?.title || sanitizedCase?.caseName || '',
    caseName: sanitizedCase?.caseName || sanitizedCase?.title || '',
    publicVisible: sanitizedCase?.publicVisible === false ? false : true,
    visibleToUserIds: Array.isArray(sanitizedCase?.visibleToUserIds)
      ? sanitizedCase.visibleToUserIds
      : [],
    opensAt: sanitizedCase?.opensAt,
    dueAt: sanitizedCase?.dueAt,
    status: sanitizedCase?.status,
    createdAt: sanitizedCase?.createdAt,
    updatedAt: sanitizedCase?.updatedAt,
    auditItems,
    disbursements: auditItems,
    invoiceMappings: Array.isArray(sanitizedCase?.invoiceMappings)
      ? sanitizedCase.invoiceMappings
      : [],
    referenceDocuments: Array.isArray(sanitizedCase?.referenceDocuments)
      ? sanitizedCase.referenceDocuments
      : [],
    auditArea:
      typeof sanitizedCase?.auditArea === 'string' && sanitizedCase.auditArea.trim()
        ? sanitizedCase.auditArea.trim()
        : DEFAULT_AUDIT_AREA,
    caseGroupId:
      typeof sanitizedCase?.caseGroupId === 'string' && sanitizedCase.caseGroupId.trim()
        ? sanitizedCase.caseGroupId.trim()
        : null,
    workpaper:
      sanitizedCase?.workpaper && typeof sanitizedCase.workpaper === 'object'
        ? {
            ...sanitizedCase.workpaper,
            layoutType:
              sanitizedCase.workpaper.layoutType ||
              (sanitizedCase?.auditArea === AUDIT_AREAS.CASH
                ? 'cash_recon'
                : sanitizedCase?.auditArea === AUDIT_AREAS.FIXED_ASSETS
                ? 'fixed_assets'
                : 'two_pane'),
            layoutConfig:
              sanitizedCase.workpaper.layoutConfig && typeof sanitizedCase.workpaper.layoutConfig === 'object'
                ? sanitizedCase.workpaper.layoutConfig
                : {},
          }
        : {
            layoutType:
              sanitizedCase?.auditArea === AUDIT_AREAS.CASH
                ? 'cash_recon'
                : sanitizedCase?.auditArea === AUDIT_AREAS.FIXED_ASSETS
                ? 'fixed_assets'
                : 'two_pane',
            layoutConfig: {},
          },
    workflow:
      Array.isArray(sanitizedCase?.workflow) && sanitizedCase.workflow.length > 0
        ? sanitizedCase.workflow
        : ['instruction', 'selection', 'testing', 'results'],
  };
};
