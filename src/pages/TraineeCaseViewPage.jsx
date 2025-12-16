import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { Timestamp } from 'firebase/firestore';
import { storage, Button, useRoute, useAuth, useModal, appId } from '../AppCore';
import { subscribeToCase } from '../services/caseService';
import { saveSubmission } from '../services/submissionService';
import { saveProgress, subscribeProgressForCases } from '../services/progressService';
import { Send, Loader2, ExternalLink, Download } from 'lucide-react';
import ResultsAnalysis from '../components/trainee/ResultsAnalysis';
import AuditItemCardFactory from '../components/trainee/AuditItemCardFactory';
import OutstandingCheckTestingModule from '../components/trainee/OutstandingCheckTestingModule';

const FLOW_STEPS = Object.freeze({
  SELECTION: 'selection',
  TESTING: 'testing',
  RESULTS: 'results',
});

const STEP_SEQUENCE = [FLOW_STEPS.SELECTION, FLOW_STEPS.TESTING, FLOW_STEPS.RESULTS];

const STEP_LABELS = {
  [FLOW_STEPS.SELECTION]: 'Select Disbursements',
  [FLOW_STEPS.TESTING]: 'Classify Results',
  [FLOW_STEPS.RESULTS]: 'Review Outcome',
};

const STEP_DESCRIPTIONS = {
  [FLOW_STEPS.SELECTION]: 'Choose which disbursements you will test.',
  [FLOW_STEPS.TESTING]: 'Allocate the amounts across each classification and review documents.',
  [FLOW_STEPS.RESULTS]: 'See a recap of your responses.',
};

const CLASSIFICATION_FIELDS = [
  { key: 'properlyIncluded', label: 'Properly Included' },
  { key: 'properlyExcluded', label: 'Properly Excluded' },
  { key: 'improperlyIncluded', label: 'Improperly Included' },
  { key: 'improperlyExcluded', label: 'Improperly Excluded' },
];

const hasExplicitDecision = (allocation) => allocation?.isException === true || allocation?.isException === false;

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

const CLASSIFICATION_META_FIELDS = [
  'isException',
  'mode',
  'singleClassification',
  'workpaperNote',
  'notes',
  'assertion',
  'reason',
];

const isSameClassificationMap = (currentMap, nextMap) => {
  const currentKeys = Object.keys(currentMap);
  const nextKeys = Object.keys(nextMap);
  if (currentKeys.length !== nextKeys.length) return false;
  return currentKeys.every((key) => {
    const currentAllocation = currentMap[key] || {};
    const nextAllocation = nextMap[key] || {};
    const metaMatches = CLASSIFICATION_META_FIELDS.every((fieldKey) => {
      const currentValue = currentAllocation[fieldKey] ?? '';
      const nextValue = nextAllocation[fieldKey] ?? '';
      return currentValue === nextValue;
    });
    if (!metaMatches) return false;
    return CLASSIFICATION_FIELDS.every(({ key: fieldKey }) => {
      const currentValue = currentAllocation[fieldKey] ?? '';
      const nextValue = nextAllocation[fieldKey] ?? '';
      return currentValue === nextValue;
    });
  });
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

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function TraineeCaseViewPage({ params }) {
  const { caseId } = params;
  const { navigate, query, setQuery } = useRoute();
  const { userId } = useAuth();
  const { showModal, hideModal } = useModal();

  const normalizePaymentId = useCallback((value) => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }, []);

  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeStep, setActiveStep] = useState(FLOW_STEPS.SELECTION);
  const [selectedDisbursements, setSelectedDisbursements] = useState({});
  const [classificationAmounts, setClassificationAmounts] = useState({});
  const [isLocked, setIsLocked] = useState(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState(null);
  const [activeEvidenceUrl, setActiveEvidenceUrl] = useState(null);
  const [activeEvidenceError, setActiveEvidenceError] = useState('');
  const [activeEvidenceLoading, setActiveEvidenceLoading] = useState(false);
  const [downloadingReferenceId, setDownloadingReferenceId] = useState(null);
  const [isRetakeResetting, setIsRetakeResetting] = useState(false);

  const lastResolvedEvidenceRef = useRef({ evidenceId: null, storagePath: null, url: null, inlineNotSupported: false });
  const progressSaveTimeoutRef = useRef(null);
  const lastLocalChangeRef = useRef(0);
  const activeStepRef = useRef(FLOW_STEPS.SELECTION);
  const selectionRef = useRef(selectedDisbursements);
  const classificationRef = useRef(classificationAmounts);
  const selectedIdsRef = useRef([]);
  const classifiedCountRef = useRef(0);
  const isLockedRef = useRef(false);
  const retakeHandledRef = useRef(false);
  const retakeResettingRef = useRef(false);

  const createEmptyAllocation = useCallback(() => {
    const template = {};
    CLASSIFICATION_FIELDS.forEach(({ key }) => {
      template[key] = '';
    });
    return template;
  }, []);

  const resetForRetake = useCallback(
    async ({ clearRetakeQuery } = {}) => {
      if (!caseId || !userId) return;
      if (retakeResettingRef.current) return;

      retakeResettingRef.current = true;
      setIsRetakeResetting(true);
      setIsLocked(false);
      setActiveStep(FLOW_STEPS.SELECTION);
      setSelectedDisbursements({});
      setClassificationAmounts({});
      setActiveEvidenceId(null);
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = { evidenceId: null, storagePath: null, url: null, inlineNotSupported: false };

      let didReset = false;
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
            step: FLOW_STEPS.SELECTION,
            draft: {
              selectedPaymentIds: [],
              classificationDraft: {},
              fixedAssetDraft: {},
              cashLinkMap: {},
              cashAdjustments: [],
              cashSummary: {},
            },
          },
          forceOverwrite: true,
        });
        didReset = true;
      } catch (err) {
        console.error('Failed to reset progress for retake:', err);
        showModal('We ran into an issue preparing your retake. Please try again.', 'Retake Error');
        retakeResettingRef.current = false;
      } finally {
        setIsRetakeResetting(false);
        if (clearRetakeQuery && typeof setQuery === 'function') {
          setQuery(
            (prev) => {
              const next = { ...prev };
              delete next.retake;
              return next;
            },
            { replace: true }
          );
        }

        if (!didReset) {
          retakeResettingRef.current = false;
        }
      }
    },
    [caseId, userId, setQuery, showModal]
  );

  const requestRetake = useCallback(() => {
    resetForRetake();
  }, [resetForRetake]);

  const parseAmount = useCallback((value) => {
    if (value === '' || value === null || value === undefined) return 0;
    const num = Number(value);
    return Number.isFinite(num) ? num : NaN;
  }, []);

  const isAllocationComplete = useCallback(
    (disbursement, allocation) => {
      if (!allocation) return false;
      if (!hasExplicitDecision(allocation)) return false;
      const amountNumber = Number(disbursement?.amount);
      if (!Number.isFinite(amountNumber)) return false;
      if (allocation?.isException === true) {
        const noteText =
          typeof allocation.workpaperNote === 'string'
            ? allocation.workpaperNote
            : typeof allocation.notes === 'string'
            ? allocation.notes
            : '';
        if (noteText.trim().length === 0) return false;
      }
      let sum = 0;
      for (const { key } of CLASSIFICATION_FIELDS) {
        const value = parseAmount(allocation[key]);
        if (!Number.isFinite(value) || value < 0) {
          return false;
        }
        sum += value;
      }
      return Math.abs(sum - amountNumber) <= 0.01;
    },
    [parseAmount]
  );

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
    if (!query?.retake) {
      retakeHandledRef.current = false;
    }
  }, [query]);

  useEffect(() => {
    if (!caseId || !userId) return;
    const retakeValue = query?.retake;
    const retakeRequested =
      typeof retakeValue === 'string' ? retakeValue.toLowerCase() === 'true' : Boolean(retakeValue);
    if (!retakeRequested || retakeHandledRef.current) return;

    retakeHandledRef.current = true;
    resetForRetake({ clearRetakeQuery: true });
  }, [caseId, userId, query, resetForRetake]);

  useEffect(() => {
    if (!caseId || !userId) return;

    const unsubscribe = subscribeProgressForCases(
      { appId, uid: userId, caseIds: [caseId] },
      (progressMap) => {
        const entry = progressMap.get(caseId);
        if (!entry) return;

        const entryUpdatedAtMs = entry?.updatedAt?.toMillis ? entry.updatedAt.toMillis() : 0;
        const localChangeMs = lastLocalChangeRef.current || 0;
        const isEntryStale = localChangeMs > 0 && entryUpdatedAtMs > 0 && entryUpdatedAtMs < localChangeMs - 2000;
        const recentlyChanged = isEntryStale || Date.now() - lastLocalChangeRef.current < 1200;

        if (retakeResettingRef.current) {
          const percentComplete = Number(entry?.percentComplete || 0);
          const state = typeof entry?.state === 'string' ? entry.state.toLowerCase() : '';
          const step = STEP_SEQUENCE.includes(entry.step) ? entry.step : FLOW_STEPS.SELECTION;
          const isResetSnapshot =
            percentComplete === 0 && (state === 'not_started' || step === FLOW_STEPS.SELECTION);

          if (!isResetSnapshot) return;
          retakeResettingRef.current = false;
        }

        const nextStep = STEP_SEQUENCE.includes(entry.step) ? entry.step : FLOW_STEPS.SELECTION;
        if ((!recentlyChanged || nextStep === FLOW_STEPS.RESULTS) && activeStepRef.current !== nextStep) {
          setActiveStep(nextStep);
        }

        const nextSelection = {};
        const rawSelectedPaymentIds = Array.isArray(entry.draft?.selectedPaymentIds)
          ? entry.draft.selectedPaymentIds
          : [];
        rawSelectedPaymentIds.forEach((id) => {
          const normalized = normalizePaymentId(id);
          if (normalized) nextSelection[normalized] = true;
        });
        if (!recentlyChanged && !isSameSelectionMap(selectionRef.current, nextSelection)) {
          setSelectedDisbursements(nextSelection);
        }

        const rawClassificationDraft = entry.draft?.classificationDraft;
        const nextClassifications =
          rawClassificationDraft && typeof rawClassificationDraft === 'object' ? rawClassificationDraft : {};
        if (!recentlyChanged && !isSameClassificationMap(classificationRef.current, nextClassifications)) {
          setClassificationAmounts(nextClassifications);
        }

        const shouldLock = entry.state === 'submitted' || nextStep === FLOW_STEPS.RESULTS;
        if (isLockedRef.current !== shouldLock) {
          setIsLocked(shouldLock);
        }
      },
      (error) => {
        console.error('Error subscribing to progress:', error);
      }
    );

    return () => unsubscribe();
  }, [caseId, userId, normalizePaymentId]);

  const disbursementList = useMemo(
    () =>
      (Array.isArray(caseData?.disbursements) ? caseData.disbursements : []).map((item, index) => {
        const paymentId = normalizePaymentId(item?.paymentId);
        const rowKey = paymentId || item?.reference || item?._tempId || item?.id || `row-${index + 1}`;
        return { ...item, paymentId, __rowKey: rowKey };
      }),
    [caseData, normalizePaymentId]
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
    const validIds = new Set(disbursementList.map((item) => item.paymentId).filter(Boolean));

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
  }, [caseData, disbursementList]);

  const disbursementById = useMemo(() => {
    const map = new Map();
    disbursementList.forEach((item) => {
      if (!item.paymentId) return;
      map.set(item.paymentId, item);
    });
    return map;
  }, [disbursementList]);

  const selectedIds = useMemo(() => {
    if (disbursementList.length === 0) {
      return Object.keys(selectedDisbursements).filter((id) => selectedDisbursements[id]);
    }
    return disbursementList
      .map((item) => item.paymentId)
      .filter(Boolean)
      .filter((id) => selectedDisbursements[id]);
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

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    classifiedCountRef.current = classifiedCount;
  }, [classifiedCount]);

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
      const intendedStep = stepOverride || activeStepRef.current;

      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }

      progressSaveTimeoutRef.current = setTimeout(() => {
        const step = intendedStep || activeStepRef.current;
        const selectedPaymentIds = selectedIdsRef.current || [];
        const selectedCount = selectedPaymentIds.length;
        const classified = classifiedCountRef.current || 0;
        const percentComplete = computePercentComplete(step, selectedCount, classified);
        const snapshot = classificationRef.current || {};
        const nextDraft = {};
        selectedPaymentIds.forEach((id) => {
          if (snapshot[id]) nextDraft[id] = snapshot[id];
        });

        const patch = {
          percentComplete,
          state: deriveStateFromProgress(step, percentComplete),
          step,
          draft: {
            selectedPaymentIds: selectedPaymentIds,
            classificationDraft: nextDraft,
          },
        };

        saveProgress({ appId, uid: userId, caseId, patch }).catch((err) => {
          console.error('Failed to save progress:', err);
        });
      }, 300);
    },
    [userId, caseId]
  );

  useEffect(() => {
    if (!caseData || !userId || isLocked || activeStep === FLOW_STEPS.RESULTS || isRetakeResetting) return;
    enqueueProgressSave();
  }, [caseData, userId, isLocked, activeStep, enqueueProgressSave, isRetakeResetting]);

  useEffect(
    () => () => {
      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }
    },
    []
  );

  const handleSelectionChange = (paymentIdRaw) => {
    if (isLocked) return;
    const paymentId = normalizePaymentId(paymentIdRaw);
    if (!paymentId) return;
    lastLocalChangeRef.current = Date.now();
    const currentlySelected = !!selectionRef.current?.[paymentId];

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
    } else {
      setClassificationAmounts((prev) => {
        if (prev[paymentId]) return prev;
        return { ...prev, [paymentId]: createEmptyAllocation() };
      });
    }
  };

  const handleAllocationChange = (paymentId, fieldKey, value) => {
    if (isLocked) return;
    const normalizedId = normalizePaymentId(paymentId);
    if (!normalizedId) return;
    lastLocalChangeRef.current = Date.now();

    let finalValue;
    // Keep raw value for these specific, non-numeric fields
    if (['mode', 'singleClassification', 'notes', 'workpaperNote'].includes(fieldKey)) {
      finalValue = value;
    } else {
      // Sanitize all other fields (assumed to be amounts)
      finalValue = value === '' ? '' : String(value).replace(/[^0-9.]/g, '');
    }

    setClassificationAmounts((prev) => {
      const next = { ...prev };
      const allocation = { ...(next[normalizedId] || createEmptyAllocation()) };
      allocation[fieldKey] = finalValue;
      next[normalizedId] = allocation;
      return next;
    });
  };

  const handleRationaleChange = (paymentId, fieldKey, value) => {
    if (isLocked) return;
    const normalizedId = normalizePaymentId(paymentId);
    if (!normalizedId) return;
    lastLocalChangeRef.current = Date.now();
    setClassificationAmounts((prev) => {
      const next = { ...prev };
      const allocation = { ...(next[normalizedId] || createEmptyAllocation()) };
      allocation[fieldKey] = value; // Stores 'assertion', 'reason', or 'isException'
      next[normalizedId] = allocation;
      return next;
    });
  };

  const goToTestingStep = () => {
    if (isLocked) return;
    if (selectedIds.length === 0) {
      showModal('Please select at least one disbursement to continue.', 'No Selection');
      return;
    }
    const missingDocs = selectedEvidenceItems.filter((item) => !item?.hasLinkedDocument);
    if (missingDocs.length > 0) {
      const missingList = Array.from(new Set(missingDocs.map((item) => item?.paymentId || 'Unknown ID'))).join(', ');
      showModal(
        `Support for the following selections is still pending:\n${missingList}\n\nPlease wait for the supporting documents before continuing.`, 
        'Support Not Ready'
      );
      return;
    }
    lastLocalChangeRef.current = Date.now();
    setClassificationAmounts((prev) => {
      const next = { ...prev };
      selectedIds.forEach((id) => {
        if (!next[id]) {
          next[id] = createEmptyAllocation();
        }
      });
      return next;
    });
    enqueueProgressSave(FLOW_STEPS.TESTING);
    setActiveStep(FLOW_STEPS.TESTING);
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
      const entry = {};
      CLASSIFICATION_FIELDS.forEach(({ key }) => {
        entry[key] = parseAmount(allocation[key]);
      });
      entry.isException = allocation.isException ?? null;
      entry.mode = allocation.mode || '';
      entry.singleClassification = allocation.singleClassification || '';
      entry.assertion = allocation.assertion || '';
      entry.reason = allocation.reason || '';
      entry.workpaperNote =
        typeof allocation.workpaperNote === 'string'
          ? allocation.workpaperNote
          : typeof allocation.notes === 'string'
          ? allocation.notes
          : '';
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
        submittedAt: Timestamp.now(),
      });

      await saveProgress({
        appId,
        uid: userId,
        caseId,
        patch: {
          percentComplete: 100,
          state: 'submitted',
          step: FLOW_STEPS.RESULTS,
          draft: {
            selectedPaymentIds: selectedIds,
            classificationDraft: classificationAmounts,
          },
        },
      });

      setIsLocked(true);
      setActiveStep(FLOW_STEPS.RESULTS);
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

  const isOutstandingCheckTesting =
    caseData?.auditArea === 'cash' && caseData?.cashContext?.moduleType === 'outstanding_check_testing';
  if (isOutstandingCheckTesting) {
    return (
      <OutstandingCheckTestingModule
        caseId={caseId}
        caseData={caseData}
        userId={userId}
        navigate={navigate}
        showModal={showModal}
      />
    );
  }

  const stepIndex = STEP_SEQUENCE.indexOf(activeStep);

  const renderStepper = () => (
    <ol className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-white rounded-lg shadow px-4 py-4">
      {STEP_SEQUENCE.map((stepKey, idx) => {
        const isCompleted = stepIndex > idx;
        const isActive = stepIndex === idx;
        return (
          <li key={stepKey} className="flex items-center space-x-3">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${isActive ? 'bg-blue-600 text-white' : isCompleted ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'}`}
            >
              {isCompleted ? '✓' : idx + 1}
            </span>
            <div>
              <p className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{STEP_LABELS[stepKey]}</p>
              <p className="text-xs text-gray-500 hidden sm:block">{STEP_DESCRIPTIONS[stepKey]}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );

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
            return (
              <button
                key={item.evidenceId}
                type="button"
                onClick={() => setActiveEvidenceId(item.evidenceId)}
                aria-label={`Evidence for ${documentLabel}`}
                className={`w-full text-left px-4 py-3 focus:outline-none transition-colors ${isActive ? 'bg-blue-50 border-l-4 border-blue-500' : 'hover:bg-gray-50'}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>
                    Invoice: {invoiceLabel}
                  </span>
                  {!item.hasLinkedDocument && (
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

  const renderEvidenceViewer = (items) => {
    const activeEvidence = activeEvidenceId
      ? items.find((item) => item.evidenceId === activeEvidenceId)
      : null;
    const nowViewingLabel =
      activeEvidence?.evidenceFileName || activeEvidence?.paymentId || 'Supporting document';

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col min-h-[480px]">
        <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Document Viewer</h2>
            <p className="text-xs text-gray-500">
              {items.length === 0
                ? 'Choose a disbursement to see its supporting document.'
                : activeEvidenceId
                ? `Now viewing: ${nowViewingLabel}`
                : 'Select a disbursement to view its document.'}
            </p>
          </div>
          {viewerEnabled && activeEvidenceId ? (
            (() => {
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
  };

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

  const handleDownloadReferenceDoc = async (doc) => {
    if (!doc) return;
    const displayName = (doc.fileName || 'reference-document').trim() || 'reference-document';
    try {
      setDownloadingReferenceId(doc.id);
      let url = (doc.downloadURL || '').trim();
      if (!url) {
        if (!doc.storagePath) {
          throw new Error('Reference document is missing a download link.');
        }
        url = await getDownloadURL(storageRef(storage, doc.storagePath));
      }
      await triggerFileDownload(url, displayName);
    } catch (error) {
      console.error('Error downloading reference document:', error);
      const message = error?.message || 'Unable to download reference document at this time.';
      showModal(message, 'Download Error');
    } finally {
      setDownloadingReferenceId(null);
    }
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
          <div className="flex flex-wrap gap-2">
            {referenceDocuments.map((doc) => (
              <Button
                key={doc.id}
                variant="secondary"
                className="text-xs px-3 py-1 bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                onClick={() => handleDownloadReferenceDoc(doc)}
                isLoading={downloadingReferenceId === doc.id}
                disabled={downloadingReferenceId && downloadingReferenceId !== doc.id}
                title={doc.fileName}
              >
                <Download size={14} className="inline mr-1" />
                <span className="max-w-[160px] truncate inline-block align-middle">{doc.fileName || 'Reference'}</span>
              </Button>
            ))}
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
          {disbursementList.map((d, index) => {
            const paymentId = d.paymentId;
            const checkboxId = paymentId ? `cb-${paymentId}` : `cb-missing-${index + 1}`;
            const disabled = isLocked || !paymentId;
            return (
              <div
                key={d.__rowKey}
                className="flex items-center p-4 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
              >
                <input
                  type="checkbox"
                  id={checkboxId}
                  checked={paymentId ? !!selectedDisbursements[paymentId] : false}
                  onChange={() => handleSelectionChange(paymentId)}
                  disabled={disabled}
                  className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-4 cursor-pointer disabled:cursor-not-allowed"
                />
                <label
                  htmlFor={checkboxId}
                  className={`flex-grow grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className="text-sm text-gray-700">
                    <strong className="font-medium">ID:</strong> {paymentId || 'Missing payment ID'}
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
                  {!paymentId ? (
                    <span className="text-xs text-amber-700">
                      This disbursement is missing a payment ID and cannot be selected.
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
  );

  const renderTestingStep = () => {
    const missingDocuments = selectedEvidenceItems.filter((item) => !item?.hasLinkedDocument);
    const missingPaymentIds = Array.from(new Set(missingDocuments.map((item) => item?.paymentId || 'Unknown ID'))); 

    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800">Step 2 — Classify Results</h2>
            <p className="text-sm text-gray-500">
              Review the supporting documents and allocate the disbursement amount across each classification category.
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
              <Button variant="secondary" onClick={() => setActiveStep(FLOW_STEPS.SELECTION)}>
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
              <h3 className="text-xl font-semibold text-gray-800 mb-4">Audit Procedures</h3>
              <div className="space-y-6">
                {selectedDisbursementDetails.map((d) => {
                  const allocation = classificationAmounts[d.paymentId] || createEmptyAllocation();
                  const totalEntered = CLASSIFICATION_FIELDS.reduce((sum, { key }) => {
                    const value = parseAmount(allocation[key]);
                    return sum + (Number.isFinite(value) ? value : 0);
                  }, 0);
                  const amountNumber = Number(d.amount) || 0;
                  const totalsMatch = Math.abs(totalEntered - amountNumber) <= 0.01;

                  // 3. The Swap: Use Factory instead of manual divs
                  return (
                    <AuditItemCardFactory
                      key={d.paymentId}
                      item={d}
                      allocation={allocation}
                      classificationFields={CLASSIFICATION_FIELDS}
                      splitAllocationHint="Enter amounts for each category."
                      singleAllocationHint="Select a classification."
                      onSplitToggle={(id, checked) => {
                         // Simple local toggle logic or update allocation mode
                         handleAllocationChange(id, 'mode', checked ? 'split' : 'single');
                      }}
                      onClassificationChange={(id, val) => handleAllocationChange(id, 'singleClassification', val)}
                      onSplitAmountChange={(id, key, val) => handleAllocationChange(id, key, val)}
                      onNoteChange={(id, val) => handleAllocationChange(id, 'workpaperNote', val)}
                      onRationaleChange={handleRationaleChange} // <--- Pass the new handler
                      isLocked={isLocked}
                      totalsMatch={totalsMatch}
                      totalEntered={totalEntered}
                    />
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
              <Button variant="secondary" onClick={() => setActiveStep(FLOW_STEPS.SELECTION)} disabled={isLocked}>
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
    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Audit Completion Report</h1>
            <p className="text-gray-600">Review your performance against the Virtual Senior&apos;s expectations.</p>
          </div>
          
          <ResultsAnalysis 
            disbursements={selectedDisbursementDetails} 
            studentAnswers={classificationAmounts} 
            onRequestRetake={requestRetake}
            onReturnToDashboard={() => navigate('/trainee')}
          />
        </div>

        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => navigate('/trainee')}> 
            Return to Dashboard
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
