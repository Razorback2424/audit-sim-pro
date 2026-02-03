import { Timestamp } from 'firebase/firestore';
import { appId } from '../AppCore';
import { createCase, updateCase } from '../services/caseService';
import { getCurrentUserOrgId } from '../services/userService';
import getUUID from '../utils/getUUID';
import { mergeDisbursementDocuments } from '../utils/caseFormTransforms';
import { AUDIT_AREAS } from '../models/caseConstants';
import { CASH_ARTIFACT_TYPES } from '../constants/caseFormOptions';
import { ANSWER_KEY_FIELDS, ANSWER_KEY_TOLERANCE, ANSWER_KEY_PLACEHOLDER } from '../utils/caseFormHelpers';
import { queueCaseGenerationJob, saveCaseGenerationPlan } from '../services/caseGenerationService';

const canUseLocalStorage = () => {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
};

const sanitizeHighlightedDocumentForSave = (doc) => {
  if (!doc || typeof doc !== 'object') return undefined;
  const fileName = (doc.fileName || '').trim();
  const storagePath = (doc.storagePath || '').trim();
  if (!fileName && !storagePath) return undefined;
  const payload = {};
  if (fileName) payload.fileName = fileName;
  if (storagePath) payload.storagePath = storagePath;
  if (doc.contentType) payload.contentType = doc.contentType;
  return payload;
};

const parseDateTimeInputValue = (value, label) => {
  if (!value) {
    return { timestamp: null };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { error: `${label} must be a valid date/time.` };
  }
  return { timestamp: Timestamp.fromDate(parsed) };
};

export function createCaseFormSubmitHandler({
  meta: { isEditing, editingCaseId, draftCaseId },
  state: {
    caseName,
    yearEndInput,
    yearEndValue,
    caseLevel,
    moduleId,
    recipeVersion,
    auditArea,
    layoutType,
    layoutConfigRaw,
    instruction,
    publicVisible,
    selectedUserIds,
    caseGroupSelection,
    customCaseGroupId,
    status,
    opensAtStr,
    dueAtStr,
    cashContext,
    cashOutstandingItems,
    cashCutoffItems,
    cashRegisterItems,
    cashReconciliationMap,
    faSummary,
    faRisk,
    faAdditions,
    faDisposals,
    disbursements,
    referenceDocuments,
    cashArtifacts,
    originalCaseData,
    generationPlan,
  },
  user: { userId, userProfile, role },
  ui: { showModal, navigate, setLoading },
  log: { ulog, logValidationFail },
  uploads: { uploadFileAndGetMetadata, uploadReferenceDocument, uploadHighlightedDocument },
  draftStorageKey,
  highlightStartRef,
  highlightStartTimerRef,
}) {
  return async function handleSubmit(event) {
    event.preventDefault();

    ulog('case-save:start', {
      isEditing,
      editingCaseId,
      disbursementCount: disbursements.length,
      hasHighlighted: disbursements.some((d) => d?.highlightedDocument?.clientSideFile),
    });

    let derivedReconciliationMap = cashReconciliationMap;
    let faAdditionsTotal = 0;
    let faDisposalsTotal = 0;
    let parsedLayoutConfig = {};

    if (layoutConfigRaw && layoutConfigRaw.trim()) {
      try {
        const parsed = JSON.parse(layoutConfigRaw);
        if (parsed && typeof parsed === 'object') {
          parsedLayoutConfig = parsed;
        } else {
          logValidationFail('layout-config-not-object');
          showModal('Layout Config must be valid JSON object.', 'Validation Error');
          return;
        }
      } catch (err) {
        logValidationFail('layout-config-invalid-json', { error: err.message });
        showModal('Layout Config must be valid JSON. ' + err.message, 'Validation Error');
        return;
      }
    }

    if (!caseName.trim()) {
      logValidationFail('case-name-required');
      showModal('Case name is required.', 'Validation Error');
      return;
    }

    const resolvedYearEnd = (yearEndValue || '').trim();
    if (!resolvedYearEnd) {
      logValidationFail('year-end-required');
      showModal('Year-end date is required.', 'Validation Error');
      return;
    }

    if (!caseLevel || typeof caseLevel !== 'string') {
      logValidationFail('case-level-required');
      showModal('Case level is required.', 'Validation Error');
      return;
    }
    const normalizedLevel = caseLevel.trim();
    if (!['basic', 'intermediate', 'advanced'].includes(normalizedLevel)) {
      logValidationFail('case-level-invalid');
      showModal('Case level must be Basic, Intermediate, or Advanced.', 'Validation Error');
      return;
    }

    if (auditArea === AUDIT_AREAS.CASH) {
      const cashModuleTypeRaw = typeof cashContext?.moduleType === 'string' ? cashContext.moduleType.trim() : '';
      const cashModuleType = cashModuleTypeRaw || 'bank_reconciliation';
      const isOutstandingCheckTesting = cashModuleType === 'outstanding_check_testing';

      const { bookBalance, bankBalance, reconciliationDate } = cashContext || {};
      if (!bookBalance || !bankBalance || !reconciliationDate) {
        logValidationFail('cash-context-incomplete', { bookBalance, bankBalance, reconciliationDate });
        showModal(
          'For Cash cases, provide Book Balance, Bank Statement Balance, and the reconciliation/reporting date in the Data Entry step.',
          'Validation Error'
        );
        return;
      }

      const outstandingIssues = [];
      if (isOutstandingCheckTesting) {
        const cutoffWindowDaysRaw = cashContext?.cutoffWindowDays;
        const cutoffWindowDays = Number(cutoffWindowDaysRaw);
        if (!Number.isFinite(cutoffWindowDays) || cutoffWindowDays <= 0) {
          logValidationFail('cash-otc-cutoff-window-missing', { cutoffWindowDays: cutoffWindowDaysRaw });
          showModal('For Outstanding Check Testing, provide the cutoff window (days) in Cash Context.', 'Validation Error');
          return;
        }
      }
      cashOutstandingItems.forEach((item, idx) => {
        const missing = [];
        if (!item.reference) missing.push(isOutstandingCheckTesting ? 'Check #' : 'Reference #');
        if (!item.amount) missing.push('Amount');
        if (!isOutstandingCheckTesting) {
          if (!item.payee) missing.push('Description / Payee');
          if (!item.issueDate) missing.push('Book Date');
        }
        if (missing.length > 0) {
          outstandingIssues.push(`Outstanding item #${idx + 1} missing: ${missing.join(', ')}.`);
        }
      });
      if (outstandingIssues.length > 0) {
        logValidationFail('cash-outstanding-items-incomplete', { issues: outstandingIssues });
        showModal(outstandingIssues.join('\n'), 'Validation Error');
        return;
      }

      const cutoffIssues = [];
      cashCutoffItems.forEach((item, idx) => {
        const missing = [];
        if (!item.reference) missing.push(isOutstandingCheckTesting ? 'Check #' : 'Reference #');
        if (!item.clearDate) missing.push(isOutstandingCheckTesting ? 'Clearing Date' : 'Cleared Date');
        if (!item.amount) missing.push('Amount');
        if (missing.length > 0) {
          cutoffIssues.push(`Cutoff item #${idx + 1} missing: ${missing.join(', ')}.`);
        }
      });
      if (cutoffIssues.length > 0) {
        logValidationFail('cash-cutoff-items-incomplete', { issues: cutoffIssues });
        showModal(cutoffIssues.join('\n'), 'Validation Error');
        return;
      }

      if (isOutstandingCheckTesting) {
        const normalizeCheckNo = (value) => (value === null || value === undefined ? '' : String(value).trim());
        const normalizeAmount = (value) => {
          const num = Number(value);
          return Number.isFinite(num) ? num : null;
        };
        const findDuplicates = (values) => {
          const counts = new Map();
          values.forEach((val) => {
            if (!val) return;
            counts.set(val, (counts.get(val) || 0) + 1);
          });
          return Array.from(counts.entries())
            .filter(([, count]) => count > 1)
            .map(([val]) => val);
        };

        const cutoffCheckNos = (cashCutoffItems || []).map((item) => normalizeCheckNo(item?.reference)).filter(Boolean);
        const outstandingCheckNos = (cashOutstandingItems || [])
          .map((item) => normalizeCheckNo(item?.reference))
          .filter(Boolean);
        const registerCheckNos = (cashRegisterItems || [])
          .map((item) => normalizeCheckNo(item?.checkNo))
          .filter(Boolean);

        const duplicateCutoff = findDuplicates(cutoffCheckNos);
        const duplicateOutstanding = findDuplicates(outstandingCheckNos);
        const duplicateRegister = findDuplicates(registerCheckNos);
        if (duplicateCutoff.length || duplicateOutstanding.length || duplicateRegister.length) {
          const parts = [];
          if (duplicateCutoff.length) parts.push(`Duplicate cutoff check numbers: ${duplicateCutoff.join(', ')}`);
          if (duplicateRegister.length) parts.push(`Duplicate register check numbers: ${duplicateRegister.join(', ')}`);
          if (duplicateOutstanding.length) parts.push(`Duplicate outstanding list check numbers: ${duplicateOutstanding.join(', ')}`);
          logValidationFail('cash-otc-duplicate-check-nos', { duplicateCutoff, duplicateRegister, duplicateOutstanding });
          showModal(parts.join('\n'), 'Validation Error');
          return;
        }

        const registerIssues = [];
        const registerIndex = new Map();
        (cashRegisterItems || []).forEach((item) => {
          const checkNo = normalizeCheckNo(item?.checkNo);
          if (!checkNo) return;
          registerIndex.set(checkNo, item);
        });
        (cashRegisterItems || []).forEach((item, idx) => {
          const missing = [];
          if (!item.checkNo) missing.push('Check #');
          if (!item.writtenDate) missing.push('Written date');
          if (!item.amount) missing.push('Amount');
          if (missing.length > 0) {
            registerIssues.push(`Register item #${idx + 1} missing: ${missing.join(', ')}.`);
          }
        });
        if (registerIssues.length > 0) {
          logValidationFail('cash-register-items-incomplete', { issues: registerIssues });
          showModal(registerIssues.join('\n'), 'Validation Error');
          return;
        }

        const missingRegisterForCutoff = cutoffCheckNos.filter((checkNo) => !registerIndex.has(checkNo));
        if (missingRegisterForCutoff.length > 0) {
          logValidationFail('cash-otc-register-missing-for-cutoff', { missing: missingRegisterForCutoff });
          showModal(
            `Every January cutoff cleared check must have a matching check register entry (by check #).\nMissing: ${missingRegisterForCutoff.join(
              ', '
            )}`,
            'Validation Error'
          );
          return;
        }

        const mismatchIssues = [];
        cutoffCheckNos.forEach((checkNo) => {
          const cutoffItem = (cashCutoffItems || []).find((item) => normalizeCheckNo(item?.reference) === checkNo);
          const registerItem = registerIndex.get(checkNo);
          const cutoffAmount = normalizeAmount(cutoffItem?.amount);
          const registerAmount = normalizeAmount(registerItem?.amount);
          if (cutoffAmount !== null && registerAmount !== null && Math.abs(cutoffAmount - registerAmount) > 0.01) {
            mismatchIssues.push(`Amount mismatch for check #${checkNo} (cutoff ${cutoffAmount} vs register ${registerAmount}).`);
          }
        });
        if (mismatchIssues.length > 0) {
          logValidationFail('cash-otc-amount-mismatch', { issues: mismatchIssues });
          showModal(mismatchIssues.join('\n'), 'Validation Error');
          return;
        }

        // Reverse-direction module does not use the reconciliation mapper.
        derivedReconciliationMap = [];
      } else {
        const normalizedMap = [...cashReconciliationMap];
      cashCutoffItems.forEach((cutoffItem) => {
        const hasMap = normalizedMap.some((m) => m.cutoffTempId === cutoffItem._tempId);
        if (!hasMap) {
          normalizedMap.push({
            _tempId: getUUID(),
            outstandingTempId: '',
            cutoffTempId: cutoffItem._tempId,
            scenarioType: 'unrecorded',
          });
        }
      });

      const mappingIssues = [];
      cashOutstandingItems.forEach((item, idx) => {
        const mapping = normalizedMap.find((m) => m.outstandingTempId === item._tempId);
        if (!mapping || !mapping.scenarioType) {
          mappingIssues.push(
            `Reconciliation mapping required for outstanding item #${idx + 1} (${item.reference || 'no ref'}).`
          );
        }
      });
      if (mappingIssues.length > 0) {
        logValidationFail('cash-reconciliation-map-incomplete', { issues: mappingIssues });
        showModal(mappingIssues.join('\n'), 'Validation Error');
        return;
      }

      derivedReconciliationMap = normalizedMap;
      }
    }

    if (auditArea === AUDIT_AREAS.FIXED_ASSETS) {
      const faIssues = [];
      if (!faRisk.tolerableMisstatement) {
        faIssues.push('Enter a tolerable misstatement for Fixed Assets.');
      }
      faSummary.forEach((row, idx) => {
        const missing = [];
        if (!row.className) missing.push('Asset class name');
        if (!row.beginningBalance) missing.push('Beginning balance');
        if (!row.additions) missing.push('Additions');
        if (!row.disposals) missing.push('Disposals');
        if (!row.endingBalance) missing.push('Ending balance');
        if (missing.length > 0) {
          faIssues.push(`Rollforward class #${idx + 1} missing: ${missing.join(', ')}.`);
        }
        const begin = Number(row.beginningBalance) || 0;
        const add = Number(row.additions) || 0;
        const disp = Number(row.disposals) || 0;
        const end = Number(row.endingBalance) || 0;
        if (Math.abs(begin + add - disp - end) > 0.01) {
          faIssues.push(
            `Rollforward class ${row.className || idx + 1} does not foot (Beg + Add - Disp should equal End).`
          );
        }
        faAdditionsTotal += add;
        faDisposalsTotal += disp;
      });

      faAdditions.forEach((item, idx) => {
        const missing = [];
        if (!item.vendor) missing.push('Vendor/Description');
        if (!item.amount) missing.push('Amount');
        if (!item.inServiceDate) missing.push('In-service date');
        if (!item.natureOfExpenditure) missing.push('Nature of expenditure');
        if (!item.properPeriod) missing.push('Proper period');
        if (missing.length > 0) {
          faIssues.push(`Addition #${idx + 1} missing: ${missing.join(', ')}.`);
        }
      });
      faDisposals.forEach((item, idx) => {
        const missing = [];
        if (!item.assetId) missing.push('Asset ID/Description');
        if (!item.proceeds) missing.push('Proceeds');
        if (!item.nbv) missing.push('Net book value');
        if (missing.length > 0) {
          faIssues.push(`Disposal #${idx + 1} missing: ${missing.join(', ')}.`);
        }
      });

      const detailAddSum = faAdditions.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      const detailDispSum = faDisposals.reduce((sum, item) => sum + (Number(item.proceeds) || 0), 0);
      if (Math.abs(detailAddSum - faAdditionsTotal) > 0.5) {
        faIssues.push('Additions detail total does not tie to rollforward additions.');
      }
      if (Math.abs(detailDispSum - faDisposalsTotal) > 0.5) {
        faIssues.push('Disposals detail total does not tie to rollforward disposals.');
      }

      if (faIssues.length > 0) {
        logValidationFail('fixed-assets-incomplete', { issues: faIssues });
        showModal(faIssues.join('\n'), 'Validation Error');
        return;
      }
    }

    if (!Array.isArray(disbursements) || disbursements.length === 0) {
      logValidationFail('no-disbursements');
      showModal('Add at least one disbursement before saving.', 'Validation Error');
      return;
    }

    const keyFields =
      auditArea === AUDIT_AREAS.CASH
        ? ['paymentId', 'payee', 'amount', 'paymentDate', 'transactionType']
        : ['paymentId', 'payee', 'amount', 'paymentDate'];
    for (let index = 0; index < disbursements.length; index++) {
      const item = disbursements[index];
      const missingFields = keyFields.filter((field) => !item[field]);
      if (missingFields.length > 0) {
        logValidationFail('disbursement-incomplete', { index, item, missingFields });
        showModal(`Disbursement #${index + 1} is missing: ${missingFields.join(', ')}.`, 'Validation Error');
        return;
      }
    }

    const answerKeyIssues = [];
    disbursements.forEach((disbursement, index) => {
      const key = disbursement.answerKey || {};
      const amountNumber = Number(disbursement.amount || 0);
      const explanationMissing = !String(key.explanation || '').trim();

      if (disbursement.answerKeyMode === 'split') {
        const totals = ANSWER_KEY_FIELDS.reduce((sum, field) => {
          const value = Number(key[field] || 0);
          if (!Number.isNaN(value)) return sum + value;
          return sum;
        }, 0);
        const hasValues = ANSWER_KEY_FIELDS.some((field) => Number(key[field] || 0) > 0);
        if (!hasValues || explanationMissing) {
          answerKeyIssues.push(
            `Answer key for disbursement #${index + 1} (${
              disbursement.paymentId || 'no payment ID'
            }) requires split amounts and an explanation.`
          );
          return;
        }
        const diff = Math.abs(totals - amountNumber);
        if (diff > ANSWER_KEY_TOLERANCE) {
          answerKeyIssues.push(
            `Disbursement #${index + 1} (${
              disbursement.paymentId || 'no payment ID'
            }) has answer key totals (${totals.toFixed(2)}) that do not match the disbursement amount (${amountNumber.toFixed(
              2
            )}).`
          );
        }
        return;
      }

      const classification = disbursement.answerKeySingleClassification;
      if (!classification || classification === ANSWER_KEY_PLACEHOLDER) {
        answerKeyIssues.push(
          `Choose a classification for disbursement #${index + 1} (${disbursement.paymentId || 'no payment ID'}).`
        );
        return;
      }
      if (explanationMissing) {
        answerKeyIssues.push(
          `Provide an explanation for disbursement #${index + 1} (${disbursement.paymentId || 'no payment ID'}).`
        );
        return;
      }
      const assignedAmount = Number(key[classification] || 0);
      const diff = Math.abs(assignedAmount - amountNumber);
      if (diff > ANSWER_KEY_TOLERANCE) {
        answerKeyIssues.push(
          `Disbursement #${index + 1} (${
            disbursement.paymentId || 'no payment ID'
          }) has answer key totals (${assignedAmount.toFixed(2)}) that do not match the disbursement amount (${amountNumber.toFixed(
            2
          )}).`
        );
      }
    });

    if (answerKeyIssues.length > 0) {
      logValidationFail('answer-key-issues', { issues: answerKeyIssues });
      showModal(answerKeyIssues.join('\n'), 'Answer Key Validation');
      return;
    }

    const isNewCaseCreation = !isEditing && !draftCaseId;
    const resolvedPublicVisible = isNewCaseCreation ? true : publicVisible;
    const visibleToUserIdsArray = resolvedPublicVisible ? [] : Array.from(new Set(selectedUserIds));

    if (!resolvedPublicVisible && visibleToUserIdsArray.length === 0) {
      logValidationFail('private-case-no-users');
      showModal('Private cases must list at least one User ID.', 'Validation Error');
      return;
    }

    const trimmedCustomGroupId = customCaseGroupId.trim();
    if (caseGroupSelection === '__custom' && !trimmedCustomGroupId) {
      logValidationFail('custom-group-id-empty');
      showModal('Enter a custom case group identifier or choose "No group".', 'Validation Error');
      return;
    }

    const resolvedCaseGroupId =
      caseGroupSelection === '__custom'
        ? trimmedCustomGroupId
        : caseGroupSelection === '__none'
        ? null
        : caseGroupSelection;

    const { timestamp: opensAtTsRaw, error: opensError } = parseDateTimeInputValue(opensAtStr, 'Opens At');
    if (opensError) {
      logValidationFail('opens-at-invalid', { error: opensError });
      showModal(opensError, 'Validation Error');
      return;
    }

    const { timestamp: dueAtTs, error: dueError } = parseDateTimeInputValue(dueAtStr, 'Due At');
    if (dueError) {
      logValidationFail('due-at-invalid', { error: dueError });
      showModal(dueError, 'Validation Error');
      return;
    }

    const opensAtTs = opensAtTsRaw || (isNewCaseCreation ? Timestamp.now() : null);

    if (opensAtTs && dueAtTs && dueAtTs.toMillis() < opensAtTs.toMillis()) {
      logValidationFail('due-before-open', { opensAt: opensAtTs?.toMillis?.(), dueAt: dueAtTs?.toMillis?.() });
      showModal('Due At must be after Opens At.', 'Validation Error');
      return;
    }

    ulog('case-save:passed-date-validation');

    setLoading(true);
    let currentCaseId = editingCaseId || draftCaseId;

    const activeReferenceDocs = [
      ...referenceDocuments,
      ...(auditArea === AUDIT_AREAS.CASH ? cashArtifacts : []),
    ].filter((doc) => {
      if (!doc) return false;
      if (doc.clientSideFile) return true;
      if (doc.fileName) return true;
      if (doc.downloadURL) return true;
      if (doc.storagePath) return true;
      if (doc.generationSpec && typeof doc.generationSpec === 'object') return true;
      return false;
    });

    const requiresCashArtifacts = auditArea === AUDIT_AREAS.CASH;
    const cashArtifactIssues = [];
    if (requiresCashArtifacts) {
      const cashByType = new Map();
      (Array.isArray(cashArtifacts) ? cashArtifacts : []).forEach((doc) => {
        if (!doc) return;
        const rawType = typeof doc.type === 'string' ? doc.type.trim() : '';
        const normalizedType =
          rawType && rawType.startsWith('cash_') ? rawType : rawType ? `cash_${rawType}` : '';
        if (normalizedType) {
          cashByType.set(normalizedType, doc);
        }
      });
      CASH_ARTIFACT_TYPES.forEach(({ value, label }) => {
        const doc = cashByType.get(value);
        if (!doc) {
          cashArtifactIssues.push(`Missing ${label}.`);
          return;
        }
        const name = (doc.fileName || '').trim();
        const hasSource = Boolean(doc.clientSideFile || doc.downloadURL || doc.storagePath);
        if (!name) {
          cashArtifactIssues.push(`${label} must include a display name.`);
        }
        if (!hasSource) {
          cashArtifactIssues.push(
            `${label} must include an uploaded file, download URL, or storage path.`
          );
        }
      });
    }

    if (requiresCashArtifacts && cashArtifactIssues.length > 0) {
      logValidationFail('cash-artifacts-incomplete', { issues: cashArtifactIssues });
      showModal(cashArtifactIssues.join('\n'), 'Validation Error');
      setLoading(false);
      return;
    }

    if (activeReferenceDocs.length === 0) {
      logValidationFail('reference-docs-empty');
      showModal('Add at least one reference document before submitting.', 'Validation Error');
      setLoading(false);
      return;
    }

    const referenceValidationFailed = activeReferenceDocs.some((doc) => {
      const name = (doc.fileName || '').trim();
      const hasUpload = !!doc.clientSideFile;
      const hasUrl = !!doc.downloadURL;
      const hasStoragePath = !!doc.storagePath;
      const hasGenerationSpec = doc.generationSpec && typeof doc.generationSpec === 'object';
      if (!name) return true;
      if (!hasUpload && !hasUrl && !hasStoragePath && !hasGenerationSpec) return true;
      return false;
    });

    if (referenceValidationFailed) {
      logValidationFail('reference-doc-missing-data', { activeReferenceDocsCount: activeReferenceDocs.length });
      showModal(
        'Reference documents must include a display name and either an uploaded file, download URL, storage path, or a generation spec.',
        'Validation Error'
      );
      setLoading(false);
      return;
    }

    const generationOnlyDocs = activeReferenceDocs.filter(
      (doc) =>
        doc &&
        doc.generationSpec &&
        !doc.clientSideFile &&
        !doc.downloadURL &&
        !doc.storagePath
    );
    if (generationOnlyDocs.length > 0 && status !== 'draft') {
      logValidationFail('reference-doc-generation-pending', {
        count: generationOnlyDocs.length,
        status,
      });
      showModal(
        'Reference documents are waiting on generation. Set status to Draft or run generation before publishing.',
        'Generation Pending'
      );
      setLoading(false);
      return;
    }

    const flattenedMappings = disbursements.flatMap((disbursement) =>
      (disbursement.mappings || []).map((mapping) => ({
        ...mapping,
        paymentId: disbursement.paymentId,
        disbursementTempId: disbursement._tempId,
      }))
    );
    const preUploadDisbursements = disbursements.map(({ _tempId, mappings, ...rest }) => ({
      ...rest,
      highlightedDocument: sanitizeHighlightedDocumentForSave(rest.highlightedDocument),
    }));

    try {
      const orgIdFromToken = await getCurrentUserOrgId().catch((e) => {
        console.warn('[CaseForm] Failed to fetch orgId from token', e);
        return null;
      });
      const resolvedOrgId = orgIdFromToken ?? userProfile?.orgId ?? null;
      const resolvedRole = role || 'unknown';

      if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && !resolvedOrgId) {
        logValidationFail('org-id-missing', { resolvedOrgId, role });
        console.error('[CaseForm] Blocking save: missing orgId', {
          resolvedOrgId,
          role: resolvedRole,
          userId,
        });
        showModal(
          'Your account is missing an orgId. Please contact an admin to set your organization before saving cases.',
          'Permission Needed'
        );
        setLoading(false);
        return;
      }

      console.info('[CaseForm] Submitting case', {
        isNew: isNewCaseCreation,
        editingCaseId,
        auditArea,
        disbursementCount: disbursements.length,
        referenceDocCount: referenceDocuments.length,
        cashArtifactCount: cashArtifacts.length,
        hasUploads:
          flattenedMappings.some((m) => m.clientSideFile) ||
          activeReferenceDocs.some((d) => d.clientSideFile) ||
          disbursements.some((d) => d.highlightedDocument?.clientSideFile),
        publicVisible: resolvedPublicVisible,
        visibleToUserIdsCount: visibleToUserIdsArray.length,
        caseGroupId: resolvedCaseGroupId || null,
        userId,
        appId,
        orgId: resolvedOrgId,
        role: resolvedRole,
      });
      if (isNewCaseCreation) {
        const tempCaseData = {
          caseName,
          title: caseName,
          orgId: resolvedOrgId,
          workpaper: { layoutType, layoutConfig: parsedLayoutConfig },
          instruction,
          disbursements: preUploadDisbursements,
          invoiceMappings: [],
          referenceDocuments: [],
          visibleToUserIds: visibleToUserIdsArray,
          publicVisible: resolvedPublicVisible,
          status,
          opensAt: opensAtTs,
          dueAt: dueAtTs,
          createdBy: userId,
          _deleted: false,
          auditArea,
          caseGroupId: resolvedCaseGroupId,
        };
        currentCaseId = await createCase(tempCaseData);
        showModal(
          `Case structure created (ID: ${currentCaseId}). Uploading files... This may take a moment. Please do not navigate away.`,
          'Processing',
          null
        );
      } else if (currentCaseId) {
        showModal(
          `Updating case (ID: ${currentCaseId}). Uploading any new/changed files... Please do not navigate away.`,
          'Processing',
          null
        );
      }

      if (!currentCaseId) throw new Error('Case ID is missing. Cannot proceed with file uploads.');

      const uploadCandidates = flattenedMappings.filter((m) => m.paymentId && m.clientSideFile);

      ulog('case-save:map-upload:start', { count: uploadCandidates.length });

      const settled = await Promise.allSettled(
        uploadCandidates.map((mapping) => uploadFileAndGetMetadata(mapping, currentCaseId))
      );

      const uploadResults = settled.map((r, idx) =>
        r.status === 'fulfilled'
          ? r.value
          : {
              uploadError: r.reason?.message || 'Upload failed',
              fileName: uploadCandidates[idx]?.fileName,
              paymentId: uploadCandidates[idx]?.paymentId,
            }
      );

      const failedUploads = uploadResults.filter((result) => result && result.uploadError);
      if (failedUploads.length > 0) {
        const errorMessages = failedUploads
          .map((f) => `- ${f.fileName || 'A file'} for Payment ID ${f.paymentId}: ${f.uploadError}`)
          .join('\n');
        showModal(
          `Some file uploads failed:\n${errorMessages}\n\nPlease correct the issues by re-selecting files or removing problematic mappings, then try saving again. Case data has not been fully saved.`,
          'Upload Errors'
        );
        setLoading(false);
        return;
      }

      const uploadedMappings = uploadResults
        .filter((r) => r && !r.uploadError)
        .map(({ clientSideFile, uploadProgress, _tempId, disbursementTempId, uploadError, ...rest }) => rest);

      const retainedMappings = flattenedMappings
        .filter((mapping) => mapping.paymentId && !mapping.clientSideFile)
        .map(({ clientSideFile, uploadProgress, uploadError, disbursementTempId, ...rest }) => rest);

      const finalInvoiceMappings = [...retainedMappings, ...uploadedMappings];

      let finalReferenceDocuments = [];
      let finalCashArtifacts = [];
      if (activeReferenceDocs.length > 0) {
        ulog('case-save:reference-upload:start', { count: activeReferenceDocs.length });
        const referenceSettled = await Promise.allSettled(
          activeReferenceDocs.map((doc) => uploadReferenceDocument(doc, currentCaseId))
        );
        const referenceResults = referenceSettled.map((r, idx) =>
          r.status === 'fulfilled'
            ? r.value
            : {
                uploadError: r.reason?.message || 'Upload failed',
                _tempId: activeReferenceDocs[idx]?._tempId,
                fileName:
                  activeReferenceDocs[idx]?.fileName ||
                  activeReferenceDocs[idx]?.clientSideFile?.name ||
                  `Reference document ${idx + 1}`,
                type: activeReferenceDocs[idx]?.type,
              }
        );

        const referenceFailedUploads = referenceResults.filter((item) => item && item.uploadError);
        if (referenceFailedUploads.length > 0) {
          const errorMessages = referenceFailedUploads
            .map((f) => `- ${f.fileName || 'A reference document'}: ${f.uploadError}`)
            .join('\n');
          showModal(
            `Some reference document uploads failed:\n${errorMessages}\n\nPlease address these issues and try saving again.`,
            'Upload Errors'
          );
          setLoading(false);
          return;
        }

        const normalizedResults = referenceResults
          .filter((item) => item && !item.uploadError && item.fileName)
          .map(({ _tempId, clientSideFile, uploadProgress, uploadError, ...rest }) => rest);

        finalCashArtifacts = normalizedResults.filter((doc) => doc.type && doc.type.startsWith('cash_'));
        finalReferenceDocuments = normalizedResults.filter((doc) => !doc.type || !doc.type.startsWith('cash_'));
      }

      ulog('case-save:highlight-upload:start', {
        disbursementCount: disbursements.length,
        withFiles: disbursements.filter((d) => d?.highlightedDocument?.clientSideFile).length,
      });

      if (highlightStartTimerRef.current) clearTimeout(highlightStartTimerRef.current);
      highlightStartRef.current = false;
      if (disbursements.some((d) => d?.highlightedDocument?.clientSideFile)) {
        highlightStartTimerRef.current = setTimeout(() => {
          if (!highlightStartRef.current) {
            ulog('highlight:never-started', { caseId: currentCaseId });
            showModal(
              'Highlighted document upload did not start. Please check your connection and that storage CORS/rules are applied, then try again.',
              'Upload stalled'
            );
            setLoading(false);
          }
        }, 5000);
      }

      const highlightedSettled = await Promise.allSettled(
        disbursements.map((disbursement) => uploadHighlightedDocument(disbursement, currentCaseId))
      );

      ulog('highlight:all-settled', {
        count: highlightedSettled.length,
        statuses: highlightedSettled.map((r) => r.status),
      });

      const highlightedResults = highlightedSettled.map((result, idx) =>
        result.status === 'fulfilled'
          ? result.value
          : {
              disbursementTempId: disbursements[idx]?._tempId,
              uploadError: result.reason?.message || 'Upload failed',
              fileName: disbursements[idx]?.highlightedDocument?.fileName,
            }
      );

      const highlightedErrors = highlightedResults.filter((entry) => entry && entry.uploadError);
      if (highlightedErrors.length > 0) {
        ulog('highlight:errors', highlightedErrors);
      } else {
        ulog('highlight:success:all', {
          uploaded: highlightedResults.filter((e) => e && !e.uploadError && e.payload),
        });
      }
      if (highlightedErrors.length > 0) {
        const errorMessages = highlightedErrors
          .map(
            (h) =>
              `- ${h.fileName || 'Highlighted file'} for item ${h.disbursementTempId || 'unknown'}: ${h.uploadError}`
          )
          .join('\n');
        showModal(
          `Some evidence reveal uploads failed:\n${errorMessages}\n\nPlease fix the files and try saving again.`,
          'Upload Errors'
        );
        setLoading(false);
        return;
      }

      const highlightedMap = new Map();
      highlightedResults.forEach((entry, idx) => {
        const key = entry?.disbursementTempId || disbursements[idx]?._tempId;
        if (key && entry?.payload) {
          highlightedMap.set(key, entry.payload);
        }
      });

      const disbursementsWithHighlights = disbursements.map((disbursement) => {
        const highlightPayload =
          highlightedMap.get(disbursement._tempId) || sanitizeHighlightedDocumentForSave(disbursement.highlightedDocument);
        return { ...disbursement, highlightedDocument: highlightPayload };
      });

      const disbursementPayload = mergeDisbursementDocuments(disbursementsWithHighlights, finalInvoiceMappings).map(
        ({ mappings, answerKeyMode, answerKeySingleClassification, highlightedDocument, ...rest }) => ({
          ...rest,
          highlightedDocument: sanitizeHighlightedDocumentForSave(highlightedDocument),
        })
      );

      const normalizedModuleId =
        typeof moduleId === 'string' && moduleId.trim() ? moduleId.trim() : null;
      const rawRecipeVersion = Number(recipeVersion);
      const normalizedRecipeVersion =
        Number.isFinite(rawRecipeVersion) && rawRecipeVersion > 0 ? Math.floor(rawRecipeVersion) : 1;
      const instructionPayload =
        instruction && typeof instruction === 'object'
          ? { ...instruction, version: normalizedRecipeVersion }
          : { version: normalizedRecipeVersion };

      const caseDataPayload = {
        caseName,
        title: caseName,
        orgId: resolvedOrgId,
        workpaper: { layoutType, layoutConfig: parsedLayoutConfig },
        instruction: instructionPayload,
        disbursements: disbursementPayload,
        invoiceMappings: finalInvoiceMappings,
        referenceDocuments: finalReferenceDocuments,
        visibleToUserIds: visibleToUserIdsArray,
        publicVisible: resolvedPublicVisible,
        status,
        opensAt: opensAtTs,
        dueAt: dueAtTs,
        createdBy: isNewCaseCreation || !originalCaseData?.createdBy ? userId : originalCaseData.createdBy,
        _deleted: originalCaseData?._deleted ?? false,
        auditArea,
        caseLevel: normalizedLevel,
        moduleId: normalizedModuleId,
        recipeVersion: normalizedRecipeVersion,
        yearEnd: resolvedYearEnd,
        yearEndLabel: (yearEndInput || '').trim() || null,
        caseGroupId: resolvedCaseGroupId,
        cashContext:
          auditArea === AUDIT_AREAS.CASH
            ? {
                moduleType: cashContext.moduleType || 'bank_reconciliation',
                bookBalance: cashContext.bookBalance || '',
                bankBalance: cashContext.bankBalance || '',
                reconciliationDate: cashContext.reconciliationDate || '',
                reportingDate: cashContext.reconciliationDate || '',
                simulateMathError: Boolean(cashContext.simulateMathError),
                confirmedBalance: cashContext.confirmedBalance || '',
                testingThreshold: cashContext.testingThreshold || '',
                cutoffWindowDays: cashContext.cutoffWindowDays || '',
              }
            : null,
        cashOutstandingItems: auditArea === AUDIT_AREAS.CASH ? cashOutstandingItems : [],
        cashCutoffItems: auditArea === AUDIT_AREAS.CASH ? cashCutoffItems : [],
        cashRegisterItems: auditArea === AUDIT_AREAS.CASH ? cashRegisterItems : [],
        cashReconciliationMap: auditArea === AUDIT_AREAS.CASH ? derivedReconciliationMap : [],
        cashArtifacts:
          auditArea === AUDIT_AREAS.CASH
            ? finalCashArtifacts.map((doc) => ({
                ...doc,
                type: doc.type && doc.type.startsWith('cash_') ? doc.type : `cash_${doc.type || 'year_end_statement'}`,
              }))
            : [],
        faSummary: auditArea === AUDIT_AREAS.FIXED_ASSETS ? faSummary : [],
        faRisk: auditArea === AUDIT_AREAS.FIXED_ASSETS ? faRisk : null,
        faAdditions: auditArea === AUDIT_AREAS.FIXED_ASSETS ? faAdditions : [],
        faDisposals: auditArea === AUDIT_AREAS.FIXED_ASSETS ? faDisposals : [],
        faArtifacts: [],
      };

      if (!isNewCaseCreation && originalCaseData?.createdAt) {
        caseDataPayload.createdAt = originalCaseData.createdAt;
      }

      ulog('case-save:update-case', {
        isNewCaseCreation,
        caseId: currentCaseId,
        disbursementCount: caseDataPayload.disbursements.length,
      });

      await updateCase(currentCaseId, caseDataPayload);

    if (generationPlan) {
      try {
        await saveCaseGenerationPlan({ caseId: currentCaseId, plan: generationPlan });
        ulog('case-save:generation-plan:stored', { caseId: currentCaseId });
      } catch (err) {
        ulog('case-save:generation-plan:error', { caseId: currentCaseId, error: err?.message });
        console.warn('[CaseForm] Failed to store generation plan', err);
      }
    }

    if (generationPlan?.referenceDocumentSpecs?.length) {
      try {
        const queued = await queueCaseGenerationJob({
          caseId: currentCaseId,
          plan: generationPlan,
          appId,
        });
        ulog('case-save:generation-job:queued', { caseId: currentCaseId, job: queued?.jobId });
      } catch (err) {
        ulog('case-save:generation-job:error', { caseId: currentCaseId, error: err?.message });
        console.warn('[CaseForm] Failed to queue generation job', err);
      }
    }

      showModal(`Case ${isNewCaseCreation ? 'created' : 'updated'} successfully!`, 'Success');
      try {
        if (canUseLocalStorage()) {
          window.localStorage.removeItem(draftStorageKey);
        }
      } catch (err) {
        console.error('Failed to clear draft', err);
      }
      navigate('/admin');
    } catch (error) {
      ulog('case-save:error', { message: error?.message, code: error?.code, name: error?.name });
      console.error('[CaseForm] Error saving case', {
        message: error?.message,
        code: error?.code,
        name: error?.name,
        stack: error?.stack,
      });
      let detailedErrorMsg = 'Error saving case: ' + (error?.message || 'Unknown error');
      if (error?.code) detailedErrorMsg += `\nCode: ${error.code}`;
      if (error?.stack) detailedErrorMsg += `\nStack: ${error.stack.split('\n').slice(0, 3).join('\n')}`;
      showModal(detailedErrorMsg, 'Error');
    } finally {
      setLoading(false);
      if (highlightStartTimerRef.current) {
        clearTimeout(highlightStartTimerRef.current);
        highlightStartTimerRef.current = null;
      }
    }
  };
}
