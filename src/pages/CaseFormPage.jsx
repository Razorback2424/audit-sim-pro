import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { storage, appId } from '../AppCore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { useAuth, Button, useRoute, useModal } from '../AppCore';
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
import {
  STATUS_OPTIONS,
  WORKPAPER_LAYOUT_OPTIONS,
} from '../constants/caseFormOptions';
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
  isAnswerKeyReady,
} from '../utils/caseFormHelpers';
import { AnswerKeyStep } from '../components/caseForm/AnswerKeyCard';
import { CaseFormStepNav, ReviewStep } from '../components/caseForm/CaseFormNavigation';
import CaseBasicsStep from '../components/caseForm/CaseBasicsStep';
import InstructionStep from '../components/caseForm/InstructionStep';
import AudienceScheduleStep from '../components/caseForm/AudienceScheduleStep';
import TransactionsStep from '../components/caseForm/TransactionsStep';
import AttachmentsStep from '../components/caseForm/AttachmentsStep';

const DRAFT_STORAGE_KEY = 'audit_sim_case_draft_v1';
export const mergeDisbursementDocuments = (disbursementList, invoiceMappings) => {
  const baseDisbursements = (disbursementList || []).map(({ _tempId, ...rest }) => rest);
  const mappingGroups = new Map();

  (invoiceMappings || [])
    .filter((m) => m && m.paymentId)
    .forEach((m) => {
      const key = m.paymentId;
      if (!mappingGroups.has(key)) {
        mappingGroups.set(key, []);
      }
      mappingGroups.get(key).push({
        paymentId: m.paymentId,
        storagePath: m.storagePath || '',
        fileName: m.fileName || '',
        downloadURL: m.downloadURL || '',
        contentType: m.contentType || '',
      });
    });

  return baseDisbursements.map((item) => {
    const next = { ...item };
    const linkedDocs = item.paymentId ? mappingGroups.get(item.paymentId) || [] : [];
    const existingDocs = Array.isArray(item.supportingDocuments) ? item.supportingDocuments : [];

    const combinedDocs = [...existingDocs, ...linkedDocs].map((doc) => ({
      storagePath: doc.storagePath || '',
      fileName: doc.fileName || '',
      downloadURL: doc.downloadURL || '',
      contentType: doc.contentType || '',
    }));

    const dedupedDocs = [];
    const seen = new Set();
    combinedDocs.forEach((doc) => {
      const key = `${doc.storagePath}|${doc.downloadURL}|${doc.fileName}|${doc.contentType}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (doc.storagePath || doc.downloadURL || doc.fileName) {
        dedupedDocs.push(doc);
      }
    });

    if (dedupedDocs.length > 0) {
      const [primaryDoc, ...additionalDocs] = dedupedDocs;

      if (primaryDoc.storagePath) next.storagePath = primaryDoc.storagePath;
      else delete next.storagePath;

      if (primaryDoc.fileName) next.fileName = primaryDoc.fileName;
      else delete next.fileName;

      if (primaryDoc.downloadURL) next.downloadURL = primaryDoc.downloadURL;
      else delete next.downloadURL;

      if (primaryDoc.contentType) next.contentType = primaryDoc.contentType;
      else delete next.contentType;

      next.supportingDocuments = [
        {
          storagePath: primaryDoc.storagePath || '',
          fileName: primaryDoc.fileName || '',
          downloadURL: primaryDoc.downloadURL || '',
          contentType: primaryDoc.contentType || '',
        },
        ...additionalDocs.map((doc) => ({
          storagePath: doc.storagePath || '',
          fileName: doc.fileName || '',
          downloadURL: doc.downloadURL || '',
          contentType: doc.contentType || '',
        })),
      ];
    } else {
      delete next.storagePath;
      delete next.fileName;
      delete next.downloadURL;
      delete next.contentType;
      delete next.supportingDocuments;
    }

    return next;
  });
};

function useCaseForm({ params }) {
  const { caseId: editingCaseId } = params || {};
  const isEditing = !!editingCaseId;
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { showModal } = useModal();

  const initialDisbursement = () => ({
    _tempId: getUUID(),
    paymentId: '',
    payee: '',
    amount: '',
    paymentDate: '',
    transactionType: '',
    answerKeyMode: 'single',
    answerKeySingleClassification: DEFAULT_ANSWER_KEY_CLASSIFICATION,
    answerKey: buildSingleAnswerKey(null, 0, ''),
    mappings: [],
    trapType: '',
    requiredAssertions: [],
    errorReasons: [],
    shouldFlag: false,
    validator: { type: '', config: {} },
  });
  const initialOutstandingItem = () => ({
    _tempId: getUUID(),
    reference: '',
    payee: '',
    issueDate: '',
    amount: '',
  });
  const initialCutoffItem = () => ({
    _tempId: getUUID(),
    reference: '',
    clearDate: '',
    amount: '',
  });
  const initialReconciliationMap = () => ({
    _tempId: getUUID(),
    outstandingTempId: '',
    cutoffTempId: '',
    scenarioType: '',
  });
  const initialInstruction = () => ({
    title: '',
    moduleCode: '',
    hook: { headline: '', risk: '', body: '' },
    visualAsset: { type: 'VIDEO', source_id: '', alt: '' },
    heuristic: { rule_text: '', reminder: '' },
    gateCheck: {
      question: '',
      success_message: '',
      failure_message: '',
      options: [
        { id: 'opt1', text: '', correct: false, feedback: '' },
        { id: 'opt2', text: '', correct: true, feedback: '' },
      ],
    },
  });
const initialMapping = () => ({
  _tempId: getUUID(),
  disbursementTempId: '',
  fileName: '',
    storagePath: '',
    clientSideFile: null,
    uploadProgress: undefined,
    uploadError: null,
    downloadURL: '',
    contentType: '',
  });
  const initialReferenceDocument = () => ({
    _tempId: getUUID(),
    fileName: '',
    storagePath: '',
    downloadURL: '',
    clientSideFile: null,
    uploadProgress: undefined,
    uploadError: null,
    contentType: '',
  });

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
const [cashContext, setCashContext] = useState({
  bookBalance: '',
  bankBalance: '',
  reconciliationDate: '',
  simulateMathError: false,
  confirmedBalance: '',
  testingThreshold: '',
  cutoffWindowDays: '',
});
  const [cashOutstandingItems, setCashOutstandingItems] = useState([initialOutstandingItem()]);
  const [cashCutoffItems, setCashCutoffItems] = useState([initialCutoffItem()]);
  const [cashReconciliationMap, setCashReconciliationMap] = useState([]);
  const [cashArtifacts, setCashArtifacts] = useState([]);
  const initialFaClass = () => ({
    _tempId: getUUID(),
    className: '',
    beginningBalance: '',
    additions: '',
    disposals: '',
    endingBalance: '',
  });
  const initialFaAddition = () => ({
    _tempId: getUUID(),
    vendor: '',
    description: '',
    amount: '',
    inServiceDate: '',
    glAccount: '',
    natureOfExpenditure: '',
    properPeriod: '',
  });
  const initialFaDisposal = () => ({
    _tempId: getUUID(),
    assetId: '',
    description: '',
    proceeds: '',
    nbv: '',
  });
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

  const disbursementCsvInputRef = useRef(null);
  const hasCheckedDraftRef = useRef(false);

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
    if (hasCheckedDraftRef.current) return;
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const savedDraft = window.localStorage.getItem(draftStorageKey);
      if (!savedDraft) return;
      const parsed = JSON.parse(savedDraft);
      if (!parsed || !parsed.updatedAt) return;
      hasCheckedDraftRef.current = true;
      const confirmLoad = window.confirm(
        isEditing
          ? 'We found an unsaved draft for this case. Would you like to restore it?'
          : 'Restoring your unsaved new case draft...'
      );
      if (!confirmLoad) {
        window.localStorage.removeItem(draftStorageKey);
        return;
      }
      if (parsed.caseName) setCaseName(parsed.caseName);
      if (parsed.auditArea) setAuditArea(parsed.auditArea);
      if (parsed.instruction) setInstruction(parsed.instruction);
      if (parsed.disbursements) setDisbursements(parsed.disbursements);
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
    } catch (err) {
      console.error('Failed to restore draft', err);
    }
  }, [draftStorageKey, isEditing]);

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
    draftStorageKey,
    isHydratedForDrafts,
  ]);
  // --- AUTO-SAVE LOGIC END ---

  useEffect(() => {
    hasCheckedDraftRef.current = false;
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
              trapType: d.trapType || '',
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

  const SUPPORTED_FILE_TYPES = [
    { mime: 'application/pdf', extensions: ['.pdf'], label: 'PDF' },
    { mime: 'application/x-pdf', extensions: ['.pdf'], label: 'PDF' },
    { mime: 'text/csv', extensions: ['.csv'], label: 'CSV' },
    { mime: 'application/csv', extensions: ['.csv'], label: 'CSV' },
    { mime: 'application/vnd.ms-excel', extensions: ['.xls'], label: 'Excel (.xls)' },
    { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extensions: ['.xlsx'], label: 'Excel (.xlsx)' },
    { mime: 'application/vnd.ms-excel.sheet.macroenabled.12', extensions: ['.xlsm'], label: 'Excel (.xlsm)' },
  ];

  const SUPPORTED_MIME_TYPES = new Set(SUPPORTED_FILE_TYPES.map((entry) => entry.mime.toLowerCase()));
  const SUPPORTED_EXTENSIONS = new Set(
    SUPPORTED_FILE_TYPES.flatMap((entry) => entry.extensions.map((ext) => ext.toLowerCase()))
  );
  const UNSAFE_STORAGE_CHARS = new RegExp('[\\\\/#?\\[\\]*<>:"|]+', 'g');

  const prettySupportedLabels = Array.from(new Set(SUPPORTED_FILE_TYPES.map((entry) => entry.label))).join(', ');

  const FILE_INPUT_ACCEPT = Array.from(
    new Set([
      ...Array.from(SUPPORTED_EXTENSIONS),
      ...Array.from(SUPPORTED_MIME_TYPES),
    ])
  ).join(',');

  const getFileExtension = (name) => {
    if (!name || typeof name !== 'string') return '';
    const match = name.trim().toLowerCase().match(/(\.[a-z0-9]{1,8})$/i);
    return match ? match[0].toLowerCase() : '';
  };

  const pickContentType = (file) => {
    const declaredType = (file?.type || '').toLowerCase();
    if (declaredType && SUPPORTED_MIME_TYPES.has(declaredType)) {
      if (declaredType === 'application/x-pdf') return 'application/pdf';
      return declaredType;
    }
    const ext = getFileExtension(file?.name || '');
    if (ext && SUPPORTED_EXTENSIONS.has(ext)) {
      if (ext === '.pdf') return 'application/pdf';
      if (ext === '.csv') return 'text/csv';
      if (ext === '.xls') return 'application/vnd.ms-excel';
      if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (ext === '.xlsm') return 'application/vnd.ms-excel.sheet.macroenabled.12';
    }
    return declaredType || 'application/octet-stream';
  };

  const isSupportedFile = (file) => {
    if (!file) return false;
    const normalizedType = (file.type || '').toLowerCase();
    const ext = getFileExtension(file.name || '');
    if (SUPPORTED_MIME_TYPES.has(normalizedType)) return true;
    if (SUPPORTED_EXTENSIONS.has(ext)) return true;
    if (normalizedType === 'application/octet-stream' && SUPPORTED_EXTENSIONS.has(ext)) return true;
    return false;
  };

  const ensureSafeStorageName = (rawName, desiredContentType) => {
    const sanitized = (rawName || 'artifact')
      .replace(UNSAFE_STORAGE_CHARS, '_')
      .replace(/\s+/g, ' ')
      .trim();
    const baseName = sanitized || 'artifact';
    const currentExt = getFileExtension(baseName);

    const extensionForType = (() => {
      switch (desiredContentType) {
        case 'text/csv':
          return '.csv';
        case 'application/vnd.ms-excel':
          return '.xls';
        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
          return '.xlsx';
        case 'application/vnd.ms-excel.sheet.macroenabled.12':
          return '.xlsm';
        default:
          return '.pdf';
      }
    })();

    if (currentExt) {
      return baseName;
    }
    return `${baseName}${extensionForType}`;
  };

  const handleMappingFileSelect = (disbursementTempId, mappingTempId, file) => {
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
      uploadProgress: 0,
      uploadError: null,
      downloadURL: '',
      contentType,
    }));
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
              uploadProgress: 0,
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
              uploadProgress: 0,
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
    const finalStoragePath = `artifacts/${appId}/case_invoice/${caseIdForUpload}/${safeName}`;
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

  const handleSubmit = async (event) => {
    event.preventDefault();

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
          showModal('Layout Config must be valid JSON object.', 'Validation Error');
          return;
        }
      } catch (err) {
        showModal('Layout Config must be valid JSON. ' + err.message, 'Validation Error');
        return;
      }
    }

    if (!caseName.trim()) {
      showModal('Case name is required.', 'Validation Error');
      return;
    }

    if (auditArea === AUDIT_AREAS.CASH) {
      const { bookBalance, bankBalance, reconciliationDate } = cashContext || {};
      if (!bookBalance || !bankBalance || !reconciliationDate) {
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
        showModal(faIssues.join('\n'), 'Validation Error');
        return;
      }
    }

    if (!Array.isArray(disbursements) || disbursements.length === 0) {
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
      showModal(answerKeyIssues.join('\n'), 'Answer Key Validation');
      return;
    }

    const visibleToUserIdsArray = publicVisible ? [] : Array.from(new Set(selectedUserIds));

    if (!publicVisible && visibleToUserIdsArray.length === 0) {
      showModal('Private cases must list at least one User ID.', 'Validation Error');
      return;
    }

    const trimmedCustomGroupId = customCaseGroupId.trim();
    if (caseGroupSelection === '__custom' && !trimmedCustomGroupId) {
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
      showModal(opensError, 'Validation Error');
      return;
    }

    const { timestamp: dueAtTs, error: dueError } = parseDateTimeInputValue(dueAtStr, 'Due At');
    if (dueError) {
      showModal(dueError, 'Validation Error');
      return;
    }

    if (opensAtTs && dueAtTs && dueAtTs.toMillis() < opensAtTs.toMillis()) {
      showModal('Due At must be after Opens At.', 'Validation Error');
      return;
    }

    setLoading(true);
    let currentCaseId = editingCaseId;
    let isNewCaseCreation = !isEditing;

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

    try {
      if (isNewCaseCreation) {
        const tempCaseData = {
          caseName,
          title: caseName,
          workpaper: { layoutType, layoutConfig: parsedLayoutConfig },
          instruction,
          disbursements: disbursements.map(({ _tempId, mappings, ...rest }) => rest),
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
      } else if (editingCaseId) {
        currentCaseId = editingCaseId;
        showModal(
          `Updating case (ID: ${currentCaseId}). Uploading any new/changed files... Please do not navigate away.`,
          'Processing',
          null
        );
      }

      if (!currentCaseId) throw new Error('Case ID is missing. Cannot proceed with file uploads.');

      const uploadCandidates = flattenedMappings.filter((m) => m.paymentId && m.clientSideFile);

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

      const disbursementPayload = mergeDisbursementDocuments(disbursements, finalInvoiceMappings).map(
        ({ mappings, answerKeyMode, answerKeySingleClassification, ...rest }) => rest
      );

      const caseDataPayload = {
        caseName,
        title: caseName,
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

      if (!isNewCaseCreation) {
        caseDataPayload.createdAt = originalCaseData?.createdAt ?? null;
      }

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
      console.error('Error saving case:', error);
      let detailedErrorMsg = 'Error saving case: ' + error.message;
      if (error.cause) detailedErrorMsg += `\nCause: ${error.cause.message || error.cause}`;
      showModal(detailedErrorMsg, 'Error');
    } finally {
      setLoading(false);
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

export default function CaseFormPage({ params }) {
  const {
    meta: { isEditing },
    status: { loading },
    basics,
    instructionData,
    audience,
    transactions,
    attachments,
    answerKey,
    files,
    actions: { handleSubmit, goBack },
  } = useCaseForm({ params });

  const [activeStep, setActiveStep] = useState(0);
  const steps = useMemo(
    () => [
      { id: 'basics', label: 'Basics', description: 'Name, status, audit area, and grouping' },
      { id: 'instruction', label: 'Instruction', description: 'Briefing, Video, and Gate Check' },
      { id: 'audience', label: 'Audience & Schedule', description: 'Visibility controls and timing' },
      { id: 'transactions', label: 'Data Entry', description: 'Balances, transactions, and mappings' },
      { id: 'attachments', label: 'Attachments', description: 'Invoice and reference files' },
      { id: 'answerKey', label: 'Answer Key', description: 'Correct classifications and rationale' },
      { id: 'review', label: 'Review & Submit', description: 'Final summary before publishing' },
    ],
    []
  );

  const summaryData = useMemo(() => {
    const disbursementCount = transactions.disbursements.filter((item) => {
      if (!item) return false;
      return Boolean(item.paymentId || item.payee || item.amount || item.paymentDate);
    }).length;
    const mappingCount = transactions.disbursements.reduce(
      (sum, disbursement) =>
        sum + (disbursement.mappings || []).filter((mapping) => mapping && mapping.paymentId).length,
      0
    );
    const attachmentCount = attachments.referenceDocuments.filter((item) => {
      if (!item) return false;
      return Boolean(item.fileName || item.clientSideFile || item.downloadURL || item.storagePath);
    }).length;

    return {
      caseName: basics.caseName,
      status: basics.status,
      publicVisible: audience.publicVisible,
      selectedUserIds: audience.selectedUserIds,
      opensAtStr: audience.opensAtStr,
      dueAtStr: audience.dueAtStr,
      disbursementCount,
      mappingCount,
      attachmentCount,
    };
  }, [
    basics.caseName,
    basics.status,
    audience.publicVisible,
    audience.selectedUserIds,
    audience.opensAtStr,
    audience.dueAtStr,
    transactions.disbursements,
    attachments.referenceDocuments,
  ]);

  const reviewChecklist = useMemo(() => {
    const entries = [];

    const trimmedCaseName = (basics.caseName || '').trim();
    entries.push({
      id: 'case-name',
      label: 'Case name provided',
      isReady: trimmedCaseName.length > 0,
      detail:
        trimmedCaseName.length > 0
          ? `Using “${trimmedCaseName}”.`
          : 'Enter a descriptive case name trainees will recognize.',
    });

    const disbursementList = Array.isArray(transactions.disbursements)
      ? transactions.disbursements
      : [];
    const disbursementKeyFields = [
      { key: 'paymentId', label: 'Payment ID' },
      { key: 'payee', label: 'Payee' },
      { key: 'amount', label: 'Amount' },
      { key: 'paymentDate', label: 'Payment Date' },
    ];
    const disbursementFieldIssues = [];
    if (disbursementList.length === 0) {
      disbursementFieldIssues.push(
        'Add at least one disbursement with a payment ID, payee, amount, and payment date.'
      );
    }
    disbursementList.forEach((disbursement, index) => {
      if (!disbursement) return;
      const missingFields = disbursementKeyFields
        .filter(({ key }) => !disbursement[key])
        .map(({ label }) => label);
      if (missingFields.length > 0) {
        disbursementFieldIssues.push(
          `Disbursement #${index + 1} is missing ${missingFields.join(', ')}.`
        );
      }
    });

    entries.push({
      id: 'disbursement-fields',
      label: 'Disbursement details complete',
      isReady: disbursementFieldIssues.length === 0,
      detail:
        disbursementFieldIssues.length === 0
          ? `All ${disbursementList.length} disbursement${
              disbursementList.length === 1 ? '' : 's'
            } include the required fields.`
          : disbursementFieldIssues.join(' '),
    });

    const incompleteAnswerKeys = [];
    disbursementList.forEach((disbursement, index) => {
      if (!disbursement) return;
      if (!isAnswerKeyReady(disbursement)) {
        const identifier = disbursement.paymentId || disbursement.payee || 'unnamed disbursement';
        incompleteAnswerKeys.push(
          `Answer key incomplete for disbursement #${index + 1} (${identifier}).`
        );
      }
    });

    entries.push({
      id: 'answer-key',
      label: 'Answer keys ready',
      isReady: disbursementList.length > 0 && incompleteAnswerKeys.length === 0,
      detail:
        disbursementList.length === 0
          ? 'Add disbursements to build corresponding answer keys.'
          : incompleteAnswerKeys.length === 0
          ? 'Answer keys include classifications, explanations, and matching totals.'
          : incompleteAnswerKeys.join(' '),
    });

    const uniqueSelectedUserIds = Array.isArray(audience.selectedUserIds)
      ? Array.from(new Set(audience.selectedUserIds))
      : [];
    const privateAudienceReady = audience.publicVisible || uniqueSelectedUserIds.length > 0;
    entries.push({
      id: 'audience',
      label: 'Audience visibility configured',
      isReady: privateAudienceReady,
      detail: audience.publicVisible
        ? 'Case is visible to all trainees.'
        : uniqueSelectedUserIds.length > 0
        ? `Private case with ${uniqueSelectedUserIds.length} authorized user${
            uniqueSelectedUserIds.length === 1 ? '' : 's'
          }.`
        : 'Add at least one authorized user for a private case.',
    });

    const referenceDocs = Array.isArray(attachments.referenceDocuments)
      ? attachments.referenceDocuments
      : [];
    const cashDocs = [];
    const referenceIssues = [];
    [...referenceDocs, ...cashDocs].forEach((doc, index) => {
      if (!doc) return;
      const hasAnyContent = Boolean(
        doc.clientSideFile || doc.fileName || doc.downloadURL || doc.storagePath
      );
      if (!hasAnyContent) return;
      const trimmedName = (doc.fileName || '').trim();
      const hasDisplayName = trimmedName.length > 0;
      const hasSource = Boolean(doc.clientSideFile || doc.downloadURL || doc.storagePath);
      if (!hasDisplayName) {
        referenceIssues.push(`Reference document #${index + 1} is missing a display name.`);
      }
      if (!hasSource) {
        const label = trimmedName || `Reference document #${index + 1}`;
        referenceIssues.push(
          `${label} needs an uploaded file, download URL, or storage path before submission.`
        );
      }
    });

    entries.push({
      id: 'reference-documents',
      label: 'Reference materials complete',
      isReady: referenceIssues.length === 0,
      detail:
        referenceIssues.length === 0
          ? referenceDocs.some(
              (doc) =>
                doc &&
                (doc.clientSideFile || doc.fileName || doc.downloadURL || doc.storagePath)
            )
            ? 'All reference documents include names and accessible files or links.'
            : 'No reference documents have been added yet.'
          : referenceIssues.join(' '),
    });

    const parseForChecklist = (value, label) => {
      if (!value) {
        return { timestamp: null };
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return { error: `${label} must be a valid date/time.` };
      }
      return { timestamp: parsed };
    };

    const opensResult = parseForChecklist(audience.opensAtStr, 'Opens At');
    const dueResult = parseForChecklist(audience.dueAtStr, 'Due At');

    let scheduleReady = true;
    let scheduleDetails = 'Schedule dates look good.';
    if (opensResult.error) {
      scheduleReady = false;
      scheduleDetails = opensResult.error;
    } else if (dueResult.error) {
      scheduleReady = false;
      scheduleDetails = dueResult.error;
    } else if (
      opensResult.timestamp &&
      dueResult.timestamp &&
      dueResult.timestamp.getTime() < opensResult.timestamp.getTime()
    ) {
      scheduleReady = false;
      scheduleDetails = 'Due At must be after Opens At.';
    } else if (opensResult.timestamp && dueResult.timestamp) {
      const formatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      scheduleDetails = `Runs from ${formatter.format(opensResult.timestamp)} to ${formatter.format(
        dueResult.timestamp
      )}.`;
    }

    entries.push({
      id: 'schedule',
      label: 'Schedule validated',
      isReady: scheduleReady,
      detail: scheduleDetails,
    });

    return entries;
  }, [
    attachments.referenceDocuments,
    audience.dueAtStr,
    audience.opensAtStr,
    audience.publicVisible,
    audience.selectedUserIds,
    basics.caseName,
    transactions.disbursements,
  ]);

  const allChecklistItemsReady = useMemo(
    () => (Array.isArray(reviewChecklist) ? reviewChecklist.every((item) => item.isReady) : false),
    [reviewChecklist]
  );

  const isLastStep = activeStep === steps.length - 1;

  const handleNext = () => {
    setActiveStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const handleBackStep = () => {
    setActiveStep((prev) => Math.max(prev - 1, 0));
  };

  if (loading && isEditing) {
    return <div className="p-4 text-center">Loading case details...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-3xl bg-white p-6 shadow-xl">
          <h1 className="text-3xl font-bold text-gray-800">
            {isEditing ? 'Edit Audit Case' : 'Create New Audit Case'}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Move through each step to update the case. Your progress is saved only when you finish the final review.
          </p>

          <CaseFormStepNav steps={steps} activeStep={activeStep} onStepChange={setActiveStep} disabled={loading} />

          <form onSubmit={handleSubmit} className="space-y-10">
            {activeStep === 0 ? <CaseBasicsStep basics={basics} /> : null}
            {activeStep === 1 ? <InstructionStep instructionData={instructionData} /> : null}
            {activeStep === 2 ? <AudienceScheduleStep audience={audience} /> : null}
            {activeStep === 3 ? <TransactionsStep transactions={transactions} files={files} /> : null}
            {activeStep === 4 ? <AttachmentsStep attachments={attachments} files={files} /> : null}
            {activeStep === 5 ? (
              <AnswerKeyStep
                disbursements={answerKey.disbursements}
                onUpdate={answerKey.updateAnswerKeyForDisbursement}
                classificationFields={answerKey.classificationFields}
                answerKeyLabels={answerKey.answerKeyLabels}
                classificationOptions={answerKey.answerKeyClassificationOptions}
              />
            ) : null}
            {activeStep === 6 ? (
              <ReviewStep
                summaryData={summaryData}
                reviewChecklist={reviewChecklist}
                allChecklistItemsReady={allChecklistItemsReady}
              />
            ) : null}

            <div className="flex flex-col gap-3 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {activeStep > 0 ? (
                  <Button onClick={handleBackStep} variant="secondary" type="button" disabled={loading}>
                    Back
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <Button
                  onClick={() => {
                    goBack();
                  }}
                  variant="secondary"
                  type="button"
                  disabled={loading}
                  className="justify-center"
                >
                  Cancel
                </Button>
                {isLastStep ? (
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={loading || !allChecklistItemsReady}
                    isLoading={loading}
                    className="justify-center"
                  >
                    {isEditing ? 'Save Changes' : 'Create Case'}
                  </Button>
                ) : (
                  <Button onClick={handleNext} variant="primary" type="button" disabled={loading} className="justify-center">
                    Next
                  </Button>
                )}
                {isLastStep && !allChecklistItemsReady ? (
                  <p className="text-sm text-amber-600 sm:text-right">
                    Complete the submission checklist before submitting.
                  </p>
                ) : null}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
