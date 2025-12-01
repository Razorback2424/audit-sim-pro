import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { Timestamp } from 'firebase/firestore';
import { storage, Button, useRoute, useAuth, useModal, appId, Input, Textarea } from '../AppCore';
import { subscribeToCase } from '../services/caseService';
import { saveSubmission, subscribeToSubmission } from '../services/submissionService';
import { saveProgress, subscribeProgressForCases } from '../services/progressService';
import { Send, Loader2, ExternalLink, Download, CheckCircle2, XCircle, Info } from 'lucide-react';
import { getClassificationFields, getFlowCopy } from '../constants/classificationFields';
import { DEFAULT_AUDIT_AREA, AUDIT_AREAS } from '../models/caseConstants';
import { deriveImmediateFeedbackForItem } from '../logic/ValidatorRegistry';
import { currencyFormatter } from '../utils/formatters';
import AuditItemCardFactory from '../components/trainee/AuditItemCardFactory';
import CashReconciliationWorkbench from '../components/trainee/workspaces/CashReconciliationWorkbench';
import WorkpaperRenderer from '../components/trainee/WorkpaperRenderer';
import InstructionView from '../components/InstructionView';

const FLOW_STEPS = Object.freeze({
  INSTRUCTION: 'instruction',
  SELECTION: 'selection',
  TESTING: 'testing',
  RESULTS: 'results',
});

const DEFAULT_WORKFLOW = [
  FLOW_STEPS.INSTRUCTION,
  FLOW_STEPS.SELECTION,
  FLOW_STEPS.TESTING,
  FLOW_STEPS.RESULTS,
];
const EXCEPTION_CLASSIFICATION_KEYS = new Set(['improperlyIncluded', 'improperlyExcluded']);

const isInlinePreviewable = (contentType, fileNameOrPath) => {
  const normalizedType = typeof contentType === 'string' ? contentType.toLowerCase() : '';
  if (normalizedType === 'application/pdf' || normalizedType === 'application/x-pdf') {
    return true;
  }
  const normalizedName = typeof fileNameOrPath === 'string' ? fileNameOrPath.toLowerCase() : '';
  const pdfPattern = /\.pdf(?:$|[?#])/;
  if (!normalizedType && pdfPattern.test(normalizedName)) {
    return true;
  }
  if (normalizedType === 'application/octet-stream' && pdfPattern.test(normalizedName)) {
    return true;
  }
  return false;
};

const computePercentComplete = (step, selectedCount, classifiedCount) => {
  if (step === FLOW_STEPS.RESULTS) return 100;
  if (selectedCount <= 0) return 0;
  if (step === FLOW_STEPS.SELECTION) return 25;
  if (step === FLOW_STEPS.TESTING) {
    const ratio = selectedCount === 0 ? 0 : Math.min(1, classifiedCount / selectedCount);
    return Math.min(95, 25 + Math.round(ratio * 70));
  }
  return 0;
};

const deriveStateFromProgress = (step, percentComplete) => {
  if (step === FLOW_STEPS.RESULTS || percentComplete >= 100) return 'submitted';
  if (percentComplete > 0) return 'in_progress';
  return 'not_started';
};

const isSameSelectionMap = (currentMap, nextMap) => {
  const currentKeys = Object.keys(currentMap);
  const nextKeys = Object.keys(nextMap);
  if (currentKeys.length !== nextKeys.length) return false;
  return currentKeys.every((key) => !!nextMap[key]);
};

const createEmptySplitValuesForFields = (fields) => {
  const splits = {};
  fields.forEach(({ key }) => {
    splits[key] = '';
  });
  return splits;
};

const buildEmptyAllocationStateForFields = (fields) => ({
  mode: 'single',
  singleClassification: '',
  splitValues: createEmptySplitValuesForFields(fields),
  notes: '',
});

const toValidClassificationKey = (value, keySet) =>
  typeof value === 'string' && keySet.has(value) ? value : '';

const normalizeAllocationShapeForFields = (rawAllocation, fields, keySet) => {
  if (!rawAllocation || typeof rawAllocation !== 'object') {
    return buildEmptyAllocationStateForFields(fields);
  }

  // Legacy payloads stored just a classification totals object.
  const legacyDetected = fields.some(({ key }) => rawAllocation[key] !== undefined);
  if (legacyDetected && !rawAllocation.mode) {
    const legacy = buildEmptyAllocationStateForFields(fields);
    legacy.notes = typeof rawAllocation.notes === 'string' ? rawAllocation.notes : '';
    const nonZeroKeys = [];

    fields.forEach(({ key }) => {
      const value = rawAllocation[key];
      const asString = value === undefined || value === null || value === '' ? '' : String(value);
      legacy.splitValues[key] = asString;
      const numericValue = Number(asString);
      if (Number.isFinite(numericValue) && Math.abs(numericValue) > 0) {
        nonZeroKeys.push(key);
      }
    });

    if (nonZeroKeys.length <= 1) {
      legacy.mode = 'single';
      legacy.singleClassification = nonZeroKeys[0] ?? '';
      legacy.splitValues = createEmptySplitValuesForFields(fields);
    } else {
      legacy.mode = 'split';
    }

    return legacy;
  }

  const normalized = buildEmptyAllocationStateForFields(fields);
  normalized.notes = typeof rawAllocation.notes === 'string' ? rawAllocation.notes : '';
  const requestedSplitMode = rawAllocation.mode === 'split';
  normalized.mode = requestedSplitMode ? 'split' : 'single';
  normalized.singleClassification = toValidClassificationKey(rawAllocation.singleClassification, keySet);

  fields.forEach(({ key }) => {
    const value =
      (rawAllocation.splitValues && rawAllocation.splitValues[key] !== undefined
        ? rawAllocation.splitValues[key]
        : rawAllocation[key]) ?? '';
    normalized.splitValues[key] = value === null ? '' : String(value);
  });

  const hasMeaningfulSplit = fields.some(({ key }) => {
    const rawValue = normalized.splitValues[key];
    if (rawValue === '' || rawValue === null || rawValue === undefined) return false;
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) && Math.abs(numeric) > 0;
  });

  if (requestedSplitMode) {
    return normalized;
  }

  if (normalized.mode === 'split' && !hasMeaningfulSplit) {
    const fallbackClassification = toValidClassificationKey(normalized.singleClassification, keySet);
    normalized.mode = 'single';
    normalized.singleClassification = fallbackClassification;
    normalized.splitValues = createEmptySplitValuesForFields(fields);
  }

  return normalized;
};

const allocationsAreEqualForFields = (left, right, fields, keySet) => {
  const a = normalizeAllocationShapeForFields(left, fields, keySet);
  const b = normalizeAllocationShapeForFields(right, fields, keySet);

  if (a.mode !== b.mode) return false;
  if ((a.singleClassification || '') !== (b.singleClassification || '')) return false;
  if ((a.notes || '') !== (b.notes || '')) return false;

  return fields.every(({ key }) => (a.splitValues[key] ?? '') === (b.splitValues[key] ?? ''));
};

const isSameClassificationMapForFields = (currentMap, nextMap, fields, keySet) => {
  const currentKeys = Object.keys(currentMap);
  const nextKeys = Object.keys(nextMap);
  if (currentKeys.length !== nextKeys.length) return false;
  return currentKeys.every((key) =>
    allocationsAreEqualForFields(currentMap[key], nextMap[key], fields, keySet)
  );
};

const collectSupportingDocuments = (disbursement) => {
  if (!disbursement) return [];

  const fallbackFileName = disbursement.paymentId ? `Document for ${disbursement.paymentId}` : 'Supporting document';

  const rawDocs = Array.isArray(disbursement.supportingDocuments) && disbursement.supportingDocuments.length > 0
    ? disbursement.supportingDocuments
    : [
        {
          storagePath: disbursement.storagePath || '',
          downloadURL: disbursement.downloadURL || '',
          fileName: disbursement.fileName || '',
          contentType: disbursement.contentType || '',
        },
      ];

  const seen = new Set();
  return rawDocs
    .map((doc) => {
      const storagePath = doc.storagePath || '';
      const downloadURL = doc.downloadURL || '';
      const derivedFileName =
        doc.fileName ||
        (storagePath ? storagePath.split('/').pop() : '') ||
        fallbackFileName;
      return {
        storagePath,
        downloadURL,
        fileName: derivedFileName,
        contentType: doc.contentType || '',
      };
    })
    .filter((doc) => {
      const key = `${doc.storagePath}|${doc.downloadURL}|${doc.fileName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return doc.storagePath || doc.downloadURL || doc.fileName;
    });
};

const DEFAULT_FLOW_COPY_STATE = getFlowCopy(DEFAULT_AUDIT_AREA);

const buildEmptyFixedAssetDraft = () => ({
  leadScheduleTicks: {},
  scopingDecision: null,
  additionResponses: {},
  disposalResponses: {},
  analyticsResponse: {},
});

const normalizeFixedAssetDraft = (rawDraft) => {
  if (!rawDraft || typeof rawDraft !== 'object') {
    return buildEmptyFixedAssetDraft();
  }
  return {
    leadScheduleTicks:
      rawDraft.leadScheduleTicks && typeof rawDraft.leadScheduleTicks === 'object'
        ? { ...rawDraft.leadScheduleTicks }
        : {},
    scopingDecision:
      rawDraft.scopingDecision && typeof rawDraft.scopingDecision === 'object'
        ? { ...rawDraft.scopingDecision }
        : null,
    additionResponses:
      rawDraft.additionResponses && typeof rawDraft.additionResponses === 'object'
        ? { ...rawDraft.additionResponses }
        : {},
    disposalResponses:
      rawDraft.disposalResponses && typeof rawDraft.disposalResponses === 'object'
        ? { ...rawDraft.disposalResponses }
        : {},
    analyticsResponse:
      rawDraft.analyticsResponse && typeof rawDraft.analyticsResponse === 'object'
        ? { ...rawDraft.analyticsResponse }
        : {},
  };
};

const areFixedAssetDraftsEqual = (left, right) => {
  const a = normalizeFixedAssetDraft(left);
  const b = normalizeFixedAssetDraft(right);
  return (
    JSON.stringify(a.leadScheduleTicks) === JSON.stringify(b.leadScheduleTicks) &&
    JSON.stringify(a.scopingDecision) === JSON.stringify(b.scopingDecision) &&
    JSON.stringify(a.additionResponses) === JSON.stringify(b.additionResponses) &&
    JSON.stringify(a.disposalResponses) === JSON.stringify(b.disposalResponses) &&
    JSON.stringify(a.analyticsResponse) === JSON.stringify(b.analyticsResponse)
  );
};

const useSubmission = (caseId, userId) => {
  const [submission, setSubmission] = useState(null);

  useEffect(() => {
    if (!caseId || !userId) {
      setSubmission(null);
      return undefined;
    }
    const unsubscribe = subscribeToSubmission(
      userId,
      caseId,
      (doc) => {
        setSubmission(doc);
      },
      (error) => {
        console.error('[TraineeCaseView] Failed to load submission document', error);
        setSubmission(null);
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [caseId, userId]);

  return submission;
};

export default function TraineeCaseViewPage({ params }) {
  const { caseId } = params;
  const { navigate, query, setQuery } = useRoute();
  const { userId } = useAuth();
  const { showModal, hideModal } = useModal();

  const submission = useSubmission(caseId, userId);

  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeStep, setActiveStep] = useState(null);
  const [selectedDisbursements, setSelectedDisbursements] = useState({});
  const [classificationAmounts, setClassificationAmounts] = useState({});
  const [fixedAssetDraft, setFixedAssetDraft] = useState(() => buildEmptyFixedAssetDraft());
  const [workspaceNotes, setWorkspaceNotes] = useState({});
  const [isLocked, setIsLocked] = useState(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState(null);
  const [activeEvidenceUrl, setActiveEvidenceUrl] = useState(null);
  const [activeEvidenceError, setActiveEvidenceError] = useState('');
  const [activeEvidenceLoading, setActiveEvidenceLoading] = useState(false);
  const [downloadingReferences, setDownloadingReferences] = useState(false);
  const [isRetakeResetting, setIsRetakeResetting] = useState(false);
  const [cashCanSubmit, setCashCanSubmit] = useState(false);
  const [cashLinkMap, setCashLinkMap] = useState({});
  const [cashAdjustments, setCashAdjustments] = useState([]);
  const [cashSummaryDraft, setCashSummaryDraft] = useState({});
  const [isScopingModalOpen, setIsScopingModalOpen] = useState(false);
  const [scopingModalError, setScopingModalError] = useState('');

  const auditArea =
    (typeof caseData?.auditArea === 'string' && caseData.auditArea.trim()) || DEFAULT_AUDIT_AREA;
  const layoutType = useMemo(() => {
    if (caseData?.workpaper?.layoutType) return caseData.workpaper.layoutType;
    if (auditArea === AUDIT_AREAS.CASH) return 'cash_recon';
    if (auditArea === AUDIT_AREAS.FIXED_ASSETS) return 'fixed_assets';
    return 'two_pane';
  }, [caseData, auditArea]);
  const isCashLayout = layoutType === 'cash_recon' || auditArea === AUDIT_AREAS.CASH;
  const isFixedAssetLayout = layoutType === 'fixed_assets' || auditArea === AUDIT_AREAS.FIXED_ASSETS;
  const layoutConfig = useMemo(
    () =>
      caseData?.workpaper && typeof caseData.workpaper.layoutConfig === 'object'
        ? caseData.workpaper.layoutConfig || {}
        : {},
    [caseData]
  );

  useEffect(() => {
    if (isCashLayout) {
      setCashCanSubmit(false);
    } else {
      setCashCanSubmit(true);
    }
  }, [isCashLayout]);
  const classificationContextArea = isCashLayout ? AUDIT_AREAS.CASH : auditArea;
  const classificationFields = useMemo(
    () => getClassificationFields(classificationContextArea),
    [classificationContextArea]
  );
  const classificationKeySet = useMemo(
    () => new Set(classificationFields.map(({ key }) => key)),
    [classificationFields]
  );
  const flowCopy = useMemo(() => getFlowCopy(classificationContextArea), [classificationContextArea]);
  const effectiveFlowCopy = flowCopy || DEFAULT_FLOW_COPY_STATE;
  const stepLabels = effectiveFlowCopy.stepLabels || DEFAULT_FLOW_COPY_STATE.stepLabels;
  const stepDescriptions =
    effectiveFlowCopy.stepDescriptions || DEFAULT_FLOW_COPY_STATE.stepDescriptions;
  const testingIntro = effectiveFlowCopy.testingIntro || DEFAULT_FLOW_COPY_STATE.testingIntro;
  const splitAllocationHint =
    effectiveFlowCopy.splitAllocationHint || DEFAULT_FLOW_COPY_STATE.splitAllocationHint;
  const singleAllocationHint =
    effectiveFlowCopy.singleAllocationHint || DEFAULT_FLOW_COPY_STATE.singleAllocationHint;

  const createEmptySplitValues = useCallback(
    () => createEmptySplitValuesForFields(classificationFields),
    [classificationFields]
  );

  const createEmptyAllocation = useCallback(
    () => buildEmptyAllocationStateForFields(classificationFields),
    [classificationFields]
  );

  const normalizeAllocationShape = useCallback(
    (rawAllocation) =>
      normalizeAllocationShapeForFields(rawAllocation, classificationFields, classificationKeySet),
    [classificationFields, classificationKeySet]
  );

  const isSameClassificationMap = useCallback(
    (currentMap, nextMap) =>
      isSameClassificationMapForFields(currentMap, nextMap, classificationFields, classificationKeySet),
    [classificationFields, classificationKeySet]
  );

  const workflow = useMemo(() => {
    const rawWorkflow =
      Array.isArray(caseData?.workflow) && caseData.workflow.length > 0
        ? caseData.workflow
        : DEFAULT_WORKFLOW;
    const normalized = [];
    const seen = new Set();
    rawWorkflow.forEach((step) => {
      if (!step || seen.has(step)) return;
      seen.add(step);
      normalized.push(step);
    });
    if (!seen.has(FLOW_STEPS.INSTRUCTION)) {
      return [FLOW_STEPS.INSTRUCTION, ...normalized];
    }
    return normalized;
  }, [caseData]);
  const firstWorkflowStep = useMemo(() => workflow[0] ?? FLOW_STEPS.INSTRUCTION, [workflow]);
  const resultsWorkflowStep = useMemo(() => {
    if (workflow.includes(FLOW_STEPS.RESULTS)) {
      return FLOW_STEPS.RESULTS;
    }
    return workflow[workflow.length - 1] ?? FLOW_STEPS.RESULTS;
  }, [workflow]);

  const lastResolvedEvidenceRef = useRef({ evidenceId: null, storagePath: null, url: null, inlineNotSupported: false });
  const progressSaveTimeoutRef = useRef(null);
  const activeStepRef = useRef(null);
  const selectionRef = useRef(selectedDisbursements);
  const classificationRef = useRef(classificationAmounts);
  const fixedAssetDraftRef = useRef(fixedAssetDraft);
  const isLockedRef = useRef(false);
  const retakeHandledRef = useRef(false);
  const retakeResettingRef = useRef(false);

  const normalizeAllocationInput = useCallback((rawValue) => {
    if (rawValue === null || rawValue === undefined) return '';
    const stringValue = String(rawValue).trim();
    if (stringValue === '') return '';

    const withoutCurrency = stringValue.replace(/[$\s]/g, '');
    const withoutCommas = withoutCurrency.replace(/,/g, '');
    const digitsAndDots = withoutCommas.replace(/[^0-9.]/g, '');
    if (digitsAndDots === '') return '';

    const parts = digitsAndDots.split('.');
    let wholePart = parts.shift() || '';
    const decimalPart = parts.join('');
    if (wholePart === '') {
      wholePart = '0';
    }

    let normalized = decimalPart ? `${wholePart}.${decimalPart}` : wholePart;
    if (digitsAndDots.endsWith('.') && decimalPart === '') {
      normalized = `${wholePart}.`;
    }

    return normalized;
  }, []);

  const parseAmount = useCallback(
    (value) => {
      if (value === '' || value === null || value === undefined) return 0;
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : NaN;
      }
      const normalized = normalizeAllocationInput(value);
      if (normalized === '' || normalized === '.') return 0;
      const num = Number(normalized);
      return Number.isFinite(num) ? num : NaN;
    },
    [normalizeAllocationInput]
  );

  const computeAllocationTotals = useCallback(
    (disbursement, allocation) => {
      const normalized = normalizeAllocationShape(allocation);
      const totals = {};
      classificationFields.forEach(({ key }) => {
        totals[key] = 0;
      });

      const amountNumber = Number(disbursement?.amount);
      if (!Number.isFinite(amountNumber)) {
        return totals;
      }

      if (normalized.mode === 'split') {
        classificationFields.forEach(({ key }) => {
          const value = parseAmount(normalized.splitValues[key]);
          totals[key] = Number.isFinite(value) ? value : 0;
        });
        return totals;
      }

      const classification = normalized.singleClassification;
      if (classification && classificationKeySet.has(classification)) {
        totals[classification] = amountNumber;
      }
      return totals;
    },
    [classificationFields, classificationKeySet, normalizeAllocationShape, parseAmount]
  );

  const isAllocationComplete = useCallback(
    (disbursement, allocation) => {
      if (!allocation) return false;
      const normalized = normalizeAllocationShape(allocation);
      const amountNumber = Number(disbursement?.amount);
      if (!Number.isFinite(amountNumber)) return false;

      if (normalized.mode === 'split') {
        let sum = 0;
        for (const { key } of classificationFields) {
          const value = parseAmount(normalized.splitValues[key]);
          if (!Number.isFinite(value) || value < 0) {
            return false;
          }
          sum += value;
        }
        return Math.abs(sum - amountNumber) <= 0.01;
      }

      const classification = normalized.singleClassification;
      return Boolean(classification && classificationKeySet.has(classification));
    },
    [classificationFields, classificationKeySet, normalizeAllocationShape, parseAmount]
  );

  const requiresExceptionNote = useCallback(
    (allocation) => {
      if (!allocation) return false;
      const normalized = normalizeAllocationShape(allocation);

      if (normalized.mode === 'split') {
        return classificationFields.some(({ key }) => {
          if (!EXCEPTION_CLASSIFICATION_KEYS.has(key)) return false;
          const value = parseAmount(normalized.splitValues[key]);
          return Number.isFinite(value) && Math.abs(value) > 0;
        });
      }

      return EXCEPTION_CLASSIFICATION_KEYS.has(normalized.singleClassification);
    },
    [classificationFields, normalizeAllocationShape, parseAmount]
  );

  const hasExceptionNote = useCallback((allocation, workspaceEntry) => {
    const note =
      (allocation && typeof allocation.notes === 'string' && allocation.notes) ||
      (workspaceEntry && typeof workspaceEntry.workpaperNote === 'string' && workspaceEntry.workpaperNote) ||
      (workspaceEntry && typeof workspaceEntry.notes === 'string' && workspaceEntry.notes) ||
      '';
    return note.trim().length > 5;
  }, []);

  const mapCashStatusToClassification = useCallback((status) => {
    if (status === 'cleared') return 'properlyIncluded';
    if (status === 'outstanding') return 'properlyExcluded';
    if (status === 'void') return 'improperlyIncluded';
    if (status === 'adjustment') return 'improperlyExcluded';
    return '';
  }, []);

  useEffect(() => {
    if (workflow.length > 0) {
      setActiveStep((prev) => {
        if (prev && workflow.includes(prev)) {
          return prev;
        }
        return firstWorkflowStep;
      });
    }
  }, [workflow, firstWorkflowStep]);

  useEffect(() => {
    activeStepRef.current = activeStep;
  }, [activeStep]);

  useEffect(() => {
    selectionRef.current = selectedDisbursements;
  }, [selectedDisbursements]);

  useEffect(() => {
    classificationRef.current = classificationAmounts;
  }, [classificationAmounts]);

  useEffect(() => {
    fixedAssetDraftRef.current = fixedAssetDraft;
  }, [fixedAssetDraft]);

  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  useEffect(() => {
    retakeResettingRef.current = isRetakeResetting;
  }, [isRetakeResetting]);

  useEffect(() => {
    if (!caseId || !userId) return;
    const retakeValue = query?.retake;
    const retakeRequested =
      typeof retakeValue === 'string' ? retakeValue.toLowerCase() === 'true' : Boolean(retakeValue);
    if (!retakeRequested || retakeHandledRef.current) return;

    retakeHandledRef.current = true;
    setIsRetakeResetting(true);
    setIsLocked(false);
    setCashLinkMap({});
    setCashAdjustments([]);
    setCashSummaryDraft({});
    setCashCanSubmit(false);
    const initialWorkflowStep = firstWorkflowStep;
    setActiveStep(initialWorkflowStep);
    setSelectedDisbursements({});
    setClassificationAmounts({});
    setFixedAssetDraft(buildEmptyFixedAssetDraft());

    const resetProgress = async () => {
      try {
        if (progressSaveTimeoutRef.current) {
          clearTimeout(progressSaveTimeoutRef.current);
        }

        await saveProgress({
          appId,
          uid: userId,
          caseId,
          patch: {
            percentComplete: 0,
            state: 'not_started',
            step: initialWorkflowStep,
            draft: {
              selectedPaymentIds: [],
              classificationDraft: {},
              fixedAssetDraft: buildEmptyFixedAssetDraft(),
              cashLinkMap: {},
              cashAdjustments: [],
              cashSummary: {},
            },
          },
        });
      } catch (err) {
        console.error('Failed to reset progress for retake:', err);
        showModal('We ran into an issue preparing your retake. Please try again.', 'Retake Error');
      } finally {
        setIsRetakeResetting(false);
        setQuery((prev) => {
          const next = { ...prev };
          delete next.retake;
          return next;
        }, { replace: true });
      }
    };

    resetProgress();
  }, [caseId, userId, query, setQuery, showModal, firstWorkflowStep]);

  useEffect(() => {
    if (!caseId || !userId) {
      setLoading(false);
      if (!caseId) navigate('/trainee');
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToCase(
      caseId,
      (caseDoc) => {
        if (caseDoc && !caseDoc._deleted) {
          const isPublic =
            typeof caseDoc.publicVisible === 'boolean'
              ? caseDoc.publicVisible
              : !(Array.isArray(caseDoc.visibleToUserIds) && caseDoc.visibleToUserIds.length > 0);
          const isRostered = Array.isArray(caseDoc.visibleToUserIds) && caseDoc.visibleToUserIds.includes(userId);
          if (!isPublic && !isRostered) {
            showModal('You do not have permission to view this case.', 'Access Denied');
            navigate('/trainee');
            return;
          }
          if (caseDoc.status === 'archived') {
            showModal('This case has been archived by an administrator.', 'Unavailable');
            navigate('/trainee');
            return;
          }
          const opensAtMsRaw = caseDoc?.opensAt?.toMillis
            ? caseDoc.opensAt.toMillis()
            : caseDoc?.opensAt
            ? new Date(caseDoc.opensAt).getTime()
            : null;
          const opensAtMs = opensAtMsRaw !== null && !Number.isNaN(opensAtMsRaw) ? opensAtMsRaw : null;
          if (opensAtMs && opensAtMs > Date.now()) {
            showModal('This case is not yet open for review. Please check back later.', 'Not Yet Available');
            navigate('/trainee');
            return;
          }
          setCaseData(caseDoc);
        } else {
          showModal('Case not found or has been removed.', 'Error');
          navigate('/trainee');
        }
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching case: ', error);
        showModal('Error fetching case: ' + error.message, 'Error');
        setLoading(false);
        navigate('/trainee');
      }
    );

    return () => unsubscribe();
  }, [caseId, navigate, userId, showModal]);

  useEffect(() => {
    if (!caseId || !userId) return;

    const unsubscribe = subscribeProgressForCases(
      { appId, uid: userId, caseIds: [caseId] },
      (progressMap) => {
        if (retakeResettingRef.current) return;
        const entry = progressMap.get(caseId);
        if (!entry) return;

        const nextStep = workflow.includes(entry.step) ? entry.step : firstWorkflowStep;
        if (nextStep && activeStepRef.current !== nextStep) {
          setActiveStep(nextStep);
        }

        const nextSelection = {};
        (entry.draft?.selectedPaymentIds || []).forEach((id) => {
          if (id) nextSelection[id] = true;
        });
        if (!isSameSelectionMap(selectionRef.current, nextSelection)) {
          setSelectedDisbursements(nextSelection);
        }

        const rawClassifications = entry.draft?.classificationDraft || {};
        const normalizedClassifications = Object.keys(rawClassifications).reduce((acc, key) => {
          acc[key] = normalizeAllocationShape(rawClassifications[key]);
          return acc;
        }, {});
        if (!isSameClassificationMap(classificationRef.current, normalizedClassifications)) {
          setClassificationAmounts(normalizedClassifications);
        }

        const nextFixedAssetDraft = normalizeFixedAssetDraft(entry.draft?.fixedAssetDraft);
        if (!areFixedAssetDraftsEqual(fixedAssetDraftRef.current, nextFixedAssetDraft)) {
          setFixedAssetDraft(nextFixedAssetDraft);
        }

        const nextCashLinks = entry.draft?.cashLinkMap && typeof entry.draft.cashLinkMap === 'object'
          ? entry.draft.cashLinkMap
          : {};
        setCashLinkMap(nextCashLinks);

        const nextCashAdjustments = Array.isArray(entry.draft?.cashAdjustments)
          ? entry.draft.cashAdjustments
          : [];
        setCashAdjustments(nextCashAdjustments);

        const nextCashSummary = entry.draft?.cashSummary && typeof entry.draft.cashSummary === 'object'
          ? entry.draft.cashSummary
          : {};
        setCashSummaryDraft(nextCashSummary);

        const shouldLock = entry.state === 'submitted' || nextStep === resultsWorkflowStep;
        if (isLockedRef.current !== shouldLock) {
          setIsLocked(shouldLock);
        }
      },
      (error) => {
        console.error('Error subscribing to progress:', error);
      }
    );

    return () => unsubscribe();
  }, [
    caseId,
    userId,
    isSameClassificationMap,
    normalizeAllocationShape,
    workflow,
    firstWorkflowStep,
    resultsWorkflowStep,
    areFixedAssetDraftsEqual,
    normalizeFixedAssetDraft,
  ]);

  const cashOutstandingList = useMemo(() => {
    if (!isCashLayout) return [];
    return Array.isArray(caseData?.cashOutstandingItems)
      ? caseData.cashOutstandingItems.map((item, index) => ({
          ...item,
          paymentId:
            item.paymentId ||
            item.reference ||
            item._tempId ||
            item.id ||
            `cash-ledger-${index + 1}`,
          payee: item.payee || item.description || '',
          paymentDate: item.issueDate || item.bookDate || item.paymentDate || '',
        }))
      : [];
  }, [caseData, isCashLayout]);

  const disbursementList = useMemo(() => {
    if (isCashLayout) {
      return [...cashOutstandingList, ...cashAdjustments];
    }
    return Array.isArray(caseData?.disbursements) ? caseData.disbursements : [];
  }, [cashAdjustments, cashOutstandingList, caseData, isCashLayout]);
  const cashCutoffList = useMemo(
    () => (Array.isArray(caseData?.cashCutoffItems) ? caseData.cashCutoffItems : []),
    [caseData]
  );
  const cashArtifacts = useMemo(
    () => (Array.isArray(caseData?.cashArtifacts) ? caseData.cashArtifacts : []),
    [caseData]
  );

  const referenceDocuments = useMemo(() => {
    const docs = Array.isArray(caseData?.referenceDocuments) ? caseData.referenceDocuments : [];
    const usedIds = new Set();
    const normalized = [];

    docs.forEach((doc, index) => {
      if (!doc) return;
      const fileName = (doc.fileName || '').trim() || `Reference document ${index + 1}`;
      const storagePath = (doc.storagePath || '').trim();
      const downloadURL = (doc.downloadURL || '').trim();
      const contentType = (doc.contentType || '').trim();
      if (!storagePath && !downloadURL) return;
      const baseId = storagePath || downloadURL || `${fileName}-${index}`;
      let id = baseId;
      let suffix = 1;
      while (usedIds.has(id)) {
        suffix += 1;
        id = `${baseId}-${suffix}`;
      }
      usedIds.add(id);
      normalized.push({
        id,
        fileName,
        storagePath,
        downloadURL,
        contentType,
      });
    });

    return normalized;
  }, [caseData]);

  const fixedAssetSummary = useMemo(
    () => (Array.isArray(caseData?.faSummary) ? caseData.faSummary : []),
    [caseData]
  );

  const fixedAssetRisk = useMemo(
    () => (caseData?.faRisk && typeof caseData.faRisk === 'object' ? caseData.faRisk : {}),
    [caseData]
  );

  const fixedAssetAdditions = useMemo(
    () => (Array.isArray(caseData?.faAdditions) ? caseData.faAdditions : []),
    [caseData]
  );

  const fixedAssetDisposals = useMemo(
    () => (Array.isArray(caseData?.faDisposals) ? caseData.faDisposals : []),
    [caseData]
  );

  const fixedAssetTotals = useMemo(() => {
    const safeSum = (rows, key) =>
      rows.reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
    return {
      beginningBalance: safeSum(fixedAssetSummary, 'beginningBalance'),
      additions: safeSum(fixedAssetSummary, 'additions'),
      disposals: safeSum(fixedAssetSummary, 'disposals'),
      endingBalance: safeSum(fixedAssetSummary, 'endingBalance'),
    };
  }, [fixedAssetSummary]);

  useEffect(() => {
    if (!caseData) return;
    const validIds = new Set(disbursementList.map((item) => item.paymentId));

    setSelectedDisbursements((prev) => {
      const filtered = {};
      Object.keys(prev).forEach((id) => {
        if (validIds.has(id)) filtered[id] = true;
      });
      if (Object.keys(filtered).length === Object.keys(prev).length) {
        return prev;
      }
      return filtered;
    });

    setClassificationAmounts((prev) => {
      const filtered = {};
      Object.keys(prev).forEach((id) => {
        if (validIds.has(id)) filtered[id] = prev[id];
      });
      if (isSameClassificationMap(prev, filtered)) {
        return prev;
      }
      return filtered;
    });

    setWorkspaceNotes((prev) => {
      const filtered = {};
      Object.keys(prev).forEach((id) => {
        if (validIds.has(id)) {
          filtered[id] = prev[id];
        }
      });
      const prevKeys = Object.keys(prev);
      const filteredKeys = Object.keys(filtered);
      if (
        prevKeys.length === filteredKeys.length &&
        prevKeys.every((key) => prev[key] === filtered[key])
      ) {
        return prev;
      }
      return filtered;
    });
  }, [caseData, disbursementList, isSameClassificationMap]);

  const disbursementById = useMemo(() => {
    const map = new Map();
    disbursementList.forEach((item) => {
      map.set(item.paymentId, item);
    });
    return map;
  }, [disbursementList]);

  const selectedIds = useMemo(() => {
    if (isCashLayout || isFixedAssetLayout) {
      return disbursementList.map((item) => item.paymentId).filter(Boolean);
    }
    if (disbursementList.length === 0) {
      return Object.keys(selectedDisbursements).filter((id) => selectedDisbursements[id]);
    }
    return disbursementList.map((item) => item.paymentId).filter((id) => selectedDisbursements[id]);
  }, [disbursementList, isCashLayout, isFixedAssetLayout, selectedDisbursements]);

  const selectedDisbursementDetails = useMemo(
    () => selectedIds.map((id) => disbursementById.get(id)).filter(Boolean),
    [selectedIds, disbursementById]
  );

  const classifiedCount = useMemo(() => {
    return selectedDisbursementDetails.filter((disbursement) =>
      isAllocationComplete(disbursement, classificationAmounts[disbursement.paymentId])
    ).length;
  }, [selectedDisbursementDetails, classificationAmounts, isAllocationComplete]);

  const classificationDraft = useMemo(() => {
    const draft = {};
    selectedIds.forEach((id) => {
      if (classificationAmounts[id]) {
        draft[id] = classificationAmounts[id];
      }
    });
    return draft;
  }, [selectedIds, classificationAmounts]);

  const allClassified =
    selectedDisbursementDetails.length > 0 && classifiedCount === selectedDisbursementDetails.length;

  const exceptionNoteRequiredIds = useMemo(() => {
    if (isCashLayout) return [];
    return selectedDisbursementDetails
      .map((item) => {
        const allocation = classificationAmounts[item.paymentId] || createEmptyAllocation();
        const needsNote = requiresExceptionNote(allocation);
        const hasNote = hasExceptionNote(allocation, workspaceNotes[item.paymentId]);
        return needsNote && !hasNote ? item.paymentId : null;
      })
      .filter(Boolean);
  }, [
    classificationAmounts,
    createEmptyAllocation,
    hasExceptionNote,
    isCashLayout,
    requiresExceptionNote,
    selectedDisbursementDetails,
    workspaceNotes,
  ]);

  const allEvidenceItems = useMemo(() => {
    const items = [];
    disbursementList.forEach((item, disbursementIndex) => {
      const docs = collectSupportingDocuments(item);
      if (docs.length === 0) {
        const displayId = item.paymentId || `Disbursement ${disbursementIndex + 1}`;
        const fallbackName = item.paymentId ? `Document for ${item.paymentId}` : 'Supporting document';
        items.push({
          ...item,
          evidenceId: `${displayId}::0`,
          evidenceFileName: fallbackName,
          hasLinkedDocument: false,
          storagePath: '',
          downloadURL: '',
          contentType: item.contentType || '',
        });
        return;
      }

      docs.forEach((doc, docIndex) => {
        const displayId = item.paymentId || `Disbursement ${disbursementIndex + 1}`;
        items.push({
          ...item,
          storagePath: doc.storagePath || '',
          downloadURL: doc.downloadURL || '',
          evidenceId: `${displayId}::${docIndex}`,
          evidenceFileName: doc.fileName || displayId,
          hasLinkedDocument: Boolean(doc.storagePath || doc.downloadURL),
          documentIndex: docIndex,
          contentType: doc.contentType || item.contentType || '',
        });
      });
    });
    return items;
  }, [disbursementList]);

  const selectedEvidenceItems = useMemo(() => {
    return allEvidenceItems.filter((item) => selectedIds.includes(item.paymentId));
  }, [allEvidenceItems, selectedIds]);

  const viewerEnabled = activeStep === FLOW_STEPS.TESTING;
  const pdfViewerState = useMemo(
    () => ({
      isOpen: viewerEnabled && Boolean(activeEvidenceUrl),
      currentDocId: viewerEnabled ? activeEvidenceId : null,
    }),
    [viewerEnabled, activeEvidenceUrl, activeEvidenceId]
  );
  const evidenceSource = useMemo(
    () => (viewerEnabled ? selectedEvidenceItems : []),
    [viewerEnabled, selectedEvidenceItems]
  );

  useEffect(() => {
    if (!viewerEnabled) {
      setActiveEvidenceId(null);
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = { evidenceId: null, storagePath: null, url: null, inlineNotSupported: false };
      return;
    }

    if (evidenceSource.length === 0) {
      setActiveEvidenceId(null);
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = { evidenceId: null, storagePath: null, url: null, inlineNotSupported: false };
      return;
    }

    if (!activeEvidenceId || !evidenceSource.some((item) => item.evidenceId === activeEvidenceId)) {
      setActiveEvidenceId(evidenceSource[0].evidenceId);
    }
  }, [viewerEnabled, evidenceSource, activeEvidenceId]);

  useEffect(() => {
    if (!viewerEnabled || evidenceSource.length === 0 || !activeEvidenceId) {
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = { evidenceId: null, storagePath: null, url: null, inlineNotSupported: false };
      return;
    }

    const target = evidenceSource.find((item) => item.evidenceId === activeEvidenceId);
    if (!target) {
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = { evidenceId: null, storagePath: null, url: null, inlineNotSupported: false };
      return;
    }

    const inlinePreviewAllowed = isInlinePreviewable(
      target.contentType,
      target.evidenceFileName || target.storagePath || target.downloadURL
    );

    if (target.downloadURL) {
      if (inlinePreviewAllowed) {
        setActiveEvidenceUrl(target.downloadURL);
        setActiveEvidenceError('');
        setActiveEvidenceLoading(false);
        lastResolvedEvidenceRef.current = {
          evidenceId: target.evidenceId,
          storagePath: target.storagePath || null,
          url: target.downloadURL,
          inlineNotSupported: false,
        };
      } else {
        setActiveEvidenceUrl(null);
        setActiveEvidenceError('Preview not available for this file type. Use "Open in new tab" to download.');
        setActiveEvidenceLoading(false);
        lastResolvedEvidenceRef.current = {
          evidenceId: target.evidenceId,
          storagePath: target.storagePath || null,
          url: null,
          inlineNotSupported: true,
        };
      }
      return;
    }

    if (!target.storagePath) {
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('Document not linked for this disbursement.');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = {
        evidenceId: target.evidenceId,
        storagePath: null,
        url: null,
      };
      return;
    }

    if (!storage?.app) {
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('Document preview unavailable in this environment.');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = {
        evidenceId: target.evidenceId,
        storagePath: target.storagePath,
        url: null,
      };
      return;
    }

    const lastResolved = lastResolvedEvidenceRef.current;
    if (
      lastResolved.evidenceId === target.evidenceId &&
      lastResolved.storagePath === target.storagePath &&
      (lastResolved.url || lastResolved.inlineNotSupported)
    ) {
      if (lastResolved.inlineNotSupported) {
        setActiveEvidenceUrl(null);
        setActiveEvidenceError('Preview not available for this file type. Use "Open in new tab" to download.');
      } else {
        setActiveEvidenceUrl(lastResolved.url);
        setActiveEvidenceError('');
      }
      setActiveEvidenceLoading(false);
      return;
    }

    let cancelled = false;
    setActiveEvidenceLoading(true);
    setActiveEvidenceError('');
    setActiveEvidenceUrl(null);
    lastResolvedEvidenceRef.current = {
      evidenceId: target.evidenceId,
      storagePath: target.storagePath,
      url: null,
      inlineNotSupported: false,
    };

    if (!inlinePreviewAllowed) {
      setActiveEvidenceLoading(false);
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('Preview not available for this file type. Use "Open in new tab" to download.');
      lastResolvedEvidenceRef.current = {
        evidenceId: target.evidenceId,
        storagePath: target.storagePath,
        url: null,
        inlineNotSupported: true,
      };
      return () => {
        cancelled = true;
      };
    }

    getDownloadURL(storageRef(storage, target.storagePath))
      .then((url) => {
        if (cancelled) return;
        setActiveEvidenceUrl(url);
        setActiveEvidenceError('');
        lastResolvedEvidenceRef.current = {
          evidenceId: target.evidenceId,
          storagePath: target.storagePath,
          url,
          inlineNotSupported: false,
        };
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Error loading evidence document:', error);
        const message =
          error?.code === 'storage/object-not-found'
            ? 'Document is missing from storage.'
            : 'Unable to load document preview.';
        setActiveEvidenceUrl(null);
        setActiveEvidenceError(message);
        lastResolvedEvidenceRef.current = {
          evidenceId: target.evidenceId,
          storagePath: target.storagePath,
          url: null,
          inlineNotSupported: false,
        };
      })
      .finally(() => {
        if (cancelled) return;
        setActiveEvidenceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [viewerEnabled, evidenceSource, activeEvidenceId]);

  const enqueueProgressSave = useCallback(
    (stepOverride) => {
      if (!userId || !caseId) return;
      const step = stepOverride || activeStep;
      const selectedCount = selectedIds.length;
      const percentComplete = computePercentComplete(step, selectedCount, classifiedCount);

      const patch = {
        percentComplete,
        state: deriveStateFromProgress(step, percentComplete),
        step,
      draft: {
        selectedPaymentIds: selectedIds,
        classificationDraft,
        fixedAssetDraft,
        cashLinkMap,
        cashAdjustments,
        cashSummary: cashSummaryDraft,
      },
    };

      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }

      progressSaveTimeoutRef.current = setTimeout(() => {
        saveProgress({ appId, uid: userId, caseId, patch }).catch((err) => {
          console.error('Failed to save progress:', err);
        });
      }, 600);
    },
    [
      userId,
      caseId,
      activeStep,
      selectedIds,
      classifiedCount,
      classificationDraft,
      fixedAssetDraft,
      cashLinkMap,
      cashAdjustments,
      cashSummaryDraft,
    ]
  );

  useEffect(() => {
    if (!caseData || !userId || isLocked || activeStep === resultsWorkflowStep) return;
    enqueueProgressSave();
  }, [caseData, userId, isLocked, activeStep, resultsWorkflowStep, enqueueProgressSave]);

  useEffect(
    () => () => {
      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }
    },
    []
  );

  const handleSelectionChange = (paymentId) => {
    if (isLocked) return;
    const currentlySelected = !!selectedDisbursements[paymentId];

    setSelectedDisbursements((prev) => {
      const next = { ...prev };
      if (currentlySelected) {
        delete next[paymentId];
      } else {
        next[paymentId] = true;
      }
      return next;
    });

    if (currentlySelected) {
      setClassificationAmounts((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, paymentId)) return prev;
        const { [paymentId]: _removed, ...rest } = prev;
        return rest;
      });
      setWorkspaceNotes((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, paymentId)) return prev;
        const { [paymentId]: _removedNotes, ...rest } = prev;
        return rest;
      });
    } else {
      setClassificationAmounts((prev) => {
        if (prev[paymentId]) return prev;
        return { ...prev, [paymentId]: createEmptyAllocation() };
      });
    }
  };

  const updateAllocation = useCallback(
    (paymentId, updater) => {
      setClassificationAmounts((prev) => {
        const next = { ...prev };
        const current = normalizeAllocationShape(next[paymentId]);
        const updated = normalizeAllocationShape(updater(current));
        next[paymentId] = updated;
        return next;
      });
    },
    [normalizeAllocationShape]
  );

  const handleWorkspaceUpdate = useCallback((paymentId, updates = {}) => {
    if (!paymentId || typeof updates !== 'object' || updates === null) return;
    setWorkspaceNotes((prev) => ({
      ...prev,
      [paymentId]: {
        ...(prev[paymentId] || {}),
        ...updates,
      },
    }));
  }, []);

  const handleRationaleSelection = useCallback((paymentId, field, value) => {
    if (!paymentId || !field) return;
    setWorkspaceNotes((prev) => ({
      ...prev,
      [paymentId]: {
        ...(prev[paymentId] || {}),
        [field]: value,
      },
    }));
  }, []);

  const handleNoteChange = useCallback(
    (paymentId, noteText) => {
      if (isLocked) return;
      setClassificationAmounts((prev) => {
        const current = prev[paymentId] || createEmptyAllocation();
        if (current.notes === noteText) return prev;
        return {
          ...prev,
          [paymentId]: {
            ...current,
            notes: noteText,
          },
        };
      });
      handleWorkspaceUpdate(paymentId, { workpaperNote: noteText });
    },
    [createEmptyAllocation, handleWorkspaceUpdate, isLocked]
  );

  const handleSingleClassificationChange = (paymentId, classification) => {
    if (isLocked) return;
    const normalizedValue = classificationKeySet.has(classification) ? classification : '';
    updateAllocation(paymentId, (current) => ({
      ...current,
      mode: 'single',
      singleClassification: normalizedValue,
    }));
  };

  const handleSplitToggle = (paymentId, checked, disbursement) => {
    if (isLocked) return;
    if (checked) {
      updateAllocation(paymentId, (current) => {
        const totals = computeAllocationTotals(disbursement, current);
        const splitValues = createEmptySplitValues();
        classificationFields.forEach(({ key }) => {
          const value = totals[key];
          splitValues[key] = Number.isFinite(value) && value !== 0 ? value.toString() : '';
        });
        return {
          ...current,
          mode: 'split',
          splitValues,
        };
      });
    } else {
      updateAllocation(paymentId, (current) => ({
        ...current,
        mode: 'single',
        splitValues: createEmptySplitValues(),
      }));
    }
  };

  const handleSplitAmountChange = (paymentId, fieldKey, rawValue) => {
    if (isLocked) return;
    const sanitized = rawValue === '' ? '' : normalizeAllocationInput(rawValue);
    updateAllocation(paymentId, (current) => ({
      ...current,
      mode: 'split',
      splitValues: {
        ...current.splitValues,
        [fieldKey]: sanitized,
      },
    }));
  };

  const handleCashStatusUpdate = useCallback(
    (ledgerId, updates = {}) => {
      if (!ledgerId) return;
      setClassificationAmounts((prev) => {
        const current = prev[ledgerId] || createEmptyAllocation();
        const nextStatus = updates.status ?? current.status ?? '';
        const nextNote = updates.note ?? current.note ?? '';
        const linkedBankItemId = updates.linkedBankItemId ?? current.linkedBankItemId ?? '';
        const mappedClassification = mapCashStatusToClassification(nextStatus);
        return {
          ...prev,
          [ledgerId]: {
            ...current,
            mode: 'single',
            singleClassification: mappedClassification || current.singleClassification || '',
            splitValues: createEmptySplitValues(),
            status: nextStatus,
            note: nextNote,
            notes: nextNote,
            linkedBankItemId,
          },
        };
      });
      if (updates.note) {
        setWorkspaceNotes((prev) => ({
          ...prev,
          [ledgerId]: { ...(prev[ledgerId] || {}), workpaperNote: updates.note, status: updates.status },
        }));
      }
    },
    [createEmptyAllocation, createEmptySplitValues, mapCashStatusToClassification]
  );

  const handleCashLinkChange = useCallback(
    (links) => {
      const nextLinks = links && typeof links === 'object' ? links : {};
      setCashLinkMap(nextLinks);
      const ledgerWithLinks = new Set(Object.values(nextLinks));
      setClassificationAmounts((prev) => {
        const next = { ...prev };
        Object.entries(next).forEach(([ledgerId, entry]) => {
          if (entry?.linkedBankItemId && !ledgerWithLinks.has(ledgerId)) {
            next[ledgerId] = { ...entry, linkedBankItemId: '' };
          }
        });
        Object.entries(nextLinks).forEach(([bankId, ledgerId]) => {
          const existing = next[ledgerId] || createEmptyAllocation();
          next[ledgerId] = { ...existing, linkedBankItemId: bankId };
        });
        return next;
      });
    },
    [createEmptyAllocation]
  );

  const handleCashAdjustmentCreation = useCallback(
    (bankItem) => {
      if (!bankItem) return;
      const baseId =
        bankItem.bankId ||
        bankItem._tempId ||
        bankItem.reference ||
        bankItem.paymentId ||
        `adjustment-${Date.now()}`;
      let candidateId = baseId;
      let suffix = 1;
      while (disbursementById.has(candidateId)) {
        candidateId = `${baseId}-${suffix}`;
        suffix += 1;
      }
      const noteText = `Unrecorded item from cutoff: ${bankItem.reference || bankItem.bankId || candidateId}`;
      const adjustment = {
        paymentId: candidateId,
        reference: bankItem.reference || candidateId,
        payee: bankItem.payee || bankItem.description || bankItem.reference || '',
        amount: bankItem.amount || 0,
        paymentDate: bankItem.clearDate || bankItem.date || '',
        _sourceBankId: bankItem.bankId || bankItem._tempId || bankItem.reference || '',
      };
      setCashAdjustments((prev) => [...prev, adjustment]);
      setClassificationAmounts((prev) => ({
        ...prev,
        [candidateId]: {
          ...createEmptyAllocation(),
          mode: 'single',
          singleClassification: 'improperlyExcluded',
          status: 'adjustment',
          note: noteText,
          notes: noteText,
          linkedBankItemId: bankItem.bankId || bankItem._tempId || bankItem.reference || '',
        },
      }));
      setWorkspaceNotes((prev) => ({
        ...prev,
        [candidateId]: { ...(prev[candidateId] || {}), workpaperNote: noteText, status: 'adjustment' },
      }));
      setCashLinkMap((prev) => ({
        ...prev,
        [bankItem.bankId || bankItem._tempId || bankItem.reference || candidateId]: candidateId,
      }));
    },
    [createEmptyAllocation, disbursementById]
  );

  const handleCashSummaryChange = useCallback((summary) => {
    if (!summary || typeof summary !== 'object') return;
    setCashSummaryDraft(summary);
  }, []);

  const toggleLeadScheduleTick = useCallback(
    (cellKey) => {
      if (!cellKey || isLocked) return;
      setFixedAssetDraft((prev) => {
        const next = normalizeFixedAssetDraft(prev);
        const current = next.leadScheduleTicks[cellKey] || '';
        const nextValue = current === 'verified' ? 'exception' : current === 'exception' ? '' : 'verified';
        return {
          ...next,
          leadScheduleTicks: { ...next.leadScheduleTicks, [cellKey]: nextValue },
        };
      });
    },
    [isLocked]
  );

  const updateScopingDecision = useCallback((updates) => {
    setFixedAssetDraft((prev) => {
      const next = normalizeFixedAssetDraft(prev);
      const currentDecision =
        next.scopingDecision && typeof next.scopingDecision === 'object' ? next.scopingDecision : {};
      return {
        ...next,
        scopingDecision: { ...currentDecision, ...updates },
      };
    });
  }, []);

  const upsertAdditionResponse = useCallback((additionId, updates) => {
    if (!additionId) return;
    setFixedAssetDraft((prev) => {
      const next = normalizeFixedAssetDraft(prev);
      const existing = next.additionResponses?.[additionId] || {};
      return {
        ...next,
        additionResponses: {
          ...next.additionResponses,
          [additionId]: { ...existing, ...updates },
        },
      };
    });
  }, []);

  const upsertDisposalResponse = useCallback((disposalId, updates) => {
    if (!disposalId) return;
    setFixedAssetDraft((prev) => {
      const next = normalizeFixedAssetDraft(prev);
      const existing = next.disposalResponses?.[disposalId] || {};
      return {
        ...next,
        disposalResponses: {
          ...next.disposalResponses,
          [disposalId]: { ...existing, ...updates },
        },
      };
    });
  }, []);

  const updateAnalyticsResponse = useCallback((updates) => {
    setFixedAssetDraft((prev) => {
      const next = normalizeFixedAssetDraft(prev);
      const existing = next.analyticsResponse && typeof next.analyticsResponse === 'object' ? next.analyticsResponse : {};
      return {
        ...next,
        analyticsResponse: { ...existing, ...updates },
      };
    });
  }, []);

  const goToTestingStep = () => {
    if (isLocked) return;
    if (!isCashLayout && selectedIds.length === 0) {
      showModal('Please select at least one disbursement to continue.', 'No Selection');
      return;
    }
    if (!isCashLayout) {
      const missingDocs = selectedEvidenceItems.filter(
        (item) => !item?.hasLinkedDocument && !isEvidenceWorkflowLinked(item.paymentId)
      );
      if (missingDocs.length > 0) {
        const missingList = Array.from(new Set(missingDocs.map((item) => item?.paymentId || 'Unknown ID'))).join(', ');
        showModal(
          `Support for the following selections is still pending:\n${missingList}\n\nPlease wait for the supporting documents before continuing.`,
          'Support Not Ready'
        );
        return;
      }
    }
    setClassificationAmounts((prev) => {
      const next = { ...prev };
      selectedIds.forEach((id) => {
        if (!next[id]) {
          next[id] = createEmptyAllocation();
        }
      });
      return next;
    });
    const targetStep = workflow.includes(FLOW_STEPS.TESTING)
      ? FLOW_STEPS.TESTING
      : workflow[1] ?? resultsWorkflowStep;
    setActiveStep(targetStep);
  };

  const handleSubmitFixedAsset = async () => {
    if (!caseData || !userId) return;
    const scopingDecision = normalizeFixedAssetDraft(fixedAssetDraft).scopingDecision || {};
    const outcome = scopingDecision.outcome || '';
    const additionsExceedTm = Boolean(scopingDecision.additionsExceedTm);
    if (!outcome) {
      showModal('Lock a testing strategy before submitting.', 'Strategy Required');
      return;
    }

    if (outcome === 'requires_testing') {
      const missingAdditions = [];
      fixedAssetAdditions.forEach((item, index) => {
        const additionId = item._tempId || item.vendor || item.description || `addition-${index + 1}`;
        const response = fixedAssetDraft.additionResponses?.[additionId] || {};
        if (!response.nature || !response.threshold || !response.usefulLife) {
          missingAdditions.push(item.vendor || item.description || `Addition ${index + 1}`);
        }
      });

      const missingDisposals = [];
      fixedAssetDisposals.forEach((item, index) => {
        const disposalId = item._tempId || item.assetId || item.description || `disposal-${index + 1}`;
        const response = fixedAssetDraft.disposalResponses?.[disposalId] || {};
        const hasCoreInputs =
          response.proceeds !== undefined &&
          response.cost !== undefined &&
          response.accumulatedDepreciation !== undefined &&
          response.recordedGainLoss !== undefined;
        if (!hasCoreInputs) {
          missingDisposals.push(item.assetId || item.description || `Disposal ${index + 1}`);
        }
      });

      const analyticsComplete =
        fixedAssetDraft.analyticsResponse &&
        (fixedAssetDraft.analyticsResponse.conclusion === 'reasonable' ||
          fixedAssetDraft.analyticsResponse.conclusion === 'investigate');

      if (missingAdditions.length > 0) {
        showModal(
          `Add details for: ${missingAdditions.join(', ')} (nature, threshold, and useful life tests).`,
          'Additions Incomplete'
        );
        return;
      }
      if (missingDisposals.length > 0) {
        showModal(
          `Complete the disposal calculator for: ${missingDisposals.join(', ')} (proceeds, cost, accumulated depreciation, recorded gain/loss).`,
          'Disposals Incomplete'
        );
        return;
      }
      if (!analyticsComplete) {
        showModal('Record a conclusion on depreciation reasonableness.', 'Analytics Incomplete');
        return;
      }
    }

    const caseTitle = caseData?.title || caseData?.caseName || 'Audit Case';
    const virtualSeniorFeedback = [];
    let gradeOverride = 100;
    if (outcome === 'insufficient_scope') {
      gradeOverride = 0;
      virtualSeniorFeedback.push({
        paymentId: 'scope',
        notes: ['Virtual Senior: Additions exceed TM but you chose no testing. Scope is insufficient.'],
      });
    }
    if (outcome === 'no_testing' && !additionsExceedTm) {
      virtualSeniorFeedback.push({
        paymentId: 'scope',
        notes: ['Additions are under TM, so no further testing was required.'],
      });
    }

    try {
      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }

      await saveSubmission(userId, caseId, {
        caseId,
        caseName: caseTitle,
        selectedPaymentIds: [],
        disbursementClassifications: {},
        expectedClassifications: {},
        workspaceNotes,
        status: 'submitted',
        submittedAt: Timestamp.now(),
        fixedAssetResponses: {
          leadScheduleTicks: fixedAssetDraft.leadScheduleTicks || {},
          scopingDecision,
          additionResponses: fixedAssetDraft.additionResponses || {},
          disposalResponses: fixedAssetDraft.disposalResponses || {},
          analyticsResponse: fixedAssetDraft.analyticsResponse || {},
          summaryTotals: fixedAssetTotals,
        },
        grade: gradeOverride,
        gradedAt: Timestamp.now(),
        virtualSeniorFeedback,
      });

      await saveProgress({
        appId,
        uid: userId,
        caseId,
        patch: {
          percentComplete: 100,
          state: 'submitted',
          step: resultsWorkflowStep,
          draft: {
            selectedPaymentIds: [],
            classificationDraft: {},
            fixedAssetDraft,
          },
        },
      });

      setIsLocked(true);
      setActiveStep(resultsWorkflowStep);
    } catch (error) {
      console.error('Error saving fixed asset submission:', error);
      showModal('Error saving submission: ' + error.message, 'Error');
    }
  };

  const handleSubmitCash = async () => {
    if (!caseData || !userId) return;
    const cashContext = caseData.cashContext || {};
    const statusRequiresNote = (status) => status === 'outstanding' || status === 'void' || status === 'adjustment';
    const ledgerStatuses = {};
    const missing = [];

    disbursementList.forEach((item) => {
      const entry = classificationAmounts[item.paymentId] || {};
      const status = entry.status || '';
      const linkedBankItemId =
        entry.linkedBankItemId ||
        (cashLinkMap && Object.entries(cashLinkMap).find(([, ledgerId]) => ledgerId === item.paymentId)?.[0]) ||
        '';
      const note =
        entry.note ||
        entry.notes ||
        entry.workpaperNote ||
        workspaceNotes[item.paymentId]?.workpaperNote ||
        workspaceNotes[item.paymentId]?.notes ||
        '';
      if (!status) {
        missing.push(item.paymentId);
      }
      if (status === 'cleared' && !linkedBankItemId) {
        missing.push(item.paymentId);
      }
      if (statusRequiresNote(status) && !note.trim()) {
        missing.push(item.paymentId);
      }
      ledgerStatuses[item.paymentId] = { status, note, linkedBankItemId };
    });

    if (!cashCanSubmit) {
      showModal(
        'Variance must be zero before you can submit. Link items and adjust statuses until the reconciliation balances.',
        'Reconciliation Not Balanced'
      );
      return;
    }

    if (missing.length > 0) {
      const unique = Array.from(new Set(missing.filter(Boolean)));
      showModal(
        `Add required statuses, links, or notes for: ${unique.join(', ')}.`,
        'Cash Items Incomplete'
      );
      return;
    }

    const allocationPayload = {};
    disbursementList.forEach((disbursement) => {
      const allocation = classificationAmounts[disbursement.paymentId];
      if (!allocation) return;
      allocationPayload[disbursement.paymentId] = computeAllocationTotals(disbursement, allocation);
    });

    const documents = [];
    const workspacePayload = disbursementList.reduce((acc, item) => {
      const existing = workspaceNotes[item.paymentId] || {};
      const note = classificationAmounts[item.paymentId]?.note;
      if (note && !existing.workpaperNote) {
        acc[item.paymentId] = { ...existing, workpaperNote: note };
      } else {
        acc[item.paymentId] = existing;
      }
      return acc;
    }, {});

    const cashSummaryPayload = {
      ...(cashSummaryDraft || {}),
      bookBalance: cashContext.bookBalance ?? '',
      bankBalance: cashContext.bankBalance ?? cashContext.confirmedBalance ?? '',
    };

    const caseTitle = caseData.title || caseData.caseName || 'Audit Case';

    try {
      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }

      await saveSubmission(userId, caseId, {
        caseId,
        caseName: caseTitle,
        selectedPaymentIds: selectedIds,
        retrievedDocuments: documents,
        disbursementClassifications: allocationPayload,
        expectedClassifications: {},
        workspaceNotes: workspacePayload,
        status: 'submitted',
        submittedAt: Timestamp.now(),
        cashLinkMap,
        cashAdjustments,
        cashSummary: cashSummaryPayload,
        cashLedgerStatuses: ledgerStatuses,
      });

      await saveProgress({
        appId,
        uid: userId,
        caseId,
        patch: {
          percentComplete: 100,
          state: 'submitted',
          step: resultsWorkflowStep,
          draft: {
            selectedPaymentIds: selectedIds,
            classificationDraft: classificationAmounts,
            fixedAssetDraft,
            cashLinkMap,
            cashAdjustments,
            cashSummary: cashSummaryDraft,
          },
        },
      });

      setIsLocked(true);
      setActiveStep(resultsWorkflowStep);
    } catch (error) {
      console.error('Error saving cash submission:', error);
      showModal('Error saving submission: ' + error.message, 'Error');
    }
  };

  const handleSubmitTesting = async () => {
    if (isFixedAssetLayout) {
      await handleSubmitFixedAsset();
      return;
    }
    if (isCashLayout) {
      await handleSubmitCash();
      return;
    }
    if (!caseData || !userId || selectedIds.length === 0) return;

    const allocationPayload = {};
    const invalidAllocations = [];
    const missingRationale = [];
    if (exceptionNoteRequiredIds.length > 0) {
      showModal(
        `Please add supporting notes for the following disbursements before submitting: ${exceptionNoteRequiredIds.join(
          ', '
        )}.`,
        'Notes Required'
      );
      return;
    }

    selectedDisbursementDetails.forEach((disbursement) => {
      const allocation = classificationAmounts[disbursement.paymentId];
      if (!isAllocationComplete(disbursement, allocation)) {
        invalidAllocations.push(disbursement.paymentId);
        return;
      }
      const requiresAssertions =
        Array.isArray(disbursement.requiredAssertions) && disbursement.requiredAssertions.length > 0;
      const requiresReasons = Array.isArray(disbursement.errorReasons) && disbursement.errorReasons.length > 0;
      const rationale = workspaceNotes[disbursement.paymentId] || {};
      if (requiresAssertions && !rationale.assertionSelection) {
        missingRationale.push(disbursement.paymentId);
      }
      if (requiresReasons && !rationale.reasonSelection) {
        missingRationale.push(disbursement.paymentId);
      }
      const totals = computeAllocationTotals(disbursement, allocation);
      const entry = {};
      classificationFields.forEach(({ key }) => {
        const value = totals[key];
        entry[key] = Number.isFinite(value) ? value : 0;
      });
      allocationPayload[disbursement.paymentId] = entry;
    });

    if (invalidAllocations.length > 0) {
      showModal(
        `Please ensure the allocations for the following disbursements are numeric, non-negative, and total the disbursement amount: ${invalidAllocations.join(
          ', '
        )}.`,
        'Incomplete Classification'
      );
      return;
    }
    if (missingRationale.length > 0) {
      showModal(
        `Select an assertion and reason for: ${Array.from(new Set(missingRationale)).join(', ')}.`,
        'Rationale Required'
      );
      return;
    }

    const caseTitle = caseData.title || caseData.caseName || 'Audit Case';
    const expectedPayload = selectedIds.reduce((acc, id) => {
      const expected = disbursementById.get(id)?.expectedClassification;
      if (expected) {
        acc[id] = expected;
      }
      return acc;
    }, {});
    const documents = selectedDisbursementDetails.flatMap((disbursement) =>
      collectSupportingDocuments(disbursement).map((doc) => ({
        paymentId: disbursement.paymentId,
        fileName: doc.fileName,
        storagePath: doc.storagePath,
        downloadURL: doc.downloadURL,
      }))
    );
    const workspacePayload = selectedIds.reduce((acc, id) => {
      const existing = workspaceNotes[id] || {};
      const classificationNote = classificationAmounts[id]?.notes;
      if (typeof classificationNote === 'string' && classificationNote !== '' && !existing.workpaperNote) {
        acc[id] = { ...existing, workpaperNote: classificationNote };
      } else {
        acc[id] = existing;
      }
      return acc;
    }, {});

    try {
      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }

      await saveSubmission(userId, caseId, {
        caseId,
        caseName: caseTitle,
        selectedPaymentIds: selectedIds,
        retrievedDocuments: documents,
        disbursementClassifications: allocationPayload,
        expectedClassifications: expectedPayload,
        workspaceNotes: workspacePayload,
        status: 'submitted',
        submittedAt: Timestamp.now(),
      });

      await saveProgress({
        appId,
        uid: userId,
        caseId,
        patch: {
          percentComplete: 100,
          state: 'submitted',
          step: resultsWorkflowStep,
          draft: {
            selectedPaymentIds: selectedIds,
            classificationDraft: classificationAmounts,
            fixedAssetDraft,
          },
        },
      });

      setIsLocked(true);
      setActiveStep(resultsWorkflowStep);
    } catch (error) {
      console.error('Error saving submission:', error);
      showModal('Error saving submission: ' + error.message, 'Error');
    }
  };

  const handleViewDocument = async (docInfo) => {
    if (!docInfo || (!docInfo.storagePath && !docInfo.downloadURL)) {
      showModal('Document path or URL is missing. Cannot view.', 'Error');
      return;
    }
    if (docInfo.storagePath && docInfo.storagePath.includes('PENDING_CASE_ID')) {
      showModal('Document is still pending processing by admin (Case ID not finalized for path). Cannot view yet.', 'Error');
      return;
    }

    if (docInfo.downloadURL) {
      window.open(docInfo.downloadURL, '_blank');
      return;
    }

    if (docInfo.storagePath) {
      showModal(
        `Attempting to get download URL for: ${docInfo.fileName}\nPath: ${docInfo.storagePath}\n\nPlease wait...`,
        'Fetching Document',
        () => null
      );
      try {
        const fileRef = storageRef(storage, docInfo.storagePath);
        const url = await getDownloadURL(fileRef);
        hideModal();
        window.open(url, '_blank');
      } catch (error) {
        console.error('Error getting download URL:', error);
        hideModal();
        let errorMessage = `Could not retrieve document: ${docInfo.fileName}.\nError: ${error.code}\n\n`;
        errorMessage +=
          "This usually means the file was not actually uploaded to Firebase Storage at the expected path by an administrator, or you don't have permission to access it.\n\n";
        errorMessage += `Expected path: ${docInfo.storagePath}\n\n`;
        errorMessage += 'Please ensure the admin has uploaded the file and that Firebase Storage rules are correctly configured.';
        showModal(errorMessage, 'Error Viewing Document');
      }
    } else {
      showModal('No valid way to access the document.', 'Error');
    }
  };

  const caseTitle = caseData?.title || caseData?.caseName || 'Audit Case';

  if (loading) return <div className="p-4 text-center">Loading case details...</div>;
  if (!caseData) return <div className="p-4 text-center">Case not found or you may not have access. Redirecting...</div>;
  if (!activeStep) return <div className="p-4 text-center">Preparing workflow...</div>;

  const stepIndex = workflow.indexOf(activeStep);

  const renderStepper = () => (
    <ol className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-white rounded-lg shadow px-4 py-4">
      {workflow.map((stepKey, idx) => {
        const isCompleted = stepIndex > idx;
        const isActive = stepIndex === idx;
        const label =
          stepLabels[stepKey] ??
          DEFAULT_FLOW_COPY_STATE.stepLabels?.[stepKey] ??
          stepKey.charAt(0).toUpperCase() + stepKey.slice(1);
        const description =
          stepDescriptions[stepKey] ?? DEFAULT_FLOW_COPY_STATE.stepDescriptions?.[stepKey] ?? '';
        return (
          <li key={stepKey} className="flex items-center space-x-3">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                isActive ? 'bg-blue-600 text-white' : isCompleted ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'
              }`}
            >
              {isCompleted ? '✓' : idx + 1}
            </span>
            <div>
              <p className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{label}</p>
              <p className="text-xs text-gray-500 hidden sm:block">{description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
  const isEvidenceWorkflowLinked = (paymentId) => Boolean(workspaceNotes[paymentId]?.evidenceLinked);

  const renderEvidenceList = (items) => (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-800">Supporting Documents</h2>
        <p className="text-xs text-gray-500">Select a disbursement to preview its support.</p>
      </div>
      <div className="max-h-[460px] overflow-y-auto divide-y divide-gray-100">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No supporting documents selected yet.</p>
        ) : (
          items.map((item, index) => {
            const isActive = item.evidenceId === activeEvidenceId;
            const invoiceLabel =
              item.evidenceFileName ||
              item.fileName ||
              (item.paymentId ? `Invoice for ${item.paymentId}` : `Invoice ${index + 1}`);
            const payeeLabel = item.payee || 'Unknown payee';
            const documentLabel = `${invoiceLabel} — ${payeeLabel}`;
            const evidenceSatisfied =
              item.hasLinkedDocument || isEvidenceWorkflowLinked(item.paymentId);
            return (
              <button
                key={item.evidenceId}
                type="button"
                onClick={() => setActiveEvidenceId(item.evidenceId)}
                aria-label={`Evidence for ${documentLabel}`}
                className={`w-full text-left px-4 py-3 focus:outline-none transition-colors ${
                  isActive ? 'bg-blue-50 border-l-4 border-blue-500' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>
                    Invoice: {invoiceLabel}
                  </span>
                  {!evidenceSatisfied && (
                    <span className="ml-3 inline-flex items-center text-[10px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                      Document not linked
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Payee:{' '}
                  <strong className="text-gray-700 font-medium">{payeeLabel}</strong>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const renderEvidenceViewer = (items) => (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col min-h-[480px]">
      <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Document Viewer</h2>
          <p className="text-xs text-gray-500">
            {items.length === 0
              ? 'Choose a disbursement to see its supporting document.'
              : activeEvidenceId
              ? `Now viewing: ${
                  items.find((item) => item.evidenceId === activeEvidenceId)?.evidenceFileName ||
                  items.find((item) => item.evidenceId === activeEvidenceId)?.paymentId ||
                  'Supporting document'
                }`
              : 'Select a disbursement to view its document.'}
          </p>
        </div>
        {viewerEnabled && activeEvidenceId ? (
          (() => {
            const activeEvidence = items.find((item) => item.evidenceId === activeEvidenceId);
            if (!activeEvidence || (!activeEvidence.storagePath && !activeEvidence.downloadURL)) return null;
            return (
              <Button
                variant="secondary"
                className="text-xs px-3 py-1"
                onClick={() =>
                  handleViewDocument({
                    fileName: activeEvidence.evidenceFileName,
                    storagePath: activeEvidence.storagePath,
                    downloadURL: activeEvidence.downloadURL,
                  })
                }
              >
                <ExternalLink size={14} className="inline mr-1" /> Open in new tab
              </Button>
            );
          })()
        ) : null}
      </div>
      <div className="flex-1 bg-gray-100 rounded-b-lg flex items-center justify-center">
        {activeEvidenceLoading ? (
          <div className="flex flex-col items-center text-gray-500">
            <Loader2 size={32} className="animate-spin mb-2" />
            <p className="text-sm">Loading document…</p>
          </div>
        ) : activeEvidenceError ? (
          <div className="max-w-sm text-center px-6 py-4 text-sm text-amber-700 bg-amber-100 border border-amber-200 rounded-md">
            {activeEvidenceError}
          </div>
        ) : activeEvidenceUrl ? (
          <iframe
            title="Evidence document"
            src={activeEvidenceUrl}
            className="w-full h-full rounded-b-lg"
            style={{ minHeight: '480px' }}
          />
        ) : (
          <p className="text-sm text-gray-500 px-6 text-center">
            Select a disbursement with a linked document to preview it here.
          </p>
        )}
      </div>
    </div>
  );

  const triggerFileDownload = async (url, filename) => {
    const safeName = filename || 'reference-document';
    const hasFetch = typeof fetch === 'function';
    const canStream = typeof window !== 'undefined' && window.URL && typeof window.URL.createObjectURL === 'function';

    if (!hasFetch || !canStream) {
      window.open(url, '_blank', 'noopener');
      return;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Unable to retrieve file contents.');
    }
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 2000);
  };

  const downloadReferenceDocument = async (doc) => {
    if (!doc) {
      throw new Error('Reference document metadata is missing.');
    }

    const displayName = (doc.fileName || 'reference-document').trim() || 'reference-document';
    let url = (doc.downloadURL || '').trim();

    if (!url) {
      if (!doc.storagePath) {
        throw new Error('Reference document is missing a download link.');
      }
      url = await getDownloadURL(storageRef(storage, doc.storagePath));
    }

    await triggerFileDownload(url, displayName);
  };

  const handleDownloadAllReferences = async () => {
    if (referenceDocuments.length === 0) return;

    setDownloadingReferences(true);
    const errors = [];

    for (const doc of referenceDocuments) {
      try {
        await downloadReferenceDocument(doc);
      } catch (error) {
        console.error('Error downloading reference document:', error);
        errors.push(`- ${(doc?.fileName || 'Reference document').trim() || 'Reference document'}: ${error?.message || error}`);
      }
    }

    if (errors.length > 0) {
      showModal(`Some reference documents could not be downloaded:\n${errors.join('\n')}`, 'Download Errors');
    }

    setDownloadingReferences(false);
  };

  const renderReferenceDownloadsBanner = () => {
    if (referenceDocuments.length === 0) {
      return (
        <div className="bg-gray-50 border border-gray-200 text-gray-700 rounded-lg px-4 py-3">
          Reference materials will appear here when provided by your instructor.
        </div>
      );
    }

    return (
      <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg px-4 py-3 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide">Reference Materials</h3>
            <p className="text-xs sm:text-sm text-indigo-800">
              Download the necessary reference documents before you begin classifying results.
            </p>
          </div>
          <div>
            <Button
              variant="secondary"
              className="text-xs px-3 py-1 bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
              onClick={handleDownloadAllReferences}
              isLoading={downloadingReferences}
              disabled={downloadingReferences}
            >
              <Download size={14} className="inline mr-1" />
              Download All Reference Documents
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderFixedAssetSelectionStep = () => {
    const leadTicks = fixedAssetDraft.leadScheduleTicks || {};
    const totalTickTargets = ['total:beginningBalance', 'total:additions', 'total:disposals', 'total:endingBalance'];
    const totalsTicked = totalTickTargets.every((key) => leadTicks[key]);
    const scopingDraft = normalizeFixedAssetDraft(fixedAssetDraft).scopingDecision || {};
    const tmValue = scopingDraft.tmInput ?? fixedAssetRisk?.tolerableMisstatement ?? '';
    const additionsValue = fixedAssetTotals.additions || 0;
    const tmNumber = Number(tmValue);
    const additionsExceedTm = Number.isFinite(tmNumber) ? additionsValue > tmNumber : false;
    const studentPlan = scopingDraft.studentPlan || '';
    const rationale = scopingDraft.rationale || '';
    const outcome = scopingDraft.outcome || '';
    const leadCellClass = (cellKey) => {
      const state = leadTicks[cellKey];
      if (state === 'verified') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
      if (state === 'exception') return 'border-rose-200 bg-rose-50 text-rose-800';
      return 'border-gray-200 bg-gray-50 text-gray-700';
    };

    const renderScopingModal = () => {
      if (!isScopingModalOpen) return null;
      const planLabel =
        studentPlan === 'testing' ? 'Proceed to testing' : studentPlan === 'no_testing' ? 'No testing' : '—';
      const handleConfirmScopingDecision = () => {
        if (!studentPlan) {
          setScopingModalError('Choose a testing strategy before continuing.');
          return;
        }
        const nextOutcome =
          studentPlan === 'no_testing'
            ? additionsExceedTm
              ? 'insufficient_scope'
              : 'no_testing'
            : 'requires_testing';
        setScopingModalError('');
        setFixedAssetDraft((prev) => {
          const base = normalizeFixedAssetDraft(prev);
          return {
            ...base,
            scopingDecision: {
              ...base.scopingDecision,
              tmInput: tmValue,
              additionsTotal: additionsValue,
              additionsExceedTm,
              studentPlan,
              rationale,
              outcome: nextOutcome,
              decidedAt: new Date().toISOString(),
            },
          };
        });
        setIsScopingModalOpen(false);
        setActiveStep(FLOW_STEPS.TESTING);
      };

      return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <p className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Testing Strategy Selector</p>
                <h3 className="text-lg font-bold text-gray-900">Decide whether testing is required</h3>
              </div>
              <button
                type="button"
                className="text-gray-500 hover:text-gray-700"
                onClick={() => {
                  setIsScopingModalOpen(false);
                  setScopingModalError('');
                }}
              >
                ✕
              </button>
            </div>
            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700">
                  Tolerable Misstatement
                  <Input
                    type="number"
                    inputMode="decimal"
                    className="mt-1"
                    value={tmValue}
                    onChange={(event) => updateScopingDecision({ tmInput: event.target.value })}
                  />
                </label>
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">System check</p>
                  <p className="mt-1 text-sm text-indigo-900">
                    Is Total Additions ({currencyFormatter.format(additionsValue)}) {'>'}{' '}
                    TM ({tmValue ? currencyFormatter.format(Number(tmValue) || 0) : 'enter TM'})?
                  </p>
                  <p className="mt-1 text-sm font-semibold text-indigo-800">
                    {additionsExceedTm ? 'Yes — testing expected.' : 'No — testing may not be required.'}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-3">
                <p className="text-sm font-semibold text-gray-800">Your decision</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      checked={studentPlan === 'testing'}
                      onChange={() => updateScopingDecision({ studentPlan: 'testing' })}
                    />
                    Proceed to detailed testing
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      checked={studentPlan === 'no_testing'}
                      onChange={() => updateScopingDecision({ studentPlan: 'no_testing' })}
                    />
                    No testing required
                  </label>
                  <span className="text-xs text-gray-500">Virtual Senior expects testing when additions exceed TM.</span>
                </div>
                <Textarea
                  placeholder="Document your rationale (e.g., why testing is or is not required)."
                  value={rationale}
                  onChange={(event) => updateScopingDecision({ rationale: event.target.value })}
                  rows={3}
                />
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p className="font-semibold">Outcome preview</p>
                  <p className="mt-1">
                    Plan: {planLabel}.{' '}
                    {additionsExceedTm && studentPlan === 'no_testing'
                      ? 'Virtual Senior will flag insufficient scope.'
                      : studentPlan
                      ? 'Decision will be recorded when you lock the strategy.'
                      : 'Choose a strategy to continue.'}
                  </p>
                </div>
                {scopingModalError ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {scopingModalError}
                  </div>
                ) : null}
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setIsScopingModalOpen(false);
                    setScopingModalError('');
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleConfirmScopingDecision}>Lock Strategy</Button>
              </div>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="relative">
        {renderScopingModal()}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-5">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Lead Schedule</p>
            <h2 className="text-2xl font-semibold text-gray-800">Tick and tie the rollforward before testing</h2>
            <p className="text-sm text-gray-500">
              Click each balance to mark it as verified (green) or not agreed (red). Summary totals must be ticked
              before you choose your testing strategy.
            </p>
          </div>

          {fixedAssetSummary.length === 0 ? (
            <p className="text-gray-600 text-sm">
              No rollforward data available. Contact your instructor before proceeding.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Asset Class
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Beg Bal
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Additions
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Disposals
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                      End Bal
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {fixedAssetSummary.map((row, index) => {
                    const rowKey = row.className || `class-${index + 1}`;
                    const renderCell = (fieldKey, value) => {
                      const cellKey = `${rowKey}:${fieldKey}`;
                      return (
                        <td key={cellKey} className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => toggleLeadScheduleTick(cellKey)}
                            className={`w-full rounded-md border px-3 py-2 text-right transition ${leadCellClass(cellKey)}`}
                            aria-label={`Tick ${row.className || rowKey} ${fieldKey}`}
                          >
                            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
                              <span>{leadTicks[cellKey] === 'exception' ? 'Does not agree' : 'Tick'}</span>
                              {leadTicks[cellKey] === 'verified' ? (
                                <CheckCircle2 size={14} />
                              ) : leadTicks[cellKey] === 'exception' ? (
                                <XCircle size={14} />
                              ) : null}
                            </div>
                            <div className="text-base font-semibold">
                              {currencyFormatter.format(Number(value) || 0)}
                            </div>
                          </button>
                        </td>
                      );
                    };

                    return (
                      <tr key={rowKey}>
                        <td className="px-3 py-2 font-semibold text-gray-800">{row.className || `Class ${index + 1}`}</td>
                        {renderCell('beginningBalance', row.beginningBalance)}
                        {renderCell('additions', row.additions)}
                        {renderCell('disposals', row.disposals)}
                        {renderCell('endingBalance', row.endingBalance)}
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-50 font-semibold text-gray-900">
                    <td className="px-3 py-2">Total</td>
                    {['beginningBalance', 'additions', 'disposals', 'endingBalance'].map((col) => {
                      const cellKey = `total:${col}`;
                      const value = fixedAssetTotals[col] || 0;
                      return (
                        <td key={cellKey} className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => toggleLeadScheduleTick(cellKey)}
                            className={`w-full rounded-md border px-3 py-2 text-right transition ${leadCellClass(cellKey)}`}
                            aria-label={`Tick total ${col}`}
                          >
                            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
                              <span>Summary total</span>
                              {leadTicks[cellKey] === 'verified' ? (
                                <CheckCircle2 size={14} />
                              ) : leadTicks[cellKey] === 'exception' ? (
                                <XCircle size={14} />
                              ) : null}
                            </div>
                            <div className="text-base font-semibold">{currencyFormatter.format(value)}</div>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1 text-sm text-gray-700">
              <p className="font-semibold text-gray-800">Tickmark legend</p>
              <p>
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 mr-2">
                  Verified
                </span>
                <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                  Does not agree
                </span>
              </p>
              <p className="text-xs text-gray-500">Totals must be ticked before you can choose a testing strategy.</p>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Strategy status</div>
              <div className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-800">
                {outcome === 'requires_testing'
                  ? 'Testing unlocked'
                  : outcome === 'no_testing'
                  ? 'No testing required'
                  : outcome === 'insufficient_scope'
                  ? 'Insufficient scope'
                  : 'Pending strategy'}
              </div>
              <div className="text-xs text-gray-500">
                TM: {tmValue ? currencyFormatter.format(Number(tmValue) || 0) : 'enter TM'} | Additions:{' '}
                {currencyFormatter.format(additionsValue)}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={() => navigate('/trainee')}>
              Back to Cases
            </Button>
            <Button
              onClick={() => {
                setIsScopingModalOpen(true);
                setScopingModalError('');
              }}
              disabled={isLocked || !totalsTicked || fixedAssetSummary.length === 0}
            >
              Open Testing Strategy Selector
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderInstructionStep = () => {
    const instructionData = caseData?.instruction || {};
    return (
      <InstructionView
        instructionData={instructionData}
        onStartSimulation={() => {
          setActiveStep(FLOW_STEPS.SELECTION);
          enqueueProgressSave(FLOW_STEPS.SELECTION);
        }}
      />
    );
  };

  const renderSelectionStep = () => (
    isFixedAssetLayout ? (
      renderFixedAssetSelectionStep()
    ) : (
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">Step 1 — Select Disbursements</h2>
          <p className="text-sm text-gray-500">
            Choose which disbursements you want to test. You will review supporting documents on the next step.
          </p>
        </div>

        {disbursementList.length === 0 ? (
          <p className="text-gray-500">No disbursements are available for this case.</p>
        ) : (
          <div className="space-y-3">
            {disbursementList.map((d, index) => {
              const displayId = d.paymentId || d.reference || d._tempId || d.id || `item-${index + 1}`;
              const displayDate = d.paymentDate || d.issueDate || d.bookDate || '';
              return (
                <div
                  key={displayId}
                  className="flex items-center p-4 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
                >
                <input
                  type="checkbox"
                  id={`cb-${displayId}`}
                  checked={!!selectedDisbursements[displayId]}
                  onChange={() => handleSelectionChange(displayId)}
                  disabled={isLocked}
                  className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-4 cursor-pointer disabled:cursor-not-allowed"
                />
                <label
                  htmlFor={`cb-${displayId}`}
                  className="flex-grow grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1 cursor-pointer"
                >
                  <span className="text-sm text-gray-700">
                    <strong className="font-medium">ID:</strong> {displayId}
                  </span>
                  <span className="text-sm text-gray-700">
                    <strong className="font-medium">Payee:</strong> {d.payee || d.reference || '—'}
                  </span>
                  <span className="text-sm text-gray-700">
                    <strong className="font-medium">Amount:</strong> {currencyFormatter.format(Number(d.amount) || 0)}
                  </span>
                  <span className="text-sm text-gray-700">
                    <strong className="font-medium">Date:</strong> {displayDate}
                  </span>
                  {d.expectedClassification ? (
                    <span className="text-xs text-gray-500">
                      Expected classification: {d.expectedClassification}
                    </span>
                  ) : null}
                </label>
              </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <Button variant="secondary" onClick={() => navigate('/trainee')}>
            Back to Cases
          </Button>
          <Button onClick={goToTestingStep} disabled={selectedIds.length === 0 || isLocked}>
            Continue to Classification
          </Button>
        </div>
      </div>
    )
  );

  const renderFixedAssetTestingStep = () => {
    const scopingDecision = normalizeFixedAssetDraft(fixedAssetDraft).scopingDecision || {};
    const outcome = scopingDecision.outcome || '';
    const additionsExceedTm = Boolean(scopingDecision.additionsExceedTm);
    const tmValue = scopingDecision.tmInput ?? fixedAssetRisk?.tolerableMisstatement ?? '';

    if (!outcome) {
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
          <h2 className="text-2xl font-semibold text-gray-800">Lock your testing strategy</h2>
          <p className="text-sm text-gray-600">
            Finish the rollforward tickmarking and open the Testing Strategy Selector before starting work.
          </p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => setActiveStep(firstWorkflowStep)}>
              Return to Lead Schedule
            </Button>
          </div>
        </div>
      );
    }

    const scopingSummaryCard = (
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Scoping checkpoint</p>
          <p className="text-sm text-indigo-900">
            Additions: {currencyFormatter.format(fixedAssetTotals.additions || 0)} · TM:{' '}
            {tmValue ? currencyFormatter.format(Number(tmValue) || 0) : 'not entered'}
          </p>
          <p className="text-xs text-indigo-800">
            Outcome: {outcome === 'requires_testing'
              ? 'Testing required'
              : outcome === 'no_testing'
              ? 'No testing required'
              : 'Insufficient scope'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setActiveStep(firstWorkflowStep)}>
            Edit Strategy
          </Button>
        </div>
      </div>
    );

    if (outcome !== 'requires_testing') {
      return (
        <div className="space-y-4">
          {scopingSummaryCard}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
            <h3 className="text-xl font-semibold text-gray-800">
              {outcome === 'no_testing' && !additionsExceedTm
                ? 'No further testing required'
                : 'Virtual Senior: scope failed'}
            </h3>
            <p className="text-sm text-gray-600">
              {outcome === 'no_testing' && !additionsExceedTm
                ? 'You concluded testing is unnecessary because additions are under tolerable misstatement.'
                : 'Additions exceed tolerable misstatement, so skipping testing will be flagged as insufficient scope.'}
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setActiveStep(firstWorkflowStep)}>
                Back
              </Button>
              <Button onClick={handleSubmitFixedAsset}>Record Decision and Finish</Button>
            </div>
          </div>
        </div>
      );
    }

    const capitalizationThreshold =
      Number(fixedAssetRisk.capitalizationThreshold || fixedAssetRisk.tolerableMisstatement || 0) || 0;

    return (
      <div className="space-y-6">
        {scopingSummaryCard}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Capitalization Policy</p>
            <h3 className="text-lg font-semibold text-gray-800">Keep the policy visible while testing</h3>
            <p className="mt-1 text-sm text-gray-600">
              Use the client policy to benchmark nature, threshold, and useful life conclusions.
            </p>
            {referenceDocuments.length > 0 ? (
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    handleViewDocument({
                      fileName: referenceDocuments[0].fileName,
                      storagePath: referenceDocuments[0].storagePath,
                      downloadURL: referenceDocuments[0].downloadURL,
                    })
                  }
                >
                  Open {referenceDocuments[0].fileName}
                </Button>
                {referenceDocuments.length > 1 ? (
                  <Button variant="ghost" onClick={handleDownloadAllReferences}>
                    Download all reference docs
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                No policy document linked. Check the Reference Materials section.
              </p>
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Invoice Viewer</p>
            <h3 className="text-lg font-semibold text-gray-800">Reference tray for source documents</h3>
            <p className="mt-1 text-sm text-gray-600">
              Use the existing document viewer to open each invoice while you record conclusions below.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {renderEvidenceList(selectedEvidenceItems)}
              {renderEvidenceViewer(selectedEvidenceItems)}
            </div>
          </div>
        </div>

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Additions workbench</p>
            <h3 className="text-lg font-semibold text-gray-800">Nature, threshold, and useful life tests</h3>
          </div>
          {fixedAssetAdditions.length === 0 ? (
            <p className="text-sm text-gray-600">No additions were provided for this case.</p>
          ) : (
            <div className="space-y-3">
              {fixedAssetAdditions.map((item, index) => {
                const additionId = item._tempId || item.vendor || item.description || `addition-${index + 1}`;
                const response = fixedAssetDraft.additionResponses?.[additionId] || {};
                const amountNumber = Number(item.amount) || 0;
                const autoThreshold = capitalizationThreshold > 0 ? amountNumber >= capitalizationThreshold : null;
                return (
                  <div key={additionId} className="rounded-md border border-gray-200 p-3 bg-gray-50">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-gray-800">{item.vendor || 'Addition'}</p>
                        <p className="text-xs text-gray-500">
                          {item.description || 'No description'} · In-service: {item.inServiceDate || '—'}
                        </p>
                      </div>
                      <div className="text-sm font-semibold text-gray-900">
                        {currencyFormatter.format(amountNumber)}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Nature test</label>
                        <select
                          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          value={response.nature || ''}
                          onChange={(event) => upsertAdditionResponse(additionId, { nature: event.target.value })}
                        >
                          <option value="">Select...</option>
                          <option value="capital_asset">Capital Asset</option>
                          <option value="repair_expense">Repair / Expense</option>
                          <option value="startup">Start-up / Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-700">
                          Threshold test {capitalizationThreshold ? `(>${currencyFormatter.format(capitalizationThreshold)})` : ''}
                        </label>
                        <select
                          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          value={response.threshold || ''}
                          onChange={(event) => upsertAdditionResponse(additionId, { threshold: event.target.value })}
                        >
                          <option value="">Select...</option>
                          <option value="over_threshold">Cost exceeds threshold</option>
                          <option value="under_threshold">Cost under threshold</option>
                        </select>
                        {autoThreshold !== null ? (
                          <p className="mt-1 text-[11px] text-gray-500">
                            System check: {autoThreshold ? 'Above' : 'Below'} threshold based on amount.
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Useful life test</label>
                        <select
                          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
                          value={response.usefulLife || ''}
                          onChange={(event) => upsertAdditionResponse(additionId, { usefulLife: event.target.value })}
                        >
                          <option value="">Select...</option>
                          <option value="appropriate">Appropriate</option>
                          <option value="too_short">Too short</option>
                          <option value="too_long">Too long</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <Input
                        placeholder="Proposed debit account"
                        value={response.debitAccount || ''}
                        onChange={(event) =>
                          upsertAdditionResponse(additionId, { debitAccount: event.target.value })
                        }
                      />
                      <Input
                        placeholder="Proposed credit account"
                        value={response.creditAccount || ''}
                        onChange={(event) =>
                          upsertAdditionResponse(additionId, { creditAccount: event.target.value })
                        }
                      />
                      <Input
                        placeholder="Adjustment amount"
                        type="number"
                        inputMode="decimal"
                        value={response.adjustmentAmount || ''}
                        onChange={(event) =>
                          upsertAdditionResponse(additionId, { adjustmentAmount: event.target.value })
                        }
                      />
                    </div>
                    <Textarea
                      className="mt-3"
                      placeholder="Workpaper note or proposed reclassification entry"
                      value={response.note || ''}
                      onChange={(event) => upsertAdditionResponse(additionId, { note: event.target.value })}
                      rows={3}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Disposals workbench</p>
            <h3 className="text-lg font-semibold text-gray-800">Re-perform gain/loss calculation</h3>
          </div>
          {fixedAssetDisposals.length === 0 ? (
            <p className="text-sm text-gray-600">No disposals provided for this case.</p>
          ) : (
            <div className="space-y-3">
              {fixedAssetDisposals.map((item, index) => {
                const disposalId = item._tempId || item.assetId || item.description || `disposal-${index + 1}`;
                const response = fixedAssetDraft.disposalResponses?.[disposalId] || {};
                const proceeds = Number(response.proceeds ?? item.proceeds ?? 0);
                const cost = Number(response.cost ?? item.cost ?? 0);
                const accDep = Number(response.accumulatedDepreciation ?? 0);
                const recordedGainLoss = Number(response.recordedGainLoss ?? 0);
                const calculatedGainLoss = proceeds - (cost - accDep);
                const variance =
                  response.recordedGainLoss !== undefined ? calculatedGainLoss - recordedGainLoss : null;
                return (
                  <div key={disposalId} className="rounded-md border border-gray-200 p-3 bg-gray-50 space-y-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-gray-800">{item.assetId || item.description || 'Disposal'}</p>
                        <p className="text-xs text-gray-500">{item.description || 'No description provided.'}</p>
                      </div>
                      <div className="text-sm text-gray-600">
                        NBV: {item.nbv ? currencyFormatter.format(Number(item.nbv) || 0) : '—'}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
                        Proceeds (per bank)
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={response.proceeds ?? item.proceeds ?? ''}
                          onChange={(event) => upsertDisposalResponse(disposalId, { proceeds: event.target.value })}
                        />
                      </label>
                      <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
                        Cost per schedule
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={response.cost ?? item.cost ?? ''}
                          onChange={(event) => upsertDisposalResponse(disposalId, { cost: event.target.value })}
                        />
                      </label>
                      <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
                        Accumulated dep
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={response.accumulatedDepreciation ?? ''}
                          onChange={(event) =>
                            upsertDisposalResponse(disposalId, { accumulatedDepreciation: event.target.value })
                          }
                        />
                      </label>
                      <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
                        Recorded gain/loss
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={response.recordedGainLoss ?? ''}
                          onChange={(event) =>
                            upsertDisposalResponse(disposalId, { recordedGainLoss: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <div className="flex flex-col gap-1 text-sm text-gray-700">
                      <p className="font-semibold">
                        Calculated gain/loss: {currencyFormatter.format(calculatedGainLoss || 0)}
                      </p>
                      {variance !== null ? (
                        <p className={Math.abs(variance) > 1 ? 'text-rose-700' : 'text-emerald-700'}>
                          Variance vs recorded: {currencyFormatter.format(variance)}
                        </p>
                      ) : null}
                    </div>
                    <Textarea
                      className="mt-2"
                      placeholder="Document proposed adjustment or support"
                      value={response.note || ''}
                      onChange={(event) => upsertDisposalResponse(disposalId, { note: event.target.value })}
                      rows={3}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Depreciation analytics</p>
            <h3 className="text-lg font-semibold text-gray-800">Recalculate expected expense</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Total asset base</p>
              <p className="text-lg font-semibold text-indigo-900">
                {currencyFormatter.format(fixedAssetTotals.endingBalance || fixedAssetTotals.beginningBalance || 0)}
              </p>
            </div>
            <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Weighted average life</p>
              <p className="text-lg font-semibold text-indigo-900">
                {fixedAssetRisk.weightedAverageLife || fixedAssetDraft.analyticsResponse?.weightedAverageLife || '—'} years
              </p>
            </div>
            <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Suggested expectation</p>
              <p className="text-lg font-semibold text-indigo-900">
                {(() => {
                  const life =
                    Number(fixedAssetDraft.analyticsResponse?.weightedAverageLife) ||
                    Number(fixedAssetRisk.weightedAverageLife) ||
                    0;
                  const baseAmount = fixedAssetTotals.endingBalance || fixedAssetTotals.beginningBalance || 0;
                  const expected = life > 0 ? baseAmount / life : 0;
                  return currencyFormatter.format(expected || 0);
                })()}
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
              Your expected expense
              <Input
                type="number"
                inputMode="decimal"
                value={fixedAssetDraft.analyticsResponse?.expectedExpense || ''}
                onChange={(event) => updateAnalyticsResponse({ expectedExpense: event.target.value })}
              />
            </label>
            <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
              Client recorded expense
              <Input
                type="number"
                inputMode="decimal"
                value={fixedAssetDraft.analyticsResponse?.recordedExpense || ''}
                onChange={(event) => updateAnalyticsResponse({ recordedExpense: event.target.value })}
              />
            </label>
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-gray-700 mb-1">Conclusion</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    checked={fixedAssetDraft.analyticsResponse?.conclusion === 'reasonable'}
                    onChange={() => updateAnalyticsResponse({ conclusion: 'reasonable' })}
                  />
                  Reasonable (within 5%)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    checked={fixedAssetDraft.analyticsResponse?.conclusion === 'investigate'}
                    onChange={() => updateAnalyticsResponse({ conclusion: 'investigate' })}
                  />
                  Investigate (>5% variance)
                </label>
              </div>
            </div>
          </div>
          <Textarea
            className="mt-2"
            placeholder="Analytics note"
            value={fixedAssetDraft.analyticsResponse?.note || ''}
            onChange={(event) => updateAnalyticsResponse({ note: event.target.value })}
            rows={3}
          />
        </section>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <Button variant="secondary" onClick={() => setActiveStep(firstWorkflowStep)} disabled={isLocked}>
            Back to Lead Schedule
          </Button>
          <Button onClick={handleSubmitFixedAsset} disabled={isLocked}>
            <Send size={18} className="inline mr-2" /> Submit Fixed Asset Testing
          </Button>
        </div>
      </div>
    );
  };

  const renderCashTestingStep = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">Step 2 — Classify Results</h2>
          <p className="text-sm text-gray-500">{testingIntro}</p>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
        <CashReconciliationWorkbench
          ledgerItems={cashOutstandingList}
          cutoffItems={cashCutoffList}
          artifacts={cashArtifacts}
          cashContext={caseData?.cashContext || {}}
          classificationAmounts={classificationAmounts}
          links={cashLinkMap}
          adjustments={cashAdjustments}
          summaryDraft={cashSummaryDraft}
          onUpdateStatus={handleCashStatusUpdate}
          onLinkChange={handleCashLinkChange}
          onVarianceChange={(ready) => setCashCanSubmit(ready)}
          onProposeAdjustment={handleCashAdjustmentCreation}
          onSummaryChange={handleCashSummaryChange}
          isLocked={isLocked}
        />
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <Button variant="secondary" onClick={() => setActiveStep(firstWorkflowStep)} disabled={isLocked}>
          Back to Selection
        </Button>
        <Button onClick={handleSubmitTesting} disabled={isLocked || !cashCanSubmit}>
          <Send size={18} className="inline mr-2" /> Submit Responses
        </Button>
      </div>
    </div>
  );

  const renderTwoPaneTestingStep = () => {
    const showEvidencePanels = layoutConfig.showEvidence !== false;
    const showWorkPanels = layoutConfig.showWork !== false;
    const showReferenceBanner = layoutConfig.hideReferenceBanner ? false : true;
    const showImmediateFeedback = layoutConfig.showImmediateFeedback !== false;
    const evidenceOnLeft =
      layoutConfig.evidencePosition === 'left' || layoutConfig.evidencePosition === undefined || layoutConfig.evidencePosition === null;

    const missingDocuments = selectedEvidenceItems.filter(
      (item) => !item?.hasLinkedDocument && !isEvidenceWorkflowLinked(item.paymentId)
    );
    const missingPaymentIds = Array.from(new Set(missingDocuments.map((item) => item?.paymentId || 'Unknown ID')));

    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800">Step 2 — Classify Results</h2>
            <p className="text-sm text-gray-500">{testingIntro}</p>
          </div>
          {missingPaymentIds.length > 0 ? (
            <div className="border border-amber-300 bg-amber-50 text-amber-800 text-sm rounded-md px-4 py-3">
              <p className="font-semibold">Some documents are still missing.</p>
              <p className="mt-1">
                The following disbursements do not have support yet:{' '}
                <span className="font-medium">{missingPaymentIds.join(', ')}</span>.
              </p>
            </div>
          ) : null}
        </div>

        {selectedIds.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 text-sm text-gray-600">
            You do not have any disbursements selected. Return to the selection step to add them before testing.
            <div className="mt-4">
              <Button variant="secondary" onClick={() => setActiveStep(firstWorkflowStep)}>
                Back to Selection
              </Button>
            </div>
          </div>
        ) : (
          <>
            {showReferenceBanner ? renderReferenceDownloadsBanner() : null}
            {showEvidencePanels ? (
              <div className="grid gap-6 md:grid-cols-2">
                {evidenceOnLeft ? (
                  <>
                    {renderEvidenceList(selectedEvidenceItems)}
                    {renderEvidenceViewer(selectedEvidenceItems)}
                  </>
                ) : (
                  <>
                    {renderEvidenceViewer(selectedEvidenceItems)}
                    {renderEvidenceList(selectedEvidenceItems)}
                  </>
                )}
              </div>
            ) : null}

            {showWorkPanels ? (
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">Allocate Each Disbursement</h3>
                {exceptionNoteRequiredIds.length > 0 ? (
                  <div className="mb-4 border border-amber-300 bg-amber-50 text-amber-800 text-sm rounded-md px-4 py-3">
                    <p className="font-semibold">Notes required for proposed adjustments.</p>
                    <p className="mt-1">
                      Add workpaper notes for:{' '}
                      <span className="font-medium">{exceptionNoteRequiredIds.join(', ')}</span> before submitting.
                    </p>
                  </div>
                ) : null}
                <div className="space-y-4">
                  {selectedDisbursementDetails.map((item) => {
                    const allocation = normalizeAllocationShape(
                      classificationAmounts[item.paymentId] || createEmptyAllocation()
                    );
                    const totals = computeAllocationTotals(item, allocation);
                    const totalEntered = classificationFields.reduce((sum, { key }) => {
                      const value = totals[key];
                      return sum + (Number.isFinite(value) ? value : 0);
                    }, 0);
                    const amountNumber = Number(item.amount) || 0;
                    const totalsMatch = Math.abs(totalEntered - amountNumber) <= 0.01;
                    const itemId = item.id || item.paymentId;
                    const immediateFeedback = deriveImmediateFeedbackForItem(item);

                    return (
                      <div key={itemId} className="space-y-2">
                        {showImmediateFeedback && immediateFeedback.length > 0 ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            {immediateFeedback.map((msg, idx) => (
                              <p key={`${itemId}-feedback-${idx}`}>{msg}</p>
                            ))}
                          </div>
                        ) : null}
                        {(Array.isArray(item.requiredAssertions) && item.requiredAssertions.length > 0) ||
                        (Array.isArray(item.errorReasons) && item.errorReasons.length > 0) ? (
                          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-xs text-blue-900 space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                              Rationale (Assertion & Reason)
                            </p>
                            {Array.isArray(item.requiredAssertions) && item.requiredAssertions.length > 0 ? (
                              <label className="flex flex-col gap-1">
                                <span>Select assertion</span>
                                <select
                                  className="rounded-md border border-blue-200 p-1 text-sm"
                                  value={workspaceNotes[itemId]?.assertionSelection || ''}
                                  onChange={(event) =>
                                    handleRationaleSelection(itemId, 'assertionSelection', event.target.value)
                                  }
                                >
                                  <option value="">Choose assertion…</option>
                                  {item.requiredAssertions.map((assertion) => (
                                    <option key={assertion} value={assertion}>
                                      {assertion}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {Array.isArray(item.errorReasons) && item.errorReasons.length > 0 ? (
                              <label className="flex flex-col gap-1">
                                <span>Select reason</span>
                                <select
                                  className="rounded-md border border-blue-200 p-1 text-sm"
                                  value={workspaceNotes[itemId]?.reasonSelection || ''}
                                  onChange={(event) =>
                                    handleRationaleSelection(itemId, 'reasonSelection', event.target.value)
                                  }
                                >
                                  <option value="">Choose reason…</option>
                                  {item.errorReasons.map((reason) => (
                                    <option key={reason} value={reason}>
                                      {reason}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                        <AuditItemCardFactory
                          item={{ ...item, id: itemId }}
                          allocation={allocation}
                          classificationFields={classificationFields}
                          splitAllocationHint={splitAllocationHint}
                          singleAllocationHint={singleAllocationHint}
                          isLocked={isLocked}
                          onSplitToggle={handleSplitToggle}
                          onClassificationChange={handleSingleClassificationChange}
                          onSplitAmountChange={handleSplitAmountChange}
                          totalEntered={totalEntered}
                          totalsMatch={totalsMatch}
                          pdfViewerState={pdfViewerState}
                          onUpdate={handleWorkspaceUpdate}
                          onNoteChange={handleNoteChange}
                          workspaceState={workspaceNotes[itemId]}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
              <Button variant="secondary" onClick={() => setActiveStep(firstWorkflowStep)} disabled={isLocked}>
                Back to Selection
              </Button>
              <Button
                onClick={handleSubmitTesting}
                disabled={isLocked || exceptionNoteRequiredIds.length > 0 || !allClassified}
              >
                <Send size={18} className="inline mr-2" /> Submit Responses
              </Button>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderTestingStep = () => {
    const renderers = {
      fixed_assets: renderFixedAssetTestingStep,
      cash_recon: renderCashTestingStep,
      two_pane: renderTwoPaneTestingStep,
    };

    return (
      <WorkpaperRenderer
        layoutType={layoutType}
        layoutConfig={layoutConfig}
        renderers={renderers}
        fallbackRenderer={renderTwoPaneTestingStep}
      />
    );
  };

  const renderResultsStep = () => {
    if (isFixedAssetLayout) {
      const latestAttempt =
        Array.isArray(submission?.attempts) && submission.attempts.length > 0
          ? submission.attempts[submission.attempts.length - 1]
          : submission;
      const fixedAssetResponses = latestAttempt?.fixedAssetResponses || {};
      const scopingDecision = fixedAssetResponses.scopingDecision || fixedAssetDraft.scopingDecision || {};
      const outcome = scopingDecision.outcome || 'Pending';
      const tmValue = scopingDecision.tmInput ?? fixedAssetRisk?.tolerableMisstatement ?? '';
      const additionsTotal = fixedAssetResponses.summaryTotals?.additions ?? fixedAssetTotals.additions;
      const gradeValue = typeof submission?.grade === 'number' ? submission.grade : null;
      const seniorFeedbackList = Array.isArray(submission?.virtualSeniorFeedback)
        ? submission.virtualSeniorFeedback
        : [];

      return (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
            <h2 className="text-2xl font-semibold text-gray-800">Fixed Asset Results</h2>
            <p className="text-sm text-gray-600">Your testing strategy and recalculations are captured below.</p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Outcome</p>
                <p className="text-lg font-semibold text-indigo-900">
                  {outcome === 'requires_testing'
                    ? 'Testing completed'
                    : outcome === 'no_testing'
                    ? 'No testing required'
                    : outcome === 'insufficient_scope'
                    ? 'Insufficient scope'
                    : 'Pending'}
                </p>
              </div>
              <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Additions vs TM</p>
                <p className="text-lg font-semibold text-indigo-900">
                  {currencyFormatter.format(additionsTotal || 0)} vs {tmValue ? currencyFormatter.format(Number(tmValue) || 0) : '—'}
                </p>
              </div>
              <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Virtual Senior grade</p>
                <p className="text-lg font-semibold text-indigo-900">{gradeValue !== null ? `${gradeValue.toFixed(1)} / 100` : 'Pending'}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
            <h3 className="text-xl font-semibold text-gray-800">What you documented</h3>
            <ul className="text-sm text-gray-700 space-y-2">
              <li>Lead schedule tickmarks recorded for {Object.keys(fixedAssetResponses.leadScheduleTicks || {}).length} cells.</li>
              <li>
                Additions reviewed: {Object.keys(fixedAssetResponses.additionResponses || {}).length} /{' '}
                {fixedAssetAdditions.length || 0}
              </li>
              <li>
                Disposals recalculated: {Object.keys(fixedAssetResponses.disposalResponses || {}).length} /{' '}
                {fixedAssetDisposals.length || 0}
              </li>
              <li>
                Analytics conclusion:{' '}
                {fixedAssetResponses.analyticsResponse?.conclusion
                  ? fixedAssetResponses.analyticsResponse.conclusion === 'reasonable'
                    ? 'Reasonable'
                    : 'Investigate'
                  : 'Not recorded'}
              </li>
            </ul>
          </div>

          {seniorFeedbackList.length > 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
              <h4 className="text-lg font-semibold text-gray-800">Virtual Senior Notes</h4>
              <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700">
                {seniorFeedbackList.map((item, idx) => (
                  <li key={item.paymentId || idx}>{Array.isArray(item.notes) ? item.notes.join(' ') : item.notes}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );
    }

    const formatClassificationLabel = (key) =>
      classificationFields.find((field) => field.key === key)?.label || key || 'Not specified';

    const answerKeyIsSplit = (disbursement) => {
      if (disbursement?.answerKeyMode === 'split') return true;
      const keyTotals = classificationFields.map(({ key }) => Number(disbursement?.answerKey?.[key] ?? 0));
      return keyTotals.filter((value) => Math.abs(value) > 0.009).length > 1;
    };

    const formatTimestamp = (ts) => {
      if (!ts) return null;
      if (typeof ts.toDate === 'function') {
        return ts.toDate().toLocaleString();
      }
      if (typeof ts.seconds === 'number') {
        return new Date(ts.seconds * 1000).toLocaleString();
      }
      return null;
    };

    const gradeValue = typeof submission?.grade === 'number' ? submission.grade : null;
    const gradeDisplay = gradeValue !== null ? gradeValue.toFixed(1) : null;
    const gradedAtText = formatTimestamp(submission?.gradedAt);
    const gradingDetails = submission?.gradingDetails || {};
    const gradeReady = gradeDisplay !== null;
    const seniorFeedback = Array.isArray(submission?.virtualSeniorFeedback)
      ? submission.virtualSeniorFeedback
      : [];

    const renderDisbursementResults = () => {
      if (!submission) {
        return <p className="text-sm text-gray-500">Retrieving your submission details...</p>;
      }
      if (!gradeReady) {
        return (
          <p className="text-sm text-gray-500">
            Grading is in progress. This usually takes a few seconds—feel free to refresh shortly.
          </p>
        );
      }
      if (selectedDisbursementDetails.length === 0) {
        return <p className="text-sm text-gray-500">No disbursements were recorded in your submission.</p>;
      }
      return (
        <ul className="space-y-4">
          {selectedDisbursementDetails.map((d) => {
            const detail = gradingDetails[d.paymentId];
            const answerKey = d.answerKey || {};
            const splitConfigured = detail?.splitMode ?? answerKeyIsSplit(d);
            const explanation = detail?.explanation || answerKey.explanation;
            const showExplanation = typeof explanation === 'string' && explanation.trim().length > 0;
            const selectedLabel = formatClassificationLabel(detail?.userClassification);
            const correctLabel = formatClassificationLabel(detail?.correctClassification);
            const statusBadge = detail ? (
              detail.isCorrect ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-700">
                  <CheckCircle2 size={16} className="mr-1" /> Correct
                </span>
              ) : (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-700">
                  <XCircle size={16} className="mr-1" /> Needs Review
                </span>
              )
            ) : (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-50 text-amber-700">
                <Info size={16} className="mr-1" /> Awaiting grade
              </span>
            );

            const renderDetailContent = () => {
              if (!detail) {
                return (
                  <p className="mt-3 text-sm text-gray-500">
                    Grading details are not available for this disbursement yet.
                  </p>
                );
              }
              if (splitConfigured) {
                return (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm text-left text-gray-700 border border-gray-200 rounded-md">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-3 py-2 font-semibold text-gray-600">Classification</th>
                          <th className="px-3 py-2 font-semibold text-gray-600">Your Entry</th>
                          <th className="px-3 py-2 font-semibold text-gray-600">Correct Answer</th>
                          <th className="px-3 py-2 font-semibold text-gray-600">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classificationFields.map(({ key, label }) => {
                          const fieldEval = detail.fields?.[key] || { user: 0, correct: 0, isCorrect: true };
                          return (
                            <tr key={`${d.paymentId}-${key}`} className="border-t">
                              <td className="px-3 py-2">{label}</td>
                              <td className="px-3 py-2">{currencyFormatter.format(fieldEval.user)}</td>
                              <td className="px-3 py-2">{currencyFormatter.format(fieldEval.correct)}</td>
                              <td className="px-3 py-2">
                                {fieldEval.isCorrect ? (
                                  <span className="inline-flex items-center text-green-700">
                                    <CheckCircle2 size={16} className="mr-1" /> Match
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center text-amber-700">
                                    <XCircle size={16} className="mr-1" /> Mismatch
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              }
              return (
                <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-3 text-sm text-gray-700 space-y-1">
                  <p>
                    <strong>Your selection:</strong> {selectedLabel}
                  </p>
                  <p>
                    <strong>Correct classification:</strong> {correctLabel}
                  </p>
                  {detail.isCorrect ? (
                    <p className="text-green-600">Great job—your classification matches the answer key.</p>
                  ) : (
                    <p className="text-amber-700">Review the guidance below to understand the expected classification.</p>
                  )}
                </div>
              );
            };

            return (
              <li key={d.paymentId} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-sm text-gray-600">
                    <div>
                      <strong className="font-medium">ID:</strong> {d.paymentId}
                    </div>
                    <div>
                      <strong className="font-medium">Payee:</strong> {d.payee}
                    </div>
                    <div>
                      <strong className="font-medium">Amount:</strong> {currencyFormatter.format(Number(d.amount) || 0)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">{statusBadge}</div>
                </div>
                {renderDetailContent()}
                {showExplanation ? (
                  <div className="mt-3 border border-blue-100 bg-blue-50 text-blue-900 rounded-md px-3 py-2 text-sm">
                    <strong className="font-semibold">Explanation:</strong> {explanation}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      );
    };

    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-lg shadow-xl p-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Submission Confirmed</h1>
          <p className="text-gray-600">
            Your testing selections for {caseTitle} have been recorded. You can review your answers below.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Final Grade</h2>
          {gradeReady ? (
            <div>
              <p className="text-4xl font-extrabold text-gray-900">{gradeDisplay}%</p>
              {gradedAtText ? (
                <p className="text-xs text-gray-500 mt-1">Graded on {gradedAtText}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Grading in progress… please check back shortly.</p>
          )}
        </div>

        {seniorFeedback.length > 0 ? (
          <div className="rounded-lg border border-red-100 bg-white shadow-sm overflow-hidden">
            <div className="bg-red-50 px-4 py-3 border-b border-red-100 flex items-center">
              <span className="text-xl mr-2" role="img" aria-label="Review notes">
                📝
              </span>
              <h3 className="font-bold text-red-900">Virtual Senior Review Notes</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {seniorFeedback.map((item) => (
                <div key={item.paymentId || item.payee} className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-gray-700">{item.payee || 'Unnamed item'}</span>
                    <span className="text-xs text-gray-400 uppercase tracking-wide">{item.paymentId}</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    {(item.notes || []).map((note, idx) => (
                      <li key={`${item.paymentId || 'item'}-${idx}`} className="text-sm text-red-700">
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Results & Feedback</h2>
          {renderDisbursementResults()}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/trainee')}>
            Back to Cases
          </Button>
          <Button variant="secondary" onClick={() => navigate('/trainee/submission-history')}>
            View Submission History
          </Button>
        </div>
      </div>
    );
  };

  let stepContent = null;
  if (activeStep === FLOW_STEPS.INSTRUCTION) {
    stepContent = renderInstructionStep();
  } else if (activeStep === FLOW_STEPS.SELECTION) {
    stepContent = renderSelectionStep();
  } else if (activeStep === FLOW_STEPS.TESTING) {
    stepContent = renderTestingStep();
  } else {
    stepContent = renderResultsStep();
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">{caseTitle}</h1>
            <p className="text-sm text-gray-500">Follow the steps to complete your testing workflow.</p>
          </div>
        </div>
        {renderStepper()}
        {stepContent}
      </div>
    </div>
  );
}
