import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, useAuth, useRoute, useModal, appId, storage } from '../AppCore';
import { fetchCase, createCase, markCaseDeleted, fetchCasesPage } from '../services/caseService';
import { fetchUserRosterOptions, getCurrentUserOrgId } from '../services/userService';
import getUUID from '../utils/getUUID';
import {
  AUDIT_AREA_VALUES,
  CASE_GROUP_VALUES,
  DEFAULT_AUDIT_AREA,
  AUDIT_AREA_LABELS,
  CASE_GROUP_LABELS,
  AUDIT_AREAS,
} from '../models/caseConstants';
import { CASH_ARTIFACT_TYPES, STATUS_OPTIONS, WORKPAPER_LAYOUT_OPTIONS } from '../constants/caseFormOptions';
import { getClassificationFields } from '../constants/classificationFields';
import {
  ANSWER_KEY_LABELS,
  ANSWER_KEY_PLACEHOLDER,
  DEFAULT_ANSWER_KEY_CLASSIFICATION,
  buildSingleAnswerKey,
  detectAnswerKeyMode,
  extractAnswerKeyMeta,
} from '../utils/caseFormHelpers';
import {
  initialDisbursement,
  initialOutstandingItem,
  initialCutoffItem,
  initialCashRegisterItem,
  initialReconciliationMap,
  initialInstruction,
  initialMapping,
  initialReferenceDocument,
  initialFaClass,
  initialFaAddition,
  initialFaDisposal,
  initialCashContext,
  initialHighlightedDocument,
} from '../constants/caseFormDefaults';
import { FILE_INPUT_ACCEPT, prettySupportedLabels } from '../utils/caseFileHelpers';
import { useUser } from '../AppCore';
import { createCaseFormUploadHandlers } from './useCaseFormUploads';
import { createCaseFormCsvImportHandler } from './useCaseFormCsvImport';
import { createCaseFormSubmitHandler } from './useCaseFormSubmit';
import {
  fetchCaseGenerationPlan,
  queueCaseGenerationJob,
  saveCaseGenerationPlan,
  generateCaseDraft as generateCaseDraftFromServer,
} from '../services/caseGenerationService';
import { listCaseRecipes } from '../generation/recipeRegistry';
import { ANALYTICS_EVENTS, trackAnalyticsEvent } from '../services/analyticsService';

const DEBUG_LOGS = process.env.REACT_APP_DEBUG_LOGS === 'true';

const DRAFT_STORAGE_KEY = 'audit_sim_case_draft_v1';
const DEFAULT_LAYOUT_TYPE = 'two_pane';
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120000;
const CASE_LEVEL_OPTIONS = [
  { value: 'basic', label: 'Basic' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];
const CASE_LEVEL_VALUES = CASE_LEVEL_OPTIONS.map((option) => option.value);

const canUseLocalStorage = () => {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
};

const normalizeCashArtifactType = (value) => {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  return trimmed.startsWith('cash_') ? trimmed : `cash_${trimmed}`;
};

const formatCaseLevel = (value) => {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const normalizeYearEndInput = (raw) => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { value: '', error: '' };

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](20X\d|\d{4})$/i);
  const dashMatch = trimmed.match(/^(20X\d|\d{4})-(\d{1,2})-(\d{1,2})$/i);
  const match = slashMatch || dashMatch;
  if (!match) {
    return { value: '', error: 'Use MM/DD/20X#, MM/DD/YYYY, or YYYY-MM-DD.' };
  }

  const monthRaw = slashMatch ? match[1] : match[2];
  const dayRaw = slashMatch ? match[2] : match[3];
  const yearToken = slashMatch ? match[3] : match[1];
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!month || month < 1 || month > 12 || !day || day < 1 || day > 31) {
    return { value: '', error: 'Enter a valid month and day.' };
  }

  const yearIsPseudo = yearToken.toUpperCase().startsWith('20X');
  const numericYear = yearIsPseudo ? 2000 + Number(yearToken.slice(-1)) : Number(yearToken);
  if (!numericYear || numericYear < 2000) {
    return { value: '', error: 'Enter a valid year.' };
  }

  const checkDate = new Date(Date.UTC(numericYear, month - 1, day));
  if (
    Number.isNaN(checkDate.getTime()) ||
    checkDate.getUTCMonth() + 1 !== month ||
    checkDate.getUTCDate() !== day
  ) {
    return { value: '', error: 'Enter a real calendar date.' };
  }

  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  const normalizedYear = yearIsPseudo ? `20X${yearToken.slice(-1)}` : String(numericYear);
  return { value: `${normalizedYear}-${paddedMonth}-${paddedDay}`, error: '' };
};

const normalizeCaseIdentifier = (value) => String(value || '').trim().toLowerCase();

const getCaseTypeLabel = (auditArea) => {
  if (auditArea === AUDIT_AREAS.PAYABLES) return 'SURL';
  return AUDIT_AREA_LABELS[auditArea] || 'Audit Case';
};

const buildInstructionTitleBase = ({ auditArea, caseLevel }) => {
  const areaLabel = getCaseTypeLabel(auditArea);
  const levelLabel = formatCaseLevel(caseLevel);
  return `${areaLabel} ${levelLabel}`.trim();
};

const buildUniqueInstructionTitle = ({ baseTitle, usedTitles }) => {
  const normalizedUsed = new Set(usedTitles.map(normalizeCaseIdentifier));
  if (!normalizedUsed.has(normalizeCaseIdentifier(baseTitle))) return baseTitle;
  let suffix = 2;
  while (suffix < 1000) {
    const candidate = `${baseTitle} ${suffix}`;
    if (!normalizedUsed.has(normalizeCaseIdentifier(candidate))) return candidate;
    suffix += 1;
  }
  return `${baseTitle} ${Date.now()}`;
};

const buildModuleCodePrefix = (auditArea) =>
  getCaseTypeLabel(auditArea)
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase() || 'CASE';

const buildModuleCodeSeed = (caseLevel) => {
  if (caseLevel === 'intermediate') return 201;
  if (caseLevel === 'advanced') return 301;
  return 101;
};

const buildUniqueModuleCode = ({ auditArea, caseLevel, usedCodes }) => {
  const normalizedUsed = new Set(usedCodes.map((value) => String(value || '').trim().toUpperCase()));
  const prefix = buildModuleCodePrefix(auditArea);
  let codeNumber = buildModuleCodeSeed(caseLevel);
  let candidate = `${prefix}-${codeNumber}`;
  while (normalizedUsed.has(candidate)) {
    codeNumber += 1;
    candidate = `${prefix}-${codeNumber}`;
  }
  return candidate;
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error('timeout'));
      }, ms);
    }),
  ]);

const buildAutoCaseName = ({ auditArea, yearEndLabel, caseLevel }) => {
  const areaLabel = getCaseTypeLabel(auditArea);
  const parts = [areaLabel];
  if (yearEndLabel) parts.push(`Year-End ${yearEndLabel}`);
  if (caseLevel) parts.push(formatCaseLevel(caseLevel));
  return parts.join(' · ');
};

const buildCashArtifact = (type) => ({
  _tempId: getUUID(),
  type,
  fileName: '',
  storagePath: '',
  downloadURL: '',
  clientSideFile: null,
  uploadProgress: undefined,
  uploadError: null,
  contentType: '',
  confirmedBalance: '',
});

function useCaseForm({ params }) {
  const { caseId: editingCaseId } = params || {};
  const isEditing = !!editingCaseId;
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { userProfile, role } = useUser();
  const { showModal } = useModal();

  const [caseName, setCaseName] = useState('');
  const [yearEndInput, setYearEndInput] = useState('');
  const [yearEndValue, setYearEndValue] = useState('');
  const [yearEndError, setYearEndError] = useState('');
  const [caseLevel, setCaseLevel] = useState('basic');
  const [moduleId, setModuleId] = useState('');
  const [recipeVersion, setRecipeVersion] = useState(1);
  const [overrideDefaults, setOverrideDefaults] = useState(false);
  const [overrideDisbursementCount, setOverrideDisbursementCount] = useState('');
  const [overrideVendorCount, setOverrideVendorCount] = useState('');
  const [overrideInvoicesPerVendor, setOverrideInvoicesPerVendor] = useState('');
  const [publicVisible, setPublicVisible] = useState(true);
  const [auditArea, setAuditArea] = useState(DEFAULT_AUDIT_AREA);
  const [layoutType, setLayoutType] = useState(DEFAULT_LAYOUT_TYPE);
  const [layoutConfigRaw, setLayoutConfigRaw] = useState('');
  const classificationFields = useMemo(() => getClassificationFields(auditArea), [auditArea]);
  const answerKeyLabels = useMemo(() => {
    const map = { ...ANSWER_KEY_LABELS };
    classificationFields.forEach(({ key, label }) => {
      if (key) map[key] = label || map[key] || key;
    });
    return map;
  }, [classificationFields]);
  const answerKeyClassificationOptions = useMemo(
    () => [
      { value: ANSWER_KEY_PLACEHOLDER, label: 'Choose classification…' },
      ...classificationFields.map(({ key, label }) => ({
        value: key,
        label: label || ANSWER_KEY_LABELS[key] || key,
      })),
    ],
    [classificationFields]
  );
  const [caseGroupSelection, setCaseGroupSelection] = useState('__none');
  const [customCaseGroupId, setCustomCaseGroupId] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [rosterOptions, setRosterOptions] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState('');
  const [status, setStatus] = useState('assigned');
  const [opensAtStr, setOpensAtStr] = useState('');
  const [dueAtStr, setDueAtStr] = useState('');
  const [cashContext, setCashContext] = useState(initialCashContext());
  const [cashOutstandingItems, setCashOutstandingItems] = useState([initialOutstandingItem()]);
  const [cashCutoffItems, setCashCutoffItems] = useState([initialCutoffItem()]);
  const [cashRegisterItems, setCashRegisterItems] = useState([initialCashRegisterItem()]);
  const [cashReconciliationMap, setCashReconciliationMap] = useState([]);
  const [cashArtifacts, setCashArtifacts] = useState([]);
  const [faSummary, setFaSummary] = useState([initialFaClass()]);
  const [faRisk, setFaRisk] = useState({
    tolerableMisstatement: '',
    capitalizationThreshold: '',
    weightedAverageLife: '',
    strategy: 'all_over_tm',
    sampleSize: '',
  });
  const [faAdditions, setFaAdditions] = useState([initialFaAddition()]);
  const [faDisposals, setFaDisposals] = useState([initialFaDisposal()]);
  const [disbursements, setDisbursements] = useState([initialDisbursement()]);
  const [referenceDocuments, setReferenceDocuments] = useState([initialReferenceDocument()]);
  const [loading, setLoading] = useState(false);
  const [originalCaseData, setOriginalCaseData] = useState(null);
  const [instruction, setInstruction] = useState(initialInstruction());
  const [isHydratedForDrafts, setIsHydratedForDrafts] = useState(false);
  const [draftCaseId, setDraftCaseId] = useState(null);
  const [generationPlan, setGenerationPlan] = useState(null);
  const [generationPolling, setGenerationPolling] = useState(false);
  const [hasGeneratedDraft, setHasGeneratedDraft] = useState(false);
  const [existingInstructionTitles, setExistingInstructionTitles] = useState([]);
  const [existingModuleCodes, setExistingModuleCodes] = useState([]);

  const disbursementCsvInputRef = useRef(null);
  const draftPermissionRef = useRef(null);
  const pendingDraftRef = useRef(null);
  const highlightStartRef = useRef(false);
  const highlightStartTimerRef = useRef(null);
  const highlightInflightRef = useRef({});
  const mappingInflightRef = useRef({});
  const disbursementsRef = useRef(disbursements);
  const generationPollingRef = useRef(false);

  const auditAreaSelectOptions = useMemo(
    () => AUDIT_AREA_VALUES.map((value) => ({ value, label: getCaseTypeLabel(value) })),
    []
  );
  const caseRecipeOptions = useMemo(() => listCaseRecipes(), []);

  const caseGroupSelectOptions = useMemo(() => {
    const baseOptions = CASE_GROUP_VALUES.map((value) => ({
      value,
      label: CASE_GROUP_LABELS[value] || value,
    }));
    return [
      { value: '__none', label: 'No group' },
      ...baseOptions,
      { value: '__custom', label: 'Custom group…' },
    ];
  }, []);

  const autoCaseName = useMemo(() => {
    const yearEndLabel = (yearEndInput || yearEndValue || '').trim();
    return buildAutoCaseName({ auditArea, yearEndLabel, caseLevel });
  }, [auditArea, caseLevel, yearEndInput, yearEndValue]);

  useEffect(() => {
    if (isEditing) return;
    setCaseName((prev) => {
      const trimmed = (prev || '').trim();
      if (!trimmed || trimmed === autoCaseName) {
        return autoCaseName;
      }
      return prev;
    });
  }, [autoCaseName, isEditing]);

  useEffect(() => {
    if (isEditing) return;
    let isActive = true;
    const loadExistingIdentifiers = async () => {
      const orgIdFromToken = await getCurrentUserOrgId().catch((err) => {
        console.warn('[CaseForm] Failed to fetch orgId for instruction auto-title', err);
        return null;
      });
      const resolvedOrgId = orgIdFromToken ?? userProfile?.orgId ?? null;
      if (!resolvedOrgId) return;
      const titles = [];
      const codes = [];
      let cursor = null;
      let hasNext = true;
      let pageCount = 0;
      const maxPages = 5;

      while (hasNext && pageCount < maxPages) {
        // Keep within timeout window per page fetch.
        // eslint-disable-next-line no-await-in-loop
        const result = await withTimeout(
          fetchCasesPage({ pageSize: 200, orgId: resolvedOrgId, cursor, direction: 'next' }),
          5000
        );
        if (!isActive) return;
        (result?.items || []).forEach((item) => {
          if (!item) return;
          if (item.title) titles.push(item.title);
          if (item.caseName) titles.push(item.caseName);
          if (item.instruction?.title) titles.push(item.instruction.title);
          if (item.moduleCode) codes.push(item.moduleCode);
          if (item.instruction?.moduleCode) codes.push(item.instruction.moduleCode);
        });
        hasNext = Boolean(result?.pageInfo?.hasNext);
        cursor = hasNext ? { lastDoc: result?.pageInfo?.lastDoc } : null;
        pageCount += 1;
      }
      setExistingInstructionTitles(titles);
      setExistingModuleCodes(codes);
    };
    loadExistingIdentifiers().catch((err) => {
      if (err?.message === 'timeout') {
        console.warn('[CaseForm] Skipping instruction auto-title lookup (timed out).');
        return;
      }
      console.warn('[CaseForm] Failed to load existing instruction identifiers', err);
    });
    return () => {
      isActive = false;
    };
  }, [isEditing, userProfile?.orgId]);

  useEffect(() => {
    if (isEditing) return;
    const baseTitle = buildInstructionTitleBase({ auditArea, caseLevel });
    const title = buildUniqueInstructionTitle({
      baseTitle,
      usedTitles: existingInstructionTitles,
    });
    const moduleCode = buildUniqueModuleCode({
      auditArea,
      caseLevel,
      usedCodes: existingModuleCodes,
    });
    setInstruction((prev) => {
      if (prev?.title === title && prev?.moduleCode === moduleCode) return prev;
      return { ...prev, title, moduleCode };
    });
  }, [
    auditArea,
    caseLevel,
    existingInstructionTitles,
    existingModuleCodes,
    instruction?.title,
    instruction?.moduleCode,
    isEditing,
  ]);

  useEffect(() => {
    const normalizedVersion = Number.isFinite(Number(recipeVersion)) ? Number(recipeVersion) : 1;
    setInstruction((prev) => {
      if (Number(prev?.version) === normalizedVersion) return prev;
      return { ...prev, version: normalizedVersion };
    });
  }, [recipeVersion]);

  useEffect(() => {
    const { value, error } = normalizeYearEndInput(yearEndInput);
    setYearEndValue(value);
    setYearEndError(error);
  }, [yearEndInput]);

  const draftStorageKey = useMemo(() => {
    if (isEditing && editingCaseId) return `${DRAFT_STORAGE_KEY}__${editingCaseId}`;
    if (isEditing) return `${DRAFT_STORAGE_KEY}__editing`;
    return `${DRAFT_STORAGE_KEY}__new`;
  }, [editingCaseId, isEditing]);

  const hasMeaningfulDraft = useCallback((draft) => {
    if (!draft || typeof draft !== 'object') return false;
    const yearEndLabel = (draft.yearEndInput || draft.yearEndValue || '').trim();
    const autoName = buildAutoCaseName({
      auditArea: draft.auditArea || DEFAULT_AUDIT_AREA,
      yearEndLabel,
      caseLevel: draft.caseLevel || 'basic',
    });

    const caseName = (draft.caseName || '').trim();
    const hasCustomCaseName = caseName && caseName !== autoName;
    const hasAuditArea = draft.auditArea && draft.auditArea !== DEFAULT_AUDIT_AREA;
    const hasLevel = draft.caseLevel && draft.caseLevel !== 'basic';
    const hasYearEnd = Boolean(yearEndLabel);
    const hasModuleId = Boolean((draft.moduleId || '').trim());
    const hasRecipeVersion = Number(draft.recipeVersion || 1) > 1;
    const hasOverrideDefaults =
      draft.overrideDefaults ||
      Boolean((draft.overrideDisbursementCount || '').trim()) ||
      Boolean((draft.overrideVendorCount || '').trim()) ||
      Boolean((draft.overrideInvoicesPerVendor || '').trim());
    const hasVisibility = draft.publicVisible === false;
    const hasStatus = typeof draft.status === 'string' && draft.status !== 'assigned';
    const hasSchedule = Boolean((draft.opensAtStr || '').trim() || (draft.dueAtStr || '').trim());
    const hasGroup =
      (draft.caseGroupSelection && draft.caseGroupSelection !== '__none') ||
      (draft.customCaseGroupId || '').trim();
    const hasLayout =
      (draft.layoutType && draft.layoutType !== DEFAULT_LAYOUT_TYPE) ||
      (draft.layoutConfigRaw || '').trim();
    const hasInstruction = Boolean(
      (draft.instruction?.title || '').trim() ||
        (draft.instruction?.moduleCode || '').trim() ||
        (draft.instruction?.hook?.headline || '').trim() ||
        (draft.instruction?.hook?.risk || '').trim() ||
        (draft.instruction?.hook?.body || '').trim() ||
        (draft.instruction?.heuristic?.rule_text || '').trim() ||
        (draft.instruction?.heuristic?.reminder || '').trim() ||
        (draft.instruction?.gateCheck?.question || '').trim() ||
        (draft.instruction?.gateCheck?.success_message || '').trim() ||
        (draft.instruction?.gateCheck?.failure_message || '').trim() ||
        (draft.instruction?.gateCheck?.options || []).some((opt) =>
          Boolean((opt?.text || '').trim() || (opt?.feedback || '').trim())
        )
    );
    const hasDisbursements = Array.isArray(draft.disbursements)
      ? draft.disbursements.some((item) => {
          if (!item || typeof item !== 'object') return false;
          const hasCore = Boolean(
            String(item.paymentId || '').trim() ||
              String(item.payee || '').trim() ||
              String(item.amount || '').trim() ||
              String(item.paymentDate || '').trim() ||
              String(item.transactionType || '').trim()
          );
          const hasMappings = Array.isArray(item.mappings)
            ? item.mappings.some(
                (mapping) =>
                  mapping &&
                  ((mapping.paymentId || '').trim() ||
                    (mapping.fileName || '').trim() ||
                    mapping.downloadURL ||
                    mapping.storagePath ||
                    mapping.clientSideFile)
              )
            : false;
          const hasAnswerKey =
            (item.answerKey?.explanation || '').trim() ||
            (item.answerKey?.reason || '').trim() ||
            (item.answerKey?.assertion || '').trim();
          return Boolean(hasCore || hasMappings || hasAnswerKey || item.shouldFlag);
        })
      : false;
    const hasReferences = Array.isArray(draft.referenceDocuments)
      ? draft.referenceDocuments.some((doc) => {
          if (!doc || typeof doc !== 'object') return false;
          return Boolean(
            (doc.fileName || '').trim() ||
              doc.downloadURL ||
              doc.storagePath ||
              doc.clientSideFile ||
              (doc.generationSpec && typeof doc.generationSpec === 'object')
          );
        })
      : false;
    const hasCashContext = Boolean(
      (draft.cashContext?.bookBalance || '').trim() ||
        (draft.cashContext?.bankBalance || '').trim() ||
        (draft.cashContext?.reconciliationDate || '').trim() ||
        (draft.cashContext?.confirmedBalance || '').trim() ||
        (draft.cashContext?.testingThreshold || '').trim() ||
        (draft.cashContext?.cutoffWindowDays || '').trim() ||
        draft.cashContext?.simulateMathError
    );
    const hasCashItems = (list, keys) =>
      Array.isArray(list) &&
      list.some((item) => item && keys.some((key) => String(item[key] || '').trim()));
    const hasCashArtifacts = Array.isArray(draft.cashArtifacts)
      ? draft.cashArtifacts.some((doc) => {
          if (!doc || typeof doc !== 'object') return false;
          return Boolean(
            (doc.fileName || '').trim() ||
              doc.downloadURL ||
              doc.storagePath ||
              doc.clientSideFile ||
              (doc.type || '').trim()
          );
        })
      : false;
    const hasFixedAssets =
      hasCashItems(draft.faSummary, ['className', 'beginningBalance', 'additions', 'disposals', 'endingBalance']) ||
      hasCashItems(draft.faAdditions, ['vendor', 'description', 'amount', 'inServiceDate', 'glAccount']) ||
      hasCashItems(draft.faDisposals, ['assetId', 'description', 'proceeds', 'nbv']) ||
      Boolean(
        (draft.faRisk?.tolerableMisstatement || '').trim() ||
          (draft.faRisk?.capitalizationThreshold || '').trim() ||
          (draft.faRisk?.weightedAverageLife || '').trim() ||
          (draft.faRisk?.sampleSize || '').trim() ||
          (draft.faRisk?.strategy && draft.faRisk.strategy !== 'all_over_tm')
      );
    const hasGenerationPlan = Boolean(
      draft.generationPlan &&
        (draft.generationPlan.referenceDocumentSpecs?.length ||
          (draft.generationPlan.yearEnd || '').trim() ||
          (draft.generationPlan.caseLevel || '').trim())
    );

    return Boolean(
      draft.draftCaseId ||
        hasModuleId ||
        hasRecipeVersion ||
        hasCustomCaseName ||
        hasAuditArea ||
        hasLevel ||
        hasYearEnd ||
        hasVisibility ||
        hasStatus ||
        hasSchedule ||
        hasGroup ||
        hasLayout ||
        hasInstruction ||
        hasDisbursements ||
        hasReferences ||
        hasCashContext ||
        hasCashItems(draft.cashOutstandingItems, ['reference', 'payee', 'issueDate', 'amount']) ||
        hasCashItems(draft.cashCutoffItems, ['reference', 'clearDate', 'amount']) ||
        hasCashItems(draft.cashRegisterItems, ['checkNo', 'writtenDate', 'amount', 'payee']) ||
        hasCashArtifacts ||
        hasFixedAssets ||
        hasGenerationPlan ||
        hasOverrideDefaults
    );
  }, []);

  const clearDraftStorage = useCallback(() => {
    if (!canUseLocalStorage()) return;
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch (err) {
      console.error('Failed to clear draft', err);
    }
  }, [draftStorageKey]);

  const applyDraftToState = useCallback(
    (parsed) => {
      if (!parsed) return;
      if (parsed.caseName) setCaseName(parsed.caseName);
      if (parsed.auditArea) setAuditArea(parsed.auditArea);
      if (parsed.instruction) setInstruction(parsed.instruction);
      if (parsed.disbursements) setDisbursements(parsed.disbursements);
      if (parsed.draftCaseId) setDraftCaseId(parsed.draftCaseId);
      if (parsed.layoutType) setLayoutType(parsed.layoutType);
      if (parsed.layoutConfigRaw) setLayoutConfigRaw(parsed.layoutConfigRaw);
      if (parsed.publicVisible !== undefined) setPublicVisible(parsed.publicVisible);
      if (parsed.selectedUserIds) setSelectedUserIds(parsed.selectedUserIds);
      if (parsed.caseGroupSelection) setCaseGroupSelection(parsed.caseGroupSelection);
      if (parsed.customCaseGroupId) setCustomCaseGroupId(parsed.customCaseGroupId);
      if (parsed.status) setStatus(parsed.status);
      if (parsed.opensAtStr) setOpensAtStr(parsed.opensAtStr);
      if (parsed.dueAtStr) setDueAtStr(parsed.dueAtStr);
      const parsedYearEndInput =
        typeof parsed.yearEndInput === 'string' ? parsed.yearEndInput.trim() : '';
      const parsedYearEndValue =
        typeof parsed.yearEndValue === 'string' ? parsed.yearEndValue.trim() : '';
      if (parsedYearEndInput || parsedYearEndValue) {
        setYearEndInput(parsedYearEndInput || parsedYearEndValue);
        setYearEndValue(parsedYearEndValue || parsedYearEndInput);
      }
      if (parsed.caseLevel) {
        const normalizedLevel = String(parsed.caseLevel || '').trim();
        if (CASE_LEVEL_VALUES.includes(normalizedLevel)) {
          setCaseLevel(normalizedLevel);
        }
      }
      if (typeof parsed.moduleId === 'string') {
        setModuleId(parsed.moduleId);
      }
      if (parsed.recipeVersion !== undefined && parsed.recipeVersion !== null) {
        const parsedVersion = Number(parsed.recipeVersion);
        setRecipeVersion(Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : 1);
      }
      if (typeof parsed.overrideDefaults === 'boolean') {
        setOverrideDefaults(parsed.overrideDefaults);
      }
      if (typeof parsed.overrideDisbursementCount === 'string') {
        setOverrideDisbursementCount(parsed.overrideDisbursementCount);
      }
      if (typeof parsed.overrideVendorCount === 'string') {
        setOverrideVendorCount(parsed.overrideVendorCount);
      }
      if (typeof parsed.overrideInvoicesPerVendor === 'string') {
        setOverrideInvoicesPerVendor(parsed.overrideInvoicesPerVendor);
      }
      if (parsed.cashContext) setCashContext(parsed.cashContext);
      if (parsed.cashOutstandingItems) setCashOutstandingItems(parsed.cashOutstandingItems);
      if (parsed.cashCutoffItems) setCashCutoffItems(parsed.cashCutoffItems);
      if (parsed.cashRegisterItems) setCashRegisterItems(parsed.cashRegisterItems);
      if (parsed.cashArtifacts) setCashArtifacts(parsed.cashArtifacts);
      if (parsed.faSummary) setFaSummary(parsed.faSummary);
      if (parsed.faRisk) setFaRisk(parsed.faRisk);
      if (parsed.faAdditions) setFaAdditions(parsed.faAdditions);
      if (parsed.faDisposals) setFaDisposals(parsed.faDisposals);
      if (parsed.referenceDocuments) setReferenceDocuments(parsed.referenceDocuments);
      if (parsed.generationPlan) {
        setGenerationPlan(parsed.generationPlan);
        setHasGeneratedDraft(true);
      }
    },
    []
  );

  const resetFormForNewCase = useCallback(() => {
    setCaseName('');
    setYearEndInput('');
    setYearEndValue('');
    setYearEndError('');
    setCaseLevel('basic');
    setModuleId('');
    setRecipeVersion(1);
    setOverrideDefaults(false);
    setOverrideDisbursementCount('');
    setOverrideVendorCount('');
    setOverrideInvoicesPerVendor('');
    setSelectedUserIds([]);
    setPublicVisible(true);
    setStatus('assigned');
    setOpensAtStr('');
    setDueAtStr('');
    setDisbursements([initialDisbursement()]);
    setReferenceDocuments([initialReferenceDocument()]);
    setCashContext({
      moduleType: 'bank_reconciliation',
      bookBalance: '',
      bankBalance: '',
      reconciliationDate: '',
      reportingDate: '',
      simulateMathError: false,
      confirmedBalance: '',
      testingThreshold: '',
      cutoffWindowDays: '',
    });
    setCashOutstandingItems([initialOutstandingItem()]);
    setCashCutoffItems([initialCutoffItem()]);
    setCashRegisterItems([initialCashRegisterItem()]);
    setCashReconciliationMap([]);
    setCashArtifacts([]);
    setFaSummary([initialFaClass()]);
    setFaRisk({
      tolerableMisstatement: '',
      strategy: 'all_over_tm',
      sampleSize: '',
    });
    setFaAdditions([initialFaAddition()]);
    setFaDisposals([initialFaDisposal()]);
    setInstruction(initialInstruction());
    setLayoutType(DEFAULT_LAYOUT_TYPE);
    setLayoutConfigRaw('');
    setOriginalCaseData(null);
    setGenerationPlan(null);
    setHasGeneratedDraft(false);
    setAuditArea(DEFAULT_AUDIT_AREA);
    setCaseGroupSelection('__none');
    setCustomCaseGroupId('');
    setDraftCaseId(null);
  }, []);

  const restoreDraftFromStorage = useCallback(() => {
    if (!canUseLocalStorage()) return;
    try {
      const savedDraft = window.localStorage.getItem(draftStorageKey);
      if (!savedDraft) return;
      const parsed = JSON.parse(savedDraft);
      if (!parsed || !parsed.updatedAt) return;
      if (!hasMeaningfulDraft(parsed)) {
        clearDraftStorage();
        return;
      }

      if (draftPermissionRef.current === null) {
        pendingDraftRef.current = parsed;
        showModal(
          isEditing
            ? 'We found an unsaved draft for this case.'
            : 'We found an unsaved draft for this new case.',
          'Resume Draft',
          (hideModal) => (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  hideModal();
                  draftPermissionRef.current = false;
                  const pending = pendingDraftRef.current;
                  pendingDraftRef.current = null;
                  clearDraftStorage();
                  if (pending?.draftCaseId) {
                    try {
                      await markCaseDeleted(pending.draftCaseId);
                    } catch (err) {
                      console.warn('[case-form] Failed to delete draft case', err);
                    }
                  }
                  setDraftCaseId(null);
                  resetFormForNewCase();
                }}
              >
                New Draft
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  hideModal();
                  draftPermissionRef.current = true;
                  const pending = pendingDraftRef.current;
                  pendingDraftRef.current = null;
                  applyDraftToState(pending || parsed);
                }}
              >
                Continue Draft
              </Button>
            </div>
          ),
          { disableClose: true }
        );
        return;
      }

      if (draftPermissionRef.current === true) {
        applyDraftToState(parsed);
      }
    } catch (err) {
      console.error('Failed to restore draft', err);
    }
  }, [
    applyDraftToState,
    clearDraftStorage,
    draftStorageKey,
    hasMeaningfulDraft,
    isEditing,
    resetFormForNewCase,
    showModal,
  ]);

  const normalizeReferenceDocumentsForForm = useCallback((docs) => {
    if (!Array.isArray(docs) || docs.length === 0) {
      return [initialReferenceDocument()];
    }
    return docs.map((doc) => ({
      _tempId: doc._tempId || getUUID(),
      fileName: doc.fileName || '',
      storagePath: doc.storagePath || '',
      downloadURL: doc.downloadURL || '',
      clientSideFile: null,
      uploadProgress: doc.storagePath ? 100 : undefined,
      uploadError: null,
      contentType: doc.contentType || '',
      generationSpec: doc.generationSpec || null,
      generationSpecId: doc.generationSpecId || null,
    }));
  }, []);

  const normalizeCashArtifactsForForm = useCallback((docs) => {
    const list = Array.isArray(docs) ? docs.filter(Boolean) : [];
    let changed = false;
    const normalizedList = list.map((doc) => {
      if (!doc || typeof doc !== 'object') return doc;
      const normalizedType = normalizeCashArtifactType(doc.type);
      const nextDoc = { ...doc };
      if (normalizedType && normalizedType !== doc.type) {
        nextDoc.type = normalizedType;
        changed = true;
      }
      if (!nextDoc._tempId) {
        nextDoc._tempId = getUUID();
        changed = true;
      }
      return nextDoc;
    });

    const requiredTypes = CASH_ARTIFACT_TYPES.map((entry) => entry.value);
    const requiredSet = new Set(requiredTypes);
    const byType = new Map();
    normalizedList.forEach((doc) => {
      if (!doc || typeof doc !== 'object') return;
      if (doc.type) byType.set(doc.type, doc);
    });

    const next = requiredTypes.map((type) => {
      const existing = byType.get(type);
      if (existing) return existing;
      changed = true;
      return buildCashArtifact(type);
    });

    normalizedList.forEach((doc) => {
      if (!doc || typeof doc !== 'object') return;
      const type = doc.type || '';
      if (!type || requiredSet.has(type)) return;
      next.push(doc);
    });

    return { items: next, changed };
  }, []);

  useEffect(() => {
    if (auditArea !== AUDIT_AREAS.CASH) return;
    setCashArtifacts((prev) => {
      const { items, changed } = normalizeCashArtifactsForForm(prev);
      return changed ? items : prev;
    });
  }, [auditArea, normalizeCashArtifactsForForm]);

  useEffect(() => {
    disbursementsRef.current = disbursements;
  }, [disbursements]);

  const stripClientFilesForDraft = useCallback((items) => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const mappings = Array.isArray(item.mappings)
        ? item.mappings.map((mapping) => {
            if (!mapping || typeof mapping !== 'object') return mapping;
            // eslint-disable-next-line no-unused-vars
            const { clientSideFile, ...rest } = mapping;
            return rest;
          })
        : item.mappings;
      const highlightedDocument =
        item.highlightedDocument && typeof item.highlightedDocument === 'object'
          ? // eslint-disable-next-line no-unused-vars
            (({ clientSideFile, ...rest }) => rest)(item.highlightedDocument)
          : item.highlightedDocument;
      return { ...item, mappings, highlightedDocument };
    });
  }, []);

  useEffect(() => {
    if (!isHydratedForDrafts) return;
    if (!canUseLocalStorage()) return;

    const draftData = {
      caseName,
      yearEndInput,
      yearEndValue,
      caseLevel,
      moduleId,
      recipeVersion,
      overrideDefaults,
      overrideDisbursementCount,
      overrideVendorCount,
      overrideInvoicesPerVendor,
      auditArea,
      layoutType,
      layoutConfigRaw,
      publicVisible,
      selectedUserIds,
      caseGroupSelection,
      customCaseGroupId,
      status,
      opensAtStr,
      dueAtStr,
      disbursements: stripClientFilesForDraft(disbursements),
      instruction,
      cashContext,
      cashOutstandingItems,
      cashCutoffItems,
      cashRegisterItems,
      cashArtifacts: (Array.isArray(cashArtifacts) ? cashArtifacts : []).map((doc) => {
        if (!doc || typeof doc !== 'object') return doc;
        // eslint-disable-next-line no-unused-vars
        const { clientSideFile, ...rest } = doc;
        return rest;
      }),
      faSummary,
      faRisk,
      faAdditions,
      faDisposals,
      referenceDocuments: (Array.isArray(referenceDocuments) ? referenceDocuments : []).map((doc) => {
        if (!doc || typeof doc !== 'object') return doc;
        // eslint-disable-next-line no-unused-vars
        const { clientSideFile, ...rest } = doc;
        return rest;
      }),
      generationPlan,
      draftCaseId,
      updatedAt: Date.now(),
    };

    const handler = setTimeout(() => {
      try {
        if (!hasMeaningfulDraft(draftData)) {
          window.localStorage.removeItem(draftStorageKey);
          return;
        }
        window.localStorage.setItem(draftStorageKey, JSON.stringify(draftData));
      } catch (err) {
        console.error('Failed to save draft', err);
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [
    caseName,
    yearEndInput,
    yearEndValue,
    caseLevel,
    moduleId,
    recipeVersion,
    overrideDefaults,
    overrideDisbursementCount,
    overrideVendorCount,
    overrideInvoicesPerVendor,
    auditArea,
    layoutType,
    layoutConfigRaw,
    publicVisible,
    selectedUserIds,
    caseGroupSelection,
    customCaseGroupId,
    status,
    opensAtStr,
    dueAtStr,
    disbursements,
    instruction,
    cashContext,
    cashOutstandingItems,
    cashCutoffItems,
    cashRegisterItems,
    cashArtifacts,
    faSummary,
    faRisk,
    faAdditions,
    faDisposals,
    referenceDocuments,
    generationPlan,
    draftCaseId,
    draftStorageKey,
    hasMeaningfulDraft,
    isHydratedForDrafts,
    stripClientFilesForDraft,
  ]);

  useEffect(() => {
    draftPermissionRef.current = null;
  }, [editingCaseId]);

  useEffect(() => {
    let cancelled = false;
    setRosterLoading(true);
    fetchUserRosterOptions()
      .then((options) => {
        if (cancelled) return;
        setRosterOptions(options);
        setRosterLoading(false);
        setRosterError('');
      })
      .catch((error) => {
        if (process.env.NODE_ENV !== 'test') {
          console.error('Error loading roster options:', error);
        }
        if (cancelled) return;
        setRosterError('Unable to load roster options. Try refreshing or contact support.');
        setRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setRosterOptions((existing) => {
      const missing = selectedUserIds.filter((id) => !existing.some((option) => option.id === id));
      if (missing.length === 0) return existing;
      const supplemental = missing.map((id) => ({ id, label: id }));
      return [...existing, ...supplemental];
    });
  }, [selectedUserIds]);

  const ulog = (event, payload) => {
    const data = payload || {};
    try {
      if (DEBUG_LOGS) {
        console.info('[case-upload]', event, data);
        if (event === 'error:resumable' && data?.error?.serverResponse) {
          console.info('[case-upload] serverResponse', data.error.serverResponse);
        }
      }
    } catch (e) {
      // no-op
    }
  };
  const logValidationFail = (reason, extra = {}) => {
    try {
      console.warn('[case-upload] validation-failed', { reason, ...extra });
    } catch {}
  };
  const formatGenerationError = useCallback((error, fallback) => {
    if (!error) return fallback || 'Unable to queue generation job.';
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    const code = error.code ? String(error.code).trim() : '';
    if (
      (code === 'internal' || code === 'functions/internal') &&
      (!message || message.toLowerCase() === 'internal')
    ) {
      return 'Cloud Function not reachable. Confirm Functions are deployed and region matches (default us-central1).';
    }
    let details = '';
    if (error.details) {
      if (typeof error.details === 'string') {
        details = error.details.trim();
      } else {
        try {
          details = JSON.stringify(error.details);
        } catch {
          details = '';
        }
      }
    }
    const parts = [];
    if (message) parts.push(message);
    if (code && code !== message) parts.push(`(${code})`);
    if (details && details !== message) parts.push(details);
    return parts.length ? parts.join(' ') : fallback || 'Unable to queue generation job.';
  }, []);

  const computeGenerationCounts = useCallback((docs) => {
    if (!Array.isArray(docs)) {
      return { total: 0, ready: 0, pending: 0 };
    }
    const generated = docs.filter(
      (doc) => doc && doc.generationSpec && typeof doc.generationSpec === 'object'
    );
    const ready = generated.filter((doc) => doc.storagePath).length;
    return {
      total: generated.length,
      ready,
      pending: Math.max(0, generated.length - ready),
    };
  }, []);

  const toSafeDate = useCallback((value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') {
      const asDate = value.toDate();
      return Number.isNaN(asDate?.getTime()) ? null : asDate;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, []);

  const pollGenerationUpdates = useCallback(
    async (caseIdForJob) => {
      if (!caseIdForJob || generationPollingRef.current) return;
      generationPollingRef.current = true;
      setGenerationPolling(true);
      const maxAttempts = 180;
      let lastJobStatus = null;
      let lastErrorCount = 0;
      let terminalCountdown = null;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 2000));
        // eslint-disable-next-line no-await-in-loop
        const updated = await fetchCase(caseIdForJob, { includePrivateKeys: true }).catch(() => null);
        if (updated?.referenceDocuments) {
          const normalized = normalizeReferenceDocumentsForForm(updated.referenceDocuments);
          setReferenceDocuments(normalized);
          const counts = computeGenerationCounts(updated.referenceDocuments);
          if (counts.pending === 0) {
            // continue to refresh job status before breaking
          }
        }
        // eslint-disable-next-line no-await-in-loop
        const refreshedPlan = await fetchCaseGenerationPlan({ caseId: caseIdForJob }).catch(() => null);
        if (refreshedPlan) {
          setGenerationPlan(refreshedPlan);
          lastJobStatus = refreshedPlan?.lastJob?.status || null;
          lastErrorCount = refreshedPlan?.lastJob?.errorCount || 0;
        }
        const counts =
          updated?.referenceDocuments ? computeGenerationCounts(updated.referenceDocuments) : null;
        const pending = counts ? counts.pending : null;
        const terminalStatus =
          lastJobStatus === 'completed' || lastJobStatus === 'partial' || lastJobStatus === 'error';
        if (terminalStatus) {
          if (pending === 0 || pending === null) {
            break;
          }
          if (terminalCountdown === null) {
            terminalCountdown = 3;
          } else {
            terminalCountdown -= 1;
          }
          if (terminalCountdown <= 0) {
            break;
          }
        }
      }
      generationPollingRef.current = false;
      setGenerationPolling(false);
      if (lastJobStatus === 'error' || lastErrorCount > 0) {
        showModal(
          'Some documents failed to generate. Review the generation status in the Review step.',
          'Generation Error'
        );
      }
    },
    [
      setReferenceDocuments,
      normalizeReferenceDocumentsForForm,
      resolveReferenceDownloadUrls,
      setGenerationPlan,
      computeGenerationCounts,
      showModal,
    ]
  );

  const {
    uploadFileAndGetMetadata,
    uploadReferenceDocument,
    uploadHighlightedDocument,
    handleMappingFileSelect,
    handleHighlightedDocumentSelect,
    handleReferenceDocFileSelect,
    handleCashArtifactFileSelect,
  } = createCaseFormUploadHandlers({
    editingCaseId,
    draftCaseId,
    setDraftCaseId,
    caseName,
    yearEndValue,
    yearEndInput,
    caseLevel,
    auditArea,
    layoutType,
    layoutConfigRaw,
    instruction,
    publicVisible,
    selectedUserIds,
    caseGroupSelection,
    customCaseGroupId,
    userId,
    userProfile,
    role,
    showModal,
    ulog,
    disbursements,
    disbursementsRef,
    setDisbursements,
    mappingInflightRef,
    highlightInflightRef,
    setReferenceDocuments,
    setCashArtifacts,
    MAX_ARTIFACT_BYTES,
    UPLOAD_TIMEOUT_MS,
  });

  const handleCsvImport = createCaseFormCsvImportHandler({
    disbursementCsvInputRef,
    setDisbursements,
    showModal,
    onImportCompleted: ({ importedCount }) => {
      trackAnalyticsEvent(ANALYTICS_EVENTS.ADMIN_CASE_IMPORT_COMPLETED, {
        caseId: editingCaseId || draftCaseId || '',
        importedCount: Number(importedCount) || 0,
      });
    },
  });

  const handleSubmit = createCaseFormSubmitHandler({
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
    analytics: {
      onMilestoneEvent: ({ eventName, props }) => {
        if (!eventName) return;
        trackAnalyticsEvent(eventName, {
          caseId: editingCaseId || draftCaseId || '',
          ...props,
        });
      },
    },
    draftStorageKey,
    highlightStartRef,
    highlightStartTimerRef,
  });

  const normalizeHighlightedDocument = (doc) => {
    if (!doc || typeof doc !== 'object') {
      return initialHighlightedDocument();
    }
    return {
      ...initialHighlightedDocument(),
      ...doc,
      fileName: doc.fileName || '',
      storagePath: doc.storagePath || '',
      downloadURL: doc.downloadURL || '',
      contentType: doc.contentType || '',
      clientSideFile: null,
      uploadProgress: doc.storagePath ? 100 : undefined,
      uploadError: null,
    };
  };

  const toDateTimeLocalInput = (value) => {
    if (!value) return '';
    let date;
    if (typeof value?.toDate === 'function') {
      date = value.toDate();
    } else if (value instanceof Date) {
      date = value;
    } else if (value?.seconds) {
      date = new Date(value.seconds * 1000);
    } else {
      date = new Date(value);
    }
    if (!date || Number.isNaN(date.getTime())) return '';
    const tzOffset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - tzOffset * 60000);
    return local.toISOString().slice(0, 16);
  };

  useEffect(() => {
    if (isEditing && editingCaseId) {
      setLoading(true);
      fetchCase(editingCaseId, { includePrivateKeys: true })
        .then((data) => {
          if (data) {
            setOriginalCaseData(data);
            setGenerationPlan(null);
            setHasGeneratedDraft(false);
            setCaseName(data.caseName || data.title || '');
            const inferredPublic =
              typeof data.publicVisible === 'boolean'
                ? data.publicVisible
                : !(Array.isArray(data.visibleToUserIds) && data.visibleToUserIds.length > 0);
            setPublicVisible(inferredPublic);
            const rosterList = Array.isArray(data.visibleToUserIds) ? data.visibleToUserIds : [];
            setSelectedUserIds(inferredPublic ? [] : rosterList);
            setStatus(data.status || 'assigned');
            setOpensAtStr(toDateTimeLocalInput(data.opensAt));
            setDueAtStr(toDateTimeLocalInput(data.dueAt));
            setCashContext({
              moduleType: data.cashContext?.moduleType ?? 'bank_reconciliation',
              bookBalance: data.cashContext?.bookBalance ?? '',
              bankBalance: data.cashContext?.bankBalance ?? '',
              reconciliationDate:
                data.cashContext?.reconciliationDate ??
                data.cashContext?.reportingDate ??
                data.auditYearEnd ??
                '',
              simulateMathError: Boolean(data.cashContext?.simulateMathError),
              confirmedBalance: data.cashContext?.confirmedBalance ?? '',
              testingThreshold: data.cashContext?.testingThreshold ?? '',
              cutoffWindowDays: data.cashContext?.cutoffWindowDays ?? '',
            });
            setCashOutstandingItems(
              Array.isArray(data.cashOutstandingItems) && data.cashOutstandingItems.length > 0
                ? data.cashOutstandingItems.map((entry) => ({ _tempId: getUUID(), ...entry }))
                : [initialOutstandingItem()]
            );
            setCashCutoffItems(
              Array.isArray(data.cashCutoffItems) && data.cashCutoffItems.length > 0
                ? data.cashCutoffItems.map((entry) => ({ _tempId: getUUID(), ...entry }))
                : [initialCutoffItem()]
            );
            setCashRegisterItems(
              Array.isArray(data.cashRegisterItems) && data.cashRegisterItems.length > 0
                ? data.cashRegisterItems.map((entry) => ({ _tempId: getUUID(), ...entry }))
                : [initialCashRegisterItem()]
            );
            setCashReconciliationMap(
              Array.isArray(data.cashReconciliationMap)
                ? data.cashReconciliationMap.map((entry) => ({ _tempId: getUUID(), ...entry }))
                : []
            );
            setCashArtifacts(normalizeCashArtifactsForForm(data.cashArtifacts).items);
            setFaSummary(
              Array.isArray(data.faSummary) && data.faSummary.length > 0
                ? data.faSummary.map((entry) => ({ _tempId: getUUID(), ...entry }))
                : [initialFaClass()]
            );
            setFaRisk({
              tolerableMisstatement: data.faRisk?.tolerableMisstatement ?? '',
              strategy: data.faRisk?.strategy ?? 'all_over_tm',
              sampleSize: data.faRisk?.sampleSize ?? '',
            });
            setFaAdditions(
              Array.isArray(data.faAdditions) && data.faAdditions.length > 0
                ? data.faAdditions.map((entry) => ({ _tempId: getUUID(), ...entry }))
                : [initialFaAddition()]
            );
            setFaDisposals(
              Array.isArray(data.faDisposals) && data.faDisposals.length > 0
                ? data.faDisposals.map((entry) => ({ _tempId: getUUID(), ...entry }))
                : [initialFaDisposal()]
            );
            if (data.instruction) {
              setInstruction(data.instruction);
            } else {
              setInstruction(initialInstruction());
            }
            const baseDisbursements =
              data.disbursements?.map((d) => {
                const draft = {
                  _tempId: d._tempId || getUUID(),
                  paymentId: d.paymentId || '',
                  payee: d.payee || '',
                  amount: d.amount || '',
                  paymentDate: d.paymentDate || '',
                  transactionType: d.transactionType || '',
                  answerKey: {
                    properlyIncluded: d.answerKey?.properlyIncluded ?? 0,
                    properlyExcluded: d.answerKey?.properlyExcluded ?? 0,
                    improperlyIncluded: d.answerKey?.improperlyIncluded ?? 0,
                    improperlyExcluded: d.answerKey?.improperlyExcluded ?? 0,
                    explanation: d.answerKey?.explanation ?? '',
                    assertion: d.answerKey?.assertion ?? '',
                    reason: d.answerKey?.reason ?? '',
                  },
                  mappings: [],
                  highlightedDocument: normalizeHighlightedDocument(d.highlightedDocument),
                  correctAssertions: Array.isArray(d.correctAssertions)
                    ? d.correctAssertions
                    : Array.isArray(d.requiredAssertions)
                    ? d.requiredAssertions
                    : [],
                };
                const derived = detectAnswerKeyMode({
                  amount: draft.amount,
                  answerKey: draft.answerKey,
                });
                return {
                  ...draft,
                  answerKeyMode: derived.mode,
                  answerKeySingleClassification:
                    derived.classification || DEFAULT_ANSWER_KEY_CLASSIFICATION,
                  answerKey: derived.answerKey,
                };
              }) || [initialDisbursement()];

            const mappingGroups = new Map();
            (data.invoiceMappings || []).forEach((m) => {
              const key = (m.paymentId || '').trim();
              const normalizedKey = key || '__unlinked';
              if (!mappingGroups.has(normalizedKey)) {
                mappingGroups.set(normalizedKey, []);
              }
              mappingGroups.get(normalizedKey).push({
                ...m,
                _tempId: m._tempId || getUUID(),
                disbursementTempId: null,
                clientSideFile: null,
                uploadProgress: m.storagePath ? 100 : undefined,
                uploadError: null,
                contentType: m.contentType || '',
              });
            });

            const disbursementsWithMappings = baseDisbursements.map((d) => {
              const mappingsForPayment = mappingGroups.get((d.paymentId || '').trim()) || [];
              return {
                ...d,
                mappings: mappingsForPayment.map((mapping) => ({
                  ...mapping,
                  disbursementTempId: d._tempId,
                  paymentId: d.paymentId,
                })),
                trapType: Array.isArray(d.trapType)
                  ? d.trapType.filter(Boolean)
                  : d.trapType
                  ? [d.trapType]
                  : [],
                correctAssertions: Array.isArray(d.correctAssertions)
                  ? d.correctAssertions
                  : Array.isArray(d.requiredAssertions)
                  ? d.requiredAssertions
                  : [],
                requiredAssertions: Array.isArray(d.requiredAssertions) ? d.requiredAssertions : [],
                errorReasons: Array.isArray(d.errorReasons) ? d.errorReasons : [],
                shouldFlag: Boolean(d.shouldFlag),
                validator:
                  d.validator && typeof d.validator === 'object'
                    ? { type: d.validator.type || '', config: d.validator.config || {} }
                    : { type: '', config: {} },
              };
            });

            setDisbursements(disbursementsWithMappings);
            setReferenceDocuments(
              normalizeReferenceDocumentsForForm(data.referenceDocuments)
            );
            setAuditArea(
              typeof data.auditArea === 'string' && data.auditArea.trim()
                ? data.auditArea.trim()
                : DEFAULT_AUDIT_AREA
            );
            const normalizedLevel =
              typeof data.caseLevel === 'string' ? data.caseLevel.trim() : '';
            setCaseLevel(CASE_LEVEL_VALUES.includes(normalizedLevel) ? normalizedLevel : 'basic');
            const resolvedModuleId =
              typeof data.moduleId === 'string'
                ? data.moduleId.trim()
                : typeof data.recipeId === 'string'
                ? data.recipeId.trim()
                : '';
            setModuleId(resolvedModuleId);
            const resolvedRecipeVersion = Number(
              data.recipeVersion ?? data.instruction?.version ?? 1
            );
            setRecipeVersion(
              Number.isFinite(resolvedRecipeVersion) && resolvedRecipeVersion > 0
                ? resolvedRecipeVersion
                : 1
            );
            const storedYearEndLabel =
              typeof data.yearEndLabel === 'string' && data.yearEndLabel.trim()
                ? data.yearEndLabel.trim()
                : typeof data.yearEnd === 'string'
                ? data.yearEnd.trim()
                : '';
            setYearEndInput(storedYearEndLabel);
            if (typeof data.yearEnd === 'string' && data.yearEnd.trim()) {
              setYearEndValue(data.yearEnd.trim());
            }
            const inferredLayout =
              data?.workpaper?.layoutType ||
              (data.auditArea === AUDIT_AREAS.CASH
                ? 'cash_recon'
                : data.auditArea === AUDIT_AREAS.FIXED_ASSETS
                ? 'fixed_assets'
                : DEFAULT_LAYOUT_TYPE);
            setLayoutType(inferredLayout);
            const incomingLayoutConfig =
              data?.workpaper &&
              typeof data.workpaper.layoutConfig === 'object' &&
              data.workpaper.layoutConfig !== null
                ? data.workpaper.layoutConfig
                : {};
            setLayoutConfigRaw(
              Object.keys(incomingLayoutConfig).length > 0
                ? JSON.stringify(incomingLayoutConfig, null, 2)
                : ''
            );
            const existingGroupId = typeof data.caseGroupId === 'string' ? data.caseGroupId.trim() : '';
            if (existingGroupId && CASE_GROUP_VALUES.includes(existingGroupId)) {
              setCaseGroupSelection(existingGroupId);
              setCustomCaseGroupId('');
            } else if (existingGroupId) {
              setCaseGroupSelection('__custom');
              setCustomCaseGroupId(existingGroupId);
            } else {
              setCaseGroupSelection('__none');
              setCustomCaseGroupId('');
            }
          } else {
            showModal('Case not found.', 'Error');
            navigate('/admin');
          }
          setLoading(false);
          restoreDraftFromStorage();
          setIsHydratedForDrafts(true);

          fetchCaseGenerationPlan({ caseId: editingCaseId })
            .then((plan) => {
              if (plan) {
                setGenerationPlan(plan);
                setHasGeneratedDraft(true);
                if (plan.yearEnd) {
                  setYearEndInput((prev) => prev || plan.yearEnd);
                  setYearEndValue((prev) => prev || plan.yearEnd);
                }
                if (plan.caseLevel) {
                  const normalizedLevel = String(plan.caseLevel || '').trim();
                  if (CASE_LEVEL_VALUES.includes(normalizedLevel)) {
                    setCaseLevel((prev) => prev || normalizedLevel);
                  }
                }
              }
            })
            .catch((error) => {
              console.warn('[case-form] Failed to load generation plan', error);
            });
        })
        .catch((error) => {
          console.error('Error fetching case for editing:', error);
          showModal('Error fetching case: ' + error.message, 'Error');
          setLoading(false);
          navigate('/admin');
          restoreDraftFromStorage();
          setIsHydratedForDrafts(true);
        });
    } else {
      resetFormForNewCase();

      restoreDraftFromStorage();
      setIsHydratedForDrafts(true);
    }
  }, [
    isEditing,
    editingCaseId,
    navigate,
    showModal,
    resetFormForNewCase,
    restoreDraftFromStorage,
    normalizeReferenceDocumentsForForm,
    normalizeCashArtifactsForForm,
  ]);

  const queueGenerationJob = useCallback(async () => {
    if (!generationPlan) {
      showModal('No generation plan found for this case.', 'Generation');
      return;
    }
    if (role && role !== 'admin' && role !== 'owner' && role !== 'instructor') {
      showModal('Only admins or instructors can generate reference documents.', 'Permission Needed');
      return;
    }
    if (!appId) {
      showModal(
        'Missing appId. Please ensure the app is initialized (window.__app_id) before generating documents.',
        'Generation Error'
      );
      return;
    }
    let caseIdForJob = editingCaseId || draftCaseId;
    const jobStatus = generationPlan?.lastJob?.status;
    const lastJobId = generationPlan?.lastJob?.jobId || '';
    const lastJobUpdatedAt = toSafeDate(generationPlan?.lastJob?.updatedAt);
    const jobAgeMs = lastJobUpdatedAt ? Date.now() - lastJobUpdatedAt.getTime() : null;
    const jobFresh = jobAgeMs !== null && jobAgeMs < 5 * 60 * 1000;
    if ((jobStatus === 'queued' || jobStatus === 'processing') && lastJobId && jobFresh) {
      pollGenerationUpdates(caseIdForJob);
      return;
    }
    if (!caseIdForJob) {
      const orgIdFromToken = await getCurrentUserOrgId().catch((e) => {
        console.warn('[CaseForm] Failed to fetch orgId from token (generation)', e);
        return null;
      });
      const resolvedOrgId = orgIdFromToken ?? userProfile?.orgId ?? null;
      const resolvedRole = role || 'unknown';

      if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && !resolvedOrgId) {
        showModal(
          'Your account is missing an orgId. Please contact an admin to set your organization before generating documents.',
          'Permission Needed'
        );
        return;
      }

      let parsedLayoutConfig = {};
      if (layoutConfigRaw && layoutConfigRaw.trim()) {
        try {
          const parsed = JSON.parse(layoutConfigRaw);
          if (parsed && typeof parsed === 'object') parsedLayoutConfig = parsed;
        } catch {
          // Keep generation resilient; layout config can be fixed before final publish.
        }
      }

      const rosterIds = Array.isArray(selectedUserIds)
        ? Array.from(new Set(selectedUserIds)).filter(Boolean)
        : [];
      const visibleToUserIds = publicVisible ? [] : rosterIds;
      const resolvedCaseGroupId =
        caseGroupSelection === '__custom'
          ? (customCaseGroupId || '').trim() || null
          : caseGroupSelection && caseGroupSelection !== '__none'
          ? caseGroupSelection
          : null;

      const title = (caseName || '').trim() || 'Untitled draft';

      const draftPayload = {
        caseName: title,
        title,
        orgId: resolvedOrgId,
        workpaper: { layoutType, layoutConfig: parsedLayoutConfig },
        instruction,
        disbursements,
        invoiceMappings: [],
        referenceDocuments,
        visibleToUserIds,
        publicVisible,
        status: 'draft',
        opensAt: null,
        dueAt: null,
        createdBy: userId,
        _deleted: false,
        auditArea,
        moduleId: moduleId || null,
        recipeVersion: Number.isFinite(Number(recipeVersion)) ? Number(recipeVersion) : 1,
        caseGroupId: resolvedCaseGroupId,
      };

      try {
        caseIdForJob = await createCase(draftPayload);
        setDraftCaseId(caseIdForJob);
        try {
          await saveCaseGenerationPlan({ caseId: caseIdForJob, plan: generationPlan });
        } catch (err) {
          console.warn('[case-form] Failed to store generation plan for draft case', err);
          if (err?.code === 'permission-denied') {
            showModal(
              'Permission denied saving generation plan. Confirm your role is admin/instructor and Firestore rules are deployed.',
              'Generation Error'
            );
            return;
          }
        }
      } catch (error) {
        console.error('[case-form] Failed to create draft case for generation', error);
        showModal(error?.message || 'Unable to create a draft case for generation.', 'Generation Error');
        return;
      }
    }
    try {
      let planForJob = generationPlan;
      if (
        !planForJob ||
        !Array.isArray(planForJob.referenceDocumentSpecs) ||
        planForJob.referenceDocumentSpecs.length === 0
      ) {
        const refreshedPlan = await fetchCaseGenerationPlan({ caseId: caseIdForJob }).catch(() => null);
        if (refreshedPlan) {
          setGenerationPlan(refreshedPlan);
          planForJob = refreshedPlan;
        }
      }
      if (
        !planForJob ||
        !Array.isArray(planForJob.referenceDocumentSpecs) ||
        planForJob.referenceDocumentSpecs.length === 0
      ) {
        showModal('No valid generation plan found for this case.', 'Generation Error');
        return;
      }

      let result = await queueCaseGenerationJob({
        caseId: caseIdForJob,
        plan: planForJob,
        appId,
      });
      if (!result?.jobId) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        result = await queueCaseGenerationJob({
          caseId: caseIdForJob,
          plan: planForJob,
          appId,
        });
      }
      if (!result?.jobId) {
        showModal('Generation job did not return an id. Please retry.', 'Generation Error');
        return;
      }
      setGenerationPlan((prev) =>
        prev
          ? {
              ...prev,
              lastJob: {
                ...(prev.lastJob || {}),
                jobId: result.jobId,
                status: 'queued',
                updatedAt: new Date().toISOString(),
              },
            }
          : prev
      );
      pollGenerationUpdates(caseIdForJob);
    } catch (error) {
      console.error('[case-form] Failed to queue generation job', error);
      showModal(formatGenerationError(error, 'Unable to queue generation job.'), 'Generation Error');
    }
  }, [
    generationPlan,
    editingCaseId,
    draftCaseId,
    showModal,
    setGenerationPlan,
    layoutConfigRaw,
    selectedUserIds,
    publicVisible,
    caseGroupSelection,
    customCaseGroupId,
    caseName,
    userProfile,
    role,
    userId,
    auditArea,
    instruction,
    disbursements,
    referenceDocuments,
    layoutType,
    moduleId,
    recipeVersion,
    formatGenerationError,
    pollGenerationUpdates,
    toSafeDate,
  ]);

  // Auto-queue removed to prevent UI freeze. Use manual trigger in ReviewStep.

  const handleDisbursementChange = (index, updatedItem) => {
    setDisbursements((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        let nextItem = updatedItem;
        if (nextItem.answerKeyMode !== 'split') {
          const classification = nextItem.answerKeySingleClassification || DEFAULT_ANSWER_KEY_CLASSIFICATION;
          const amountNumber = Number(nextItem.amount || 0);
          const explanation = nextItem.answerKey?.explanation || '';
          const meta = extractAnswerKeyMeta(nextItem.answerKey);
          nextItem = {
            ...nextItem,
            answerKey: buildSingleAnswerKey(classification, amountNumber, explanation, meta),
          };
        }
        return nextItem;
      })
    );
  };
  const addDisbursement = () => setDisbursements([...disbursements, initialDisbursement()]);
  const removeDisbursement = (index) => setDisbursements(disbursements.filter((_, i) => i !== index));

  const addMappingToDisbursement = (disbursementTempId) => {
    setDisbursements((prev) =>
      prev.map((disbursement) => {
        if (disbursement._tempId !== disbursementTempId) return disbursement;
        const newMapping = {
          ...initialMapping(),
          disbursementTempId,
          paymentId: disbursement.paymentId,
        };
        return {
          ...disbursement,
          mappings: [...(disbursement.mappings || []), newMapping],
        };
      })
    );
  };

  const handleOutstandingChange = (index, updates) => {
    setCashOutstandingItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item))
    );
  };
  const addOutstandingItem = () => setCashOutstandingItems((prev) => [...prev, initialOutstandingItem()]);
  const removeOutstandingItem = (index) =>
    setCashOutstandingItems((prev) => prev.filter((_, i) => i !== index));

  const handleCutoffChange = (index, updates) => {
    setCashCutoffItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item))
    );
  };
  const addCutoffItem = () => setCashCutoffItems((prev) => [...prev, initialCutoffItem()]);
  const removeCutoffItem = (index) => setCashCutoffItems((prev) => prev.filter((_, i) => i !== index));

  const handleCashRegisterChange = (index, updates) => {
    setCashRegisterItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item))
    );
  };
  const addCashRegisterItem = () => setCashRegisterItems((prev) => [...prev, initialCashRegisterItem()]);
  const removeCashRegisterItem = (index) =>
    setCashRegisterItems((prev) => prev.filter((_, i) => i !== index));

  const handleReconciliationMapChange = (index, updates) => {
    setCashReconciliationMap((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item))
    );
  };
  const addReconciliationMap = () => setCashReconciliationMap((prev) => [...prev, initialReconciliationMap()]);
  const removeReconciliationMap = (index) =>
    setCashReconciliationMap((prev) => prev.filter((_, i) => i !== index));

  const removeMappingFromDisbursement = (disbursementTempId, mappingTempId) => {
    setDisbursements((prev) =>
      prev.map((disbursement) => {
        if (disbursement._tempId !== disbursementTempId) return disbursement;
        return {
          ...disbursement,
          mappings: (disbursement.mappings || []).filter((mapping) => mapping._tempId !== mappingTempId),
        };
      })
    );
  };

  const updateHighlightedDocumentForDisbursement = (disbursementTempId, updater) => {
    setDisbursements((prev) =>
      prev.map((disbursement) => {
        if (disbursement._tempId !== disbursementTempId) return disbursement;
        const currentDoc = disbursement.highlightedDocument || initialHighlightedDocument();
        return { ...disbursement, highlightedDocument: updater(currentDoc) };
      })
    );
  };

  const handleClearHighlightedDocument = (disbursementTempId) => {
    updateHighlightedDocumentForDisbursement(disbursementTempId, () => initialHighlightedDocument());
  };

  const syncMappingsWithPaymentId = (disbursementTempId, newPaymentId) => {
    setDisbursements((prev) =>
      prev.map((disbursement) => {
        if (disbursement._tempId !== disbursementTempId) return disbursement;
        return {
          ...disbursement,
          mappings: (disbursement.mappings || []).map((mapping) => ({
            ...mapping,
            paymentId: newPaymentId,
          })),
        };
      })
    );
  };

  const handleReferenceDocChange = (index, updatedItem) => {
    const next = [...referenceDocuments];
    next[index] = updatedItem;
    setReferenceDocuments(next);
  };

  const updateAnswerKeyForDisbursement = (disbursementIndex, updater) => {
    setDisbursements((prev) =>
      prev.map((disbursement, index) => {
        if (index !== disbursementIndex) return disbursement;
        return updater(disbursement);
      })
    );
  };

  const handleCashArtifactChange = (index, updates) => {
    setCashArtifacts((prev) => prev.map((doc, i) => (i === index ? { ...doc, ...updates } : doc)));
  };

  const addReferenceDocument = () => {
    setReferenceDocuments([...referenceDocuments, initialReferenceDocument()]);
  };

  const removeReferenceDocument = (index) => {
    setReferenceDocuments(referenceDocuments.filter((_, i) => i !== index));
  };

  const addFaClass = () => setFaSummary((prev) => [...prev, initialFaClass()]);
  const addFaAddition = () => setFaAdditions((prev) => [...prev, initialFaAddition()]);
  const addFaDisposal = () => setFaDisposals((prev) => [...prev, initialFaDisposal()]);

  const goBack = () => navigate('/admin');

  const generateCaseDraft = useCallback(
    async (recipeId, overrides = {}) => {
      try {
        const startedAt = Date.now();
        if (DEBUG_LOGS) {
          console.info('[case-form] generateCaseDraft:start', { recipeId, overrides });
        }
        const draft = await generateCaseDraftFromServer({ recipeId, overrides });
        if (DEBUG_LOGS) {
          console.info('[case-form] generateCaseDraft:buildComplete', {
            recipeId,
            ms: Date.now() - startedAt,
          });
        }
        setCaseName(draft.caseName);
        setAuditArea(draft.auditArea);
        setLayoutType(draft.layoutType);
        setLayoutConfigRaw(draft.layoutConfigRaw || '');
        setInstruction(draft.instruction);
        setModuleId(draft.moduleId || draft.recipeId || '');
        if (draft.recipeVersion !== undefined && draft.recipeVersion !== null) {
          const parsedVersion = Number(draft.recipeVersion);
          setRecipeVersion(Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : 1);
        }
        setDisbursements(draft.disbursements);
        setReferenceDocuments(draft.referenceDocuments);
        if (draft.cashContext) setCashContext(draft.cashContext);
        if (draft.cashOutstandingItems) setCashOutstandingItems(draft.cashOutstandingItems);
        if (draft.cashCutoffItems) setCashCutoffItems(draft.cashCutoffItems);
        if (draft.cashRegisterItems) setCashRegisterItems(draft.cashRegisterItems);
        if (draft.cashReconciliationMap) setCashReconciliationMap(draft.cashReconciliationMap);
        if (draft.faSummary) setFaSummary(draft.faSummary);
        if (draft.faRisk) setFaRisk(draft.faRisk);
        if (draft.faAdditions) setFaAdditions(draft.faAdditions);
        if (draft.faDisposals) setFaDisposals(draft.faDisposals);
        setGenerationPlan(draft.generationPlan || null);
        if (draft.generationPlan?.yearEnd) {
          setYearEndInput(draft.generationPlan.yearEnd);
          setYearEndValue(draft.generationPlan.yearEnd);
        }
        if (draft.generationPlan?.caseLevel) {
          setCaseLevel(draft.generationPlan.caseLevel);
        }
        setHasGeneratedDraft(true);
        if (DEBUG_LOGS) {
          console.info('[case-form] generateCaseDraft:stateApplied', {
            recipeId,
            ms: Date.now() - startedAt,
          });
        }
        return true;
      } catch (error) {
        console.error('[case-form] Failed to generate case draft', error);
        showModal(error.message || 'Unable to generate case draft.', 'Generation Error');
        return false;
      }
    },
    [generateCaseDraftFromServer, showModal]
  );

  const resetGeneratedDraft = useCallback(() => {
    resetFormForNewCase();
  }, [resetFormForNewCase]);

  const basics = {
    caseName,
    setCaseName,
    auditArea,
    setAuditArea,
    yearEndInput,
    setYearEndInput,
    yearEndValue,
    yearEndError,
    caseLevel,
    setCaseLevel,
    caseLevelOptions: CASE_LEVEL_OPTIONS,
    moduleId,
    setModuleId,
    recipeVersion,
    setRecipeVersion,
    overrideDefaults,
    setOverrideDefaults,
    overrideDisbursementCount,
    setOverrideDisbursementCount,
    overrideVendorCount,
    setOverrideVendorCount,
    overrideInvoicesPerVendor,
    setOverrideInvoicesPerVendor,
    layoutType,
    setLayoutType,
    workpaperLayoutOptions: WORKPAPER_LAYOUT_OPTIONS,
    layoutConfigRaw,
    setLayoutConfigRaw,
    auditAreaSelectOptions,
    caseGroupSelection,
    setCaseGroupSelection,
    caseGroupSelectOptions,
    customCaseGroupId,
    setCustomCaseGroupId,
    status,
    setStatus,
    statusOptions: STATUS_OPTIONS,
    cashContext,
    setCashContext,
  };

  const audience = {
    publicVisible,
    setPublicVisible,
    selectedUserIds,
    setSelectedUserIds,
    rosterOptions,
    rosterLoading,
    rosterError,
    opensAtStr,
    setOpensAtStr,
    dueAtStr,
    setDueAtStr,
  };

  const transactions = {
    disbursements,
    handleDisbursementChange,
    addDisbursement,
    removeDisbursement,
    addMappingToDisbursement,
    removeMappingFromDisbursement,
    handleMappingFileSelect,
    handleHighlightedDocumentSelect,
    handleClearHighlightedDocument,
    syncMappingsWithPaymentId,
    disbursementCsvInputRef,
    handleCsvImport,
    auditArea,
    cashContext,
    setCashContext,
    cashOutstandingItems,
    cashCutoffItems,
    cashRegisterItems,
    cashReconciliationMap,
    handleOutstandingChange,
    addOutstandingItem,
    removeOutstandingItem,
    handleCutoffChange,
    addCutoffItem,
    removeCutoffItem,
    handleCashRegisterChange,
    addCashRegisterItem,
    removeCashRegisterItem,
    handleReconciliationMapChange,
    addReconciliationMap,
    removeReconciliationMap,
    addFaClass,
    addFaAddition,
    addFaDisposal,
    faSummary,
    setFaSummary,
    faRisk,
    setFaRisk,
    faAdditions,
    setFaAdditions,
    faDisposals,
    setFaDisposals,
  };

  const attachments = {
    disbursements,
    referenceDocuments,
    handleReferenceDocChange,
    addReferenceDocument,
    removeReferenceDocument,
    handleReferenceDocFileSelect,
    cashArtifacts,
    handleCashArtifactChange,
    handleCashArtifactFileSelect,
    auditArea,
  };

  const answerKey = {
    disbursements,
    updateAnswerKeyForDisbursement,
    classificationFields,
    answerKeyLabels,
    answerKeyClassificationOptions,
  };

  const instructionData = {
    instruction,
    setInstruction,
  };

  const files = {
    FILE_INPUT_ACCEPT,
    prettySupportedLabels,
    MAX_ARTIFACT_BYTES,
  };

  return {
    meta: { isEditing, editingCaseId },
    status: { loading },
    basics,
    audience,
    transactions,
    attachments,
    answerKey,
    instructionData,
    files,
    generation: {
      recipes: caseRecipeOptions,
      generationPlan,
      generateCaseDraft,
      queueGenerationJob,
      hasGeneratedDraft,
      generationPolling,
    },
    actions: { handleSubmit, goBack, resetGeneratedDraft },
  };
}

export default useCaseForm;
