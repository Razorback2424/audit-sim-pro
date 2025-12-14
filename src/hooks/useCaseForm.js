import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { storage, appId } from '../AppCore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { useAuth, useRoute, useModal } from '../AppCore';
import { fetchCase, createCase, updateCase } from '../services/caseService';
import { fetchUserRosterOptions } from '../services/userService';
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
  ANSWER_KEY_FIELDS,
  ANSWER_KEY_TOLERANCE,
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
import { FILE_INPUT_ACCEPT, prettySupportedLabels, isSupportedFile, pickContentType, ensureSafeStorageName } from '../utils/caseFileHelpers';
import { mergeDisbursementDocuments } from '../utils/caseFormTransforms';
import { useUser } from '../AppCore';
import { getCurrentUserOrgId } from '../services/userService';

const DRAFT_STORAGE_KEY = 'audit_sim_case_draft_v1';

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
  const [layoutType, setLayoutType] = useState('two_pane');
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

  const disbursementCsvInputRef = useRef(null);
  const draftPermissionRef = useRef(null);
  const highlightStartRef = useRef(false);
  const highlightStartTimerRef = useRef(null);
  const highlightInflightRef = useRef({});
  const mappingInflightRef = useRef({});
  const disbursementsRef = useRef(disbursements);

  const auditAreaSelectOptions = useMemo(
    () => AUDIT_AREA_VALUES.map((value) => ({ value, label: AUDIT_AREA_LABELS[value] || value })),
    []
  );

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
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const savedDraft = window.localStorage.getItem(draftStorageKey);
      if (!savedDraft) return;
      const parsed = JSON.parse(savedDraft);
      if (!parsed || !parsed.updatedAt) return;

      // Ask for permission once; remember the user's choice across renders.
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
        if (parsed.faSummary) setFaSummary(parsed.faSummary);
        if (parsed.faRisk) setFaRisk(parsed.faRisk);
        if (parsed.faAdditions) setFaAdditions(parsed.faAdditions);
        if (parsed.faDisposals) setFaDisposals(parsed.faDisposals);
        if (parsed.referenceDocuments) setReferenceDocuments(parsed.referenceDocuments);
      }
    } catch (err) {
      console.error('Failed to restore draft', err);
    }
  }, [draftStorageKey, isEditing]);

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
            // File objects are not serializable; remove them from draft storage.
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

  // --- AUTO-SAVE LOGIC START ---
  useEffect(() => {
    if (!isHydratedForDrafts) return;
    if (typeof window === 'undefined' || !window.localStorage) return;

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
    faSummary,
    faRisk,
    faAdditions,
    faDisposals,
    referenceDocuments,
    draftCaseId,
    draftStorageKey,
    isHydratedForDrafts,
    stripClientFilesForDraft,
  ]);
  // --- AUTO-SAVE LOGIC END ---

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

  const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
  const UPLOAD_TIMEOUT_MS = 120000;
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

  const ensureUploadCaseId = useCallback(async () => {
    if (editingCaseId) return editingCaseId;
    if (draftCaseId) return draftCaseId;

    const orgIdFromToken = await getCurrentUserOrgId().catch((e) => {
      console.warn('[CaseForm] Failed to fetch orgId from token (draft create)', e);
      return null;
    });
    const resolvedOrgId = orgIdFromToken ?? userProfile?.orgId ?? null;
    const resolvedRole = role || 'unknown';

    if (resolvedRole !== 'admin' && !resolvedOrgId) {
      const message =
        'Your account is missing an orgId. Please contact an admin to set your organization before uploading files.';
      showModal(message, 'Permission Needed');
      throw new Error(message);
    }

    let parsedLayoutConfig = {};
    if (layoutConfigRaw && layoutConfigRaw.trim()) {
      try {
        const parsed = JSON.parse(layoutConfigRaw);
        if (parsed && typeof parsed === 'object') parsedLayoutConfig = parsed;
      } catch {
        // Keep draft creation resilient; layout config can be fixed before final save.
      }
    }

    const rosterIds = Array.isArray(selectedUserIds) ? Array.from(new Set(selectedUserIds)).filter(Boolean) : [];
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
      disbursements: [],
      invoiceMappings: [],
      referenceDocuments: [],
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

    ulog('draft-case:create', { status: draftPayload.status, auditArea, publicVisible, visibleToUserIdsCount: visibleToUserIds.length });
    const createdId = await createCase(draftPayload);
    setDraftCaseId(createdId);
    ulog('draft-case:created', { caseId: createdId });
    return createdId;
  }, [
    editingCaseId,
    draftCaseId,
    userProfile?.orgId,
    role,
    layoutConfigRaw,
    selectedUserIds,
    publicVisible,
    caseGroupSelection,
    customCaseGroupId,
    caseName,
    layoutType,
    instruction,
    userId,
    auditArea,
    showModal,
  ]);

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

  const sanitizeHighlightedDocumentForSave = (doc) => {
    if (!doc || typeof doc !== 'object') return undefined;
    const fileName = (doc.fileName || '').trim();
    const storagePath = (doc.storagePath || '').trim();
    const downloadURL = (doc.downloadURL || '').trim();
    if (!fileName && !storagePath && !downloadURL) return undefined;
    const payload = {};
    if (fileName) payload.fileName = fileName;
    if (storagePath) payload.storagePath = storagePath;
    if (downloadURL) payload.downloadURL = downloadURL;
    if (doc.contentType) payload.contentType = doc.contentType;
    return payload;
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
      fetchCase(editingCaseId)
        .then((data) => {
          if (data) {
            setOriginalCaseData(data);
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
                  answerKeySingleClassification: derived.classification || DEFAULT_ANSWER_KEY_CLASSIFICATION,
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
              data.referenceDocuments && data.referenceDocuments.length > 0
                ? data.referenceDocuments.map((doc) => ({
                    _tempId: doc._tempId || getUUID(),
                    fileName: doc.fileName || '',
                    storagePath: doc.storagePath || '',
                    downloadURL: doc.downloadURL || '',
                    clientSideFile: null,
                    uploadProgress: doc.storagePath ? 100 : undefined,
                    uploadError: null,
                    contentType: doc.contentType || '',
                  }))
                : [initialReferenceDocument()]
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
                : 'two_pane');
            setLayoutType(inferredLayout);
            const incomingLayoutConfig =
              data?.workpaper && typeof data.workpaper.layoutConfig === 'object' && data.workpaper.layoutConfig !== null
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
      setCaseName('');
      setSelectedUserIds([]);
      setPublicVisible(true);
      setStatus('assigned');
      setOpensAtStr('');
      setDueAtStr('');
      setDisbursements([initialDisbursement()]);
      setReferenceDocuments([initialReferenceDocument()]);
      setCashContext({
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
      setLayoutType('two_pane');
      setLayoutConfigRaw('');
      setOriginalCaseData(null);
      setAuditArea(DEFAULT_AUDIT_AREA);
      setCaseGroupSelection('__none');
      setCustomCaseGroupId('');

      restoreDraftFromStorage();
      setIsHydratedForDrafts(true);
    }
  }, [isEditing, editingCaseId, navigate, showModal, restoreDraftFromStorage]);

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

  const updateMappingForDisbursement = (disbursementTempId, mappingTempId, updater) => {
    setDisbursements((prev) =>
      prev.map((disbursement) => {
        if (disbursement._tempId !== disbursementTempId) return disbursement;
        return {
          ...disbursement,
          mappings: (disbursement.mappings || []).map((mapping) =>
            mapping._tempId === mappingTempId ? updater(mapping) : mapping
          ),
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

  const startImmediateMappingUpload = async (disbursementTempId, mappingTempId, caseIdForUpload) => {
    if (!caseIdForUpload) return;
    const inflightKey = `${disbursementTempId}__${mappingTempId}`;
    if (mappingInflightRef.current[inflightKey]) {
      ulog('mapping:skip:inflight', { inflightKey });
      return;
    }
    if (!navigator.onLine) {
      ulog('mapping:skip:offline', { inflightKey });
      updateMappingForDisbursement(disbursementTempId, mappingTempId, (mapping) => ({
        ...mapping,
        uploadError: 'Browser is offline',
        uploadProgress: undefined,
      }));
      return;
    }

    const latestDisbursement = (disbursementsRef.current || []).find((d) => d?._tempId === disbursementTempId);
    const latestMapping = (latestDisbursement?.mappings || []).find((m) => m?._tempId === mappingTempId);
    if (!latestMapping?.clientSideFile) {
      ulog('mapping:skip:no-client-file', { inflightKey });
      return;
    }

    try {
      mappingInflightRef.current[inflightKey] = true;
      ulog('mapping:auto-upload:start', { inflightKey, caseIdForUpload });

      const result = await uploadFileAndGetMetadata(
        {
          ...latestMapping,
          paymentId: latestDisbursement?.paymentId || latestMapping.paymentId,
          disbursementTempId,
        },
        caseIdForUpload
      );

      if (result?.uploadError) {
        ulog('mapping:auto-upload:error', { inflightKey, error: result.uploadError });
        updateMappingForDisbursement(disbursementTempId, mappingTempId, (mapping) => ({
          ...mapping,
          uploadError: result.uploadError,
          uploadProgress: undefined,
        }));
        return;
      }

      ulog('mapping:auto-upload:done', { inflightKey, storagePath: result.storagePath });
      updateMappingForDisbursement(disbursementTempId, mappingTempId, (mapping) => ({
        ...mapping,
        fileName: result.fileName || mapping.fileName,
        storagePath: result.storagePath || mapping.storagePath,
        downloadURL: result.downloadURL || mapping.downloadURL,
        contentType: result.contentType || mapping.contentType,
        clientSideFile: null,
        uploadProgress: 100,
        uploadError: null,
      }));
    } catch (err) {
      console.error('[CaseForm] Immediate mapping upload failed', err);
      showModal(`Could not upload the invoice right now: ${err.message}`, 'Upload Error');
      updateMappingForDisbursement(disbursementTempId, mappingTempId, (mapping) => ({
        ...mapping,
        uploadError: err?.message || 'Upload failed',
        uploadProgress: undefined,
      }));
    } finally {
      delete mappingInflightRef.current[inflightKey];
    }
  };

  const handleMappingFileSelect = async (disbursementTempId, mappingTempId, file) => {
    if (!file) return;
    if (!isSupportedFile(file)) {
      ulog('reject:unsupported-file', { mappingTempId, name: file.name, type: file.type });
      showModal(`Unsupported file type. Allowed formats: ${prettySupportedLabels}.`, 'Invalid File Type');
      return;
    }
    if (file.size > MAX_ARTIFACT_BYTES) {
      ulog('reject:too-large', { mappingTempId, name: file.name, size: file.size });
      showModal(`File must be under ${Math.round(MAX_ARTIFACT_BYTES / (1024 * 1024))} MB.`, 'File Too Large');
      return;
    }
    ulog('select', { mappingTempId, name: file.name, type: file.type, size: file.size });
    const contentType = pickContentType(file);
    updateMappingForDisbursement(disbursementTempId, mappingTempId, (mapping) => ({
      ...mapping,
      clientSideFile: file,
      fileName: file.name,
      storagePath: '',
      uploadProgress: undefined,
      uploadError: null,
      downloadURL: '',
      contentType,
    }));

    try {
      const caseIdForUpload = await ensureUploadCaseId();
      await startImmediateMappingUpload(disbursementTempId, mappingTempId, caseIdForUpload);
    } catch (err) {
      // Draft case creation/upload can fail (permissions/network). Keep selection intact so it can upload on Save later.
      ulog('mapping:auto-upload:setup-failed', { message: err?.message });
    }
  };

  const handleHighlightedDocumentSelect = async (disbursementTempId, file) => {
    if (!file) return;
    if (!isSupportedFile(file)) {
      ulog('highlight:reject:unsupported-file', { disbursementTempId, name: file.name, type: file.type });
      showModal(`Unsupported file type. Allowed formats: ${prettySupportedLabels}.`, 'Invalid File Type');
      return;
    }
    if (file.size > MAX_ARTIFACT_BYTES) {
      ulog('highlight:reject:too-large', { disbursementTempId, name: file.name, size: file.size });
      showModal(`File must be under ${Math.round(MAX_ARTIFACT_BYTES / (1024 * 1024))} MB.`, 'File Too Large');
      return;
    }
    ulog('highlight:select', {
      disbursementTempId,
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
    });

    const contentType = pickContentType(file);
    let nextDocForUpload = null;
    let nextDisbursement = null;

    setDisbursements((prev) => {
      let found = false;
      const nextList = prev.map((disbursement) => {
        if (disbursement._tempId !== disbursementTempId) return disbursement;
        found = true;
        const currentDoc = disbursement.highlightedDocument || initialHighlightedDocument();
        const nextDoc = {
          ...currentDoc,
          clientSideFile: file,
          fileName: currentDoc?.fileName || file.name,
          storagePath: '',
          downloadURL: '',
          uploadProgress: undefined,
          uploadError: null,
          contentType,
        };
        nextDocForUpload = nextDoc;
        nextDisbursement = { ...disbursement, highlightedDocument: nextDoc };
        return nextDisbursement;
      });
      if (!found) {
        ulog('highlight:disbursement-not-found', { disbursementTempId, disbursementIds: prev.map((d) => d._tempId) });
      }
      return nextList;
    });

    ulog('highlight:state-after-select', {
      disbursementTempId,
      hasClientFile: !!nextDocForUpload?.clientSideFile,
      fileName: nextDocForUpload?.fileName,
    });

    try {
      const caseIdForUpload = await ensureUploadCaseId();
      if (caseIdForUpload && nextDisbursement) {
        startImmediateHighlightUpload(disbursementTempId, caseIdForUpload, nextDisbursement);
      }
    } catch (err) {
      ulog('highlight:auto-upload:setup-failed', { message: err?.message });
    }
  };

  const handleClearHighlightedDocument = (disbursementTempId) => {
    updateHighlightedDocumentForDisbursement(disbursementTempId, () => initialHighlightedDocument());
  };

  const startImmediateHighlightUpload = async (disbursementTempId, caseIdForUpload, overrideDisbursement) => {
    if (!caseIdForUpload) return;
    if (highlightInflightRef.current[disbursementTempId]) {
      ulog('highlight:skip:inflight', { disbursementTempId });
      return;
    }
    const target =
      overrideDisbursement ||
      disbursements.find((d) => d?._tempId === disbursementTempId) ||
      disbursements.find((d) => d?.paymentId === disbursementTempId);
    if (!target || !target.highlightedDocument?.clientSideFile) {
      ulog('highlight:skip:no-client-file', { disbursementTempId });
      return;
    }
    try {
      highlightInflightRef.current[disbursementTempId] = true;
      ulog('highlight:auto-upload:start', { disbursementTempId, caseIdForUpload });
      const result = await uploadHighlightedDocument(target, caseIdForUpload);
      if (result?.payload) {
        ulog('highlight:auto-upload:done', { disbursementTempId, storagePath: result.payload.storagePath });
        updateHighlightedDocumentForDisbursement(disbursementTempId, (current) => ({
          ...(current || initialHighlightedDocument()),
          ...result.payload,
          clientSideFile: null,
          uploadProgress: 100,
          uploadError: null,
        }));
      } else if (result?.uploadError) {
        ulog('highlight:auto-upload:error', { disbursementTempId, error: result.uploadError });
        showModal(`Highlighted upload failed: ${result.uploadError}`, 'Upload Error');
      }
    } catch (err) {
      console.error('[CaseForm] Immediate highlight upload failed', err);
      showModal(`Could not upload highlighted document right now: ${err.message}`, 'Upload Error');
    } finally {
      delete highlightInflightRef.current[disbursementTempId];
    }
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

  const handleReferenceDocFileSelect = (index, file) => {
    if (!file) return;
    if (!isSupportedFile(file)) {
      ulog('reference:reject:unsupported-file', { index, name: file.name, type: file.type });
      showModal(`Unsupported reference material. Allowed formats: ${prettySupportedLabels}.`, 'Invalid File Type');
      return;
    }
    if (file.size > MAX_ARTIFACT_BYTES) {
      ulog('reference:reject:too-large', { index, name: file.name, size: file.size });
      showModal(`Reference file must be under ${Math.round(MAX_ARTIFACT_BYTES / (1024 * 1024))} MB.`, 'File Too Large');
      return;
    }

    const contentType = pickContentType(file);
    setReferenceDocuments((prevDocs) =>
      prevDocs.map((doc, i) =>
        i === index
          ? {
              ...doc,
              clientSideFile: file,
              fileName: doc.fileName ? doc.fileName : file.name,
              storagePath: '',
              downloadURL: '',
              uploadProgress: undefined,
              uploadError: null,
              contentType,
            }
          : doc
      )
    );
  };

  const handleCashArtifactFileSelect = (index, file) => {
    if (!file) return;
    if (!isSupportedFile(file)) {
      ulog('cash-artifact:reject:unsupported-file', { index, name: file.name, type: file.type });
      showModal(`Unsupported file. Allowed formats: ${prettySupportedLabels}.`, 'Invalid File Type');
      return;
    }
    if (file.size > MAX_ARTIFACT_BYTES) {
      ulog('cash-artifact:reject:too-large', { index, name: file.name, size: file.size });
      showModal(`File must be under ${Math.round(MAX_ARTIFACT_BYTES / (1024 * 1024))} MB.`, 'File Too Large');
      return;
    }
    const contentType = pickContentType(file);
    setCashArtifacts((prevDocs) =>
      prevDocs.map((doc, i) =>
        i === index
          ? {
              ...doc,
              clientSideFile: file,
              fileName: doc.fileName ? doc.fileName : file.name,
              storagePath: '',
              downloadURL: '',
              uploadProgress: undefined,
              uploadError: null,
              contentType,
            }
          : doc
      )
    );
  };

  const addFaClass = () => setFaSummary((prev) => [...prev, initialFaClass()]);
  const addFaAddition = () => setFaAdditions((prev) => [...prev, initialFaAddition()]);
  const addFaDisposal = () => setFaDisposals((prev) => [...prev, initialFaDisposal()]);
  const handleCashArtifactChange = (index, updates) => {
    setCashArtifacts((prev) => prev.map((doc, i) => (i === index ? { ...doc, ...updates } : doc)));
  };

  const addReferenceDocument = () => {
    setReferenceDocuments([...referenceDocuments, initialReferenceDocument()]);
  };

  const removeReferenceDocument = (index) => {
    setReferenceDocuments(referenceDocuments.filter((_, i) => i !== index));
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

  const handleCsvImport = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const text = String(loadEvent.target?.result || '').trim();
        if (!text) {
          showModal('CSV file appears to be empty.', 'Import Error');
          return;
        }
        const rows = text.split(/\r?\n/).filter(Boolean);
        if (rows.length === 0) {
          showModal('CSV file appears to be empty.', 'Import Error');
          return;
        }
        const [headerLine, ...dataLines] = rows;
        const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
        const paymentIdIdx = headers.indexOf('paymentid');
        const payeeIdx = headers.indexOf('payee');
        const amountIdx = headers.indexOf('amount');
        const paymentDateIdx = headers.indexOf('paymentdate');

        if (paymentIdIdx === -1 || payeeIdx === -1 || amountIdx === -1 || paymentDateIdx === -1) {
          showModal('CSV must include PaymentID, Payee, Amount, PaymentDate columns.', 'Import Error');
          if (disbursementCsvInputRef.current) disbursementCsvInputRef.current.value = '';
          return;
        }

        const imported = dataLines.map((line) => {
          const cells = line.split(',');
          const amountValue = cells[amountIdx]?.trim() || '';
          const amountNumber = Number(amountValue) || 0;
          return {
            _tempId: getUUID(),
            paymentId: cells[paymentIdIdx]?.trim() || '',
            payee: cells[payeeIdx]?.trim() || '',
            amount: amountValue,
            paymentDate: cells[paymentDateIdx]?.trim() || '',
            answerKeyMode: 'single',
            answerKeySingleClassification: DEFAULT_ANSWER_KEY_CLASSIFICATION,
            answerKey: buildSingleAnswerKey(null, amountNumber, ''),
            mappings: [],
          };
        });

        if (imported.length === 0) {
          showModal('No rows found in CSV after header.', 'Import Error');
          if (disbursementCsvInputRef.current) disbursementCsvInputRef.current.value = '';
          return;
        }

        setDisbursements(imported);
        showModal(`Imported ${imported.length} disbursement${imported.length === 1 ? '' : 's'} from CSV.`, 'Import Complete');
      } catch (error) {
        console.error('Error parsing CSV:', error);
        showModal('Unable to read the CSV file. Please verify the format and try again.', 'Import Error');
      } finally {
        if (disbursementCsvInputRef.current) {
          disbursementCsvInputRef.current.value = '';
        }
      }
    };

    reader.onerror = () => {
      showModal('Unexpected error reading the CSV file. Please try again.', 'Import Error');
      if (disbursementCsvInputRef.current) {
        disbursementCsvInputRef.current.value = '';
      }
    };

    reader.readAsText(file);
  };

  const uploadFileAndGetMetadata = async (mappingItem, caseIdForUpload) => {
    const uploadId = `mapping_${mappingItem._tempId || Math.random().toString(36).slice(2, 8)}`;
    const file = mappingItem.clientSideFile;
    const fallbackName = (mappingItem.fileName || '').trim() || (file?.name || '').trim();
    const parentTempId = mappingItem.disbursementTempId;

    if (!file) {
      if (!fallbackName) {
        return {
          paymentId: mappingItem.paymentId,
          fileName: '',
          uploadError: 'No file selected',
          storagePath: '',
          downloadURL: '',
        };
      }
      return {
        paymentId: mappingItem.paymentId,
        fileName: fallbackName,
        storagePath: mappingItem.storagePath || '',
        downloadURL: mappingItem.downloadURL || '',
        contentType: mappingItem.contentType || '',
      };
    }

    const desiredContentType = mappingItem.contentType || pickContentType(file);
    const safeName = ensureSafeStorageName(fallbackName || file.name || 'supporting-document.pdf', desiredContentType);
    const finalStoragePath = `artifacts/${appId}/case_documents/${caseIdForUpload}/${safeName}`;
    const fileRef = storageRef(storage, finalStoragePath);

    updateMappingForDisbursement(parentTempId, mappingItem._tempId, (current) => ({
      ...current,
      fileName: safeName,
      storagePath: finalStoragePath,
      uploadProgress: 0,
      uploadError: null,
      contentType: desiredContentType,
    }));

    const awaitResumable = (task) =>
      new Promise((resolve, reject) => {
        let lastLogged = -10;
        const timer = setTimeout(() => {
          try {
            task.cancel();
          } catch {}
          ulog(uploadId, 'timeout', `${UPLOAD_TIMEOUT_MS}ms`);
          unsubscribe();
          reject(new Error(`Upload timed out after ${UPLOAD_TIMEOUT_MS}ms`));
        }, UPLOAD_TIMEOUT_MS);

        const unsubscribe = task.on(
          'state_changed',
          (snapshot) => {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            if (pct - lastLogged >= 10) {
              ulog(uploadId, 'progress', {
                pct,
                state: snapshot.state,
                bytesTransferred: snapshot.bytesTransferred,
                totalBytes: snapshot.totalBytes,
              });
              lastLogged = pct;
            }
            updateMappingForDisbursement(parentTempId, mappingItem._tempId, (current) => ({
              ...current,
              uploadProgress: pct,
            }));
          },
          (err) => {
            clearTimeout(timer);
            unsubscribe();
            reject(err);
          },
          () => {
            clearTimeout(timer);
            unsubscribe();
            resolve(task.snapshot);
          }
        );
      });

    const runResumable = async () => {
      ulog(uploadId, 'mode', 'resumable');
      try {
        const metadata = {
          contentType: desiredContentType || 'application/octet-stream',
          customMetadata: {
            appId: String(appId || ''),
            caseId: String(caseIdForUpload || ''),
            uploadedBy: String(userId || ''),
            paymentId: String(mappingItem.paymentId || ''),
          },
        };
        const task = uploadBytesResumable(fileRef, file, metadata);
        const snapshot = await awaitResumable(task);
        const downloadURL = await getDownloadURL(snapshot.ref);
        ulog(uploadId, 'success:resumable', { downloadURL });
        return {
          paymentId: mappingItem.paymentId,
          fileName: safeName,
          storagePath: finalStoragePath,
          downloadURL,
          contentType: desiredContentType || 'application/octet-stream',
        };
      } catch (error) {
        const code = error?.code || '';
        let msg = error?.message || 'Upload failed';
        if (code === 'storage/retry-limit-exceeded') {
          msg = 'Network was unstable for too long and the upload was aborted. Please check your connection and try again.';
        }
        const response =
          error?.serverResponse ??
          error?.customData?.serverResponse ??
          error?.customData?._rawError ??
          error?.message ??
          '';
        try {
          console.error('[case-upload] raw error', error);
        } catch {}
        let parsedResponse = null;
        if (typeof response === 'string') {
          try {
            parsedResponse = JSON.parse(response);
          } catch {}
        }
        ulog(uploadId, 'error:resumable', {
          code,
          msg,
          error: error
            ? {
                message: error.message,
                code: error.code,
                name: error.name,
                customData: error.customData,
                serverResponse: response,
                parsedResponse,
              }
            : null,
        });
        updateMappingForDisbursement(parentTempId, mappingItem._tempId, (current) => ({
          ...current,
          uploadError: msg,
          uploadProgress: undefined,
        }));
        return {
          paymentId: mappingItem.paymentId,
          fileName: safeName,
          uploadError: msg,
          storagePath: finalStoragePath,
          downloadURL: '',
          contentType: desiredContentType || 'application/octet-stream',
        };
      }
    };

    const first = await runResumable();
    const msgLower = String(first?.uploadError || '').toLowerCase();
    const transient =
      msgLower.includes('retry-limit-exceeded') ||
      msgLower.includes('network') ||
      msgLower.includes('500') ||
      msgLower.includes('503') ||
      msgLower.includes('quota') ||
      msgLower.includes('timeout');

    if (first && first.uploadError && transient) {
      ulog(uploadId, 'retry:once', first.uploadError);
      await new Promise((r) => setTimeout(r, 1500));
      return await runResumable();
    }

    return first;
  };

  const uploadReferenceDocument = async (docItem, caseIdForUpload) => {
    const fallbackName = (docItem.fileName || '').trim() || (docItem.clientSideFile?.name || '').trim();
    const applyDocUpdate = (mutator) => {
      if (docItem.type && docItem.type.startsWith('cash_')) {
        setCashArtifacts((prev) => prev.map((doc) => mutator(doc)));
      } else {
        setReferenceDocuments((prev) => prev.map((doc) => mutator(doc)));
      }
    };
    if (!docItem.clientSideFile) {
      if (!fallbackName) {
        return null;
      }
      const storagePath = (docItem.storagePath || '').trim();
      const downloadURL = (docItem.downloadURL || '').trim();
      const payload = {
        _tempId: docItem._tempId,
        fileName: fallbackName,
        type: docItem.type,
        confirmedBalance: docItem.confirmedBalance,
      };
      if (storagePath) payload.storagePath = storagePath;
      if (downloadURL) payload.downloadURL = downloadURL;
      if (docItem.contentType) payload.contentType = docItem.contentType;
      return payload;
    }

    const file = docItem.clientSideFile;
    const uploadId = `ref_${Math.random().toString(36).slice(2, 8)}`;
    ulog(uploadId, 'reference:start', {
      caseIdForUpload,
      name: file?.name,
      type: file?.type,
      size: file?.size,
      online: navigator.onLine,
    });

    if (!navigator.onLine) {
      ulog(uploadId, 'reference:offline');
      return {
        _tempId: docItem._tempId,
        fileName: fallbackName || file?.name || 'reference.pdf',
        uploadError: 'Browser is offline',
        storagePath: '',
        downloadURL: '',
        contentType: docItem.contentType || pickContentType(file),
        type: docItem.type,
        confirmedBalance: docItem.confirmedBalance,
      };
    }
    if (!caseIdForUpload) {
      const errorMsg = 'Cannot upload reference document: Case ID not finalized.';
      console.error(errorMsg, docItem);
      ulog(uploadId, 'reference:abort:no-case-id');
      applyDocUpdate((doc) =>
        doc._tempId === docItem._tempId ? { ...doc, uploadError: errorMsg, uploadProgress: undefined } : doc
      );
      throw new Error(errorMsg);
    }

    const desiredContentType = docItem.contentType || pickContentType(file);
    const rawName = file?.name || fallbackName || 'reference.pdf';
    const safeStorageName = ensureSafeStorageName(rawName, desiredContentType);
    const displayName = ((docItem.fileName || '').trim() || safeStorageName).trim();
    const finalStoragePath = `artifacts/${appId}/case_reference/${caseIdForUpload}/${safeStorageName}`;
    ulog(uploadId, 'reference:path', { rawName, safeStorageName, displayName, finalStoragePath });

    applyDocUpdate((doc) =>
      doc._tempId === docItem._tempId
        ? {
            ...doc,
            fileName: displayName,
            storagePath: finalStoragePath,
            downloadURL: '',
            uploadProgress: 0,
            uploadError: null,
            contentType: desiredContentType,
          }
        : doc
    );

    const timeoutMs = UPLOAD_TIMEOUT_MS;
    const fileRef = storageRef(storage, finalStoragePath);

    const awaitResumable = (task) => {
      return new Promise((resolve, reject) => {
        let lastLogged = -10;
        const timer = setTimeout(() => {
          try {
            task.cancel();
          } catch {}
          ulog(uploadId, 'reference:timeout', `${timeoutMs}ms`);
          unsubscribe();
          reject(new Error(`Upload timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const unsubscribe = task.on(
          'state_changed',
          (snapshot) => {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            if (pct - lastLogged >= 10) {
              ulog(uploadId, 'reference:progress', {
                pct,
                state: snapshot.state,
                bytesTransferred: snapshot.bytesTransferred,
                totalBytes: snapshot.totalBytes,
              });
              lastLogged = pct;
            }
            applyDocUpdate((doc) => (doc._tempId === docItem._tempId ? { ...doc, uploadProgress: pct } : doc));
          },
          (err) => {
            clearTimeout(timer);
            unsubscribe();
            reject(err);
          },
          () => {
            clearTimeout(timer);
            unsubscribe();
            resolve(task.snapshot);
          }
        );
      });
    };

    const runResumable = async () => {
      ulog(uploadId, 'reference:mode', 'resumable');
      try {
        const metadata = {
          contentType: desiredContentType || 'application/octet-stream',
          customMetadata: {
            appId: String(appId || ''),
            caseId: String(caseIdForUpload || ''),
            uploadedBy: String(userId || ''),
            documentType: 'reference',
          },
        };
        const task = uploadBytesResumable(fileRef, file, metadata);
        const snapshot = await awaitResumable(task);
        const downloadURL = await getDownloadURL(snapshot.ref);
        ulog(uploadId, 'reference:success', { downloadURL });
        applyDocUpdate((doc) =>
          doc._tempId === docItem._tempId ? { ...doc, uploadProgress: 100, downloadURL, uploadError: null } : doc
        );
        return {
          _tempId: docItem._tempId,
          fileName: displayName,
          storagePath: finalStoragePath,
          downloadURL,
          contentType: desiredContentType || 'application/octet-stream',
          type: docItem.type,
          confirmedBalance: docItem.confirmedBalance,
        };
      } catch (error) {
        const code = error?.code || '';
        let msg = error?.message || 'Upload failed';
        if (code === 'storage/retry-limit-exceeded') {
          msg = 'Network was unstable for too long and the upload was aborted. Please check your connection and try again.';
        }
        const response =
          error?.serverResponse ??
          error?.customData?.serverResponse ??
          error?.customData?._rawError ??
          error?.message ??
          '';
        try {
          console.error('[case-reference-upload] raw error', error);
        } catch {}
        let parsedResponse = null;
        if (typeof response === 'string') {
          try {
            parsedResponse = JSON.parse(response);
          } catch {}
        }
        ulog(uploadId, 'reference:error', {
          code,
          msg,
          error: error
            ? {
                message: error.message,
                code: error.code,
                name: error.name,
                customData: error.customData,
                serverResponse: response,
                parsedResponse,
              }
            : null,
        });
        applyDocUpdate((doc) =>
          doc._tempId === docItem._tempId ? { ...doc, uploadError: msg, uploadProgress: undefined } : doc
        );
        return {
          _tempId: docItem._tempId,
          fileName: displayName,
          storagePath: finalStoragePath,
          downloadURL: '',
          uploadError: msg,
          contentType: desiredContentType || 'application/octet-stream',
          type: docItem.type,
          confirmedBalance: docItem.confirmedBalance,
        };
      }
    };

    const first = await runResumable();
    const msgLower = String(first?.uploadError || '').toLowerCase();
    const transient =
      msgLower.includes('retry-limit-exceeded') ||
      msgLower.includes('network') ||
      msgLower.includes('500') ||
      msgLower.includes('503') ||
      msgLower.includes('quota') ||
      msgLower.includes('timeout');

    if (first && first.uploadError && transient) {
      ulog(uploadId, 'reference:retry:once', first.uploadError);
      await new Promise((r) => setTimeout(r, 1500));
      return await runResumable();
    }

    return first;
  };

  const uploadHighlightedDocument = async (disbursement, caseIdForUpload) => {
    const disbursementTempId = disbursement?._tempId || disbursement?.paymentId || getUUID();
    const docItem = disbursement?.highlightedDocument;
    const fallbackName = (docItem?.fileName || '').trim() || (docItem?.clientSideFile?.name || '').trim();

    console.log('uploadHighlightedDocument: start', { disbursement, caseIdForUpload });

    if (!docItem) {
      ulog('highlight:skip:no-doc', { disbursementTempId, reason: 'no docItem' });
      return { disbursementTempId, payload: null };
    }

    if (!docItem.clientSideFile) {
      ulog('highlight:skip:no-file', { disbursementTempId, fileName: fallbackName || docItem.fileName });
      const sanitized = sanitizeHighlightedDocumentForSave({ ...docItem, fileName: fallbackName || docItem.fileName });
      return { disbursementTempId, payload: sanitized || null };
    }

    if (!navigator.onLine) {
      const message = 'Browser is offline';
      ulog('highlight:offline', { disbursementTempId, fileName: fallbackName || docItem.clientSideFile?.name });
      updateHighlightedDocumentForDisbursement(disbursementTempId, (current) => ({
        ...(current || initialHighlightedDocument()),
        uploadError: message,
        uploadProgress: undefined,
      }));
      return { disbursementTempId, payload: null, uploadError: message, fileName: fallbackName || docItem.clientSideFile?.name };
    }

    if (!caseIdForUpload) {
      const errorMsg = 'Cannot upload highlighted document: Case ID not finalized.';
      console.error(errorMsg, disbursement);
      ulog('highlight:abort:no-case-id', { disbursementTempId, fileName: fallbackName });
      updateHighlightedDocumentForDisbursement(disbursementTempId, (current) => ({
        ...(current || initialHighlightedDocument()),
        uploadError: errorMsg,
        uploadProgress: undefined,
      }));
      throw new Error(errorMsg);
    }

    const file = docItem.clientSideFile;
    const uploadId = `highlight_${Math.random().toString(36).slice(2, 8)}`;
    const desiredContentType = docItem.contentType || pickContentType(file);
    const safeName = ensureSafeStorageName(fallbackName || file?.name || 'highlighted-answer.pdf', desiredContentType);
    const displayName = (fallbackName || safeName).trim() || safeName;
    const finalStoragePath = `artifacts/${appId}/case_highlight/${caseIdForUpload}/${safeName}`;
    ulog(uploadId, 'highlight:start', {
      disbursementTempId,
      paymentId: disbursement?.paymentId,
      fileName: displayName,
      finalStoragePath,
      caseIdForUpload,
      contentType: desiredContentType,
    });
    highlightStartRef.current = true;
    console.log('uploadHighlightedDocument: starting upload', {
      uploadId,
      finalStoragePath,
      displayName,
      desiredContentType,
      appId,
      caseIdForUpload,
      userId,
    });

    updateHighlightedDocumentForDisbursement(disbursementTempId, (current) => ({
      ...(current || initialHighlightedDocument()),
      fileName: displayName,
      storagePath: finalStoragePath,
      downloadURL: '',
      uploadProgress: 0,
      uploadError: null,
      contentType: desiredContentType,
    }));

    const timeoutMs = UPLOAD_TIMEOUT_MS;
    const fileRef = storageRef(storage, finalStoragePath);

    const awaitResumable = (task) => {
      return new Promise((resolve, reject) => {
        let lastLogged = -10;
        let sawProgress = false;
        let unsubscribe = () => {};
        const timer = setTimeout(() => {
          try {
            task.cancel();
          } catch {}
          ulog(uploadId, 'highlight:timeout', `${timeoutMs}ms`);
          console.log('uploadHighlightedDocument: timeout');
          unsubscribe();
          reject(new Error(`Upload timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const stallTimer = setTimeout(() => {
          if (sawProgress) return;
          try {
            task.cancel();
          } catch {}
          ulog(uploadId, 'highlight:stall', 'no-progress-8s');
          console.log('uploadHighlightedDocument: stall timer triggered');
          unsubscribe();
          reject(new Error('Upload did not start. Check your connection or permissions and try again.'));
        }, 8000);

        unsubscribe = task.on(
          'state_changed',
          (snapshot) => {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            if (snapshot.bytesTransferred > 0) sawProgress = true;
            if (pct - lastLogged >= 10) {
        ulog(uploadId, 'highlight:progress', {
          pct,
          state: snapshot.state,
          bytesTransferred: snapshot.bytesTransferred,
          totalBytes: snapshot.totalBytes,
              });
              lastLogged = pct;
            }
            updateHighlightedDocumentForDisbursement(disbursementTempId, (current) => ({
              ...(current || initialHighlightedDocument()),
              uploadProgress: pct,
            }));
          },
          (err) => {
            clearTimeout(timer);
            clearTimeout(stallTimer);
            console.error('uploadHighlightedDocument: error in task.on', err);
            unsubscribe();
            reject(err);
          },
          () => {
            clearTimeout(timer);
            clearTimeout(stallTimer);
            console.log('uploadHighlightedDocument: success in task.on');
            unsubscribe();
            resolve(task.snapshot);
          }
        );
      });
    };

    const runResumable = async () => {
      ulog(uploadId, 'highlight:mode', 'resumable');
      try {
        const metadata = {
          contentType: desiredContentType || 'application/octet-stream',
          customMetadata: {
            appId: String(appId || ''),
            caseId: String(caseIdForUpload || ''),
            uploadedBy: String(userId || ''),
            paymentId: String(disbursement?.paymentId || ''),
            documentType: 'highlighted_answer_key',
          },
        };
        console.log('uploadHighlightedDocument: metadata', metadata);
        const task = uploadBytesResumable(fileRef, file, metadata);
        ulog(uploadId, 'highlight:resumable:created', {
          bucket: fileRef.bucket,
          fullPath: fileRef.fullPath,
          name: fileRef.name,
          contentType: metadata.contentType,
        });
        const snapshot = await awaitResumable(task);
        const downloadURL = await getDownloadURL(snapshot.ref);
        ulog(uploadId, 'highlight:success', { downloadURL });
        updateHighlightedDocumentForDisbursement(disbursementTempId, (current) => ({
          ...(current || initialHighlightedDocument()),
          uploadProgress: 100,
          downloadURL,
          uploadError: null,
        }));
        return {
          disbursementTempId,
          payload: {
            fileName: displayName,
            storagePath: finalStoragePath,
            downloadURL,
            contentType: desiredContentType || 'application/octet-stream',
          },
          uploadError: null,
        };
      } catch (error) {
        const code = error?.code || '';
        let msg = error?.message || 'Upload failed';
        if (code === 'storage/retry-limit-exceeded') {
          msg = 'Network was unstable for too long and the upload was aborted. Please check your connection and try again.';
        }
        const response =
          error?.serverResponse ??
          error?.customData?.serverResponse ??
          error?.customData?._rawError ??
          error?.message ??
          '';
        const xhrStatus = error?.customData?.serverResponse && typeof error.customData.serverResponse === 'string'
          ? error.customData.serverResponse
          : null;
        let parsedResponse = null;
        if (typeof response === 'string') {
          try {
            parsedResponse = JSON.parse(response);
          } catch {}
        }
        ulog(uploadId, 'highlight:error', {
          code,
          msg,
          error: error
            ? {
                message: error.message,
                code: error.code,
                name: error.name,
                customData: error.customData,
                serverResponse: response,
                parsedResponse,
                xhrStatus,
              }
            : null,
        });
        console.error('uploadHighlightedDocument: caught error', {
          code,
          msg,
          response,
          xhrStatus,
          error,
        });
        updateHighlightedDocumentForDisbursement(disbursementTempId, (current) => ({
          ...(current || initialHighlightedDocument()),
          uploadError: msg,
          uploadProgress: undefined,
        }));
        return {
          disbursementTempId,
          payload: null,
          uploadError: msg,
          fileName: displayName,
        };
      }
    };

    const first = await runResumable();
    const msgLower = String(first?.uploadError || '').toLowerCase();
    const transient =
      msgLower.includes('retry-limit-exceeded') ||
      msgLower.includes('network') ||
      msgLower.includes('500') ||
      msgLower.includes('503') ||
      msgLower.includes('quota') ||
          msgLower.includes('timeout');

    if (first && first.uploadError && transient) {
      ulog(uploadId, 'highlight:retry:once', first.uploadError);
      await new Promise((r) => setTimeout(r, 1500));
      return await runResumable();
    }

    return first;
  };

  const handleSubmit = async (event) => {
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

    if (auditArea === AUDIT_AREAS.CASH) {
      const { bookBalance, bankBalance, reconciliationDate } = cashContext || {};
      if (!bookBalance || !bankBalance || !reconciliationDate) {
        logValidationFail('cash-context-incomplete', { bookBalance, bankBalance, reconciliationDate });
        showModal('For Cash cases, provide Book Balance, Bank Statement Balance, and the reconciliation/reporting date in the Data Entry step.', 'Validation Error');
        return;
      }
      const outstandingIssues = [];
      cashOutstandingItems.forEach((item, idx) => {
        const missing = [];
        if (!item.reference) missing.push('Reference #');
        if (!item.payee) missing.push('Description / Payee');
        if (!item.issueDate) missing.push('Book Date');
        if (!item.amount) missing.push('Amount');
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
        if (!item.reference) missing.push('Reference #');
        if (!item.clearDate) missing.push('Cleared Date');
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
          mappingIssues.push(`Reconciliation mapping required for outstanding item #${idx + 1} (${item.reference || 'no ref'}).`);
        }
      });
      if (mappingIssues.length > 0) {
        logValidationFail('cash-reconciliation-map-incomplete', { issues: mappingIssues });
        showModal(mappingIssues.join('\n'), 'Validation Error');
        return;
      }

      derivedReconciliationMap = normalizedMap;
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
          faIssues.push(`Rollforward class ${row.className || idx + 1} does not foot (Beg + Add - Disp should equal End).`);
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
            `Answer key for disbursement #${index + 1} (${disbursement.paymentId || 'no payment ID'}) requires split amounts and an explanation.`
          );
          return;
        }
        const diff = Math.abs(totals - amountNumber);
        if (diff > ANSWER_KEY_TOLERANCE) {
          answerKeyIssues.push(
            `Disbursement #${index + 1} (${disbursement.paymentId || 'no payment ID'}) has answer key totals (${totals.toFixed(
              2
            )}) that do not match the disbursement amount (${amountNumber.toFixed(2)}).`
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
          `Disbursement #${index + 1} (${disbursement.paymentId || 'no payment ID'}) has answer key totals (${assignedAmount.toFixed(
            2
          )}) that do not match the disbursement amount (${amountNumber.toFixed(2)}).`
        );
      }
    });

    if (answerKeyIssues.length > 0) {
      logValidationFail('answer-key-issues', { issues: answerKeyIssues });
      showModal(answerKeyIssues.join('\n'), 'Answer Key Validation');
      return;
    }

    const visibleToUserIdsArray = publicVisible ? [] : Array.from(new Set(selectedUserIds));

    if (!publicVisible && visibleToUserIdsArray.length === 0) {
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

    const { timestamp: opensAtTs, error: opensError } = parseDateTimeInputValue(opensAtStr, 'Opens At');
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

    if (opensAtTs && dueAtTs && dueAtTs.toMillis() < opensAtTs.toMillis()) {
      logValidationFail('due-before-open', { opensAt: opensAtTs?.toMillis?.(), dueAt: dueAtTs?.toMillis?.() });
      showModal('Due At must be after Opens At.', 'Validation Error');
      return;
    }

    ulog('case-save:passed-date-validation');

    setLoading(true);
    let currentCaseId = editingCaseId || draftCaseId;
    let isNewCaseCreation = !isEditing && !draftCaseId;

    const activeReferenceDocs = [...referenceDocuments, ...cashArtifacts].filter((doc) => {
      if (!doc) return false;
      if (doc.clientSideFile) return true;
      if (doc.fileName) return true;
      if (doc.downloadURL) return true;
      if (doc.storagePath) return true;
      return false;
    });

    const referenceValidationFailed = activeReferenceDocs.some((doc) => {
      const name = (doc.fileName || '').trim();
      const hasUpload = !!doc.clientSideFile;
      const hasUrl = !!doc.downloadURL;
      const hasStoragePath = !!doc.storagePath;
      if (!name) return true;
      if (!hasUpload && !hasUrl && !hasStoragePath) return true;
      return false;
    });

    if (referenceValidationFailed) {
      logValidationFail('reference-doc-missing-data', { activeReferenceDocsCount: activeReferenceDocs.length });
      showModal('Reference documents must include a display name and either an uploaded file, download URL, or storage path.', 'Validation Error');
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

      if (resolvedRole !== 'admin' && !resolvedOrgId) {
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
        publicVisible,
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
          publicVisible,
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
              `- ${h.fileName || 'Highlighted file'} for item ${
                h.disbursementTempId || 'unknown'
              }: ${h.uploadError}`
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
          highlightedMap.get(disbursement._tempId) ||
          sanitizeHighlightedDocumentForSave(disbursement.highlightedDocument);
        return { ...disbursement, highlightedDocument: highlightPayload };
      });

      const disbursementPayload = mergeDisbursementDocuments(disbursementsWithHighlights, finalInvoiceMappings).map(
        ({ mappings, answerKeyMode, answerKeySingleClassification, highlightedDocument, ...rest }) => ({
          ...rest,
          highlightedDocument: sanitizeHighlightedDocumentForSave(highlightedDocument),
        })
      );

      const caseDataPayload = {
        caseName,
        title: caseName,
        orgId: resolvedOrgId,
        workpaper: { layoutType, layoutConfig: parsedLayoutConfig },
        instruction,
        disbursements: disbursementPayload,
        invoiceMappings: finalInvoiceMappings,
        referenceDocuments: finalReferenceDocuments,
        visibleToUserIds: visibleToUserIdsArray,
        publicVisible,
        status,
        opensAt: opensAtTs,
        dueAt: dueAtTs,
        createdBy: isNewCaseCreation || !originalCaseData?.createdBy ? userId : originalCaseData.createdBy,
        _deleted: originalCaseData?._deleted ?? false,
        auditArea,
        caseGroupId: resolvedCaseGroupId,
        cashContext: auditArea === AUDIT_AREAS.CASH
          ? {
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

      showModal(`Case ${isNewCaseCreation ? 'created' : 'updated'} successfully!`, 'Success');
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
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

  const goBack = () => navigate('/admin');

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
    cashOutstandingItems,
    cashCutoffItems,
    cashReconciliationMap,
    handleOutstandingChange,
    addOutstandingItem,
    removeOutstandingItem,
    handleCutoffChange,
    addCutoffItem,
    removeCutoffItem,
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
    actions: { handleSubmit, goBack },
  };
}

export default useCaseForm;
