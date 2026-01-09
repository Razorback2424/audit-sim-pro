import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { useAuth, useRoute, useModal, appId, storage } from '../AppCore';
import { fetchCase, createCase } from '../services/caseService';
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
import { STATUS_OPTIONS, WORKPAPER_LAYOUT_OPTIONS } from '../constants/caseFormOptions';
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
} from '../services/caseGenerationService';
import { buildCaseDraftFromRecipe } from '../generation/buildCaseDraft';
import { listCaseRecipes } from '../generation/recipeRegistry';

const DRAFT_STORAGE_KEY = 'audit_sim_case_draft_v1';
const DEFAULT_LAYOUT_TYPE = 'two_pane';
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120000;

const canUseLocalStorage = () => {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
};

function useCaseForm({ params }) {
  const { caseId: editingCaseId } = params || {};
  const isEditing = !!editingCaseId;
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { userProfile, role } = useUser();
  const { showModal } = useModal();

  const [caseName, setCaseName] = useState('');
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

  const disbursementCsvInputRef = useRef(null);
  const draftPermissionRef = useRef(null);
  const highlightStartRef = useRef(false);
  const highlightStartTimerRef = useRef(null);
  const highlightInflightRef = useRef({});
  const mappingInflightRef = useRef({});
  const disbursementsRef = useRef(disbursements);
  const generationPollingRef = useRef(false);

  const auditAreaSelectOptions = useMemo(
    () => AUDIT_AREA_VALUES.map((value) => ({ value, label: AUDIT_AREA_LABELS[value] || value })),
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

  const draftStorageKey = useMemo(() => {
    if (isEditing && editingCaseId) return `${DRAFT_STORAGE_KEY}__${editingCaseId}`;
    if (isEditing) return `${DRAFT_STORAGE_KEY}__editing`;
    return `${DRAFT_STORAGE_KEY}__new`;
  }, [editingCaseId, isEditing]);

  const restoreDraftFromStorage = useCallback(() => {
    if (!canUseLocalStorage()) return;
    try {
      const savedDraft = window.localStorage.getItem(draftStorageKey);
      if (!savedDraft) return;
      const parsed = JSON.parse(savedDraft);
      if (!parsed || !parsed.updatedAt) return;

      if (draftPermissionRef.current === null) {
        const confirmLoad = window.confirm(
          isEditing
            ? 'We found an unsaved draft for this case. Would you like to restore it?'
            : 'Restoring your unsaved new case draft...'
        );
        draftPermissionRef.current = confirmLoad;
        if (!confirmLoad) {
          window.localStorage.removeItem(draftStorageKey);
        }
      }

      if (draftPermissionRef.current === true) {
        if (parsed.caseName) setCaseName(parsed.caseName);
        if (parsed.auditArea) setAuditArea(parsed.auditArea);
        if (parsed.instruction) setInstruction(parsed.instruction);
        if (parsed.disbursements) setDisbursements(parsed.disbursements);
        if (parsed.draftCaseId) setDraftCaseId(parsed.draftCaseId);
        if (parsed.layoutType) setLayoutType(parsed.layoutType);
        if (parsed.layoutConfigRaw) setLayoutConfigRaw(parsed.layoutConfigRaw);
        if (parsed.publicVisible !== undefined) setPublicVisible(parsed.publicVisible);
        if (parsed.cashContext) setCashContext(parsed.cashContext);
        if (parsed.cashOutstandingItems) setCashOutstandingItems(parsed.cashOutstandingItems);
        if (parsed.cashCutoffItems) setCashCutoffItems(parsed.cashCutoffItems);
        if (parsed.cashRegisterItems) setCashRegisterItems(parsed.cashRegisterItems);
        if (parsed.faSummary) setFaSummary(parsed.faSummary);
        if (parsed.faRisk) setFaRisk(parsed.faRisk);
        if (parsed.faAdditions) setFaAdditions(parsed.faAdditions);
        if (parsed.faDisposals) setFaDisposals(parsed.faDisposals);
        if (parsed.referenceDocuments) setReferenceDocuments(parsed.referenceDocuments);
        if (parsed.generationPlan) setGenerationPlan(parsed.generationPlan);
      }
    } catch (err) {
      console.error('Failed to restore draft', err);
    }
  }, [draftStorageKey, isEditing]);

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
      auditArea,
      layoutType,
      layoutConfigRaw,
      publicVisible,
      disbursements: stripClientFilesForDraft(disbursements),
      instruction,
      cashContext,
      cashOutstandingItems,
      cashCutoffItems,
      cashRegisterItems,
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
        window.localStorage.setItem(draftStorageKey, JSON.stringify(draftData));
      } catch (err) {
        console.error('Failed to save draft', err);
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [
    caseName,
    auditArea,
    layoutType,
    layoutConfigRaw,
    publicVisible,
    disbursements,
    instruction,
    cashContext,
    cashOutstandingItems,
    cashCutoffItems,
    cashRegisterItems,
    faSummary,
    faRisk,
    faAdditions,
    faDisposals,
    referenceDocuments,
    generationPlan,
    draftCaseId,
    draftStorageKey,
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
      console.info('[case-upload]', event, data);
      if (event === 'error:resumable' && data?.error?.serverResponse) {
        console.info('[case-upload] serverResponse', data.error.serverResponse);
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
    const ready = generated.filter((doc) => doc.downloadURL || doc.storagePath).length;
    return {
      total: generated.length,
      ready,
      pending: Math.max(0, generated.length - ready),
    };
  }, []);

  const resolveReferenceDownloadUrls = useCallback(async (docs) => {
    if (!Array.isArray(docs) || docs.length === 0) return docs;
    const resolved = await Promise.all(
      docs.map(async (doc) => {
        if (!doc || doc.downloadURL || !doc.storagePath) return doc;
        try {
          const url = await getDownloadURL(storageRef(storage, doc.storagePath));
          return { ...doc, downloadURL: url };
        } catch (err) {
          console.warn('[case-form] Failed to resolve download URL', err);
          return doc;
        }
      })
    );
    return resolved;
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
        const updated = await fetchCase(caseIdForJob).catch(() => null);
        if (updated?.referenceDocuments) {
          const normalized = normalizeReferenceDocumentsForForm(updated.referenceDocuments);
          const resolved = await resolveReferenceDownloadUrls(normalized);
          setReferenceDocuments(resolved);
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
  });

  const handleSubmit = createCaseFormSubmitHandler({
    meta: { isEditing, editingCaseId, draftCaseId },
    state: {
      caseName,
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

  const resetFormForNewCase = useCallback(() => {
    setCaseName('');
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
  }, []);

  useEffect(() => {
    if (isEditing && editingCaseId) {
      setLoading(true);
      fetchCase(editingCaseId)
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
            setCashArtifacts([...(Array.isArray(data.cashArtifacts) ? data.cashArtifacts : [])]);
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
  ]);

  const queueGenerationJob = useCallback(async () => {
    if (!generationPlan) {
      showModal('No generation plan found for this case.', 'Generation');
      return;
    }
    if (role && role !== 'admin' && role !== 'instructor') {
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

      if (resolvedRole !== 'admin' && !resolvedOrgId) {
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
    formatGenerationError,
    pollGenerationUpdates,
    toSafeDate,
  ]);

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
    (recipeId, overrides = {}) => {
      try {
        const draft = buildCaseDraftFromRecipe({ recipeId, overrides });
        setCaseName(draft.caseName);
        setAuditArea(draft.auditArea);
        setLayoutType(draft.layoutType);
        setLayoutConfigRaw(draft.layoutConfigRaw || '');
        setInstruction(draft.instruction);
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
        setHasGeneratedDraft(true);
      } catch (error) {
        console.error('[case-form] Failed to generate case draft', error);
        showModal(error.message || 'Unable to generate case draft.', 'Generation Error');
      }
    },
    [showModal]
  );

  const resetGeneratedDraft = useCallback(() => {
    resetFormForNewCase();
  }, [resetFormForNewCase]);

  const basics = {
    caseName,
    setCaseName,
    auditArea,
    setAuditArea,
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
