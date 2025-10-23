import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { storage, appId } from '../AppCore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { useAuth, Input, Button, Select, useRoute, useModal, Textarea } from '../AppCore';
import { fetchCase, createCase, updateCase } from '../services/caseService';
import { fetchUserRosterOptions } from '../services/userService';
import getUUID from '../utils/getUUID';
import {
  PlusCircle,
  Trash2,
  Paperclip,
  CheckCircle2,
  AlertTriangle,
  UploadCloud,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  AUDIT_AREA_VALUES,
  CASE_GROUP_VALUES,
  DEFAULT_AUDIT_AREA,
  AUDIT_AREA_LABELS,
  CASE_GROUP_LABELS,
} from '../models/caseConstants';

const STATUS_OPTIONS = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'archived', label: 'Archived' },
];

const ANSWER_KEY_FIELDS = ['properlyIncluded', 'properlyExcluded', 'improperlyIncluded', 'improperlyExcluded'];
const ANSWER_KEY_TOLERANCE = 0.01;
const ANSWER_KEY_LABELS = {
  properlyIncluded: 'Properly Included',
  properlyExcluded: 'Properly Excluded',
  improperlyIncluded: 'Improperly Included',
  improperlyExcluded: 'Improperly Excluded',
};
const ANSWER_KEY_PLACEHOLDER = '__choose';
const DEFAULT_ANSWER_KEY_CLASSIFICATION = ANSWER_KEY_PLACEHOLDER;
const ANSWER_KEY_CLASSIFICATION_OPTIONS = [
  { value: ANSWER_KEY_PLACEHOLDER, label: 'Choose classification…' },
  ...ANSWER_KEY_FIELDS.map((key) => ({
    value: key,
    label: ANSWER_KEY_LABELS[key],
  })),
];

const buildSingleAnswerKey = (classification, amountValue, explanation = '') => {
  const sanitizedAmount = Number(amountValue) || 0;
  const next = {
    properlyIncluded: 0,
    properlyExcluded: 0,
    improperlyIncluded: 0,
    improperlyExcluded: 0,
    explanation,
  };
  if (classification && ANSWER_KEY_FIELDS.includes(classification)) {
    next[classification] = sanitizedAmount;
  }
  return next;
};

const detectAnswerKeyMode = (disbursement) => {
  const answerKey = disbursement.answerKey || {};
  const amountNumber = Number(disbursement.amount || 0);
  let nonZeroCount = 0;
  let lastClassification = DEFAULT_ANSWER_KEY_CLASSIFICATION;
  let lastValue = 0;
  ANSWER_KEY_FIELDS.forEach((field) => {
    const value = Number(answerKey[field] || 0);
    if (!Number.isNaN(value) && value > 0) {
      nonZeroCount += 1;
      lastClassification = field;
      lastValue = value;
    }
  });
  const total = ANSWER_KEY_FIELDS.reduce((sum, field) => {
    const value = Number(answerKey[field] || 0);
    if (Number.isNaN(value)) return sum;
    return sum + value;
  }, 0);
  if (nonZeroCount <= 1) {
    // Treat as single classification; ensure totals match amount for consistency.
    const classificationCandidate =
      nonZeroCount === 1 && Math.abs(total - amountNumber) <= ANSWER_KEY_TOLERANCE
        ? lastClassification
        : ANSWER_KEY_PLACEHOLDER;
    const normalized = buildSingleAnswerKey(
      classificationCandidate === ANSWER_KEY_PLACEHOLDER ? null : classificationCandidate,
      classificationCandidate === ANSWER_KEY_PLACEHOLDER ? 0 : amountNumber,
      answerKey.explanation || ''
    );
    return {
      mode: 'single',
      classification: classificationCandidate,
      answerKey: normalized,
    };
  }
  return {
    mode: 'split',
    classification: lastClassification,
    answerKey,
  };
};

const isAnswerKeyReady = (disbursement) => {
  const amountNumber = Number(disbursement.amount || 0);
  const answerKey = disbursement.answerKey || {};
  const explanationOk = String(answerKey.explanation || '').trim().length > 0;

  if (disbursement.answerKeyMode === 'split') {
    const totals = ANSWER_KEY_FIELDS.reduce((sum, field) => {
      const value = Number(answerKey[field] || 0);
      if (!Number.isNaN(value)) return sum + value;
      return sum;
    }, 0);
    const hasValues = ANSWER_KEY_FIELDS.some((field) => Number(answerKey[field] || 0) > 0);
    return explanationOk && hasValues && Math.abs(totals - amountNumber) <= ANSWER_KEY_TOLERANCE;
  }

  const classification = disbursement.answerKeySingleClassification;
  if (!classification || classification === ANSWER_KEY_PLACEHOLDER) return false;
  const assignedAmount = Number(answerKey[classification] || 0);
  return explanationOk && Math.abs(assignedAmount - amountNumber) <= ANSWER_KEY_TOLERANCE;
};

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
    answerKeyMode: 'single',
    answerKeySingleClassification: DEFAULT_ANSWER_KEY_CLASSIFICATION,
    answerKey: buildSingleAnswerKey(null, 0, ''),
    mappings: [],
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
  const [caseGroupSelection, setCaseGroupSelection] = useState('__none');
  const [customCaseGroupId, setCustomCaseGroupId] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [rosterOptions, setRosterOptions] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState('');
  const [status, setStatus] = useState('assigned');
  const [opensAtStr, setOpensAtStr] = useState('');
  const [dueAtStr, setDueAtStr] = useState('');
  const [disbursements, setDisbursements] = useState([initialDisbursement()]);
  const [referenceDocuments, setReferenceDocuments] = useState([initialReferenceDocument()]);
  const [loading, setLoading] = useState(false);
  const [originalCaseData, setOriginalCaseData] = useState(null);

  const disbursementCsvInputRef = useRef(null);

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
            const baseDisbursements =
              data.disbursements?.map((d) => {
                const draft = {
                  _tempId: d._tempId || getUUID(),
                  paymentId: d.paymentId || '',
                  payee: d.payee || '',
                  amount: d.amount || '',
                  paymentDate: d.paymentDate || '',
                  answerKey: {
                    properlyIncluded: d.answerKey?.properlyIncluded ?? 0,
                    properlyExcluded: d.answerKey?.properlyExcluded ?? 0,
                    improperlyIncluded: d.answerKey?.improperlyIncluded ?? 0,
                    improperlyExcluded: d.answerKey?.improperlyExcluded ?? 0,
                    explanation: d.answerKey?.explanation ?? '',
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
        })
        .catch((error) => {
          console.error('Error fetching case for editing:', error);
          showModal('Error fetching case: ' + error.message, 'Error');
          setLoading(false);
          navigate('/admin');
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
      setOriginalCaseData(null);
      setAuditArea(DEFAULT_AUDIT_AREA);
      setCaseGroupSelection('__none');
      setCustomCaseGroupId('');
    }
  }, [isEditing, editingCaseId, navigate, showModal]);

  const handleDisbursementChange = (index, updatedItem) => {
    setDisbursements((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        let nextItem = updatedItem;
        if (nextItem.answerKeyMode !== 'split') {
          const classification = nextItem.answerKeySingleClassification || DEFAULT_ANSWER_KEY_CLASSIFICATION;
          const amountNumber = Number(nextItem.amount || 0);
          const explanation = nextItem.answerKey?.explanation || '';
          nextItem = {
            ...nextItem,
            answerKey: buildSingleAnswerKey(classification, amountNumber, explanation),
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
      .replace(/[\/\\#?[\]*<>:"|]+/g, '_')
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
    if (!docItem.clientSideFile) {
      if (!fallbackName) {
        return null;
      }
      const storagePath = (docItem.storagePath || '').trim();
      const downloadURL = (docItem.downloadURL || '').trim();
      const payload = {
        _tempId: docItem._tempId,
        fileName: fallbackName,
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
      };
    }
    if (!caseIdForUpload) {
      const errorMsg = 'Cannot upload reference document: Case ID not finalized.';
      console.error(errorMsg, docItem);
      ulog(uploadId, 'reference:abort:no-case-id');
      setReferenceDocuments((prev) =>
        prev.map((doc) => (doc._tempId === docItem._tempId ? { ...doc, uploadError: errorMsg, uploadProgress: undefined } : doc))
      );
      throw new Error(errorMsg);
    }

    const desiredContentType = docItem.contentType || pickContentType(file);
    const rawName = file?.name || fallbackName || 'reference.pdf';
    const safeStorageName = ensureSafeStorageName(rawName, desiredContentType);
    const displayName = ((docItem.fileName || '').trim() || safeStorageName).trim();
    const finalStoragePath = `artifacts/${appId}/case_reference/${caseIdForUpload}/${safeStorageName}`;
    ulog(uploadId, 'reference:path', { rawName, safeStorageName, displayName, finalStoragePath });

    setReferenceDocuments((prev) =>
      prev.map((doc) =>
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
      )
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
            setReferenceDocuments((prev) =>
              prev.map((doc) => (doc._tempId === docItem._tempId ? { ...doc, uploadProgress: pct } : doc))
            );
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
        setReferenceDocuments((prev) =>
          prev.map((doc) =>
            doc._tempId === docItem._tempId
              ? { ...doc, uploadProgress: 100, downloadURL, uploadError: null }
              : doc
          )
        );
        return {
          _tempId: docItem._tempId,
          fileName: displayName,
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
        setReferenceDocuments((prev) =>
          prev.map((doc) =>
            doc._tempId === docItem._tempId
              ? { ...doc, uploadError: msg, uploadProgress: undefined }
              : doc
          )
        );
        return {
          _tempId: docItem._tempId,
          fileName: displayName,
          storagePath: finalStoragePath,
          downloadURL: '',
          uploadError: msg,
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
      ulog(uploadId, 'reference:retry:once', first.uploadError);
      await new Promise((r) => setTimeout(r, 1500));
      return await runResumable();
    }

    return first;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!caseName.trim()) {
      showModal('Case name is required.', 'Validation Error');
      return;
    }

    if (!Array.isArray(disbursements) || disbursements.length === 0) {
      showModal('Add at least one disbursement before saving.', 'Validation Error');
      return;
    }

    const keyFields = ['paymentId', 'payee', 'amount', 'paymentDate'];
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

    const activeReferenceDocs = referenceDocuments.filter((doc) => {
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

        finalReferenceDocuments = referenceResults
          .filter((item) => item && !item.uploadError && item.fileName)
          .map(({ _tempId, clientSideFile, uploadProgress, uploadError, ...rest }) => rest);
      }

      const disbursementPayload = mergeDisbursementDocuments(disbursements, finalInvoiceMappings).map(
        ({ mappings, answerKeyMode, answerKeySingleClassification, ...rest }) => rest
      );

      const caseDataPayload = {
        caseName,
        title: caseName,
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
      };

      if (!isNewCaseCreation) {
        caseDataPayload.createdAt = originalCaseData?.createdAt ?? null;
      }

      await updateCase(currentCaseId, caseDataPayload);

      showModal(`Case ${isNewCaseCreation ? 'created' : 'updated'} successfully!`, 'Success');
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
    auditAreaSelectOptions,
    caseGroupSelection,
    setCaseGroupSelection,
    caseGroupSelectOptions,
    customCaseGroupId,
    setCustomCaseGroupId,
    status,
    setStatus,
    statusOptions: STATUS_OPTIONS,
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
  };

  const attachments = {
    disbursements,
    referenceDocuments,
    handleReferenceDocChange,
    addReferenceDocument,
    removeReferenceDocument,
    handleReferenceDocFileSelect,
  };

  const answerKey = {
    disbursements,
    updateAnswerKeyForDisbursement,
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
    files,
    actions: { handleSubmit, goBack },
  };
}

function CaseFormStepNav({ steps, activeStep, onStepChange, disabled }) {
  const progressPct = Math.round(((activeStep + 1) / steps.length) * 100);

  return (
    <div className="mb-6">
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-[560px] flex-nowrap gap-2">
          {steps.map((step, index) => {
            const isActive = index === activeStep;
            const isComplete = index < activeStep;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => !disabled && onStepChange(index)}
                className={
                  'flex min-w-[140px] items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ' +
                  (isActive
                    ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                    : isComplete
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 bg-gray-100 text-gray-600 hover:border-gray-300 hover:bg-gray-200')
                }
                disabled={disabled}
              >
                <span
                  className={
                    'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ' +
                    (isActive || isComplete ? 'bg-current text-white' : 'bg-white text-gray-600')
                  }
                >
                  {index + 1}
                </span>
                <span className="truncate">{step.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 h-2 w-full rounded-full bg-gray-200" aria-hidden="true">
        <div
          className="h-2 rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {progressPct}% complete
      </p>
      {steps[activeStep]?.description ? (
        <p className="mt-3 text-sm text-gray-500">{steps[activeStep].description}</p>
      ) : null}
    </div>
  );
}

function StepIntro({ title, items = [], helper }) {
  if (!title && items.length === 0 && !helper) return null;
  return (
    <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5 text-sm shadow-sm">
      {title ? <p className="text-sm font-semibold text-blue-700">{title}</p> : null}
      {items.length > 0 ? (
        <ul className="mt-3 space-y-1 text-gray-700">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {helper ? <p className="mt-3 text-xs text-gray-500">{helper}</p> : null}
    </div>
  );
}

// Convert a long validation paragraph (or array) into an array of concise list items.
const normalizeChecklistDetail = (detail) => {
  if (Array.isArray(detail)) {
    return detail.map((d) => String(d).trim()).filter(Boolean);
  }
  if (typeof detail === 'string') {
    const text = detail.trim();
    if (!text) return [];
    // Try to parse strings like:
    // "Answer key incomplete for disbursement #1 (7546). Answer key incomplete for disbursement #2 (4325203481203). ..."
    const items = [];
    const re = /Answer key incomplete for disbursement\s*#(\d+)[^()]*\(([^)]+)\)\.?/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      items.push(`Answer key incomplete for disbursement #${m[1]} (${m[2]})`);
    }
    if (items.length > 0) return items;
    // Fallback: split by sentences/newlines
    return text
      .split(/(?:\.\s+|\n)/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

const ChecklistItem = ({
  label,
  isReady,
  detail,
  readyText = 'Ready',
  unreadyText = 'Incomplete',
}) => {
  const Icon = isReady ? CheckCircle2 : AlertTriangle;
  const colorClass = isReady ? 'text-emerald-600' : 'text-amber-600';

  // Turn the long paragraph into a list of concise items when not ready
  const items = React.useMemo(() => normalizeChecklistDetail(detail), [detail]);
  const [expanded, setExpanded] = useState(false);
  const MAX_PREVIEW = 6;
  const visibleItems = expanded ? items : items.slice(0, MAX_PREVIEW);

  const copyAll = async () => {
    try {
      const text = items.length > 0 ? items.join('\n') : String(detail || '');
      await navigator.clipboard.writeText(text);
    } catch {
      // no-op
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-start gap-3">
            <Icon size={20} className={colorClass} />
            <div className="min-w-0">
              <span className="text-sm font-medium text-gray-800">{label}</span>
              {/* Fallback to original text if we don't have a list */}
              {!isReady && items.length === 0 && detail ? (
                <p className="mt-1 text-xs text-amber-600">{detail}</p>
              ) : null}
            </div>
          </div>

          {/* Render a compact, scannable list when there are many items */}
          {!isReady && items.length > 0 ? (
            <div className="mt-2">
              <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-6 pr-2 text-xs text-amber-700">
                {visibleItems.map((line, idx) => (
                  <li key={idx} className="break-words">{line}</li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {items.length > MAX_PREVIEW ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    {expanded ? 'Show less' : `Show all ${items.length}`}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={copyAll}
                  className="text-xs text-gray-600 hover:underline"
                  title="Copy the list to clipboard"
                >
                  Copy list
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <span className={`shrink-0 text-sm font-semibold ${colorClass}`}>
          {isReady ? readyText : unreadyText}
        </span>
      </div>
    </div>
  );
};

function ReviewStep({ summaryData, reviewChecklist = [], allChecklistItemsReady = true }) {
  const formatDateTime = (value) => {
    if (!value) return 'Not set';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not set';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  };

  const audienceLabel = summaryData.publicVisible
    ? 'Visible to all trainees'
    : `${summaryData.selectedUserIds.length} specific user${summaryData.selectedUserIds.length === 1 ? '' : 's'}`;

  const readyCount = Array.isArray(reviewChecklist)
    ? reviewChecklist.filter((item) => item.isReady).length
    : 0;
  const totalCount = Array.isArray(reviewChecklist) ? reviewChecklist.length : 0;

  const ChecklistStatusIcon = allChecklistItemsReady ? CheckCircle2 : AlertTriangle;
  const statusText = allChecklistItemsReady ? 'All items ready' : 'Incomplete items';
  const statusColorClass = allChecklistItemsReady ? 'text-emerald-600 border-emerald-200 bg-emerald-50' : 'text-amber-600 border-amber-200 bg-amber-50';
  const checklistCardBaseClass = 'rounded-2xl border p-6 shadow-sm transition-colors';
  const checklistCardStateClass = allChecklistItemsReady
    ? 'border-emerald-200 bg-emerald-50/40'
    : 'border-amber-200 bg-amber-50';

  return (
    <div className="space-y-6">
      <StepIntro
        title="Final review"
        items={[
          'Confirm key dates, status, and audience visibility.',
          'Double-check disbursement counts and supporting files.',
          'Submit when you are confident everything is accurate.',
        ]}
        helper="You can navigate back to earlier steps if something needs a quick edit before publishing."
      />

      <div className={`${checklistCardBaseClass} ${checklistCardStateClass}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Submission checklist</h2>
            <p className="mt-1 text-sm text-gray-600">
              {readyCount}/{totalCount} items ready for submission
            </p>
          </div>
          <div
            className={`flex items-center gap-2 self-start rounded-full border px-3 py-1 text-sm font-medium ${statusColorClass}`}
          >
            <ChecklistStatusIcon size={16} />
            <span>{statusText}</span>
          </div>
        </div>
        {Array.isArray(reviewChecklist) && reviewChecklist.length > 0 ? (
          <div className="mt-4 space-y-3">
            {reviewChecklist.map((item) => (
              <ChecklistItem
                key={item.id}
                label={item.label}
                isReady={item.isReady}
                detail={!item.isReady ? item.detail : undefined}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Case Summary</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap">Case Name</span>
            <p className="font-medium text-gray-900">{summaryData.caseName?.trim() || 'Untitled case'}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap">Status</span>
            <p className="font-medium text-gray-900 capitalize">{summaryData.status}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap">Opens</span>
            <p className="font-medium text-gray-900">{formatDateTime(summaryData.opensAtStr)}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap">Due</span>
            <p className="font-medium text-gray-900">{formatDateTime(summaryData.dueAtStr)}</p>
          </div>
          <div className="space-y-1 md:col-span-2">
            <span className="text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap">Audience</span>
            <p className="font-medium text-gray-900">{audienceLabel}</p>
            {!summaryData.publicVisible && summaryData.selectedUserIds.length > 0 ? (
              <ul className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                {summaryData.selectedUserIds.slice(0, 6).map((id) => (
                  <li key={id} className="rounded bg-white px-2 py-1 shadow-sm">
                    {id}
                  </li>
                ))}
                {summaryData.selectedUserIds.length > 6 ? (
                  <li className="rounded bg-white px-2 py-1 shadow-sm text-gray-500">
                    +{summaryData.selectedUserIds.length - 6} more
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <SummaryPill label="Disbursements" value={summaryData.disbursementCount} />
          <SummaryPill label="Invoice Docs" value={summaryData.mappingCount} />
          <SummaryPill label="References" value={summaryData.attachmentCount} />
        </div>
      </div>
    </div>
  );
}

const SummaryPill = ({ label, value }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
    <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap">
      {label}
    </span>
    <span className="mt-2 block text-2xl font-semibold text-gray-900">{value}</span>
  </div>
);

function CaseBasicsStep({ basics }) {
  const {
    caseName,
    setCaseName,
    auditArea,
    setAuditArea,
    auditAreaSelectOptions,
    caseGroupSelection,
    setCaseGroupSelection,
    caseGroupSelectOptions,
    customCaseGroupId,
    setCustomCaseGroupId,
    status,
    setStatus,
    statusOptions,
  } = basics;

  return (
    <div className="space-y-6">
      <StepIntro
        title="In this step"
        items={[
          'Give the case a clear name trainees will recognize.',
          'Choose the audit area and active status.',
          'Optionally group the case for cohorts or curriculum.'
        ]}
        helper="You can revisit these details later. Keeping the status accurate helps trainees understand whether the case is ready."
      />

      <div>
        <label htmlFor="caseName" className="block text-sm font-medium text-gray-700">
          Case Name
        </label>
        <Input
          id="caseName"
          value={caseName}
          onChange={(e) => setCaseName(e.target.value)}
          placeholder="e.g., Q1 Unrecorded Liabilities Review"
          required
          className="mt-2"
        />
        <p className="mt-1 text-xs text-gray-500">Trainees see this title on their dashboard.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="auditArea" className="block text-sm font-medium text-gray-700">
            Audit Area
          </label>
          <Select
            id="auditArea"
            value={auditArea}
            onChange={(e) => setAuditArea(e.target.value)}
            options={auditAreaSelectOptions}
            className="mt-2"
          />
          <p className="mt-1 text-xs text-gray-500">Used for filtering and reporting.</p>
        </div>
        <div>
          <label htmlFor="caseStatus" className="block text-sm font-medium text-gray-700">
            Case Status
          </label>
          <Select
            id="caseStatus"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={statusOptions}
            className="mt-2"
          />
        </div>
      </div>

      <div>
        <label htmlFor="caseGroupSelection" className="block text-sm font-medium text-gray-700">
          Case Group (optional)
        </label>
        <Select
          id="caseGroupSelection"
          value={caseGroupSelection}
          onChange={(e) => setCaseGroupSelection(e.target.value)}
          options={caseGroupSelectOptions}
          className="mt-2"
        />
        <p className="mt-1 text-xs text-gray-500">Organize scenarios by cohort or curriculum. Leave as “No group” if not needed.</p>
      </div>

      {caseGroupSelection === '__custom' ? (
        <div>
          <label htmlFor="customCaseGroupId" className="block text-sm font-medium text-gray-700">
            Custom Group Identifier
          </label>
          <Input
            id="customCaseGroupId"
            value={customCaseGroupId}
            onChange={(e) => setCustomCaseGroupId(e.target.value)}
            placeholder="e.g., ap-advanced-spring"
            className="mt-2"
          />
          <p className="mt-1 text-xs text-gray-500">Use a lowercase slug that matches your reporting conventions.</p>
        </div>
      ) : null}
    </div>
  );
}

function AudienceScheduleStep({ audience }) {
  const {
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
  } = audience;

  return (
    <div className="space-y-6">
      <StepIntro
        title="Focus for this step"
        items={[
          'Decide who should see the case.',
          'Add or remove specific trainees when privacy is needed.',
          'Set optional open and due dates so trainees see a clear timeline.'
        ]}
        helper="Private cases must have at least one trainee selected. You can leave the schedule blank if timing is flexible."
      />

      <div className="rounded-lg border border-gray-200 p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-800">Audience</h3>
            <p className="mt-1 text-xs text-gray-500">Limit visibility to specific trainees or keep it open to everyone.</p>
          </div>
          <label className="inline-flex items-center space-x-2 text-sm">
            <input
              id="publicVisible"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={publicVisible}
              onChange={(e) => setPublicVisible(e.target.checked)}
            />
            <span className="text-gray-700">Visible to all signed-in trainees</span>
          </label>
        </div>
        {!publicVisible ? (
          <div className="mt-4">
            <label htmlFor="visibleToUserIds" className="block text-sm font-medium text-gray-700">
              Visible to Specific Users
            </label>
            <RosterMultiSelect
              id="visibleToUserIds"
              options={rosterOptions}
              value={selectedUserIds}
              onChange={setSelectedUserIds}
              disabled={publicVisible || rosterLoading}
              loading={rosterLoading}
              placeholder="Search by name, email, or ID"
            />
            <p className="mt-1 text-xs text-gray-500">Select one or more users who should see this case.</p>
            {rosterError ? (
              <p className="mt-1 text-xs text-red-600">
                {rosterError} You can still type a user ID and press Enter to add it manually.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-xs text-gray-500">This case is currently visible to all trainees.</p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-base font-semibold text-gray-800">Schedule</h3>
        <p className="mt-1 text-xs text-gray-500">Times are stored in UTC and shown in the trainee’s local timezone.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="opensAt" className="block text-sm font-medium text-gray-700">
              Opens At (UTC)
            </label>
            <Input
              id="opensAt"
              type="datetime-local"
              value={opensAtStr}
              onChange={(e) => setOpensAtStr(e.target.value)}
              className="mt-2"
            />
            <p className="mt-1 text-xs text-gray-500">Optional. Trainees will see the case after this time.</p>
          </div>
          <div>
            <label htmlFor="dueAt" className="block text-sm font-medium text-gray-700">
              Due At (UTC)
            </label>
            <Input
              id="dueAt"
              type="datetime-local"
              value={dueAtStr}
              onChange={(e) => setDueAtStr(e.target.value)}
              className="mt-2"
            />
            <p className="mt-1 text-xs text-gray-500">Optional deadline for trainees.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TransactionsStep({ transactions, files }) {
  const {
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
  } = transactions;
  const { FILE_INPUT_ACCEPT, prettySupportedLabels, MAX_ARTIFACT_BYTES } = files;

  return (
    <div className="space-y-8">
      <StepIntro
        title="Complete these tasks"
        items={[
          'Review each disbursement and confirm amount, payee, and date.',
          'Attach supporting invoices for the transactions trainees will inspect.',
          'Use CSV import if you have many disbursements to add at once.'
        ]}
        helper="Keep each card closed once the details are confirmed. This keeps the list scannable, especially for longer cases."
      />

      <section className="rounded-lg border border-gray-200 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-800">Disbursements</h3>
            <p className="text-xs text-gray-500">
              Import a CSV or add entries manually. Answer keys stay hidden until you expand an item.
            </p>
          </div>
          <div>
            <label
              htmlFor="csvImportDisbursements"
              className="inline-flex cursor-pointer items-center rounded-md bg-green-500 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-green-600"
            >
              <UploadCloud size={16} className="mr-2" /> Import CSV
            </label>
            <Input
              id="csvImportDisbursements"
              type="file"
              accept=".csv"
              onChange={handleCsvImport}
              className="hidden"
              ref={disbursementCsvInputRef}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          CSV format: PaymentID,Payee,Amount,PaymentDate (with header row). Dates should be YYYY-MM-DD.
        </p>
        <div className="mt-4 space-y-4">
          {disbursements.map((item, index) => (
            <DisbursementItem
              key={item._tempId}
              item={item}
              index={index}
              onChange={handleDisbursementChange}
              onRemove={removeDisbursement}
              onAddMapping={addMappingToDisbursement}
              onRemoveMapping={removeMappingFromDisbursement}
              onSelectMappingFile={handleMappingFileSelect}
              onSyncPaymentId={syncMappingsWithPaymentId}
              fileAcceptValue={FILE_INPUT_ACCEPT}
              maxUploadBytes={MAX_ARTIFACT_BYTES}
              prettySupportedLabels={prettySupportedLabels}
            />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={addDisbursement} variant="secondary" type="button">
            <PlusCircle size={16} className="mr-1" /> Add Disbursement
          </Button>
        </div>
      </section>
    </div>
  );
}

function AttachmentsStep({ attachments, files }) {
  const {
    disbursements,
    referenceDocuments,
    handleReferenceDocChange,
    addReferenceDocument,
    removeReferenceDocument,
    handleReferenceDocFileSelect,
  } = attachments;
  const { FILE_INPUT_ACCEPT } = files;

  return (
    <div className="space-y-6">
      <StepIntro
        title="Check supporting files"
        items={[
          'Review invoice documents linked to each disbursement.',
          'Upload or link reference materials trainees need for context.',
          'Confirm file names and statuses before publishing.'
        ]}
        helper="Use this step as a final file audit. Disbursement invoices are edited in the Transactions step; reference files can be updated here."
      />

      <section className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-base font-semibold text-gray-800">Invoice Attachments</h3>
        <p className="mt-1 text-xs text-gray-500">
          Each disbursement should have at least one supporting document. Use the Transactions step to add or remove files.
        </p>
        <div className="mt-4 space-y-4">
          {disbursements.map((disbursement) => (
            <div
              key={disbursement._tempId}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {disbursement.paymentId || 'Payment ID pending'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {disbursement.payee || 'Payee pending'} ·{' '}
                    {disbursement.amount ? `$${Number(disbursement.amount).toLocaleString()}` : 'Amount pending'}
                  </p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  {(disbursement.mappings || []).length} document{(disbursement.mappings || []).length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {(disbursement.mappings || []).length === 0 ? (
                  <p className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
                    No documents linked yet. Add them under the Transactions step.
                  </p>
                ) : (
                  (disbursement.mappings || []).map((mapping) => (
                    <InvoiceMappingSummaryRow key={mapping._tempId} mapping={mapping} />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-base font-semibold text-gray-800">Reference Documents</h3>
        <p className="mt-1 text-xs text-gray-500">
          Provide supplemental files (e.g., AP aging, accrual schedules). Expand an item to configure download URLs or storage paths.
        </p>
        <div className="mt-4 space-y-4">
          {referenceDocuments.map((item, index) => (
            <ReferenceDocumentItem
              key={item._tempId}
              item={item}
              index={index}
              onChange={handleReferenceDocChange}
              onRemove={removeReferenceDocument}
              onFileSelect={handleReferenceDocFileSelect}
              acceptValue={FILE_INPUT_ACCEPT}
            />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={addReferenceDocument} variant="secondary" type="button">
            <PlusCircle size={16} className="mr-1" /> Add Reference Document
          </Button>
        </div>
      </section>
    </div>
  );
}

function AnswerKeyStep({ disbursements, onUpdate }) {
  return (
    <div className="space-y-6">
      <StepIntro
        title="Define the correct answer"
        items={[
          'Enter the correct totals for each classification per disbursement.',
          'Add a concise explanation so trainees understand the reasoning.',
          'Ensure the totals match the disbursement amount before submitting.',
        ]}
        helper="These answers power automated feedback. Every disbursement must be fully completed."
      />

      <div className="space-y-4">
        {disbursements.map((disbursement, index) => (
          <AnswerKeyCard
            key={disbursement._tempId}
            disbursement={disbursement}
            index={index}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    </div>
  );
}

const AnswerKeyCard = ({ disbursement, index, onUpdate }) => {
  const paymentLabel = disbursement.paymentId || `Disbursement ${index + 1}`;
  const answerKey = disbursement.answerKey || {};
  const mode = disbursement.answerKeyMode || 'single';
  const splitEnabled = mode === 'split';
  const classification = disbursement.answerKeySingleClassification || DEFAULT_ANSWER_KEY_CLASSIFICATION;
  const classificationChosen = classification && classification !== ANSWER_KEY_PLACEHOLDER;
  const classificationLabel = classificationChosen
    ? ANSWER_KEY_LABELS[classification]
    : 'Choose classification';
  const amountNumber = Number(disbursement.amount || 0);
  const ready = isAnswerKeyReady(disbursement);
  const [expanded, setExpanded] = useState(false);

  const handleClassificationChange = (value) => {
    onUpdate(index, (current) => {
      const explanation = current.answerKey?.explanation || '';
      return {
        ...current,
        answerKeyMode: 'single',
        answerKeySingleClassification: value,
        answerKey: buildSingleAnswerKey(
          value && value !== ANSWER_KEY_PLACEHOLDER ? value : null,
          value && value !== ANSWER_KEY_PLACEHOLDER ? Number(current.amount || 0) : 0,
          explanation
        ),
      };
    });
  };

  const handleSplitToggle = (checked) => {
    if (checked) {
      onUpdate(index, (current) => ({
        ...current,
        answerKeyMode: 'split',
      }));
    } else {
      onUpdate(index, (current) => {
        const existingClassification =
          current.answerKeySingleClassification && current.answerKeySingleClassification !== ANSWER_KEY_PLACEHOLDER
            ? current.answerKeySingleClassification
            : null;
        const fallbackClassification = existingClassification || ANSWER_KEY_PLACEHOLDER;
        const explanation = current.answerKey?.explanation || '';
        return {
          ...current,
          answerKeyMode: 'single',
          answerKeySingleClassification: fallbackClassification,
          answerKey: buildSingleAnswerKey(
            fallbackClassification && fallbackClassification !== ANSWER_KEY_PLACEHOLDER ? fallbackClassification : null,
            fallbackClassification && fallbackClassification !== ANSWER_KEY_PLACEHOLDER ? Number(current.amount || 0) : 0,
            explanation
          ),
        };
      });
    }
  };

  const handleExplanationChange = (value) => {
    onUpdate(index, (current) => ({
      ...current,
      answerKey: {
        ...current.answerKey,
        explanation: value,
      },
    }));
  };

  const handleSplitFieldChange = (field, value) => {
    onUpdate(index, (current) => ({
      ...current,
      answerKey: {
        ...current.answerKey,
        [field]: value,
      },
    }));
  };

  const explanationPreview = String(answerKey.explanation || '').trim() || 'Not provided yet';
  const statusBadgeClass = ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700';
  const statusText = ready ? 'READY' : 'INCOMPLETE';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{paymentLabel}</p>
          <p className="text-xs text-gray-500">
            {disbursement.payee || 'Payee pending'} ·{' '}
            {disbursement.amount
              ? `$${Number(disbursement.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : 'Amount pending'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusBadgeClass}`}>
            {statusText}
          </span>
          <button
            type="button"
            className="inline-flex h-10 w-32 items-center justify-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Hide details' : 'Edit details'}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 text-sm">
              <label className="font-medium text-blue-900" htmlFor={`classification-${disbursement._tempId}`}>
                Classification
              </label>
              <Select
                id={`classification-${disbursement._tempId}`}
                value={classification}
                onChange={(event) => handleClassificationChange(event.target.value)}
                options={ANSWER_KEY_CLASSIFICATION_OPTIONS}
                disabled={splitEnabled}
              />
              <p className="text-xs text-blue-700">
                {splitEnabled
                  ? 'Splitting enabled below'
                  : classificationChosen && amountNumber
                  ? `Entire amount of $${amountNumber.toLocaleString()} assigned to this classification.`
                  : 'Select the correct classification or enable split disbursement.'}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-blue-800">
              <input
                type="checkbox"
                className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                checked={splitEnabled}
                onChange={(event) => handleSplitToggle(event.target.checked)}
              />
              Split disbursement across classifications
            </label>
          </div>

          {splitEnabled ? (
            <div className="rounded-xl border border-gray-200 bg-white/90 p-4 shadow-sm">
              <p className="text-xs text-gray-500">
                Enter the portion allocated to each classification. Totals must equal the disbursement amount.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {ANSWER_KEY_FIELDS.map((field) => (
                  <div key={field} className="flex flex-col text-sm">
                    <label className="mb-1 font-medium text-gray-700" htmlFor={`${disbursement._tempId}-${field}`}>
                      {ANSWER_KEY_LABELS[field]}
                    </label>
                    <Input
                      id={`${disbursement._tempId}-${field}`}
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={answerKey?.[field] ?? ''}
                      onChange={(event) => handleSplitFieldChange(field, event.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor={`${disbursement._tempId}-explanation`}>
              Explanation shown to trainees
            </label>
            <Textarea
              id={`${disbursement._tempId}-explanation`}
              rows={splitEnabled ? 4 : 3}
              required
              value={answerKey?.explanation ?? ''}
              onChange={(event) => handleExplanationChange(event.target.value)}
              placeholder="Briefly explain why this allocation is correct."
            />
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-100 p-4">
          <div className="grid gap-4 text-sm text-gray-700 md:grid-cols-2">
            <div>
              <span className="text-xs uppercase tracking-wide text-gray-500">Classification</span>
              <p className={`mt-1 font-semibold ${splitEnabled ? 'text-blue-700' : classificationChosen ? 'text-gray-900' : 'text-amber-600'}`}>
                {splitEnabled ? 'Split across classifications' : classificationLabel}
              </p>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wide text-gray-500">Explanation</span>
              <p className="mt-1 truncate text-gray-600">{explanationPreview}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function CaseFormPage({ params }) {
  const {
    meta: { isEditing },
    status: { loading },
    basics,
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
      { id: 'audience', label: 'Audience & Schedule', description: 'Visibility controls and timing' },
      { id: 'transactions', label: 'Transactions', description: 'Disbursements and supporting invoices' },
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
    const referenceIssues = [];
    referenceDocs.forEach((doc, index) => {
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
    answerKey.disbursements,
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
            {activeStep === 1 ? <AudienceScheduleStep audience={audience} /> : null}
            {activeStep === 2 ? <TransactionsStep transactions={transactions} files={files} /> : null}
            {activeStep === 3 ? <AttachmentsStep attachments={attachments} files={files} /> : null}
            {activeStep === 4 ? (
              <AnswerKeyStep disbursements={answerKey.disbursements} onUpdate={answerKey.updateAnswerKeyForDisbursement} />
            ) : null}
            {activeStep === 5 ? (
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

const RosterMultiSelect = ({ id, options, value, onChange, disabled, loading, placeholder }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const optionsMap = useMemo(() => {
    const map = new Map();
    options.forEach((option) => {
      map.set(option.id, option);
    });
    return map;
  }, [options]);

  const valueSet = useMemo(() => new Set(value), [value]);

  const normalizedSelected = useMemo(
    () =>
      value.map((selectedId) => {
        const option = optionsMap.get(selectedId);
        return {
          id: selectedId,
          label: option?.label || selectedId,
        };
      }),
    [value, optionsMap]
  );

  const filteredOptions = useMemo(() => {
    const available = options.filter((option) => !valueSet.has(option.id));
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return available.slice(0, 20);
    }
    return available.filter((option) => {
      const label = option.label?.toLowerCase() || '';
      const email = option.email?.toLowerCase() || '';
      return label.includes(trimmed) || email.includes(trimmed) || option.id.toLowerCase().includes(trimmed);
    });
  }, [options, query, valueSet]);

  const handleInputFocus = () => {
    if (!disabled) {
      setOpen(true);
    }
  };

  const handleInputChange = (event) => {
    if (disabled) return;
    setQuery(event.target.value);
    setOpen(true);
  };

  const addValue = (rawId) => {
    const trimmed = typeof rawId === 'string' ? rawId.trim() : '';
    if (!trimmed || valueSet.has(trimmed)) {
      setQuery('');
      setOpen(false);
      return;
    }
    onChange([...value, trimmed]);
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (filteredOptions.length > 0) {
        const [first] = filteredOptions;
        if (first) addValue(first.id);
      } else {
        addValue(query);
      }
    }
    if (event.key === 'Backspace' && !query && value.length > 0) {
      event.preventDefault();
      const next = value.slice(0, -1);
      onChange(next);
    }
  };

  const removeSelected = (selectedId) => {
    if (disabled) return;
    onChange(value.filter((idValue) => idValue !== selectedId));
  };

  const selectOption = (option) => {
    if (disabled) return;
    addValue(option.id);
  };

  const dropdownId = id ? `${id}-options` : undefined;

  const showDropdown = !disabled && open && filteredOptions.length > 0;

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-gray-300 px-2 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
        {normalizedSelected.map((selected) => (
          <span
            key={selected.id}
            className="flex items-center space-x-1 rounded bg-blue-100 px-2 py-1 text-xs text-blue-800"
          >
            <span>{selected.label}</span>
            <button
              type="button"
              className="text-blue-600 hover:text-blue-800"
              aria-label={`Remove ${selected.label}`}
              onClick={() => removeSelected(selected.id)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={normalizedSelected.length === 0 ? placeholder : ''}
          disabled={disabled}
          className="flex-1 border-none bg-transparent py-1 text-sm text-gray-700 outline-none"
          role="combobox"
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
          aria-controls={dropdownId}
          aria-label="Search roster"
        />
      </div>
      {showDropdown ? (
        <ul
          id={dropdownId}
          role="listbox"
          className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
        >
          {filteredOptions.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                <span className="text-gray-700">{option.label}</span>
                {option.email ? <span className="text-xs text-gray-500">{option.email}</span> : null}
              </button>
            </li>
          ))}
          {filteredOptions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">No matches found.</li>
          ) : null}
        </ul>
      ) : null}
      {loading ? <p className="mt-1 text-xs text-gray-500">Loading roster…</p> : null}
    </div>
  );
};

const DisbursementItem = ({
  item,
  index,
  onChange,
  onRemove,
  onAddMapping,
  onRemoveMapping,
  onSelectMappingFile,
  onSyncPaymentId,
  fileAcceptValue,
  maxUploadBytes,
  prettySupportedLabels,
}) => {
  const isNewItem = !item.paymentId && !item.payee && !item.amount && !item.paymentDate;
  const [expanded, setExpanded] = useState(isNewItem || index === 0);

  useEffect(() => {
    if (isNewItem) {
      setExpanded(true);
    }
  }, [isNewItem]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    let nextItem = { ...item, [name]: value };
    if (name === 'amount' && nextItem.answerKeyMode !== 'split') {
      const classification = nextItem.answerKeySingleClassification || DEFAULT_ANSWER_KEY_CLASSIFICATION;
      const amountNumber = Number(value) || 0;
      const explanation = nextItem.answerKey?.explanation || '';
      nextItem.answerKey = buildSingleAnswerKey(classification, amountNumber, explanation);
    }
    onChange(index, nextItem);
    if (name === 'paymentId') {
      onSyncPaymentId(nextItem._tempId, value);
    }
  };

  const baseId = item._tempId || item.paymentId || `disbursement-${index}`;
  const mappings = item.mappings || [];

  const formatAmount = (value) => {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return value || 'Pending';
  };

  const summaryFields = [
    {
      label: 'Payment ID',
      value: item.paymentId || 'Pending',
      editor: (
        <Input
          id={`${baseId}-paymentId`}
          name="paymentId"
          value={item.paymentId}
          onChange={handleChange}
          placeholder="Payment ID"
          required
        />
      ),
    },
    {
      label: 'Payee',
      value: item.payee || 'Pending',
      editor: (
        <Input
          id={`${baseId}-payee`}
          name="payee"
          value={item.payee}
          onChange={handleChange}
          placeholder="Payee"
          required
        />
      ),
    },
    {
      label: 'Amount',
      value: item.amount ? `$${formatAmount(item.amount)}` : 'Pending',
      editor: (
        <Input
          id={`${baseId}-amount`}
          name="amount"
          type="number"
          value={item.amount}
          onChange={handleChange}
          placeholder="Amount (e.g., 123.45)"
          required
        />
      ),
    },
    {
      label: 'Payment Date',
      value: item.paymentDate
        ? new Date(item.paymentDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : 'Pending',
      editor: (
        <Input
          id={`${baseId}-date`}
          name="paymentDate"
          type="date"
          value={item.paymentDate}
          onChange={handleChange}
          placeholder="Payment Date (YYYY-MM-DD)"
          required
        />
      ),
    },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:border-blue-200">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid w-full gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-[170px_minmax(0,1fr)_140px_160px]">
          {summaryFields.map(({ label, value, editor }) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap">{label}</span>
              {expanded ? (
                editor
              ) : (
                <span className={`truncate font-semibold ${value === 'Pending' ? 'text-gray-400' : 'text-gray-900'}`}>{value}</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-10 w-32 items-center justify-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {expanded ? 'Done' : 'Edit details'}
          </button>
          <Button onClick={() => onRemove(index)} variant="danger" className="h-10 w-12 justify-center">
            <Trash2 size={16} />
            <span className="sr-only">Remove disbursement</span>
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-blue-800">Supporting Documents</h4>
                <p className="text-xs text-blue-700">
                  {mappings.length > 0 ? `${mappings.length} document${mappings.length === 1 ? '' : 's'} linked` : 'No documents yet'}
                </p>
              </div>
              <Button
                onClick={() => onAddMapping(item._tempId)}
                variant="secondary"
                type="button"
                className="text-sm"
              >
                <PlusCircle size={16} className="mr-1" />
                Add document
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              {mappings.length === 0 ? (
                <p className="rounded-md border border-dashed border-blue-200 bg-white/80 p-3 text-xs text-blue-700">
                  Attach the supporting invoice trainees will review. Allowed formats: {prettySupportedLabels}. Maximum size{' '}
                  {Math.round(maxUploadBytes / (1024 * 1024))} MB.
                </p>
              ) : (
                mappings.map((mapping) => (
                  <InvoiceMappingInline
                    key={mapping._tempId}
                    mapping={mapping}
                    disbursementTempId={item._tempId}
                    onRemove={onRemoveMapping}
                    onFileSelect={onSelectMappingFile}
                    acceptValue={fileAcceptValue}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const InvoiceMappingInline = ({ mapping, disbursementTempId, onRemove, onFileSelect, acceptValue }) => {
  const fileInputId = `mapping-file-${mapping._tempId}`;
  const fileLabel =
    mapping.clientSideFile?.name || mapping.fileName || mapping.storagePath || mapping.downloadURL || 'No file selected';

  const status = (() => {
    if (mapping.uploadError) return { text: mapping.uploadError, className: 'text-red-600' };
    if (typeof mapping.uploadProgress === 'number' && mapping.uploadProgress < 100) {
      return { text: `Uploading (${Math.round(mapping.uploadProgress)}%)`, className: 'text-blue-600' };
    }
    if (mapping.uploadProgress === 100 || mapping.storagePath || mapping.downloadURL || mapping.fileName) {
      return { text: 'Ready', className: 'text-emerald-600' };
    }
    return { text: 'Pending upload', className: 'text-gray-500' };
  })();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap">Attachment</p>
          <p className="truncate text-sm font-medium text-gray-900" title={fileLabel}>
            {fileLabel}
          </p>
          {mapping.storagePath ? (
            <p className="mt-1 truncate text-xs text-gray-500" title={mapping.storagePath}>
              {mapping.storagePath}
            </p>
          ) : null}
          {mapping.downloadURL ? (
            <a
              href={mapping.downloadURL}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center text-xs text-blue-600 underline"
            >
              View stored file
            </a>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${status.className}`}>{status.text}</span>
          <Button
            onClick={() => onRemove(disbursementTempId, mapping._tempId)}
            variant="danger"
            type="button"
            className="h-8 px-2"
          >
            <Trash2 size={14} />
            <span className="sr-only">Remove document</span>
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          id={fileInputId}
          type="file"
          accept={acceptValue}
          onChange={(event) => onFileSelect(disbursementTempId, mapping._tempId, event.target.files?.[0] || null)}
          className="sm:max-w-xs"
        />
        {typeof mapping.uploadProgress === 'number' && mapping.uploadProgress >= 0 && mapping.uploadProgress < 100 ? (
          <div className="w-full sm:w-48">
            <div className="h-1.5 rounded-full bg-gray-200">
              <div
                className="h-1.5 rounded-full bg-blue-500 transition-all"
                style={{ width: `${mapping.uploadProgress}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const InvoiceMappingSummaryRow = ({ mapping }) => {
  const summary = (() => {
    if (mapping.uploadError) return { text: mapping.uploadError, tone: 'text-red-600' };
    if (typeof mapping.uploadProgress === 'number' && mapping.uploadProgress < 100) {
      return { text: `Uploading (${Math.round(mapping.uploadProgress)}%)`, tone: 'text-blue-600' };
    }
    if (mapping.uploadProgress === 100 || mapping.storagePath || mapping.downloadURL || mapping.fileName) {
      return { text: 'Ready', tone: 'text-emerald-600' };
    }
    return { text: 'Pending upload', tone: 'text-gray-500' };
  })();

  const label = mapping.fileName || mapping.clientSideFile?.name || mapping.storagePath || mapping.downloadURL || 'Unnamed file';

  return (
    <div className="flex flex-col rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-gray-800" title={label}>
          {label}
        </span>
        <span className={`font-semibold ${summary.tone}`}>{summary.text}</span>
      </div>
      {mapping.storagePath ? (
        <span className="mt-1 truncate text-[11px] text-gray-500" title={mapping.storagePath}>
          {mapping.storagePath}
        </span>
      ) : null}
      {mapping.downloadURL ? (
        <a
          href={mapping.downloadURL}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center text-[11px] text-blue-600 underline"
        >
          View file
        </a>
      ) : null}
    </div>
  );
};

const ReferenceDocumentItem = ({ item, index, onChange, onRemove, onFileSelect, acceptValue }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isNewDoc =
    !item.fileName && !item.clientSideFile && !item.storagePath && !item.downloadURL;
  const [expanded, setExpanded] = useState(isNewDoc || index === 0);
  const fileInputId = `referenceFile-${item._tempId}`;

  useEffect(() => {
    if (isNewDoc) {
      setExpanded(true);
    }
  }, [isNewDoc]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    onChange(index, { ...item, [name]: value });
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      onFileSelect(index, file);
    }
  };

  const storagePathLabel = (item.storagePath || '').trim();
  const downloadUrlLabel = (item.downloadURL || '').trim();

  const summarySource = (() => {
    if (item.clientSideFile) return item.clientSideFile.name;
    if (item.fileName) return item.fileName;
    if (storagePathLabel) return storagePathLabel;
    if (downloadUrlLabel) return downloadUrlLabel;
    return 'No attachment yet';
  })();

  const statusLabel = (() => {
    if (item.uploadError) return 'Upload error';
    if (typeof item.uploadProgress === 'number' && item.uploadProgress < 100) {
      return `Uploading (${Math.round(item.uploadProgress)}%)`;
    }
    if (item.uploadProgress === 100) return 'Ready';
    if (summarySource !== 'No attachment yet') return 'Ready';
    return 'Pending';
  })();

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:border-blue-200">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid w-full gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-[220px_minmax(0,1fr)_140px]">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-gray-500">Display name</span>
            {expanded ? (
              <Input
                id={`referenceName-${item._tempId}`}
                name="fileName"
                value={item.fileName}
                onChange={handleChange}
                placeholder="e.g., AP Aging Summary"
                className="mt-1"
              />
            ) : (
              <span className={`truncate font-semibold ${item.fileName ? 'text-gray-900' : 'text-gray-400'}`}>
                {item.fileName || 'Untitled reference'}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-gray-500">Attachment</span>
            {expanded ? (
              <>
                <Input id={fileInputId} type="file" accept={acceptValue} onChange={handleFileChange} className="mt-1" />
                <p className="mt-1 text-xs text-gray-500">{summarySource}</p>
              </>
            ) : (
              <span className={`truncate font-semibold ${summarySource === 'No attachment yet' ? 'text-gray-400' : 'text-gray-900'}`}>
                {summarySource}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-gray-500">Status</span>
            <span
              className={`font-semibold ${
                item.uploadError
                  ? 'text-red-600'
                  : statusLabel === 'Ready'
                  ? 'text-emerald-600'
                  : 'text-gray-900'
              }`}
            >
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-10 w-32 items-center justify-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {expanded ? 'Done' : 'Edit details'}
          </button>
          <Button onClick={() => onRemove(index)} variant="danger" className="h-10 w-12 justify-center">
            <Trash2 size={16} />
            <span className="sr-only">Remove reference document</span>
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-xs text-gray-600">
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900"
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Advanced options
            </button>

            {showAdvanced ? (
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700" htmlFor={`referenceUrl-${item._tempId}`}>
                    Download URL (optional)
                  </label>
                  <Input
                    id={`referenceUrl-${item._tempId}`}
                    name="downloadURL"
                    value={item.downloadURL}
                    onChange={handleChange}
                    placeholder="https://storage.googleapis.com/..."
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700" htmlFor={`referencePath-${item._tempId}`}>
                    Storage Path (optional)
                  </label>
                  <Input
                    id={`referencePath-${item._tempId}`}
                    name="storagePath"
                    value={item.storagePath}
                    onChange={handleChange}
                    placeholder="Set automatically when uploading"
                    className="mt-1"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">Provide only if referencing an existing Firebase Storage file.</p>
                </div>
              </div>
            ) : null}
          </div>

          {typeof item.uploadProgress === 'number' && item.uploadProgress < 100 ? (
            <p className="text-xs text-blue-600">Upload in progress: {item.uploadProgress}%</p>
          ) : null}
          {item.uploadProgress === 100 && !item.uploadError ? (
            <p className="flex items-center text-xs text-emerald-600">
              <CheckCircle2 size={14} className="mr-1" /> Uploaded successfully
            </p>
          ) : null}
          {item.uploadError ? (
            <p className="flex items-center text-xs text-red-500">
              <AlertTriangle size={14} className="mr-1" /> {item.uploadError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
