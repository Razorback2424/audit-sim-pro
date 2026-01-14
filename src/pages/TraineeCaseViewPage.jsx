import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { Timestamp } from 'firebase/firestore';
import { storage, Button, useRoute, useAuth, useModal, appId } from '../AppCore';
import { fetchCase, listStudentCases, subscribeToCase } from '../services/caseService';
import { saveSubmission } from '../services/submissionService';
import { fetchProgressForCases, saveProgress, subscribeProgressForCases } from '../services/progressService';
import { fetchRecipeProgress, saveRecipeProgress } from '../services/recipeProgressService';
import { generateAttemptFromRecipe } from '../services/attemptService';
import { Send, Loader2, ExternalLink, Download, BookOpen } from 'lucide-react';
import ResultsAnalysis from '../components/trainee/ResultsAnalysis';
import AuditItemCardFactory from '../components/trainee/AuditItemCardFactory';
import OutstandingCheckTestingModule from '../components/trainee/OutstandingCheckTestingModule';
import InstructionView from '../components/InstructionView';
import { getCaseLevelLabel, normalizeCaseLevel } from '../models/caseConstants';

const FLOW_STEPS = Object.freeze({
  INSTRUCTION: 'instruction',
  SELECTION: 'selection',
  TESTING: 'testing',
  RESULTS: 'results',
});

const STEP_SEQUENCE = [
  FLOW_STEPS.INSTRUCTION,
  FLOW_STEPS.SELECTION,
  FLOW_STEPS.TESTING,
  FLOW_STEPS.RESULTS,
];

const STEP_LABELS = {
  [FLOW_STEPS.INSTRUCTION]: 'Instruction',
  [FLOW_STEPS.SELECTION]: 'Select Disbursements',
  [FLOW_STEPS.TESTING]: 'Classify Results',
  [FLOW_STEPS.RESULTS]: 'Review Outcome',
};

const STEP_DESCRIPTIONS = {
  [FLOW_STEPS.INSTRUCTION]: 'Review the materials and successfully answer the knowledge check questions to access the simulation.',
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

const isInvoiceReferenceDoc = (doc) => {
  if (!doc || typeof doc !== 'object') return false;
  const templateId = typeof doc.generationSpec?.templateId === 'string'
    ? doc.generationSpec.templateId.toLowerCase()
    : '';
  if (templateId.startsWith('invoice.')) return true;
  if (doc.generationSpec?.linkToPaymentId) return true;
  if (doc.linkToPaymentId) return true;
  return false;
};

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
  if (step === FLOW_STEPS.INSTRUCTION) return 0;
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

const getRecipeId = (caseData) =>
  caseData?.moduleId || caseData?.recipeId || caseData?.id || '';

const normalizeRecipeVersion = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.floor(parsed);
};

const getRecipeVersion = (caseData) => {
  if (!caseData) return 1;
  return normalizeRecipeVersion(
    caseData?.instruction?.version ??
      caseData?.recipeVersion ??
      caseData?.moduleVersion ??
      1
  );
};

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
  const [caseWithKeys, setCaseWithKeys] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeStep, setActiveStep] = useState(FLOW_STEPS.INSTRUCTION);
  const [recipeProgress, setRecipeProgress] = useState(null);
  const [selectedDisbursements, setSelectedDisbursements] = useState({});
  const [classificationAmounts, setClassificationAmounts] = useState({});
  const [isLocked, setIsLocked] = useState(false);
  const [activeEvidenceId, setActiveEvidenceId] = useState(null);
  const [activePaymentId, setActivePaymentId] = useState(null);
  const [activeEvidenceUrl, setActiveEvidenceUrl] = useState(null);
  const [activeEvidenceError, setActiveEvidenceError] = useState('');
  const [activeEvidenceLoading, setActiveEvidenceLoading] = useState(false);
  const [downloadingReferenceId, setDownloadingReferenceId] = useState(null);
  const [openedReferenceDocs, setOpenedReferenceDocs] = useState(() => new Set());
  const [decisionBlockedHint, setDecisionBlockedHint] = useState(false);
  const [isRetakeResetting, setIsRetakeResetting] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [furthestStepIndex, setFurthestStepIndex] = useState(0);
  const [levelGate, setLevelGate] = useState({ locked: false, message: '' });

  const recipeId = useMemo(() => getRecipeId(caseData), [caseData]);
  const recipeVersion = useMemo(() => getRecipeVersion(caseData), [caseData]);
  const gateScope = useMemo(() => {
    const scope = caseData?.workflow?.gateScope;
    return scope === 'per_attempt' ? 'per_attempt' : 'once';
  }, [caseData]);
  const gatePassed = useMemo(
    () => Boolean(recipeProgress && recipeProgress.passedVersion >= recipeVersion),
    [recipeProgress, recipeVersion]
  );
  const gateRequired = gateScope === 'per_attempt' ? true : !gatePassed;

  const lastResolvedEvidenceRef = useRef({ evidenceId: null, storagePath: null, url: null, inlineNotSupported: false });
  const progressSaveTimeoutRef = useRef(null);
  const lastLocalChangeRef = useRef(0);
  const activeStepRef = useRef(FLOW_STEPS.INSTRUCTION);
  const selectionRef = useRef(selectedDisbursements);
  const classificationRef = useRef(classificationAmounts);
  const selectedIdsRef = useRef([]);
  const classifiedCountRef = useRef(0);
  const isLockedRef = useRef(false);
  const retakeHandledRef = useRef(false);
  const retakeResettingRef = useRef(false);
  const decisionHintTimeoutRef = useRef(null);
  const lockNoticeRef = useRef(false);

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
      const initialStep =
        gateScope === 'once' ? FLOW_STEPS.SELECTION : FLOW_STEPS.INSTRUCTION;
      setIsRetakeResetting(true);
      setIsLocked(false);
      setActiveStep(initialStep);
      setFurthestStepIndex(0);
      setSelectedDisbursements({});
      setClassificationAmounts({});
      setActiveEvidenceId(null);
      setOpenedReferenceDocs(new Set());
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
            step: initialStep,
            draft: {
              selectedPaymentIds: [],
              classificationDraft: {},
              fixedAssetDraft: {},
              cashLinkMap: {},
              cashAdjustments: [],
              cashSummary: {},
            },
            hasSuccessfulAttempt: false,
          },
          forceOverwrite: true,
          clearActiveAttempt: true,
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
    [caseId, userId, gateScope, setQuery, showModal]
  );

  const startRetakeAttempt = useCallback(
    async ({ clearRetakeQuery } = {}) => {
      if (!caseData?.moduleId || !userId) return false;
      if (retakeResettingRef.current) return false;

      retakeResettingRef.current = true;
      setIsRetakeResetting(true);
      try {
        const newCaseId = await generateAttemptFromRecipe({
          moduleId: caseData.moduleId,
          uid: userId,
          retakeAttempt: true,
        });
        navigate(`/cases/${newCaseId}`);
        return true;
      } catch (err) {
        console.error('Failed to generate a retake attempt:', err);
        showModal('We ran into an issue preparing your retake. Please try again.', 'Retake Error');
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
        return false;
      } finally {
        setIsRetakeResetting(false);
        retakeResettingRef.current = false;
      }
    },
    [caseData, navigate, setQuery, showModal, userId]
  );

  const requestRetake = useCallback(() => {
    if (caseData?.moduleId) {
      startRetakeAttempt();
      return;
    }
    resetForRetake();
  }, [caseData, resetForRetake, startRetakeAttempt]);

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
      const isSplit = allocation.mode === 'split';
      const singleClassification = typeof allocation.singleClassification === 'string' ? allocation.singleClassification : '';
      if (allocation?.isException === false && !isSplit) {
        if (singleClassification !== 'properlyIncluded' && singleClassification !== 'properlyExcluded') {
          return false;
        }
      }
      if (allocation?.isException === true && !isSplit) {
        if (singleClassification !== 'improperlyIncluded' && singleClassification !== 'improperlyExcluded') {
          return false;
        }
      }
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
      let singleValue = 0;
      for (const { key } of CLASSIFICATION_FIELDS) {
        const value = parseAmount(allocation[key]);
        if (!Number.isFinite(value) || value < 0) {
          return false;
        }
        if (!isSplit && singleClassification && key !== singleClassification && value !== 0) {
          return false;
        }
        if (!isSplit && key === singleClassification) {
          singleValue = value;
        }
        sum += value;
      }
      if (!isSplit && allocation?.isException === false) {
        if (Math.abs(singleValue - amountNumber) > 0.01) return false;
      }
      if (!isSplit && allocation?.isException === true) {
        if (Math.abs(singleValue - amountNumber) > 0.01) return false;
      }
      return Math.abs(sum - amountNumber) <= 0.01;
    },
    [parseAmount]
  );

  const isProgressComplete = useCallback((progress) => {
    const state = typeof progress?.state === 'string' ? progress.state.toLowerCase() : '';
    const pct = Number(progress?.percentComplete || 0);
    const step = typeof progress?.step === 'string' ? progress.step.toLowerCase() : '';
    return state === 'submitted' || pct >= 100 || step === 'results';
  }, []);

  useEffect(() => {
    activeStepRef.current = activeStep;
    const currentIndex = STEP_SEQUENCE.indexOf(activeStep);
    if (currentIndex >= 0) {
      setFurthestStepIndex((prev) => Math.max(prev, currentIndex));
    }
  }, [activeStep]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    let active = true;
    if (!caseId || activeStep !== FLOW_STEPS.RESULTS) return undefined;
    fetchCase(caseId)
      .then((caseDoc) => {
        if (!active) return;
        setCaseWithKeys(caseDoc);
      })
      .catch((error) => {
        if (!active) return;
        console.warn('[TraineeCaseViewPage] Failed to load case keys for results', error);
        setCaseWithKeys(null);
      });
    return () => {
      active = false;
    };
  }, [caseId, activeStep]);

  useEffect(() => {
    if (!caseData || !userId || !recipeId) return;
    let isActive = true;

    fetchRecipeProgress({ appId, uid: userId, recipeId })
      .then((progress) => {
        if (!isActive) return;
        setRecipeProgress(progress);
      })
      .catch((error) => {
        console.error('Error fetching recipe progress:', error);
        if (isActive) {
          setRecipeProgress(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [caseData, userId, recipeId]);

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
    if (!caseData) return;

    retakeHandledRef.current = true;
    if (caseData?.moduleId) {
      startRetakeAttempt({ clearRetakeQuery: true });
      return;
    }
    resetForRetake({ clearRetakeQuery: true });
  }, [caseId, userId, query, caseData, resetForRetake, startRetakeAttempt]);

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
          const step = STEP_SEQUENCE.includes(entry.step) ? entry.step : FLOW_STEPS.INSTRUCTION;
          const isResetSnapshot =
            percentComplete === 0 && (state === 'not_started' || step === FLOW_STEPS.INSTRUCTION);

          if (!isResetSnapshot) return;
          retakeResettingRef.current = false;
        }

        const nextStep = STEP_SEQUENCE.includes(entry.step) ? entry.step : FLOW_STEPS.INSTRUCTION;
        let resolvedStep = nextStep;
        if (gatePassed && nextStep === FLOW_STEPS.INSTRUCTION) {
          resolvedStep =
            activeStepRef.current === FLOW_STEPS.INSTRUCTION && furthestStepIndex === 0
              ? FLOW_STEPS.SELECTION
              : activeStepRef.current;
        }
        if (
          (!recentlyChanged || resolvedStep === FLOW_STEPS.RESULTS) &&
          activeStepRef.current !== resolvedStep
        ) {
          setActiveStep(resolvedStep);
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
  }, [caseId, userId, normalizePaymentId, gatePassed, furthestStepIndex]);

  useEffect(() => {
    if (!caseData || !userId) return;
    const level = normalizeCaseLevel(caseData?.caseLevel);
    if (level === 'basic') {
      setLevelGate({ locked: false, message: '' });
      return;
    }

    let isActive = true;
    const checkGate = async () => {
      try {
        const result = await listStudentCases({
          appId,
          uid: userId,
          pageSize: 200,
          includeOpensAtGate: false,
          sortBy: 'due',
        });
        const items = Array.isArray(result?.items) ? result.items : [];
        const caseIds = items.map((item) => item.id).filter(Boolean);
        const progressMap = await fetchProgressForCases({ appId, uid: userId, caseIds });
        const completion = { basic: false, intermediate: false };
        items.forEach((item) => {
          const progress = progressMap.get(item.id);
          if (!isProgressComplete(progress)) return;
          const itemLevel = normalizeCaseLevel(item.caseLevel);
          if (itemLevel === 'basic') completion.basic = true;
          if (itemLevel === 'intermediate') completion.intermediate = true;
        });

        let locked = false;
        let message = '';
        if (level === 'intermediate' && !completion.basic) {
          locked = true;
          message = 'Complete a Basic case to unlock Intermediate.';
        } else if (level === 'advanced' && !completion.intermediate) {
          locked = true;
          message = 'Complete an Intermediate case to unlock Advanced.';
        }

        if (isActive) {
          setLevelGate({ locked, message });
        }
      } catch (error) {
        console.error('Error checking difficulty gate:', error);
        if (isActive) {
          setLevelGate({ locked: false, message: '' });
        }
      }
    };

    checkGate();
    return () => {
      isActive = false;
    };
  }, [caseData, userId, isProgressComplete]);

  useEffect(() => {
    if (!levelGate.locked || lockNoticeRef.current) return;
    lockNoticeRef.current = true;
    showModal(levelGate.message || 'This case is locked until prerequisite cases are completed.', 'Locked');
    navigate('/trainee');
  }, [levelGate, navigate, showModal]);

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
      if (isInvoiceReferenceDoc(doc)) return;
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

  const hasPendingGeneration = useMemo(() => {
    const docs = Array.isArray(caseData?.referenceDocuments) ? caseData.referenceDocuments : [];
    return docs.some((doc) => {
      if (!doc || typeof doc !== 'object') return false;
      const hasSpec = doc.generationSpec || doc.generationSpecId;
      if (!hasSpec) return false;
      return !doc.storagePath && !doc.downloadURL;
    });
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

  const isSurlCase = useMemo(() => {
    const identifier = `${caseData?.moduleCode || ''} ${caseData?.title || ''} ${caseData?.caseName || ''}`.toLowerCase();
    return identifier.includes('surl') || identifier.includes('unrecorded');
  }, [caseData?.moduleCode, caseData?.title, caseData?.caseName]);

  const apAgingReferenceIds = useMemo(() => {
    return referenceDocuments
      .map((doc) => {
        const label = `${doc?.fileName || ''} ${doc?.title || ''}`.toLowerCase();
        if (!label.includes('ap aging')) return null;
        return doc?.id || doc?.storagePath || doc?.downloadURL || doc?.fileName || null;
      })
      .filter(Boolean);
  }, [referenceDocuments]);

  const apAgingOpened = useMemo(() => {
    return apAgingReferenceIds.some((id) => openedReferenceDocs.has(id));
  }, [apAgingReferenceIds, openedReferenceDocs]);

  const mustOpenReference = isSurlCase && apAgingReferenceIds.length > 0;

  const handleSelectPayment = useCallback(
    (paymentId) => {
      if (!paymentId) return;
      setActivePaymentId(paymentId);
      const match = selectedEvidenceItems.find((item) => item.paymentId === paymentId);
      if (match) {
        setActiveEvidenceId(match.evidenceId);
      }
    },
    [selectedEvidenceItems]
  );

  const viewerEnabled = activeStep === FLOW_STEPS.TESTING;
  const evidenceSource = useMemo(
    () => (viewerEnabled ? selectedEvidenceItems : []),
    [viewerEnabled, selectedEvidenceItems]
  );

  useEffect(() => {
    if (!viewerEnabled) {
      setActiveEvidenceId(null);
      setActivePaymentId(null);
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = { evidenceId: null, storagePath: null, url: null, inlineNotSupported: false };
      return;
    }

    if (evidenceSource.length === 0) {
      setActiveEvidenceId(null);
      setActivePaymentId(null);
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = { evidenceId: null, storagePath: null, url: null, inlineNotSupported: false };
      return;
    }

    if (!activeEvidenceId || !evidenceSource.some((item) => item.evidenceId === activeEvidenceId)) {
      setActiveEvidenceId(evidenceSource[0].evidenceId);
      setActivePaymentId(evidenceSource[0].paymentId || null);
    }
  }, [viewerEnabled, evidenceSource, activeEvidenceId]);

  useEffect(() => {
    if (!activeEvidenceId || evidenceSource.length === 0) return;
    const matched = evidenceSource.find((item) => item.evidenceId === activeEvidenceId);
    if (matched?.paymentId && matched.paymentId !== activePaymentId) {
      setActivePaymentId(matched.paymentId);
    }
  }, [activeEvidenceId, activePaymentId, evidenceSource]);

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

  useEffect(() => {
    if (!decisionBlockedHint) return;
    if (decisionHintTimeoutRef.current) {
      clearTimeout(decisionHintTimeoutRef.current);
    }
    decisionHintTimeoutRef.current = setTimeout(() => {
      setDecisionBlockedHint(false);
    }, 3000);
    return () => {
      if (decisionHintTimeoutRef.current) {
        clearTimeout(decisionHintTimeoutRef.current);
        decisionHintTimeoutRef.current = null;
      }
    };
  }, [decisionBlockedHint]);

  const enqueueProgressSave = useCallback(
    (stepOverride) => {
      if (!userId || !caseId) return;
      const intendedStep = stepOverride || activeStepRef.current;
      setSaveStatus('saving');

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

        saveProgress({ appId, uid: userId, caseId, patch })
          .then(() => setSaveStatus('saved'))
          .catch((err) => {
            console.error('Failed to save progress:', err);
            setSaveStatus('error');
          });
      }, 1000);
    },
    [userId, caseId]
  );

  useEffect(() => {
    if (!caseData || !userId || isLocked || activeStep === FLOW_STEPS.RESULTS || isRetakeResetting) return;
    enqueueProgressSave();
  }, [caseData, userId, isLocked, activeStep, enqueueProgressSave, isRetakeResetting]);

  const handleEnterSimulation = useCallback(() => {
    if (isLocked) return;
    if (!gatePassed && recipeId && userId) {
      setRecipeProgress({ recipeId, passedVersion: recipeVersion, passedAt: null });
      saveRecipeProgress({ appId, uid: userId, recipeId, passedVersion: recipeVersion }).catch((error) => {
        console.error('Failed to save recipe progress:', error);
      });
    }
    enqueueProgressSave(FLOW_STEPS.SELECTION);
    setActiveStep(FLOW_STEPS.SELECTION);
  }, [gatePassed, recipeId, recipeVersion, userId, isLocked, enqueueProgressSave]);

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

    if (currentlySelected) {
      const currentWork = classificationRef.current?.[paymentId];
      const hasWork = Boolean(
        currentWork &&
          (currentWork.singleClassification ||
            currentWork.isException === true ||
            currentWork.isException === false ||
            (typeof currentWork.workpaperNote === 'string' && currentWork.workpaperNote.trim().length > 0) ||
            (typeof currentWork.notes === 'string' && currentWork.notes.trim().length > 0))
      );

      if (hasWork) {
        const confirmDelete = window.confirm(
          "Warning: Deselecting this item will permanently delete the work you've done for it in the Classification step.\n\nAre you sure?"
        );
        if (!confirmDelete) return;
      }
    }

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

    enqueueProgressSave();
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

    enqueueProgressSave();
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

    enqueueProgressSave();
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
      const firstInvalidId = invalidAllocations[0];
      const element = typeof document !== 'undefined' ? document.getElementById(firstInvalidId) : null;

      if (element && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showModal(`Please complete the workpaper for ${firstInvalidId} before submitting.`, 'Action Required');
      } else {
        showModal(`Please check the following items: ${invalidAllocations.join(', ')}`, 'Incomplete');
      }
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
          hasSuccessfulAttempt: true,
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

  const caseTitle = caseData?.title || caseData?.caseName || 'Audit Case';
  const caseLevelLabel = getCaseLevelLabel(caseData?.caseLevel);
  const caseSubtitle = caseLevelLabel ? `Level: ${caseLevelLabel}` : '';

  useEffect(() => {
    sessionStorage.setItem('auditsim:moduleTitle', caseTitle);
    sessionStorage.setItem('auditsim:moduleSubtitle', caseSubtitle);
    window.dispatchEvent(new Event('auditsim:moduleHeader'));
    return () => {
      sessionStorage.removeItem('auditsim:moduleTitle');
      sessionStorage.removeItem('auditsim:moduleSubtitle');
      window.dispatchEvent(new Event('auditsim:moduleHeader'));
    };
  }, [caseSubtitle, caseTitle]);

  if (loading) return <div className="p-4 text-center">Loading case details...</div>;
  if (levelGate.locked) {
    return <div className="p-4 text-center">This case is locked. {levelGate.message}</div>;
  }
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
    <ol className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-4 py-4 shadow-sm">
      {STEP_SEQUENCE.map((stepKey, idx) => {
        const isCompleted = furthestStepIndex > idx;
        const isActive = stepIndex === idx;
        const canNavigate = idx <= furthestStepIndex;
        return (
          <li key={stepKey} className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => {
                if (!canNavigate) return;
                if (activeStep === stepKey) return;
                setActiveStep(stepKey);
              }}
              className={`flex items-center space-x-3 text-left ${
                canNavigate ? 'cursor-pointer' : 'cursor-not-allowed'
              }`}
              disabled={!canNavigate}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : isCompleted
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {isCompleted ? '✓' : idx + 1}
              </span>
              <div>
                <p className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-slate-800'}`}>
                  {STEP_LABELS[stepKey]}
                </p>
                <p className="text-xs text-slate-500 hidden sm:block">{STEP_DESCRIPTIONS[stepKey]}</p>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );

  const renderEvidenceViewer = (items) => {
    const activeEvidence = activeEvidenceId
      ? items.find((item) => item.evidenceId === activeEvidenceId)
      : null;
    const nowViewingLabel =
      activeEvidence?.evidenceFileName || activeEvidence?.paymentId || 'Supporting document';
    const activePaymentDocs = activePaymentId
      ? items.filter((item) => item.paymentId === activePaymentId)
      : [];

    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-[560px]">
        <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Document Viewer</h2>
            <p className="text-xs text-slate-500">
              {items.length === 0
                ? 'Choose a disbursement to see its supporting document.'
                : activeEvidenceId
                ? `Now viewing: ${nowViewingLabel}`
                : 'Select a disbursement to view its document.'}
            </p>
            {viewerEnabled && activePaymentDocs.length > 1 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {activePaymentDocs.map((doc, index) => {
                  const isActive = doc.evidenceId === activeEvidenceId;
                  const label = doc.evidenceFileName || `Invoice ${index + 1}`;
                  return (
                    <button
                      key={doc.evidenceId}
                      type="button"
                      onClick={() => {
                        setActiveEvidenceId(doc.evidenceId);
                        if (doc.paymentId) setActivePaymentId(doc.paymentId);
                      }}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                        isActive
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}
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
        <div className="flex-1 bg-slate-50 rounded-b-xl flex items-center justify-center min-h-[520px] md:min-h-[600px] h-[60vh] md:h-[65vh] lg:h-[70vh]">
          {activeEvidenceLoading ? (
            <div className="flex flex-col items-center text-slate-500">
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
              className="w-full h-full rounded-b-xl"
              style={{ minHeight: '520px' }}
            />
          ) : (
            <p className="text-sm text-slate-500 px-6 text-center">
              Select a disbursement with a linked document to preview it here.
            </p>
          )}
        </div>
      </div>
    );
  };

  const handleDownloadReferenceDoc = async (doc) => {
    if (!doc) return;
    const displayName = (doc.fileName || 'reference-document').trim() || 'reference-document';
    const referenceKey = doc.id || doc.storagePath || doc.downloadURL || doc.fileName;
    try {
      setDownloadingReferenceId(doc.id);
      let url = '';
      const fallbackUrl = (doc.downloadURL || '').trim();
      if (doc.storagePath) {
        try {
          url = await getDownloadURL(storageRef(storage, doc.storagePath));
        } catch (err) {
          if (fallbackUrl) {
            url = fallbackUrl;
          } else {
            throw err;
          }
        }
      } else if (fallbackUrl) {
        url = fallbackUrl;
      } else {
        throw new Error('Reference document is missing a download link.');
      }
      const isPdf = isInlinePreviewable(doc.contentType, doc.fileName || url);
      if (isPdf) {
        window.open(url, '_blank', 'noopener');
      } else {
        await triggerFileDownload(url, displayName);
      }
      if (referenceKey) {
        setOpenedReferenceDocs((prev) => {
          const next = new Set(prev);
          next.add(referenceKey);
          return next;
        });
      }
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
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Reference materials will appear here when provided by your instructor.
        </div>
      );
    }

    const bannerClasses = mustOpenReference
      ? apAgingOpened
        ? 'border-emerald-200 bg-emerald-50'
        : 'border-rose-200 bg-rose-50'
      : 'border-blue-200 bg-blue-50';

    const titleClasses = mustOpenReference
      ? apAgingOpened
        ? 'text-emerald-700'
        : 'text-rose-700'
      : 'text-blue-700';

    const bodyClasses = mustOpenReference
      ? apAgingOpened
        ? 'text-emerald-900'
        : 'text-rose-900'
      : 'text-blue-900';

    const bannerMessage = mustOpenReference
      ? apAgingOpened
        ? 'Reference material opened. You can now complete classifications.'
        : 'Required before classifying: open the AP Aging reference.'
      : 'Use these documents to complete the audit procedures. Download and keep them open while you classify.';

    return (
      <div className={`rounded-xl border px-4 py-3 shadow-sm ${bannerClasses}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className={`text-xs font-semibold uppercase tracking-wide ${titleClasses}`}>Reference Materials</p>
            <p className={`text-sm ${bodyClasses}`}>{bannerMessage}</p>
          </div>
          <div className="flex w-full flex-wrap gap-3 sm:w-auto">
            {referenceDocuments.map((doc) => {
              const referenceKey = doc.id || doc.storagePath || doc.downloadURL || doc.fileName;
              const isOpened = referenceKey ? openedReferenceDocs.has(referenceKey) : false;
              return (
                <Button
                  key={doc.id}
                  variant="secondary"
                  className={`text-xs px-4 py-2 border ${
                    isOpened ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
                  } hover:bg-white w-[260px]`}
                  onClick={() => handleDownloadReferenceDoc(doc)}
                  isLoading={downloadingReferenceId === doc.id}
                  disabled={downloadingReferenceId && downloadingReferenceId !== doc.id}
                  title={doc.fileName}
                >
                  <Download size={14} className="inline mr-2" />
                  <span className="truncate inline-block align-middle">{doc.fileName || 'Reference'}</span>
                </Button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderInstructionStep = () => {
    if (!caseData?.instruction) {
      return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-2xl font-semibold text-slate-900">Step 1 — Instruction</h2>
          <p className="text-sm text-slate-600 mt-2">
            Instructional material is missing for this case. Ask your instructor to add a briefing and gate
            check before continuing.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Step 1 — Instruction</h2>
          <p className="text-sm text-slate-600">
            {gateScope === 'per_attempt'
              ? 'Review the materials and successfully answer the knowledge check questions to access the simulation.'
              : gatePassed
              ? 'Review the materials. The gate check is optional because you already cleared it.'
              : 'Review the materials and successfully answer the knowledge check questions to access the simulation.'}
          </p>
        </div>
          <InstructionView
            instructionData={caseData.instruction}
            ctaLabel="Enter the Simulation"
            className="w-full max-w-[1400px]"
            gateRequired={gateRequired}
            onStartSimulation={handleEnterSimulation}
          />
      </div>
    );
  };

  const renderSelectionStep = () => (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Step 2 — Select Disbursements</h2>
        <p className="text-sm text-slate-500">
          Choose which disbursements you want to test. You will review supporting documents on the next step.
        </p>
      </div>

      {hasPendingGeneration ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-6 py-8 text-center">
          <Loader2 size={28} className="animate-spin text-blue-600" />
          <div className="text-sm text-blue-900 font-semibold">Generating case documents…</div>
          <div className="text-xs text-blue-700">
            We&apos;re assembling invoices and reference files. This usually takes a minute.
          </div>
        </div>
      ) : disbursementList.length === 0 ? (
        <p className="text-slate-500">No disbursements are available for this case.</p>
      ) : (
        <div className="space-y-3">
          {disbursementList.map((d, index) => {
            const paymentId = d.paymentId;
            const checkboxId = paymentId ? `cb-${paymentId}` : `cb-missing-${index + 1}`;
            const disabled = isLocked || hasPendingGeneration || !paymentId;
            return (
              <div
                key={d.__rowKey}
                className="flex items-center p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <input
                  type="checkbox"
                  id={checkboxId}
                  checked={paymentId ? !!selectedDisbursements[paymentId] : false}
                  onChange={() => handleSelectionChange(paymentId)}
                  disabled={disabled}
                  className="h-5 w-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mr-4 cursor-pointer disabled:cursor-not-allowed"
                />
                <label
                  htmlFor={checkboxId}
                  className={`flex-grow grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className="text-sm text-slate-700">
                    <strong className="font-medium">ID:</strong> {paymentId || 'Missing payment ID'}
                  </span>
                <span className="text-sm text-slate-700">
                  <strong className="font-medium">Payee:</strong> {d.payee}
                </span>
                <span className="text-sm text-slate-700">
                  <strong className="font-medium">Amount:</strong> {currencyFormatter.format(Number(d.amount) || 0)}
                </span>
                <span className="text-sm text-slate-700">
                  <strong className="font-medium">Date:</strong> {d.paymentDate}
                </span>
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
        <Button onClick={goToTestingStep} disabled={selectedIds.length === 0 || isLocked || hasPendingGeneration}>
          Continue to Classification
        </Button>
      </div>
    </div>
  );

  const renderTestingStep = () => {
    const missingDocuments = selectedEvidenceItems.filter((item) => !item?.hasLinkedDocument);
    const missingPaymentIds = Array.from(new Set(missingDocuments.map((item) => item?.paymentId || 'Unknown ID'))); 
    const canMakeDecision = !mustOpenReference || apAgingOpened;

    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Step 3 — Classify Results</h2>
              <p className="text-sm text-slate-600">
                Review the supporting documents and allocate the disbursement amount across each classification category.
              </p>
            </div>

            <div className="flex items-center gap-3 sm:pt-1">
              <Button
                variant="ghost"
                className="text-sm text-blue-700 hover:bg-blue-50"
                onClick={() =>
                  showModal(
                    <div className="whitespace-pre-wrap text-sm text-slate-700">
                      {caseData?.instructions || caseData?.description || 'No specific instructions provided.'}
                    </div>,
                    'Case Instructions'
                  )
                }
              >
                <BookOpen size={16} className="mr-2 inline" /> View Scenario
              </Button>

              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {saveStatus === 'saving' ? (
                  <span className="text-blue-600 animate-pulse">Saving...</span>
                ) : saveStatus === 'saved' ? (
                  <span className="text-emerald-600">All changes saved</span>
                ) : (
                  <span className="text-amber-600">Unsaved changes</span>
                )}
              </div>
            </div>
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
        {renderReferenceDownloadsBanner()}

        {selectedIds.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-sm text-slate-600">
            You do not have any disbursements selected. Return to the selection step to add them before testing.
            <div className="mt-4">
              <Button variant="secondary" onClick={() => setActiveStep(FLOW_STEPS.SELECTION)}>
                Back to Selection
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start">
              <div className="lg:col-span-7 lg:sticky lg:top-20">
                {renderEvidenceViewer(selectedEvidenceItems)}
              </div>

              <div className="space-y-4 lg:col-span-5 mt-6 lg:mt-0">
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">Audit Procedures</h3>
                  <p className="text-xs text-slate-500 mb-1">
                    Click a row to load its document on the left, then complete the workpaper to get the “green board” effect.
                  </p>
                  {!canMakeDecision ? (
                    <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                      <p className={`text-xs font-medium ${decisionBlockedHint ? 'text-rose-700' : 'text-rose-600'}`}>
                        Open the AP Aging reference to unlock classifications.
                      </p>
                    </div>
                  ) : (
                    <div className="mb-4" />
                  )}
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="divide-y divide-slate-200 bg-white">
                      {selectedDisbursementDetails.map((d) => {
                        const allocation = classificationAmounts[d.paymentId] || createEmptyAllocation();
                        const docCount = collectSupportingDocuments(d).length;
                        const totalEntered = CLASSIFICATION_FIELDS.reduce((sum, { key }) => {
                          const value = parseAmount(allocation[key]);
                          return sum + (Number.isFinite(value) ? value : 0);
                        }, 0);
                        const amountNumber = Number(d.amount) || 0;
                        const totalsMatch = Math.abs(totalEntered - amountNumber) <= 0.01;
                        const isComplete = isAllocationComplete(d, allocation);
                        const hasDecision = hasExplicitDecision(allocation);
                        const isActive = activePaymentId === d.paymentId;

                        return (
                          <div
                            id={d.paymentId}
                            key={d.paymentId}
                            className={`scroll-mt-28 border-l-4 ${
                              isComplete ? 'border-emerald-500' : 'border-transparent'
                            } ${isActive ? 'bg-blue-50/40' : 'bg-white'}`}
                          >
                            {!isActive ? (
                              <button
                                type="button"
                                onClick={() => handleSelectPayment(d.paymentId)}
                                className="grid w-full grid-cols-[24px_minmax(0,1fr)_120px_120px] items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                aria-expanded={false}
                              >
                                <div className="flex items-center justify-center">
                                  <span
                                    className={`h-2.5 w-2.5 rounded-full ${isComplete ? 'bg-emerald-500' : 'bg-slate-300'}`}
                                    aria-label={isComplete ? 'Complete' : 'Incomplete'}
                                  />
                                </div>

                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900">{d.paymentId}</div>
                                  <div className="truncate text-xs text-slate-500">
                                    {d.payee || 'Unknown payee'}
                                    {docCount > 1 ? ` | ${docCount} invoices` : ''}
                                  </div>
                                </div>

                                <div className="min-w-0 text-right">
                                  <div className="whitespace-nowrap text-sm font-semibold text-slate-900 tabular-nums">
                                    {currencyFormatter.format(amountNumber)}
                                  </div>
                                </div>

                                <div className="flex items-center justify-end">
                                  <span className="w-[96px] text-center shrink-0">
                                    {hasDecision ? (
                                      <span
                                        className={`inline-flex w-full items-center justify-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                                          allocation.isException ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                                        }`}
                                      >
                                        {allocation.isException ? 'Exception' : 'Pass'}
                                      </span>
                                    ) : (
                                      <span className="inline-flex w-full items-center justify-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                        Pending
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </button>
                            ) : null}
                            {isActive ? (
                              <div className="bg-white px-3 py-4">
                                <AuditItemCardFactory
                                  item={d}
                                  allocation={allocation}
                                  classificationFields={CLASSIFICATION_FIELDS}
                                  splitAllocationHint="Enter amounts for each category."
                                  singleAllocationHint="Select a classification."
                                  onSplitToggle={(id, checked) => {
                                    handleAllocationChange(id, 'mode', checked ? 'split' : 'single');
                                  }}
                                  onClassificationChange={(id, val) => handleAllocationChange(id, 'singleClassification', val)}
                                  onSplitAmountChange={(id, key, val) => handleAllocationChange(id, key, val)}
                                  onNoteChange={(id, val) => handleAllocationChange(id, 'workpaperNote', val)}
                                  onRationaleChange={handleRationaleChange}
                                  canMakeDecision={canMakeDecision}
                                  onDecisionBlocked={() => setDecisionBlockedHint(true)}
                                  isLocked={isLocked}
                                  totalsMatch={totalsMatch}
                                  totalEntered={totalEntered}
                                  isComplete={isComplete}
                                />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 pb-10">
                  <Button variant="secondary" onClick={() => setActiveStep(FLOW_STEPS.SELECTION)} disabled={isLocked}>
                    Back to Selection
                  </Button>
                  <Button onClick={handleSubmitTesting} disabled={!allClassified || isLocked}>
                    <Send size={18} className="inline mr-2" /> Submit Responses
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderResultsStep = () => {
    const resultsDisbursements = caseWithKeys?.disbursements || disbursementList;
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900">Audit Completion Report</h1>
            <p className="text-slate-600">Review your performance against the Virtual Senior&apos;s expectations.</p>
          </div>
          
          <ResultsAnalysis 
            disbursements={resultsDisbursements} 
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
      <div className="w-full max-w-[1400px] mx-auto space-y-6">
        {renderStepper()}
        {stepContent}
      </div>
    </div>
  );
}
