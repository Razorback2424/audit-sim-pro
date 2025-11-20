import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { Timestamp } from 'firebase/firestore';
import { storage, Button, useRoute, useAuth, useModal, appId } from '../AppCore';
import { subscribeToCase } from '../services/caseService';
import { saveSubmission, subscribeToSubmission } from '../services/submissionService';
import { saveProgress, subscribeProgressForCases } from '../services/progressService';
import { Send, Loader2, ExternalLink, Download, CheckCircle2, XCircle, Info } from 'lucide-react';
import { getClassificationFields, getFlowCopy } from '../constants/classificationFields';
import { DEFAULT_AUDIT_AREA } from '../models/caseConstants';
import { currencyFormatter } from '../utils/formatters';
import AuditItemCardFactory from '../components/trainee/AuditItemCardFactory';

const FLOW_STEPS = Object.freeze({
  SELECTION: 'selection',
  TESTING: 'testing',
  RESULTS: 'results',
});

const DEFAULT_WORKFLOW = [FLOW_STEPS.SELECTION, FLOW_STEPS.TESTING, FLOW_STEPS.RESULTS];

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
  const [workspaceNotes, setWorkspaceNotes] = useState({});
  const [isLocked, setIsLocked] = useState(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState(null);
  const [activeEvidenceUrl, setActiveEvidenceUrl] = useState(null);
  const [activeEvidenceError, setActiveEvidenceError] = useState('');
  const [activeEvidenceLoading, setActiveEvidenceLoading] = useState(false);
  const [downloadingReferences, setDownloadingReferences] = useState(false);
  const [isRetakeResetting, setIsRetakeResetting] = useState(false);

  const auditArea =
    (typeof caseData?.auditArea === 'string' && caseData.auditArea.trim()) || DEFAULT_AUDIT_AREA;
  const classificationFields = useMemo(() => getClassificationFields(auditArea), [auditArea]);
  const classificationKeySet = useMemo(
    () => new Set(classificationFields.map(({ key }) => key)),
    [classificationFields]
  );
  const flowCopy = useMemo(() => getFlowCopy(auditArea), [auditArea]);
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
    if (Array.isArray(caseData?.workflow) && caseData.workflow.length > 0) {
      return caseData.workflow;
    }
    return DEFAULT_WORKFLOW;
  }, [caseData]);
  const firstWorkflowStep = useMemo(() => workflow[0] ?? FLOW_STEPS.SELECTION, [workflow]);
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
    const initialWorkflowStep = firstWorkflowStep;
    setActiveStep(initialWorkflowStep);
    setSelectedDisbursements({});
    setClassificationAmounts({});

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
  ]);

  const disbursementList = useMemo(
    () => (Array.isArray(caseData?.disbursements) ? caseData.disbursements : []),
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
    if (disbursementList.length === 0) {
      return Object.keys(selectedDisbursements).filter((id) => selectedDisbursements[id]);
    }
    return disbursementList.map((item) => item.paymentId).filter((id) => selectedDisbursements[id]);
  }, [disbursementList, selectedDisbursements]);

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
    [userId, caseId, activeStep, selectedIds, classifiedCount, classificationDraft]
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

  const goToTestingStep = () => {
    if (isLocked) return;
    if (selectedIds.length === 0) {
      showModal('Please select at least one disbursement to continue.', 'No Selection');
      return;
    }
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

  const handleSubmitTesting = async () => {
    if (!caseData || !userId || selectedIds.length === 0) return;

    const allocationPayload = {};
    const invalidAllocations = [];

    selectedDisbursementDetails.forEach((disbursement) => {
      const allocation = classificationAmounts[disbursement.paymentId];
      if (!isAllocationComplete(disbursement, allocation)) {
        invalidAllocations.push(disbursement.paymentId);
        return;
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

  const renderSelectionStep = () => (
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
          {disbursementList.map((d) => (
            <div
              key={d.paymentId}
              className="flex items-center p-4 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            >
              <input
                type="checkbox"
                id={`cb-${d.paymentId}`}
                checked={!!selectedDisbursements[d.paymentId]}
                onChange={() => handleSelectionChange(d.paymentId)}
                disabled={isLocked}
                className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-4 cursor-pointer disabled:cursor-not-allowed"
              />
              <label
                htmlFor={`cb-${d.paymentId}`}
                className="flex-grow grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1 cursor-pointer"
              >
                <span className="text-sm text-gray-700">
                  <strong className="font-medium">ID:</strong> {d.paymentId}
                </span>
                <span className="text-sm text-gray-700">
                  <strong className="font-medium">Payee:</strong> {d.payee}
                </span>
                <span className="text-sm text-gray-700">
                  <strong className="font-medium">Amount:</strong> {currencyFormatter.format(Number(d.amount) || 0)}
                </span>
                <span className="text-sm text-gray-700">
                  <strong className="font-medium">Date:</strong> {d.paymentDate}
                </span>
                {d.expectedClassification ? (
                  <span className="text-xs text-gray-500">
                    Expected classification: {d.expectedClassification}
                  </span>
                ) : null}
              </label>
            </div>
          ))}
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
  );

  const renderTestingStep = () => {
    const missingDocuments = selectedEvidenceItems.filter(
      (item) => !item?.hasLinkedDocument && !isEvidenceWorkflowLinked(item.paymentId)
    );
    const missingPaymentIds = Array.from(new Set(missingDocuments.map((item) => item?.paymentId || 'Unknown ID')));

    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800">Step 2 — Classify Results</h2>
            <p className="text-sm text-gray-500">
              {testingIntro}
            </p>
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
            {renderReferenceDownloadsBanner()}
            <div className="grid gap-6 md:grid-cols-2">
              {renderEvidenceList(selectedEvidenceItems)}
              {renderEvidenceViewer(selectedEvidenceItems)}
            </div>

            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
              <h3 className="text-xl font-semibold text-gray-800 mb-4">Allocate Each Disbursement</h3>
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

                  return (
                    <AuditItemCardFactory
                      key={itemId}
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
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
              <Button variant="secondary" onClick={() => setActiveStep(firstWorkflowStep)} disabled={isLocked}>
                Back to Selection
              </Button>
              <Button onClick={handleSubmitTesting} disabled={!allClassified || isLocked}>
                <Send size={18} className="inline mr-2" /> Submit Responses
              </Button>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderResultsStep = () => {
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
  if (activeStep === FLOW_STEPS.SELECTION) {
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
