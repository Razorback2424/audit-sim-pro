import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { Timestamp } from 'firebase/firestore';
import { storage, Button, useRoute, useAuth, useUser, useModal, appId } from '../AppCore';
import { fetchCase, listStudentCases, subscribeToCase } from '../services/caseService';
import { saveSubmission } from '../services/submissionService';
import { fetchProgressForCases, saveProgress, subscribeProgressForCases } from '../services/progressService';
import { fetchRecipeProgress, saveRecipeProgress } from '../services/recipeProgressService';
import { startCaseAttemptFromPool } from '../services/attemptService';
import { isBillingPaid } from '../services/billingService';
import { trackAnalyticsEvent } from '../services/analyticsService';
import { Send, Loader2, ExternalLink, Download } from 'lucide-react';
import ResultsAnalysis from '../components/trainee/ResultsAnalysis';
import AuditItemCardFactory from '../components/trainee/AuditItemCardFactory';
import OutstandingCheckTestingModule from '../components/trainee/OutstandingCheckTestingModule';
import FixedAssetTestingModule from '../components/trainee/FixedAssetTestingModule';
import InstructionView from '../components/InstructionView';
import { getCaseLevelLabel, normalizeCaseLevel } from '../models/caseConstants';
import { computeDisbursementAttemptSummary } from '../utils/attemptSummary';

const FLOW_STEPS = Object.freeze({
  INSTRUCTION: 'instruction',
  CA_CHECK: 'ca_check',
  CA_COMPLETENESS: 'ca_completeness',
  SELECTION: 'selection',
  TESTING: 'testing',
  RESULTS: 'results',
});

const DEFAULT_STEP_SEQUENCE = [
  FLOW_STEPS.INSTRUCTION,
  FLOW_STEPS.SELECTION,
  FLOW_STEPS.TESTING,
  FLOW_STEPS.RESULTS,
];

const STEP_LABELS = {
  [FLOW_STEPS.INSTRUCTION]: 'Instruction',
  [FLOW_STEPS.CA_CHECK]: 'AP Aging C&A',
  [FLOW_STEPS.CA_COMPLETENESS]: 'Disbursement Listing C&A',
  [FLOW_STEPS.SELECTION]: 'Select Disbursements',
  [FLOW_STEPS.TESTING]: 'Classify Results',
  [FLOW_STEPS.RESULTS]: 'Review Outcome',
};

const STEP_DESCRIPTIONS = {
  [FLOW_STEPS.INSTRUCTION]: 'Review the materials and successfully answer the knowledge check questions to access the simulation.',
  [FLOW_STEPS.CA_CHECK]: 'Confirm the AP aging ties to the ledger before selecting items.',
  [FLOW_STEPS.CA_COMPLETENESS]:
    'Validate the January disbursement listing before you select items to test.',
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

const CLASSIFICATION_KEYS = Object.freeze(CLASSIFICATION_FIELDS.map(({ key }) => key));
const CLASSIFICATION_LABELS = Object.freeze(
  CLASSIFICATION_FIELDS.reduce((acc, field) => {
    acc[field.key] = field.label;
    return acc;
  }, {})
);

const hasExplicitDecision = (allocation) => allocation?.isException === true || allocation?.isException === false;

const normalizeText = (val) => (typeof val === 'string' ? val.trim().toLowerCase() : '');

const parseClassificationNumber = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeExpectedClassificationKey = (raw) => {
  if (!raw) return '';
  const text = normalizeText(raw);
  if (text.includes('missing') || text.includes('unrecorded')) return 'improperlyExcluded';
  if (text.includes('improperly') && text.includes('excluded')) return 'improperlyExcluded';
  if (text.includes('improperly') && text.includes('included')) return 'improperlyIncluded';
  if (text.includes('properly') && text.includes('excluded')) return 'properlyExcluded';
  if (text.includes('properly') && text.includes('included')) return 'properlyIncluded';
  if (CLASSIFICATION_KEYS.includes(text)) return text;
  return '';
};

const extractBreakdown = (source) => {
  return CLASSIFICATION_KEYS.map((key) => ({ key, amount: parseClassificationNumber(source?.[key]) }))
    .filter(({ amount }) => Math.abs(amount) > 0.0001)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
};

const getPrimaryClassificationKey = (allocation) => {
  if (!allocation || typeof allocation !== 'object') return '';
  const explicitKey = typeof allocation.singleClassification === 'string' ? allocation.singleClassification : '';
  if (CLASSIFICATION_KEYS.includes(explicitKey)) return explicitKey;
  const breakdown = extractBreakdown(allocation?.splitValues && typeof allocation.splitValues === 'object'
    ? allocation.splitValues
    : allocation);
  if (breakdown.length > 0) return breakdown[0].key;
  if (allocation.isException === true) return 'improperlyIncluded';
  if (allocation.isException === false) return 'properlyIncluded';
  return '';
};

const getExpectedClassificationKey = (item) => {
  const explicitKey = typeof item?.answerKeySingleClassification === 'string' ? item.answerKeySingleClassification : '';
  if (CLASSIFICATION_KEYS.includes(explicitKey)) return explicitKey;
  const answerKey = item?.answerKey && typeof item.answerKey === 'object' ? item.answerKey : null;
  const breakdown = answerKey ? extractBreakdown(answerKey) : [];
  if (breakdown.length > 0) return breakdown[0].key;
  return normalizeExpectedClassificationKey(item?.expectedClassification);
};

const formatDisbursementLabel = (item, formatter) => {
  if (!item) return 'This item';
  const name = (item.payee || item.vendor || item.paymentId || 'This item').trim();
  const amount = Number(item.amount);
  const formattedAmount = Number.isFinite(amount) ? formatter.format(amount) : '';
  return formattedAmount ? `${name} (${formattedAmount})` : name;
};

const extractDecisionFromAllocation = (allocation) => {
  if (!allocation || typeof allocation !== 'object') {
    return { primaryKey: '' };
  }

  const explicitKey = typeof allocation.singleClassification === 'string' ? allocation.singleClassification : '';
  if (CLASSIFICATION_KEYS.includes(explicitKey)) {
    return { primaryKey: explicitKey };
  }

  const breakdown = extractBreakdown(allocation);
  if (breakdown.length > 0) {
    return { primaryKey: breakdown[0].key };
  }

  if (allocation.isException === true) return { primaryKey: 'improperlyIncluded' };
  if (allocation.isException === false) return { primaryKey: 'properlyIncluded' };
  return { primaryKey: '' };
};

const extractCorrectDecision = (item) => {
  const explicitKey = typeof item?.answerKeySingleClassification === 'string' ? item.answerKeySingleClassification : '';
  if (CLASSIFICATION_KEYS.includes(explicitKey)) {
    return { primaryKey: explicitKey };
  }

  const answerKey = item?.answerKey && typeof item.answerKey === 'object' ? item.answerKey : null;
  const breakdown = answerKey ? extractBreakdown(answerKey) : [];
  if (breakdown.length > 0) {
    return { primaryKey: breakdown[0].key };
  }

  const expectedKey = normalizeExpectedClassificationKey(item?.expectedClassification);
  if (expectedKey) {
    return { primaryKey: expectedKey };
  }

  return { primaryKey: '' };
};

const isClassificationCorrect = (item, allocation) => {
  if (!item || !allocation) return false;
  const isTrap = !!item.shouldFlag;
  const studentDecision = extractDecisionFromAllocation(allocation);
  const correctDecision = extractCorrectDecision(item);

  if (isTrap) {
    if (allocation.isException !== true) return false;
    if (correctDecision.primaryKey) {
      return normalizeText(studentDecision.primaryKey) === normalizeText(correctDecision.primaryKey);
    }
    return true;
  }

  if (allocation.isException === true) return false;
  if (correctDecision.primaryKey) {
    return normalizeText(studentDecision.primaryKey) === normalizeText(correctDecision.primaryKey);
  }
  return true;
};

const normalizeGateFailures = (raw) => {
  const base = {
    instruction: false,
    tieOut: false,
    completeness: false,
    selection: false,
  };
  if (!raw || typeof raw !== 'object') return base;
  return {
    instruction: Boolean(raw.instruction),
    tieOut: Boolean(raw.tieOut),
    completeness: Boolean(raw.completeness),
    selection: Boolean(raw.selection),
  };
};

const isSameGateFailures = (current, next) => {
  if (!current || !next) return false;
  return (
    Boolean(current.instruction) === Boolean(next.instruction) &&
    Boolean(current.tieOut) === Boolean(next.tieOut) &&
    Boolean(current.completeness) === Boolean(next.completeness) &&
    Boolean(current.selection) === Boolean(next.selection)
  );
};

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

const getReferenceKey = (doc) => doc?.id || doc?.storagePath || doc?.downloadURL || doc?.fileName || '';

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

const mergeReferenceDocuments = (baseDocs, overrideDocs) => {
  const merged = [];
  const seen = new Set();
  const addDoc = (doc) => {
    if (!doc) return;
    const key = String(doc.fileName || doc.id || '').toLowerCase();
    const resolvedKey = key || String(doc.id || doc.storagePath || doc.downloadURL || '');
    if (!resolvedKey || seen.has(resolvedKey)) return;
    seen.add(resolvedKey);
    merged.push(doc);
  };
  (overrideDocs || []).forEach(addDoc);
  (baseDocs || []).forEach(addDoc);
  return merged;
};

const computePercentComplete = (step, selectedCount, classifiedCount) => {
  if (step === FLOW_STEPS.INSTRUCTION) return 0;
  if (step === FLOW_STEPS.CA_CHECK) return 10;
  if (step === FLOW_STEPS.CA_COMPLETENESS) return 12;
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

const coerceToMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return null;
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

export default function TraineeCaseViewPage({ params, demoMode = false }) {
  const { caseId } = params;
  const { navigate, query, setQuery } = useRoute();
  const { userId } = useAuth();
  const { billing, loadingBilling } = useUser();
  const { showModal, hideModal } = useModal();
  const demoCaseId = (process.env.REACT_APP_DEMO_SURL_CASE_ID || '').trim();
  const isDemoCase = demoCaseId ? demoCaseId === caseId : false;
  const isDemo =
    Boolean(demoMode) ||
    (typeof query?.demo === 'string'
      ? ['1', 'true', 'yes'].includes(query.demo.toLowerCase())
      : Boolean(query?.demo));
  const canPersist = Boolean(userId) && !isDemo;

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
  const [modulePassed, setModulePassed] = useState(null);
  const [tieOutSelectionId, setTieOutSelectionId] = useState('');
  const [tieOutAssessmentFeedback, setTieOutAssessmentFeedback] = useState('');
  const [tieOutActionSelectionId, setTieOutActionSelectionId] = useState('');
  const [tieOutActionFeedback, setTieOutActionFeedback] = useState('');
  const [tieOutAssessmentPassed, setTieOutAssessmentPassed] = useState(false);
  const [tieOutAssessmentOutcome, setTieOutAssessmentOutcome] = useState('');
  const [tieOutNeedsAction, setTieOutNeedsAction] = useState(false);
  const [tieOutPassed, setTieOutPassed] = useState(false);
  const [tieOutGateResult, setTieOutGateResult] = useState(null);
  const [completenessSelectionId, setCompletenessSelectionId] = useState('');
  const [completenessAssessmentFeedback, setCompletenessAssessmentFeedback] = useState('');
  const [completenessActionSelectionId, setCompletenessActionSelectionId] = useState('');
  const [completenessActionFeedback, setCompletenessActionFeedback] = useState('');
  const [completenessAssessmentPassed, setCompletenessAssessmentPassed] = useState(false);
  const [completenessAssessmentOutcome, setCompletenessAssessmentOutcome] = useState('');
  const [completenessNeedsAction, setCompletenessNeedsAction] = useState(false);
  const [completenessPassed, setCompletenessPassed] = useState(false);
  const [completenessGateResult, setCompletenessGateResult] = useState(null);
  const [selectionGateResult, setSelectionGateResult] = useState(null);
  const [gateFailures, setGateFailures] = useState({
    instruction: false,
    tieOut: false,
    completeness: false,
    selection: false,
  });
  const [tieOutDocViews, setTieOutDocViews] = useState({});
  const [completenessDocViews, setCompletenessDocViews] = useState({});
  const [apAgingPreviewUrl, setApAgingPreviewUrl] = useState('');
  const [apAgingPreviewLoading, setApAgingPreviewLoading] = useState(false);
  const [apAgingPreviewError, setApAgingPreviewError] = useState('');

  const recipeId = useMemo(() => getRecipeId(caseData), [caseData]);
  const recipeGateId = useMemo(() => {
    const base = recipeId || '';
    const level = typeof caseData?.caseLevel === 'string' ? caseData.caseLevel.trim().toLowerCase() : '';
    return level ? `${base}::${level}` : base;
  }, [caseData, recipeId]);
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
  const workflowSteps = useMemo(() => {
    const steps = Array.isArray(caseData?.workflow?.steps) ? caseData.workflow.steps : [];
    const allowed = new Set(Object.values(FLOW_STEPS));
    let normalized = [];
    steps.forEach((step) => {
      if (!allowed.has(step)) return;
      if (!normalized.includes(step)) normalized.push(step);
    });
    if (normalized.length === 0) {
      normalized = [...DEFAULT_STEP_SEQUENCE];
    }
    if (!normalized.includes(FLOW_STEPS.INSTRUCTION)) {
      normalized.unshift(FLOW_STEPS.INSTRUCTION);
    }
    const tieOutEnabled = Boolean(caseData?.workpaper?.layoutConfig?.tieOutGate?.enabled);
    const completenessEnabled = Boolean(caseData?.workpaper?.layoutConfig?.completenessGate?.enabled);
    if (tieOutEnabled && !normalized.includes(FLOW_STEPS.CA_CHECK)) {
      const instructionIndex = normalized.indexOf(FLOW_STEPS.INSTRUCTION);
      const insertIndex = instructionIndex >= 0 ? instructionIndex + 1 : 0;
      normalized.splice(insertIndex, 0, FLOW_STEPS.CA_CHECK);
    }
    if (completenessEnabled && !normalized.includes(FLOW_STEPS.CA_COMPLETENESS)) {
      const tieOutIndex = normalized.indexOf(FLOW_STEPS.CA_CHECK);
      const instructionIndex = normalized.indexOf(FLOW_STEPS.INSTRUCTION);
      const insertIndex =
        tieOutIndex >= 0 ? tieOutIndex + 1 : instructionIndex >= 0 ? instructionIndex + 1 : 0;
      normalized.splice(insertIndex, 0, FLOW_STEPS.CA_COMPLETENESS);
    }
    if (!normalized.includes(FLOW_STEPS.RESULTS)) {
      normalized.push(FLOW_STEPS.RESULTS);
    }
    return normalized;
  }, [caseData]);
  const firstPostInstructionStep = useMemo(() => {
    const index = workflowSteps.indexOf(FLOW_STEPS.INSTRUCTION);
    if (index >= 0 && index + 1 < workflowSteps.length) {
      return workflowSteps[index + 1];
    }
    return workflowSteps[0] || FLOW_STEPS.SELECTION;
  }, [workflowSteps]);
  const workpaperConfig = useMemo(() => caseData?.workpaper?.layoutConfig || {}, [caseData]);
  const tieOutGateConfig = useMemo(() => {
    const gate = workpaperConfig?.tieOutGate;
    return gate && gate.enabled ? gate : null;
  }, [workpaperConfig]);
  const completenessGateConfig = useMemo(() => {
    const gate = workpaperConfig?.completenessGate;
    return gate && gate.enabled ? gate : null;
  }, [workpaperConfig]);
  const selectionScopeConfig = useMemo(
    () => workpaperConfig?.selectionScope || null,
    [workpaperConfig]
  );

  const lastResolvedEvidenceRef = useRef({ evidenceId: null, storagePath: null, url: null, inlineNotSupported: false });
  const progressSaveTimeoutRef = useRef(null);
  const lastLocalChangeRef = useRef(0);
  const activeStepRef = useRef(FLOW_STEPS.INSTRUCTION);
  const selectionRef = useRef(selectedDisbursements);
  const classificationRef = useRef(classificationAmounts);
  const tieOutGateResultRef = useRef(tieOutGateResult);
  const completenessGateResultRef = useRef(completenessGateResult);
  const gateFailuresRef = useRef(gateFailures);
  const attemptStartedAtRef = useRef(null);
  const selectedIdsRef = useRef([]);
  const classifiedCountRef = useRef(0);
  const isLockedRef = useRef(false);
  const retakeHandledRef = useRef(false);
  const retakeResettingRef = useRef(false);
  const decisionHintTimeoutRef = useRef(null);
  const lockNoticeRef = useRef(false);

  useEffect(() => {
    if (!tieOutGateConfig) {
      setTieOutPassed(true);
      setTieOutGateResult(null);
      setTieOutSelectionId('');
      setTieOutAssessmentFeedback('');
      setTieOutActionSelectionId('');
      setTieOutActionFeedback('');
      setTieOutAssessmentPassed(false);
      setTieOutAssessmentOutcome('');
      setTieOutNeedsAction(false);
      setTieOutDocViews({});
    } else {
      setTieOutPassed(false);
      setTieOutGateResult(null);
      setTieOutSelectionId('');
      setTieOutAssessmentFeedback('');
      setTieOutActionSelectionId('');
      setTieOutActionFeedback('');
      setTieOutAssessmentPassed(false);
      setTieOutAssessmentOutcome('');
      setTieOutNeedsAction(false);
      setTieOutDocViews({});
    }

    if (!completenessGateConfig) {
      setCompletenessPassed(true);
      setCompletenessGateResult(null);
      setCompletenessSelectionId('');
      setCompletenessAssessmentFeedback('');
      setCompletenessActionSelectionId('');
      setCompletenessActionFeedback('');
      setCompletenessAssessmentPassed(false);
      setCompletenessAssessmentOutcome('');
      setCompletenessNeedsAction(false);
      setCompletenessDocViews({});
    } else {
      setCompletenessPassed(false);
      setCompletenessGateResult(null);
      setCompletenessSelectionId('');
      setCompletenessAssessmentFeedback('');
      setCompletenessActionSelectionId('');
      setCompletenessActionFeedback('');
      setCompletenessAssessmentPassed(false);
      setCompletenessAssessmentOutcome('');
      setCompletenessNeedsAction(false);
      setCompletenessDocViews({});
    }

    setSelectionGateResult(null);
    setGateFailures({
      instruction: false,
      tieOut: false,
      completeness: false,
      selection: false,
    });
    attemptStartedAtRef.current = null;
    setModulePassed(null);
  }, [caseId, selectionScopeConfig, tieOutGateConfig, completenessGateConfig]);

  const createEmptyAllocation = useCallback(() => {
    const template = {};
    CLASSIFICATION_FIELDS.forEach(({ key }) => {
      template[key] = '';
    });
    return template;
  }, []);

  const resetForRetake = useCallback(
    async ({ clearRetakeQuery } = {}) => {
      if (!caseId) return;
      if (retakeResettingRef.current) return;

      retakeResettingRef.current = true;
      const initialStep =
        gateScope === 'once' ? firstPostInstructionStep : FLOW_STEPS.INSTRUCTION;
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
      setTieOutPassed(!tieOutGateConfig);
      setTieOutGateResult(null);
      setTieOutSelectionId('');
      setTieOutAssessmentFeedback('');
      setTieOutActionSelectionId('');
      setTieOutActionFeedback('');
      setTieOutAssessmentPassed(false);
      setTieOutAssessmentOutcome('');
      setTieOutNeedsAction(false);
      setCompletenessPassed(!completenessGateConfig);
      setCompletenessGateResult(null);
      setCompletenessSelectionId('');
      setCompletenessAssessmentFeedback('');
      setCompletenessActionSelectionId('');
      setCompletenessActionFeedback('');
      setCompletenessAssessmentPassed(false);
      setCompletenessAssessmentOutcome('');
      setCompletenessNeedsAction(false);
      setSelectionGateResult(null);
      setGateFailures({
        instruction: false,
        tieOut: false,
        completeness: false,
        selection: false,
      });
      attemptStartedAtRef.current = null;
      setModulePassed(null);
      lastResolvedEvidenceRef.current = { evidenceId: null, storagePath: null, url: null, inlineNotSupported: false };

      if (!canPersist) {
        retakeResettingRef.current = false;
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
        return;
      }

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
              tieOutGate: null,
              completenessGate: null,
              gateFailures: {
                instruction: false,
                tieOut: false,
                completeness: false,
                selection: false,
              },
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
    [
      caseId,
      canPersist,
      gateScope,
      setQuery,
      showModal,
      tieOutGateConfig,
      completenessGateConfig,
      firstPostInstructionStep,
    ]
  );

  const requestRetake = useCallback(() => {
    resetForRetake();
  }, [resetForRetake]);

  const generateNewCase = useCallback(async () => {
    if (!caseData?.moduleId) return;
    if (retakeResettingRef.current) return;
    if (!canPersist) {
      showModal('Demo mode uses a fixed case. Create an account to unlock additional cases.', 'Demo Mode');
      return;
    }
    setIsRetakeResetting(true);
    retakeResettingRef.current = true;
    try {
      const newCaseId = await startCaseAttemptFromPool({ moduleId: caseData.moduleId });
      if (firstPostInstructionStep) {
        const percentComplete = computePercentComplete(firstPostInstructionStep, 0, 0);
        await saveProgress({
          appId,
          uid: userId,
          caseId: newCaseId,
          patch: {
            percentComplete,
            state: deriveStateFromProgress(firstPostInstructionStep, percentComplete),
            step: firstPostInstructionStep,
            draft: {
              selectedPaymentIds: [],
              classificationDraft: {},
              tieOutGate: null,
              gateFailures: {
                instruction: false,
                tieOut: false,
                completeness: false,
                selection: false,
              },
            },
          },
        });
      }
      navigate(`/cases/${newCaseId}`);
    } catch (err) {
      console.error('Failed to start a new case attempt:', err);
      showModal('We ran into an issue starting a new case. Please try again.', 'Case Error');
    } finally {
      setIsRetakeResetting(false);
      retakeResettingRef.current = false;
    }
  }, [caseData?.moduleId, firstPostInstructionStep, navigate, showModal, canPersist, userId]);

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
    if (typeof progress?.hasSuccessfulAttempt === 'boolean') {
      return progress.hasSuccessfulAttempt;
    }
    const state = typeof progress?.state === 'string' ? progress.state.toLowerCase() : '';
    const pct = Number(progress?.percentComplete || 0);
    const step = typeof progress?.step === 'string' ? progress.step.toLowerCase() : '';
    return state === 'submitted' || pct >= 100 || step === 'results';
  }, []);

  useEffect(() => {
    activeStepRef.current = activeStep;
    const currentIndex = workflowSteps.indexOf(activeStep);
    if (currentIndex >= 0) {
      setFurthestStepIndex((prev) => Math.max(prev, currentIndex));
    }
  }, [activeStep, workflowSteps]);

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
    tieOutGateResultRef.current = tieOutGateResult;
  }, [tieOutGateResult]);

  useEffect(() => {
    completenessGateResultRef.current = completenessGateResult;
  }, [completenessGateResult]);

  useEffect(() => {
    gateFailuresRef.current = gateFailures;
  }, [gateFailures]);

  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  useEffect(() => {
    if (!caseId) {
      setLoading(false);
      if (!isDemo) navigate('/trainee');
      return;
    }
    if (!isDemo && !isDemoCase && userId && loadingBilling) {
      setLoading(true);
      return;
    }
    if (!isDemo && !isDemoCase && userId && !loadingBilling && !isBillingPaid(billing)) {
      setLoading(false);
      showModal('This case is locked until you upgrade your account.', 'Upgrade required');
      navigate('/checkout?plan=individual');
      return;
    }
    if (!userId && !isDemo) {
      setLoading(false);
      navigate('/login');
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
          const isRostered =
            Boolean(userId) && Array.isArray(caseDoc.visibleToUserIds) && caseDoc.visibleToUserIds.includes(userId);
          const fallbackPath = isDemo ? '/' : '/trainee';
          if (!isPublic && !isRostered) {
            showModal('You do not have permission to view this case.', 'Access Denied');
            navigate(fallbackPath);
            return;
          }
          if (caseDoc.status === 'archived') {
            showModal('This case has been archived by an administrator.', 'Unavailable');
            navigate(fallbackPath);
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
            navigate(fallbackPath);
            return;
          }
          setCaseData(caseDoc);
        } else {
          showModal('Case not found or has been removed.', 'Error');
          navigate(isDemo ? '/' : '/trainee');
        }
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching case: ', error);
        showModal('Error fetching case: ' + error.message, 'Error');
        setLoading(false);
        navigate(isDemo ? '/' : '/trainee');
      }
    );

    return () => unsubscribe();
  }, [caseId, navigate, userId, showModal, isDemo, isDemoCase, billing, loadingBilling]);

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
    if (!caseData || !canPersist || !recipeGateId) return;
    let isActive = true;

    fetchRecipeProgress({ appId, uid: userId, recipeId: recipeGateId })
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
  }, [caseData, canPersist, recipeGateId]);

  useEffect(() => {
    if (!query?.retake) {
      retakeHandledRef.current = false;
    }
  }, [query]);

  useEffect(() => {
    if (!caseId || !canPersist) return;
    const retakeValue = query?.retake;
    const retakeRequested =
      typeof retakeValue === 'string' ? retakeValue.toLowerCase() === 'true' : Boolean(retakeValue);
    if (!retakeRequested || retakeHandledRef.current) return;
    if (!caseData) return;

    retakeHandledRef.current = true;
    resetForRetake({ clearRetakeQuery: true });
  }, [caseId, canPersist, query, caseData, resetForRetake]);

  useEffect(() => {
    if (!caseId || !canPersist) return;

    const unsubscribe = subscribeProgressForCases(
      { appId, uid: userId, caseIds: [caseId] },
      (progressMap) => {
        const entry = progressMap.get(caseId);
        if (!entry) return;

        const startedAtMs = coerceToMillis(entry.activeAttempt?.startedAt);
        if (startedAtMs && !attemptStartedAtRef.current) {
          attemptStartedAtRef.current = startedAtMs;
        }

        const entryUpdatedAtMs = entry?.updatedAt?.toMillis ? entry.updatedAt.toMillis() : 0;
        const localChangeMs = lastLocalChangeRef.current || 0;
        const isEntryStale = localChangeMs > 0 && entryUpdatedAtMs > 0 && entryUpdatedAtMs < localChangeMs - 2000;
        const recentlyChanged = isEntryStale || Date.now() - lastLocalChangeRef.current < 1200;

        if (retakeResettingRef.current) {
          const percentComplete = Number(entry?.percentComplete || 0);
          const state = typeof entry?.state === 'string' ? entry.state.toLowerCase() : '';
          const step = workflowSteps.includes(entry.step) ? entry.step : FLOW_STEPS.INSTRUCTION;
          const isResetSnapshot =
            percentComplete === 0 && (state === 'not_started' || step === FLOW_STEPS.INSTRUCTION);

          if (!isResetSnapshot) return;
          retakeResettingRef.current = false;
        }

        const nextStep = workflowSteps.includes(entry.step) ? entry.step : FLOW_STEPS.INSTRUCTION;
        let resolvedStep = nextStep;
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

        const tieOutDraft = entry.draft?.tieOutGate;
        if (!recentlyChanged && tieOutGateConfig && tieOutDraft?.passed) {
          const currentTieOut = tieOutGateResultRef.current;
          if (!currentTieOut || !currentTieOut.passed) {
            setTieOutGateResult(tieOutDraft);
            setTieOutPassed(true);
            setTieOutAssessmentPassed(true);
            setTieOutAssessmentOutcome(tieOutDraft?.assessment?.outcome || '');
            setTieOutNeedsAction(false);
          }
        }
        const completenessDraft = entry.draft?.completenessGate;
        if (!recentlyChanged && completenessGateConfig && completenessDraft?.passed) {
          const currentCompleteness = completenessGateResultRef.current;
          if (!currentCompleteness || !currentCompleteness.passed) {
            setCompletenessGateResult(completenessDraft);
            setCompletenessPassed(true);
            setCompletenessAssessmentPassed(true);
            setCompletenessAssessmentOutcome(completenessDraft?.assessment?.outcome || '');
            setCompletenessNeedsAction(false);
          }
        }

        const gateFailuresRaw = entry.draft?.gateFailures;
        if (!recentlyChanged && gateFailuresRaw && typeof gateFailuresRaw === 'object') {
          const gateFailuresDraft = normalizeGateFailures(gateFailuresRaw);
          if (!isSameGateFailures(gateFailuresRef.current, gateFailuresDraft)) {
            setGateFailures(gateFailuresDraft);
          }
        }

        const shouldLock = entry.state === 'submitted' || nextStep === FLOW_STEPS.RESULTS;
        if (isLockedRef.current !== shouldLock) {
          setIsLocked(shouldLock);
        }
        if (shouldLock) {
          setModulePassed(Boolean(entry?.hasSuccessfulAttempt));
        }
      },
      (error) => {
        console.error('Error subscribing to progress:', error);
      }
    );

    return () => unsubscribe();
  }, [
    caseId,
    canPersist,
    userId,
    normalizePaymentId,
    gatePassed,
    furthestStepIndex,
    workflowSteps,
    firstPostInstructionStep,
    tieOutGateConfig,
    completenessGateConfig,
  ]);

  useEffect(() => {
    if (!caseData || !canPersist) return;
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
  }, [caseData, canPersist, isProgressComplete]);

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

  const allReferenceDocuments = useMemo(() => {
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
      const generationSpec = doc.generationSpec && typeof doc.generationSpec === 'object' ? doc.generationSpec : null;
      const generationSpecId = typeof doc.generationSpecId === 'string' ? doc.generationSpecId.trim() : '';
      const hasGenerationSpec = Boolean(generationSpec || generationSpecId);
      if (!storagePath && !downloadURL && !hasGenerationSpec) return;
      const baseId = storagePath || downloadURL || generationSpecId || `${fileName}-${index}`;
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
        generationSpec,
        generationSpecId: generationSpecId || null,
        pending: !storagePath && !downloadURL && hasGenerationSpec,
      });
    });

    return normalized;
  }, [caseData]);

  const tieOutReferenceDocuments = useMemo(() => {
    const targetNames = Array.isArray(tieOutGateConfig?.referenceDocNames)
      ? tieOutGateConfig.referenceDocNames
      : [];
    if (targetNames.length === 0) return [];
    const nameSet = new Set(targetNames.map((name) => String(name).toLowerCase()));
    return allReferenceDocuments.filter((doc) => nameSet.has(String(doc.fileName || '').toLowerCase()));
  }, [allReferenceDocuments, tieOutGateConfig]);

  const tieOutCorrectedReferenceDocuments = useMemo(() => {
    const targetNames = Array.isArray(tieOutGateConfig?.correctedReferenceDocNames)
      ? tieOutGateConfig.correctedReferenceDocNames
      : [];
    if (targetNames.length === 0) return [];
    const nameSet = new Set(targetNames.map((name) => String(name).toLowerCase()));
    return allReferenceDocuments.filter((doc) => nameSet.has(String(doc.fileName || '').toLowerCase()));
  }, [allReferenceDocuments, tieOutGateConfig]);

  const completenessReferenceDocuments = useMemo(() => {
    const targetNames = Array.isArray(completenessGateConfig?.referenceDocNames)
      ? completenessGateConfig.referenceDocNames
      : [];
    if (targetNames.length === 0) return [];
    const nameSet = new Set(targetNames.map((name) => String(name).toLowerCase()));
    return allReferenceDocuments.filter((doc) => nameSet.has(String(doc.fileName || '').toLowerCase()));
  }, [allReferenceDocuments, completenessGateConfig]);

  const completenessCorrectedReferenceDocuments = useMemo(() => {
    const targetNames = Array.isArray(completenessGateConfig?.correctedReferenceDocNames)
      ? completenessGateConfig.correctedReferenceDocNames
      : [];
    if (targetNames.length === 0) return [];
    const nameSet = new Set(targetNames.map((name) => String(name).toLowerCase()));
    return allReferenceDocuments.filter((doc) => nameSet.has(String(doc.fileName || '').toLowerCase()));
  }, [allReferenceDocuments, completenessGateConfig]);

  const referenceDocuments = useMemo(() => {
    if (!tieOutGateConfig && !completenessGateConfig) return allReferenceDocuments;
    if (tieOutGateConfig && !tieOutPassed) {
      return tieOutReferenceDocuments.length > 0 ? tieOutReferenceDocuments : allReferenceDocuments;
    }
    if (completenessGateConfig && !completenessPassed) {
      return completenessReferenceDocuments.length > 0 ? completenessReferenceDocuments : allReferenceDocuments;
    }
    const correctedDocs = completenessGateConfig
      ? completenessCorrectedReferenceDocuments
      : tieOutCorrectedReferenceDocuments;
    if (correctedDocs.length === 0) return allReferenceDocuments;
    const includeAll =
      completenessGateConfig?.includeAllReferenceDocs || tieOutGateConfig?.includeAllReferenceDocs;
    if (!includeAll) {
      return correctedDocs;
    }
    return mergeReferenceDocuments(allReferenceDocuments, correctedDocs);
  }, [
    allReferenceDocuments,
    completenessCorrectedReferenceDocuments,
    completenessGateConfig,
    completenessPassed,
    completenessReferenceDocuments,
    tieOutCorrectedReferenceDocuments,
    tieOutGateConfig,
    tieOutPassed,
    tieOutReferenceDocuments,
  ]);

  const apAgingDoc = useMemo(() => {
    return referenceDocuments.find((doc) => {
      const templateId =
        typeof doc?.generationSpec?.templateId === 'string'
          ? doc.generationSpec.templateId.toLowerCase()
          : '';
      if (templateId === 'refdoc.ap-aging.v1') return true;
      const fileName = String(doc?.fileName || '').toLowerCase();
      return fileName.includes('ap aging');
    }) || null;
  }, [referenceDocuments]);

  useEffect(() => {
    if (!apAgingDoc) {
      setApAgingPreviewUrl('');
      setApAgingPreviewError('');
      setApAgingPreviewLoading(false);
      return;
    }
    if (apAgingDoc.downloadURL) {
      setApAgingPreviewUrl(apAgingDoc.downloadURL);
      setApAgingPreviewError('');
      setApAgingPreviewLoading(false);
      return;
    }
    if (!apAgingDoc.storagePath || !storage?.app) {
      setApAgingPreviewUrl('');
      setApAgingPreviewError('AP aging preview unavailable.');
      setApAgingPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setApAgingPreviewLoading(true);
    setApAgingPreviewError('');
    setApAgingPreviewUrl('');

    getDownloadURL(storageRef(storage, apAgingDoc.storagePath))
      .then((url) => {
        if (cancelled) return;
        setApAgingPreviewUrl(url);
        setApAgingPreviewError('');
      })
      .catch((error) => {
        if (cancelled) return;
        const message =
          error?.code === 'storage/object-not-found'
            ? 'AP aging document is missing from storage.'
            : 'Unable to load AP aging preview.';
        setApAgingPreviewError(message);
      })
      .finally(() => {
        if (cancelled) return;
        setApAgingPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apAgingDoc]);

  const hasPendingGeneration = useMemo(() => {
    const docs = Array.isArray(caseData?.referenceDocuments) ? caseData.referenceDocuments : [];
    return docs.some((doc) => {
      if (!doc || typeof doc !== 'object') return false;
      const hasSpec = doc.generationSpec || doc.generationSpecId;
      if (!hasSpec) return false;
      return !doc.storagePath && !doc.downloadURL;
    });
  }, [caseData]);

  const hasMissingCashArtifacts = useMemo(() => {
    const artifacts = Array.isArray(caseData?.cashArtifacts) ? caseData.cashArtifacts : [];
    return artifacts.some((doc) => {
      if (!doc || typeof doc !== 'object') return false;
      const type = typeof doc.type === 'string' ? doc.type.trim() : '';
      if (!type) return false;
      const hasFileName = typeof doc.fileName === 'string' && doc.fileName.trim();
      const hasLink = Boolean(doc.downloadURL || doc.storagePath);
      return hasFileName && !hasLink;
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

  const scopeThreshold = useMemo(() => {
    const explicit = Number(selectionScopeConfig?.thresholdAmount);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const pm = Number(selectionScopeConfig?.performanceMateriality || 0);
    const pct = Number(selectionScopeConfig?.scopePercent || 0);
    if (Number.isFinite(pm) && pm > 0 && Number.isFinite(pct) && pct > 0) {
      return Math.round((pm * pct + Number.EPSILON) * 100) / 100;
    }
    return 0;
  }, [selectionScopeConfig]);
  const requiredSelectionIds = useMemo(() => {
    if (!selectionScopeConfig || !Number.isFinite(scopeThreshold) || scopeThreshold <= 0) return [];
    return disbursementList
      .filter((item) => Number(item?.amount || 0) >= scopeThreshold)
      .map((item) => item.paymentId)
      .filter(Boolean);
  }, [disbursementList, scopeThreshold, selectionScopeConfig]);

  const missingRequiredIds = requiredSelectionIds.filter((id) => !selectedDisbursements[id]);

  const tieOutDocsOpened = useMemo(() => {
    if (!tieOutGateConfig) return true;
    if (!tieOutGateConfig.requireOpenedDocs) return true;
    if (tieOutReferenceDocuments.length === 0) return true;
    return tieOutReferenceDocuments.every((doc) => {
      const referenceKey = getReferenceKey(doc);
      if (referenceKey && openedReferenceDocs.has(referenceKey)) return true;
      const view = tieOutDocViews[doc.id];
      return Boolean(view?.url || doc.downloadURL);
    });
  }, [openedReferenceDocs, tieOutGateConfig, tieOutReferenceDocuments, tieOutDocViews]);

  const completenessDocsOpened = useMemo(() => {
    if (!completenessGateConfig) return true;
    if (!completenessGateConfig.requireOpenedDocs) return true;
    if (completenessReferenceDocuments.length === 0) return true;
    return completenessReferenceDocuments.every((doc) => {
      const referenceKey = getReferenceKey(doc);
      if (referenceKey && openedReferenceDocs.has(referenceKey)) return true;
      const view = completenessDocViews[doc.id];
      return Boolean(view?.url || doc.downloadURL);
    });
  }, [openedReferenceDocs, completenessGateConfig, completenessReferenceDocuments, completenessDocViews]);

  useEffect(() => {
    if (!tieOutGateConfig) {
      setTieOutDocViews({});
      return;
    }
    const docs = tieOutReferenceDocuments.length > 0 ? tieOutReferenceDocuments : [];
    if (docs.length === 0) {
      setTieOutDocViews({});
      return;
    }

    let cancelled = false;
    const initialViews = {};
    docs.forEach((doc) => {
      initialViews[doc.id] = {
        url: doc.downloadURL || '',
        loading: Boolean(!doc.downloadURL && doc.storagePath),
        error: '',
      };
    });
    setTieOutDocViews(initialViews);

    if (!storage?.app) {
      setTieOutDocViews((prev) => {
        const next = { ...prev };
        docs.forEach((doc) => {
          if (!next[doc.id]?.url) {
            next[doc.id] = {
              ...next[doc.id],
              loading: false,
              error: 'Preview unavailable in this environment.',
            };
          }
        });
        return next;
      });
      return () => {
        cancelled = true;
      };
    }

    Promise.all(
      docs.map(async (doc) => {
        if (doc.downloadURL || !doc.storagePath) {
          return { id: doc.id, url: doc.downloadURL || '', error: '' };
        }
        try {
          const url = await getDownloadURL(storageRef(storage, doc.storagePath));
          return { id: doc.id, url, error: '' };
        } catch (error) {
          const message =
            error?.code === 'storage/object-not-found'
              ? 'Document is missing from storage.'
              : 'Unable to load document preview.';
          return { id: doc.id, url: '', error: message };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setTieOutDocViews((prev) => {
        const next = { ...prev };
        results.forEach((result) => {
          next[result.id] = {
            url: result.url,
            loading: false,
            error: result.error,
          };
        });
        return next;
      });
      setOpenedReferenceDocs((prev) => {
        const next = new Set(prev);
        docs.forEach((doc) => {
          const view = results.find((item) => item.id === doc.id);
          if (view?.url) {
            const key = getReferenceKey(doc);
            if (key) next.add(key);
          }
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [tieOutGateConfig, tieOutReferenceDocuments]);

  useEffect(() => {
    if (!completenessGateConfig) {
      setCompletenessDocViews({});
      return;
    }
    const docs = completenessReferenceDocuments.length > 0 ? completenessReferenceDocuments : [];
    if (docs.length === 0) {
      setCompletenessDocViews({});
      return;
    }

    let cancelled = false;
    const initialViews = {};
    docs.forEach((doc) => {
      initialViews[doc.id] = {
        url: doc.downloadURL || '',
        loading: Boolean(!doc.downloadURL && doc.storagePath),
        error: '',
      };
    });
    setCompletenessDocViews(initialViews);

    if (!storage?.app) {
      setCompletenessDocViews((prev) => {
        const next = { ...prev };
        docs.forEach((doc) => {
          if (!next[doc.id]?.url) {
            next[doc.id] = {
              ...next[doc.id],
              loading: false,
              error: 'Preview unavailable in this environment.',
            };
          }
        });
        return next;
      });
      return () => {
        cancelled = true;
      };
    }

    Promise.all(
      docs.map(async (doc) => {
        if (doc.downloadURL || !doc.storagePath) {
          return { id: doc.id, url: doc.downloadURL || '', error: '' };
        }
        try {
          const url = await getDownloadURL(storageRef(storage, doc.storagePath));
          return { id: doc.id, url, error: '' };
        } catch (error) {
          const message =
            error?.code === 'storage/object-not-found'
              ? 'Document is missing from storage.'
              : 'Unable to load document preview.';
          return { id: doc.id, url: '', error: message };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setCompletenessDocViews((prev) => {
        const next = { ...prev };
        results.forEach((result) => {
          next[result.id] = {
            url: result.url,
            loading: false,
            error: result.error,
          };
        });
        return next;
      });
      setOpenedReferenceDocs((prev) => {
        const next = new Set(prev);
        docs.forEach((doc) => {
          const view = results.find((item) => item.id === doc.id);
          if (view?.url) {
            const key = getReferenceKey(doc);
            if (key) next.add(key);
          }
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [completenessGateConfig, completenessReferenceDocuments]);

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

  const isOutstandingCheckTesting = useMemo(
    () => caseData?.auditArea === 'cash' && caseData?.cashContext?.moduleType === 'outstanding_check_testing',
    [caseData]
  );
  const isFixedAssetCase = useMemo(
    () => caseData?.auditArea === 'fixed_assets' || caseData?.workpaper?.layoutType === 'fixed_assets',
    [caseData]
  );

  const enqueueProgressSave = useCallback(
    (stepOverride) => {
      if (!canPersist || !caseId || isOutstandingCheckTesting) return;
      const intendedStep = stepOverride || activeStepRef.current;
      setSaveStatus('saving');
      if (!attemptStartedAtRef.current) {
        attemptStartedAtRef.current = Date.now();
      }

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
        const tieOutGateSnapshot = tieOutGateResultRef.current;
        const completenessGateSnapshot = completenessGateResultRef.current;
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
            gateFailures: gateFailuresRef.current,
            ...(tieOutGateSnapshot?.passed ? { tieOutGate: tieOutGateSnapshot } : {}),
            ...(completenessGateSnapshot?.passed ? { completenessGate: completenessGateSnapshot } : {}),
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
    [canPersist, caseId, isOutstandingCheckTesting]
  );

  useEffect(() => {
    if (
      !caseData ||
      !canPersist ||
      isLocked ||
      activeStep === FLOW_STEPS.RESULTS ||
      isRetakeResetting ||
      isOutstandingCheckTesting
    )
      return;
    enqueueProgressSave();
  }, [caseData, canPersist, isLocked, activeStep, enqueueProgressSave, isRetakeResetting, isOutstandingCheckTesting]);

  const markGateFailure = useCallback(
    (gateKey) => {
      setGateFailures((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, gateKey)) return prev;
        if (prev[gateKey]) return prev;
        const next = { ...prev, [gateKey]: true };
        gateFailuresRef.current = next;
        return next;
      });
      lastLocalChangeRef.current = Date.now();
      enqueueProgressSave();
    },
    [enqueueProgressSave]
  );

  const handleEnterSimulation = useCallback(() => {
    if (isLocked) return;
    if (!gatePassed && recipeGateId) {
      setRecipeProgress({ recipeId: recipeGateId, passedVersion: recipeVersion, passedAt: null });
      if (canPersist) {
        saveRecipeProgress({ appId, uid: userId, recipeId: recipeGateId, passedVersion: recipeVersion }).catch((error) => {
          console.error('Failed to save recipe progress:', error);
        });
      }
    }
    if (!attemptStartedAtRef.current) {
      attemptStartedAtRef.current = Date.now();
    }
    lastLocalChangeRef.current = Date.now();
    enqueueProgressSave(firstPostInstructionStep);
    setActiveStep(firstPostInstructionStep);
  }, [gatePassed, recipeGateId, recipeVersion, canPersist, userId, isLocked, enqueueProgressSave, firstPostInstructionStep]);

  const updateActiveStep = useCallback(
    (stepKey) => {
      if (isLocked) return;
      if (!stepKey) return;
      lastLocalChangeRef.current = Date.now();
      enqueueProgressSave(stepKey);
      setActiveStep(stepKey);
    },
    [enqueueProgressSave, isLocked]
  );

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
    if (tieOutGateConfig && !tieOutPassed) {
      showModal('Complete the AP Aging C&A step before making selections.', 'C&A Required');
      return;
    }
    if (completenessGateConfig && !completenessPassed) {
      showModal('Complete the Disbursement Listing C&A step before making selections.', 'C&A Required');
      return;
    }
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
            currentWork.isException === false)
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

  const handleTieOutAssessmentSubmit = () => {
    if (!tieOutGateConfig) return;
    const options = Array.isArray(tieOutGateConfig.assessmentOptions)
      ? tieOutGateConfig.assessmentOptions
      : [];
    const selected = options.find((option) => option.id === tieOutSelectionId);
    if (!selected) {
      setTieOutAssessmentFeedback('Select a response before continuing.');
      return;
    }
    if (!tieOutDocsOpened) {
      setTieOutAssessmentFeedback('Review both documents before answering.');
      return;
    }
    if (!selected.correct) {
      markGateFailure('tieOut');
      setTieOutAssessmentFeedback(selected.feedback || 'Re-check the totals and try again.');
      return;
    }

    const outcome = selected.outcome || '';
    setTieOutAssessmentPassed(true);
    setTieOutAssessmentOutcome(outcome);
    setTieOutAssessmentFeedback(selected.feedback || '');

    const actionMode = tieOutGateConfig.actionMode === 'always' ? 'always' : 'mismatch';
    const requiresAction = actionMode === 'always' || outcome !== 'match';
    if (outcome === 'match' && !requiresAction) {
      const result = {
        passed: true,
        assessment: {
          selectedOptionId: selected.id,
          selectedOptionText: selected.text,
          outcome,
        },
        action: null,
        skillTag: tieOutGateConfig.skillTag || '',
      };
      setTieOutPassed(true);
      setTieOutGateResult(result);
      tieOutGateResultRef.current = result;
      lastLocalChangeRef.current = Date.now();
      enqueueProgressSave();
      return;
    }

    setTieOutNeedsAction(true);
  };

  const handleTieOutActionSubmit = () => {
    if (!tieOutGateConfig) return;
    const options = Array.isArray(tieOutGateConfig.actionOptions)
      ? tieOutGateConfig.actionOptions
      : Array.isArray(tieOutGateConfig.options)
      ? tieOutGateConfig.options
      : [];
    const selected = options.find((option) => option.id === tieOutActionSelectionId);
    if (!selected) {
      setTieOutActionFeedback('Select a response before continuing.');
      return;
    }
    if (!selected.correct) {
      markGateFailure('tieOut');
      setTieOutActionFeedback(selected.feedback || tieOutGateConfig.failureMessage || 'Try again.');
      return;
    }

    const outcome = tieOutAssessmentOutcome || 'mismatch';
    const result = {
      passed: true,
      assessment: {
        selectedOptionId: tieOutSelectionId,
        selectedOptionText:
          (tieOutGateConfig.assessmentOptions || []).find((opt) => opt.id === tieOutSelectionId)?.text || '',
        outcome,
      },
      action: {
        selectedOptionId: selected.id,
        selectedOptionText: selected.text,
      },
      skillTag: tieOutGateConfig.skillTag || '',
    };
    setTieOutPassed(true);
    setTieOutGateResult(result);
    tieOutGateResultRef.current = result;
    lastLocalChangeRef.current = Date.now();
    enqueueProgressSave();
    setTieOutActionFeedback(selected.feedback || tieOutGateConfig.successMessage || 'Correct.');
  };

  const handleCompletenessAssessmentSubmit = () => {
    if (!completenessGateConfig) return;
    const options = Array.isArray(completenessGateConfig.assessmentOptions)
      ? completenessGateConfig.assessmentOptions
      : [];
    const selected = options.find((option) => option.id === completenessSelectionId);
    if (!selected) {
      setCompletenessAssessmentFeedback('Select a response before continuing.');
      return;
    }
    if (!completenessDocsOpened) {
      setCompletenessAssessmentFeedback('Review both documents before answering.');
      return;
    }
    if (!selected.correct) {
      markGateFailure('completeness');
      setCompletenessAssessmentFeedback(selected.feedback || 'Re-check the population and try again.');
      return;
    }

    const outcome = selected.outcome || '';
    setCompletenessAssessmentPassed(true);
    setCompletenessAssessmentOutcome(outcome);
    setCompletenessAssessmentFeedback(selected.feedback || '');

    const actionMode = completenessGateConfig.actionMode === 'always' ? 'always' : 'mismatch';
    const requiresAction = actionMode === 'always' || outcome !== 'match';
    if (outcome === 'match' && !requiresAction) {
      const result = {
        passed: true,
        assessment: {
          selectedOptionId: selected.id,
          selectedOptionText: selected.text,
          outcome,
        },
        action: null,
        skillTag: completenessGateConfig.skillTag || '',
      };
      setCompletenessPassed(true);
      setCompletenessGateResult(result);
      completenessGateResultRef.current = result;
      lastLocalChangeRef.current = Date.now();
      enqueueProgressSave();
      return;
    }

    setCompletenessNeedsAction(true);
  };

  const handleCompletenessActionSubmit = () => {
    if (!completenessGateConfig) return;
    const options = Array.isArray(completenessGateConfig.actionOptions)
      ? completenessGateConfig.actionOptions
      : Array.isArray(completenessGateConfig.options)
      ? completenessGateConfig.options
      : [];
    const selected = options.find((option) => option.id === completenessActionSelectionId);
    if (!selected) {
      setCompletenessActionFeedback('Select a response before continuing.');
      return;
    }
    if (!selected.correct) {
      markGateFailure('completeness');
      setCompletenessActionFeedback(selected.feedback || completenessGateConfig.failureMessage || 'Try again.');
      return;
    }

    const outcome = completenessAssessmentOutcome || 'mismatch';
    const result = {
      passed: true,
      assessment: {
        selectedOptionId: completenessSelectionId,
        selectedOptionText:
          (completenessGateConfig.assessmentOptions || []).find((opt) => opt.id === completenessSelectionId)?.text || '',
        outcome,
      },
      action: {
        selectedOptionId: selected.id,
        selectedOptionText: selected.text,
      },
      skillTag: completenessGateConfig.skillTag || '',
    };
    setCompletenessPassed(true);
    setCompletenessGateResult(result);
    completenessGateResultRef.current = result;
    lastLocalChangeRef.current = Date.now();
    enqueueProgressSave();
    setCompletenessActionFeedback(selected.feedback || completenessGateConfig.successMessage || 'Correct.');
  };

  const handleAllocationChange = (paymentId, fieldKey, value) => {
    if (isLocked) return;
    const normalizedId = normalizePaymentId(paymentId);
    if (!normalizedId) return;
    lastLocalChangeRef.current = Date.now();

    let finalValue;
    // Keep raw value for these specific, non-numeric fields
    if (['mode', 'singleClassification'].includes(fieldKey)) {
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
    if (tieOutGateConfig && !tieOutPassed) {
      showModal('Complete the AP Aging C&A check before selecting items to test.', 'C&A Required');
      return;
    }
    if (completenessGateConfig && !completenessPassed) {
      showModal('Complete the Disbursement Listing C&A check before selecting items to test.', 'C&A Required');
      return;
    }
    if (selectedIds.length === 0) {
      showModal('Please select at least one disbursement to continue.', 'No Selection');
      return;
    }
    if (selectionScopeConfig) {
      if (missingRequiredIds.length > 0) {
        markGateFailure('selection');
        showModal(
          `Selection missing one or more disbursements above ${currencyFormatter.format(scopeThreshold)}.`,
          'Selection Gate'
        );
        return;
      }
      setSelectionGateResult({
        requiredIds: requiredSelectionIds,
        missingRequiredIds,
        thresholdAmount: scopeThreshold,
        performanceMateriality: Number(selectionScopeConfig?.performanceMateriality || 0),
        scopePercent: Number(selectionScopeConfig?.scopePercent || 0),
        requiredMet: true,
      });
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
    if (!caseData || selectedIds.length === 0) return;

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
    const attemptSummary = computeDisbursementAttemptSummary({
      disbursements: disbursementList,
      studentAnswers: allocationPayload,
    });
    const startedAtMs = attemptStartedAtRef.current;
    const timeToCompleteSeconds =
      startedAtMs ? Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)) : null;
    const requiredDocsOpened =
      (!tieOutGateConfig || tieOutDocsOpened) && (!completenessGateConfig || completenessDocsOpened);
    const gateFailuresSnapshot = gateFailuresRef.current;
    const gatesFirstAttempt =
      !gateFailuresSnapshot.instruction &&
      !gateFailuresSnapshot.tieOut &&
      !gateFailuresSnapshot.completeness &&
      !gateFailuresSnapshot.selection;
    const instructionGatePassed = gateRequired ? gatePassed : true;
    const tieOutGatePassed = !tieOutGateConfig || tieOutGateResult?.passed;
    const completenessGatePassed = !completenessGateConfig || completenessGateResult?.passed;
    const selectionGatePassed = !selectionScopeConfig || selectionGateResult?.requiredMet;
    const gatesPassed = instructionGatePassed && tieOutGatePassed && completenessGatePassed && selectionGatePassed;
    const allClassificationsCorrect = selectedDisbursementDetails.every((disbursement) =>
      isClassificationCorrect(disbursement, allocationPayload[disbursement.paymentId])
    );
    const hasSuccessfulAttempt = gatesFirstAttempt && gatesPassed && allClassificationsCorrect;
    setModulePassed(hasSuccessfulAttempt);

    if (isDemo || isDemoCase) {
      trackAnalyticsEvent({
        eventType: 'demo_submitted',
        metadata: { caseId, passed: hasSuccessfulAttempt },
      });
    }

    if (!canPersist) {
      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }
      setIsLocked(true);
      setActiveStep(FLOW_STEPS.RESULTS);
      showModal('Demo complete. Create an account to save your results and unlock more cases.', 'Demo Complete');
      return;
    }

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
        surlGateResults: {
          tieOut: tieOutGateResult,
          completeness: completenessGateResult,
          selection: selectionGateResult,
        },
        attemptSummary: {
          ...attemptSummary,
          requiredDocsOpened,
          timeToCompleteSeconds,
        },
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
            gateFailures: gateFailuresRef.current,
          },
          hasSuccessfulAttempt,
        },
        clearActiveAttempt: true,
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
  if (hasPendingGeneration || hasMissingCashArtifacts) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-12">
        <div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-amber-900">Case is still generating</h1>
          <p className="mt-3 text-sm text-amber-900/80">
            This case is still finishing its documents. Please wait a few minutes and try again.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button variant="secondary" onClick={() => navigate('/trainee')}>
              Return to Dashboard
            </Button>
            <Button onClick={() => window.location.reload()}>
              Refresh
            </Button>
          </div>
        </div>
      </div>
    );
  }

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

  if (isFixedAssetCase) {
    return (
      <FixedAssetTestingModule
        caseId={caseId}
        caseData={caseData}
        userId={userId}
        navigate={navigate}
        showModal={showModal}
      />
    );
  }

  const stepIndex = workflowSteps.indexOf(activeStep);

  const renderStepper = () => (
    <ol className="flex flex-col gap-3 md:flex-row md:items-stretch md:justify-between rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-4 py-4 shadow-sm">
      {workflowSteps.map((stepKey, idx) => {
        const isCompleted = furthestStepIndex > idx;
        const isActive = stepIndex === idx;
        const canNavigate = idx <= furthestStepIndex;
        return (
          <li key={stepKey} className="flex items-center space-x-3 md:flex-1">
            <button
              type="button"
              onClick={() => {
                if (!canNavigate) return;
                if (activeStep === stepKey) return;
                updateActiveStep(stepKey);
              }}
              className={`flex items-center space-x-3 text-left ${
                canNavigate ? 'cursor-pointer' : 'cursor-not-allowed'
              }`}
              disabled={!canNavigate}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
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
    const referenceKey = getReferenceKey(doc);
    const hasLink = Boolean(doc.storagePath || doc.downloadURL);
    if (!hasLink) {
      const message =
        doc.generationSpec || doc.generationSpecId
          ? 'This reference document is still generating. Please try again in a moment.'
          : 'Reference document is missing a download link.';
      showModal(message, 'Reference Unavailable');
      return;
    }
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
    const apAgingBannerMessage = apAgingDoc
      ? 'AP Aging is embedded at the bottom of this screen. Refer to it as you classify.'
      : 'Use these documents to complete the audit procedures. Download and keep them open while you classify.';
    const filteredDocuments = referenceDocuments.filter((doc) => {
      const templateId =
        typeof doc?.generationSpec?.templateId === 'string'
          ? doc.generationSpec.templateId.toLowerCase()
          : '';
      const fileName = String(doc?.fileName || '').toLowerCase();
      if (templateId === 'refdoc.ap-aging.v1' || templateId === 'refdoc.ap-leadsheet.v1') return false;
      if (fileName.includes('ap aging') || fileName.includes('ap lead schedule')) return false;
      return true;
    });

    if (filteredDocuments.length === 0) {
      return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          {apAgingDoc ? apAgingBannerMessage : 'Reference materials will appear here when provided by your instructor.'}
        </div>
      );
    }

    const bannerClasses = 'border-blue-200 bg-blue-50';
    const titleClasses = 'text-blue-700';
    const bodyClasses = 'text-blue-900';
    const bannerMessage = apAgingBannerMessage;

    return (
      <div className={`rounded-xl border px-4 py-3 shadow-sm ${bannerClasses}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className={`text-xs font-semibold uppercase tracking-wide ${titleClasses}`}>Reference Materials</p>
            <p className={`text-sm ${bodyClasses}`}>{bannerMessage}</p>
          </div>
          <div className="flex w-full flex-wrap gap-3 sm:w-auto">
            {filteredDocuments.map((doc) => {
              const referenceKey = getReferenceKey(doc);
              const isOpened = referenceKey ? openedReferenceDocs.has(referenceKey) : false;
              const hasLink = Boolean(doc.storagePath || doc.downloadURL);
              const isPending = doc.pending || (!hasLink && (doc.generationSpec || doc.generationSpecId));
              return (
              <Button
                  key={doc.id}
                  variant="secondary"
                  className={`text-xs px-4 py-2 border ${
                    isOpened ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-700'
                  } hover:bg-white w-[260px]`}
                  onClick={() => handleDownloadReferenceDoc(doc)}
                  isLoading={downloadingReferenceId === doc.id}
                  disabled={!hasLink || (downloadingReferenceId && downloadingReferenceId !== doc.id)}
                  title={isPending ? 'Document is generating' : doc.fileName}
                >
                  <Download size={14} className="inline mr-2" />
                  <span className="truncate inline-block align-middle">
                    {doc.fileName || 'Reference'}
                    {isPending ? ' (Generating)' : ''}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const getStepNumber = (stepKey) => {
    const idx = workflowSteps.indexOf(stepKey);
    return idx >= 0 ? idx + 1 : null;
  };

  const renderInstructionStep = () => {
    if (!caseData?.instruction) {
      return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-2xl font-semibold text-slate-900">
            Step {getStepNumber(FLOW_STEPS.INSTRUCTION) || 1} — Instruction
          </h2>
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
          <h2 className="text-2xl font-semibold text-slate-900">
            Step {getStepNumber(FLOW_STEPS.INSTRUCTION) || 1} — Instruction
          </h2>
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
          className="w-full"
          gateRequired={gateRequired}
          onStartSimulation={handleEnterSimulation}
          onGateAttempt={({ correct }) => {
            if (!correct) markGateFailure('instruction');
          }}
        />
      </div>
    );
  };

  const renderCaCheckStep = () => {
    if (!tieOutGateConfig) {
      return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">
            Step {getStepNumber(FLOW_STEPS.CA_CHECK) || 2} — AP Aging C&amp;A
          </h2>
          <p className="text-sm text-slate-600">
            This case does not include a tie-out gate. Continue to selection.
          </p>
        </div>
          <div className="flex justify-end">
            <Button
              onClick={() =>
                updateActiveStep(
                  completenessGateConfig && !completenessPassed
                    ? FLOW_STEPS.CA_COMPLETENESS
                    : FLOW_STEPS.SELECTION
                )
              }
            >
              {completenessGateConfig && !completenessPassed
                ? 'Continue to Disbursement Listing C&A'
                : 'Continue to Selection'}
            </Button>
          </div>
        </div>
      );
    }

    const tieOutDocs =
      tieOutReferenceDocuments.length > 0 ? tieOutReferenceDocuments : referenceDocuments;
    const assessmentOptions = Array.isArray(tieOutGateConfig?.assessmentOptions)
      ? tieOutGateConfig.assessmentOptions
      : [
          { id: 'assess_yes', text: 'Yes, they tie out.', correct: false, outcome: 'match' },
          { id: 'assess_no', text: 'No, they do not tie out.', correct: true, outcome: 'mismatch' },
        ];
    const actionOptions = Array.isArray(tieOutGateConfig?.actionOptions)
      ? tieOutGateConfig.actionOptions
      : Array.isArray(tieOutGateConfig?.options)
      ? tieOutGateConfig.options
      : [];
    const tieOutFeedback = tieOutAssessmentFeedback;
    const stepTitle = tieOutGateConfig?.stepTitle || 'AP Aging C&A';
    const stepDescription =
      tieOutGateConfig?.description ||
      'Review the AP aging and the ledger, then determine whether the totals tie before you select items to test.';
    const evidenceTitle = tieOutGateConfig?.evidenceTitle || 'AP Aging Evidence';
    const evidenceDescription =
      tieOutGateConfig?.evidenceDescription || 'Review the AP aging and the AP ledger in parallel.';
    const passedMessage =
      tieOutGateConfig?.passedMessage || 'Tie-out cleared. Use the corrected population for your selections.';
    const nextStepKey =
      completenessGateConfig && !completenessPassed ? FLOW_STEPS.CA_COMPLETENESS : FLOW_STEPS.SELECTION;
    const nextStepLabel =
      nextStepKey === FLOW_STEPS.CA_COMPLETENESS
        ? 'Continue to Disbursement Listing C&A'
        : 'Continue to Selection';

    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">
            Step {getStepNumber(FLOW_STEPS.CA_CHECK) || 2} — {stepTitle}
          </h2>
          <p className="text-sm text-slate-600">
            {stepDescription}
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-amber-900">{evidenceTitle}</h3>
            <p className="text-sm text-amber-800">
              {evidenceDescription}
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {tieOutDocs.map((doc) => {
              const view = tieOutDocViews[doc.id] || {};
              const previewUrl = view.url || doc.downloadURL || '';
              const previewError = view.error || '';
              const previewLoading = view.loading || false;
              const hasLink = Boolean(doc.storagePath || doc.downloadURL);
              const isPending = doc.pending || (!hasLink && (doc.generationSpec || doc.generationSpecId));
              const canPreview = isInlinePreviewable(doc.contentType, doc.fileName || previewUrl);
              return (
                <div key={doc.id} className="bg-white border border-amber-200 rounded-lg overflow-hidden shadow-sm">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-amber-200 bg-amber-50">
                    <div className="text-xs font-semibold text-amber-900 truncate">{doc.fileName || 'Reference'}</div>
                    <Button
                      variant="secondary"
                      className="text-xs px-2 py-1"
                      onClick={() => handleDownloadReferenceDoc(doc)}
                      isLoading={downloadingReferenceId === doc.id}
                      disabled={!hasLink || (downloadingReferenceId && downloadingReferenceId !== doc.id)}
                    >
                      <ExternalLink size={12} className="inline mr-1" /> Open
                    </Button>
                  </div>
                  <div className="bg-white">
                    {previewLoading ? (
                      <div className="flex flex-col items-center justify-center text-amber-700 h-[320px]">
                        <Loader2 size={24} className="animate-spin mb-2" />
                        <p className="text-xs">Loading document…</p>
                      </div>
                    ) : isPending ? (
                      <div className="flex flex-col items-center justify-center text-amber-800 h-[320px]">
                        <p className="text-xs font-semibold">Document is generating…</p>
                        <p className="text-[11px] text-amber-700">This will appear once processing finishes.</p>
                      </div>
                    ) : previewError ? (
                      <div className="px-4 py-6 text-xs text-amber-800">{previewError}</div>
                    ) : canPreview && previewUrl ? (
                      <iframe
                        title={doc.fileName || 'Reference document'}
                        src={previewUrl}
                        className="w-full h-[320px] md:h-[360px] xl:h-[380px]"
                      />
                    ) : (
                      <div className="px-4 py-6 text-xs text-amber-800">
                        Preview not available. Use “Open” to view this document.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!tieOutPassed ? (
            <div className="space-y-3">
              {!tieOutAssessmentPassed ? (
                <>
                  <p className="text-sm font-semibold text-amber-900">
                    {tieOutGateConfig?.assessmentQuestion || 'Do the AP aging and AP ledger totals tie out?'}
                  </p>
                  <div className="space-y-2">
                    {assessmentOptions.map((option) => (
                      <label key={option.id} className="flex items-start gap-3 text-sm text-amber-900">
                        <input
                          type="radio"
                          name="tie-out-assessment"
                          value={option.id}
                          checked={tieOutSelectionId === option.id}
                          onChange={() => {
                            setTieOutSelectionId(option.id);
                            setTieOutAssessmentFeedback('');
                            setTieOutActionSelectionId('');
                            setTieOutActionFeedback('');
                            setTieOutAssessmentPassed(false);
                            setTieOutAssessmentOutcome('');
                            setTieOutNeedsAction(false);
                          }}
                          className="mt-1"
                        />
                        <span>{option.text}</span>
                      </label>
                    ))}
                  </div>
                  {tieOutFeedback ? (
                    <div className="text-sm text-amber-800">{tieOutFeedback}</div>
                  ) : null}
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={handleTieOutAssessmentSubmit}>
                      Submit Tie-Out Assessment
                    </Button>
                    {!tieOutDocsOpened ? (
                      <span className="text-xs text-amber-700">Review both documents before answering.</span>
                    ) : null}
                  </div>
                </>
              ) : tieOutNeedsAction ? (
                <>
                  <p className="text-sm font-semibold text-amber-900">
                    {tieOutGateConfig?.actionQuestion ||
                      'You indicated the reports do not tie. What is the best next step?'}
                  </p>
                  <div className="space-y-2">
                    {actionOptions.map((option) => (
                      <label key={option.id} className="flex items-start gap-3 text-sm text-amber-900">
                        <input
                          type="radio"
                          name="tie-out-action"
                          value={option.id}
                          checked={tieOutActionSelectionId === option.id}
                          onChange={() => {
                            setTieOutActionSelectionId(option.id);
                            setTieOutActionFeedback('');
                          }}
                          className="mt-1"
                        />
                        <span>{option.text}</span>
                      </label>
                    ))}
                  </div>
                  {tieOutActionFeedback ? (
                    <div className="text-sm text-amber-800">{tieOutActionFeedback}</div>
                  ) : null}
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={handleTieOutActionSubmit}>
                      Submit Next Step
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-emerald-700 font-semibold">
                {passedMessage}
              </div>
              <Button onClick={() => updateActiveStep(nextStepKey)}>
                {nextStepLabel}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCompletenessStep = () => {
    if (!completenessGateConfig) {
      return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <div>
          <h2 className="text-2xl font-semibold text-slate-900">
            Step {getStepNumber(FLOW_STEPS.CA_COMPLETENESS) || 2} — Disbursement Listing C&amp;A
          </h2>
            <p className="text-sm text-slate-600">
              This case does not include a completeness gate. Continue to selection.
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => updateActiveStep(FLOW_STEPS.SELECTION)}>
              Continue to Selection
            </Button>
          </div>
        </div>
      );
    }

    const completenessDocs =
      completenessReferenceDocuments.length > 0 ? completenessReferenceDocuments : referenceDocuments;
    const assessmentOptions = Array.isArray(completenessGateConfig?.assessmentOptions)
      ? completenessGateConfig.assessmentOptions
      : [];
    const actionOptions = Array.isArray(completenessGateConfig?.actionOptions)
      ? completenessGateConfig.actionOptions
      : Array.isArray(completenessGateConfig?.options)
      ? completenessGateConfig.options
      : [];
    const completenessFeedback = completenessAssessmentFeedback;
    const stepTitle = completenessGateConfig?.stepTitle || 'Disbursement Listing C&A';
    const stepDescription =
      completenessGateConfig?.description ||
      'Validate the January disbursement listing before selecting items to test.';
    const evidenceTitle = completenessGateConfig?.evidenceTitle || 'Disbursement Listing Evidence';
    const evidenceDescription =
      completenessGateConfig?.evidenceDescription ||
      'Compare the disbursement listing to the bank statement.';
    const passedMessage =
      completenessGateConfig?.passedMessage ||
      'Disbursement listing check cleared. Use the corrected population for your selections.';

    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">
            Step {getStepNumber(FLOW_STEPS.CA_COMPLETENESS) || 2} — {stepTitle}
          </h2>
          <p className="text-sm text-slate-600">{stepDescription}</p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-amber-900">{evidenceTitle}</h3>
            <p className="text-sm text-amber-800">{evidenceDescription}</p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {completenessDocs.map((doc) => {
              const view = completenessDocViews[doc.id] || {};
              const previewUrl = view.url || doc.downloadURL || '';
              const previewError = view.error || '';
              const previewLoading = view.loading || false;
              const hasLink = Boolean(doc.storagePath || doc.downloadURL);
              const isPending = doc.pending || (!hasLink && (doc.generationSpec || doc.generationSpecId));
              const canPreview = isInlinePreviewable(doc.contentType, doc.fileName || previewUrl);
              return (
                <div key={doc.id} className="bg-white border border-amber-200 rounded-lg overflow-hidden shadow-sm">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-amber-200 bg-amber-50">
                    <div className="text-xs font-semibold text-amber-900 truncate">{doc.fileName || 'Reference'}</div>
                    <Button
                      variant="secondary"
                      className="text-xs px-2 py-1"
                      onClick={() => handleDownloadReferenceDoc(doc)}
                      isLoading={downloadingReferenceId === doc.id}
                      disabled={!hasLink || (downloadingReferenceId && downloadingReferenceId !== doc.id)}
                    >
                      <ExternalLink size={12} className="inline mr-1" /> Open
                    </Button>
                  </div>
                  <div className="bg-white">
                    {previewLoading ? (
                      <div className="flex flex-col items-center justify-center text-amber-700 h-[320px]">
                        <Loader2 size={24} className="animate-spin mb-2" />
                        <p className="text-xs">Loading document…</p>
                      </div>
                    ) : isPending ? (
                      <div className="flex flex-col items-center justify-center text-amber-800 h-[320px]">
                        <p className="text-xs font-semibold">Document is generating…</p>
                        <p className="text-[11px] text-amber-700">This will appear once processing finishes.</p>
                      </div>
                    ) : previewError ? (
                      <div className="px-4 py-6 text-xs text-amber-800">{previewError}</div>
                    ) : canPreview && previewUrl ? (
                      <iframe
                        title={doc.fileName || 'Reference document'}
                        src={previewUrl}
                        className="w-full h-[320px] md:h-[360px] xl:h-[380px]"
                      />
                    ) : (
                      <div className="px-4 py-6 text-xs text-amber-800">
                        Preview not available. Use “Open” to view this document.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!completenessPassed ? (
            <div className="space-y-3">
              {!completenessAssessmentPassed ? (
                <>
                  <p className="text-sm font-semibold text-amber-900">
                    {completenessGateConfig?.assessmentQuestion ||
                      'Does the January disbursement listing appear complete?'}
                  </p>
                  <div className="space-y-2">
                    {assessmentOptions.map((option) => (
                      <label key={option.id} className="flex items-start gap-3 text-sm text-amber-900">
                        <input
                          type="radio"
                          name="completeness-assessment"
                          value={option.id}
                          checked={completenessSelectionId === option.id}
                          onChange={() => {
                            setCompletenessSelectionId(option.id);
                            setCompletenessAssessmentFeedback('');
                            setCompletenessActionSelectionId('');
                            setCompletenessActionFeedback('');
                            setCompletenessAssessmentPassed(false);
                            setCompletenessAssessmentOutcome('');
                            setCompletenessNeedsAction(false);
                          }}
                          className="mt-1"
                        />
                        <span>{option.text}</span>
                      </label>
                    ))}
                  </div>
                  {completenessFeedback ? (
                    <div className="text-sm text-amber-800">{completenessFeedback}</div>
                  ) : null}
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={handleCompletenessAssessmentSubmit}>
                      Submit C&A Assessment
                    </Button>
                    {!completenessDocsOpened ? (
                      <span className="text-xs text-amber-700">Review both documents before answering.</span>
                    ) : null}
                  </div>
                </>
              ) : completenessNeedsAction ? (
                <>
                  <p className="text-sm font-semibold text-amber-900">
                    {completenessGateConfig?.actionQuestion ||
                      'You indicated the population is incomplete. What is the best next step?'}
                  </p>
                  <div className="space-y-2">
                    {actionOptions.map((option) => (
                      <label key={option.id} className="flex items-start gap-3 text-sm text-amber-900">
                        <input
                          type="radio"
                          name="completeness-action"
                          value={option.id}
                          checked={completenessActionSelectionId === option.id}
                          onChange={() => {
                            setCompletenessActionSelectionId(option.id);
                            setCompletenessActionFeedback('');
                          }}
                          className="mt-1"
                        />
                        <span>{option.text}</span>
                      </label>
                    ))}
                  </div>
                  {completenessActionFeedback ? (
                    <div className="text-sm text-amber-800">{completenessActionFeedback}</div>
                  ) : null}
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={handleCompletenessActionSubmit}>
                      Submit Next Step
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-emerald-700 font-semibold">
                {passedMessage}
              </div>
              <Button onClick={() => updateActiveStep(FLOW_STEPS.SELECTION)}>
                Continue to Selection
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSelectionStep = () => (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">
          Step {getStepNumber(FLOW_STEPS.SELECTION) || 2} — Select Disbursements
        </h2>
        <p className="text-sm text-slate-500">
          Choose which disbursements you want to test. You will review supporting documents on the next step.
        </p>
      </div>

      {selectionScopeConfig ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Selection Scope</h3>
              <p className="text-sm text-slate-600">
                Select every disbursement at or above the threshold.
              </p>
            </div>
            <div className="text-sm text-slate-700 font-semibold">
              Threshold: {currencyFormatter.format(scopeThreshold || 0)} (
              {Math.round(Number(selectionScopeConfig?.scopePercent || 0) * 100)}% of PM)
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 text-sm text-slate-700">
            <div>
              <span className="font-semibold">Performance materiality:</span>{' '}
              {currencyFormatter.format(Number(selectionScopeConfig?.performanceMateriality || 0))}
            </div>
          </div>
        </div>
      ) : null}

      {tieOutGateConfig && !tieOutPassed ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>Complete the AP Aging C&amp;A step before selecting disbursements.</span>
          <Button variant="secondary" onClick={() => updateActiveStep(FLOW_STEPS.CA_CHECK)}>
            Return to AP Aging C&amp;A
          </Button>
        </div>
      ) : null}
      {completenessGateConfig && tieOutPassed && !completenessPassed ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>Complete the Disbursement Listing C&amp;A step before selecting disbursements.</span>
          <Button variant="secondary" onClick={() => updateActiveStep(FLOW_STEPS.CA_COMPLETENESS)}>
            Return to Disbursement Listing C&amp;A
          </Button>
        </div>
      ) : null}
      {selectionScopeConfig?.lockOnPass && selectionGateResult?.requiredMet ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Selection locked after passing the scope gate. Continue to testing to classify your selections.
        </div>
      ) : null}

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
            const selectionLocked =
              (tieOutGateConfig && !tieOutPassed) ||
              (completenessGateConfig && !completenessPassed) ||
              (selectionScopeConfig?.lockOnPass && selectionGateResult?.requiredMet);
            const disabled = isLocked || hasPendingGeneration || !paymentId || selectionLocked;
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
        <Button
          onClick={goToTestingStep}
          disabled={
            selectedIds.length === 0 ||
            isLocked ||
            hasPendingGeneration ||
            (tieOutGateConfig && !tieOutPassed) ||
            (completenessGateConfig && !completenessPassed)
          }
        >
          Continue to Classification
        </Button>
      </div>
    </div>
  );

  const renderTestingStep = () => {
    const missingDocuments = selectedEvidenceItems.filter((item) => !item?.hasLinkedDocument);
    const missingPaymentIds = Array.from(new Set(missingDocuments.map((item) => item?.paymentId || 'Unknown ID'))); 
  const canMakeDecision = true;

    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">
                Step {getStepNumber(FLOW_STEPS.TESTING) || 3} — Classify Results
              </h2>
              <p className="text-sm text-slate-600">
                Review the supporting documents and allocate the disbursement amount across each classification category.
              </p>
            </div>

            <div className="flex items-center gap-3 sm:pt-1">
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
              <Button variant="secondary" onClick={() => updateActiveStep(FLOW_STEPS.SELECTION)}>
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
                  <div className="mb-4" />
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
                                  onRationaleChange={handleRationaleChange}
                                  canMakeDecision={canMakeDecision}
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
                  <Button variant="secondary" onClick={() => updateActiveStep(FLOW_STEPS.SELECTION)} disabled={isLocked}>
                    Back to Selection
                  </Button>
                  <Button onClick={handleSubmitTesting} disabled={!allClassified || isLocked}>
                    <Send size={18} className="inline mr-2" /> Submit Responses
                  </Button>
                </div>
              </div>
            </div>
            {apAgingDoc ? (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">AP Aging Reference</h3>
                    <p className="text-xs text-slate-500">Review the AP aging summary while you classify.</p>
                  </div>
                  <Button
                    variant="secondary"
                    className="text-xs px-3 py-1"
                    onClick={() => handleDownloadReferenceDoc(apAgingDoc)}
                  >
                    <ExternalLink size={14} className="inline mr-1" /> Open in new tab
                  </Button>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                  {apAgingPreviewLoading ? (
                    <div className="flex flex-col items-center justify-center text-slate-500 h-[320px]">
                      <Loader2 size={24} className="animate-spin mb-2" />
                      <p className="text-sm">Loading AP aging…</p>
                    </div>
                  ) : apAgingPreviewError ? (
                    <div className="px-4 py-6 text-sm text-amber-700">{apAgingPreviewError}</div>
                  ) : apAgingPreviewUrl ? (
                    <iframe
                      title="AP Aging Summary"
                      src={apAgingPreviewUrl}
                      className="w-full h-[360px] md:h-[420px] lg:h-[480px]"
                    />
                  ) : (
                    <div className="px-4 py-6 text-sm text-slate-500">
                      AP aging preview is not available yet.
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  };

  const renderResultsStep = () => {
    const resultsDisbursements = caseWithKeys?.disbursements || disbursementList;
    const completionSummary = computeDisbursementAttemptSummary({
      disbursements: resultsDisbursements,
      studentAnswers: classificationAmounts,
    });
    const requiredSelectionIds = new Set(
      Array.isArray(selectionGateResult?.requiredIds) ? selectionGateResult.requiredIds : []
    );
    const criticalIssueDetails = [];
    resultsDisbursements.forEach((item) => {
      if (!item?.shouldFlag || criticalIssueDetails.length >= 3) return;
      if (requiredSelectionIds.size > 0 && !requiredSelectionIds.has(item.paymentId)) return;
      const allocation = classificationAmounts[item.paymentId] || null;
      const expectedKey = getExpectedClassificationKey(item);
      const expectedLabel = CLASSIFICATION_LABELS[expectedKey] || 'Exception';
      const studentKey = getPrimaryClassificationKey(allocation);
      const studentLabel = CLASSIFICATION_LABELS[studentKey] || 'Pass';
      if (!allocation?.isException) {
        criticalIssueDetails.push(`Missed exception: ${formatDisbursementLabel(item, currencyFormatter)}.`);
        return;
      }
      if (expectedKey && studentKey && expectedKey !== studentKey) {
        criticalIssueDetails.push(
          `Wrong classification: ${formatDisbursementLabel(item, currencyFormatter)} should be ${expectedLabel} (you marked ${studentLabel}).`
        );
      }
    });
    const gateFailuresList = Object.entries(gateFailures)
      .filter(([, value]) => value)
      .map(([key]) => {
        if (key === 'instruction') return 'Instruction gate missed';
        if (key === 'tieOut') return 'AP aging tie-out gate missed';
        if (key === 'completeness') return 'Completeness gate missed';
        if (key === 'selection') return 'Selection gate missed';
        return 'Gate missed';
      });
    const criticalIssues = criticalIssueDetails.length;
    const falsePositives = Number(completionSummary.falsePositivesCount || 0);
    const reasons = [
      ...gateFailuresList,
      ...(criticalIssues > 0
        ? [`${criticalIssues} critical ${criticalIssues === 1 ? 'issue' : 'issues'} in testing`]
        : []),
      ...(falsePositives > 0
        ? [`${falsePositives} false ${falsePositives === 1 ? 'positive' : 'positives'}`]
        : []),
    ];
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          {(isDemo || isDemoCase) ? (
            <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-blue-900">Demo complete</div>
                  <div className="text-sm text-blue-800">
                    Unlock full access to run the complete simulator and track mastery.
                  </div>
                </div>
                <Button
                  onClick={() => {
                    trackAnalyticsEvent({ eventType: 'upgrade_clicked', metadata: { source: 'demo_results' } });
                    navigate('/checkout?plan=individual');
                  }}
                >
                  Unlock full access
                </Button>
              </div>
            </div>
          ) : null}
          {modulePassed === false ? (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-semibold">Module not complete yet — this case is complete.</div>
              <div className="mt-1">
                You finished this case, but module completion requires a clean run with no critical misses.
              </div>
              <div className="mt-2 font-semibold">What needs improvement:</div>
              <div className="mt-1">
                {criticalIssueDetails.length > 0 ? (
                  <div className="space-y-1">
                    {criticalIssueDetails.map((detail) => (
                      <div key={detail}>{detail}</div>
                    ))}
                  </div>
                ) : reasons.length > 0 ? (
                  reasons.join(' • ')
                ) : (
                  'Review the results below and try a new case to demonstrate mastery.'
                )}
              </div>
              {caseData?.moduleId && !isDemo && !isDemoCase ? (
                <div className="mt-3">
                  <Button onClick={generateNewCase}>Start a new case with fresh documents</Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900">Audit Completion Report</h1>
            <p className="text-slate-600">Review your performance against the Virtual Senior&apos;s expectations.</p>
          </div>
          
          <ResultsAnalysis 
            disbursements={resultsDisbursements} 
            studentAnswers={classificationAmounts} 
            gateResults={{
              tieOut: tieOutGateResult,
              completeness: completenessGateResult,
              selection: selectionGateResult,
            }}
            referenceDocuments={referenceDocuments}
            onRequestRetake={!isDemo && !isDemoCase ? requestRetake : undefined}
            onGenerateNewCase={caseData?.moduleId && !isDemo && !isDemoCase ? generateNewCase : undefined}
            onReturnToDashboard={() => navigate(isDemo || isDemoCase ? '/' : '/trainee')}
          />
        </div>

        {!isDemo && !isDemoCase ? (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              onClick={() => navigate('/trainee')}
            >
              Return to Dashboard
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  let stepContent = null;
  if (activeStep === FLOW_STEPS.INSTRUCTION) {
    stepContent = renderInstructionStep();
  } else if (activeStep === FLOW_STEPS.CA_CHECK) {
    stepContent = renderCaCheckStep();
  } else if (activeStep === FLOW_STEPS.CA_COMPLETENESS) {
    stepContent = renderCompletenessStep();
  } else if (activeStep === FLOW_STEPS.SELECTION) {
    stepContent = renderSelectionStep();
  } else if (activeStep === FLOW_STEPS.TESTING) {
    stepContent = renderTestingStep();
  } else {
    stepContent = renderResultsStep();
  }

  return (
    <div className="bg-gray-50 min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="w-full max-w-[1600px] 2xl:max-w-[1800px] mx-auto space-y-6">
        {renderStepper()}
        {stepContent}
      </div>
    </div>
  );
}
