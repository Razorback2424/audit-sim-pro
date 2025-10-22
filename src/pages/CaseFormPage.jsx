import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { storage, appId } from '../AppCore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { useAuth, Input, Button, Select, useRoute, useModal, Textarea } from '../AppCore';
import { fetchCase, createCase, updateCase } from '../services/caseService';
import { fetchUserRosterOptions } from '../services/userService';
import getUUID from '../utils/getUUID';
import { PlusCircle, Trash2, Paperclip, CheckCircle2, AlertTriangle, UploadCloud } from 'lucide-react';
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

export default function CaseFormPage({ params }) {
  const { caseId: editingCaseId } = params || {};
  const isEditing = !!editingCaseId;
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { showModal } = useModal();

  const initialDisbursement = () => ({ _tempId: getUUID(), paymentId: '', payee: '', amount: '', paymentDate: '' });
  const initialMapping = () => ({
    _tempId: getUUID(),
    paymentId: '',
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
  const [invoiceMappings, setInvoiceMappings] = useState([initialMapping()]);
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

  // ---- upload helpers (no console or flags needed)
  const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024; // 5 MB (keep in sync with storage.rules soft limit)
  const UPLOAD_TIMEOUT_MS = 120000; // 2 minutes
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
  }; // surface errors during investigation

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
            setDisbursements(data.disbursements?.map((d) => ({ ...d, _tempId: d._tempId || getUUID() })) || [initialDisbursement()]);
            setInvoiceMappings(
              data.invoiceMappings?.map((m) => ({
                ...m,
                _tempId: m._tempId || getUUID(),
                clientSideFile: null,
                uploadProgress: m.storagePath ? 100 : undefined,
                uploadError: null,
                contentType: m.contentType || '',
              })) || [initialMapping()]
            );
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
            const existingGroupId =
              typeof data.caseGroupId === 'string' ? data.caseGroupId.trim() : '';
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
      setInvoiceMappings([initialMapping()]);
      setReferenceDocuments([initialReferenceDocument()]);
      setOriginalCaseData(null);
      setAuditArea(DEFAULT_AUDIT_AREA);
      setCaseGroupSelection('__none');
      setCustomCaseGroupId('');
    }
  }, [isEditing, editingCaseId, navigate, showModal]);

  const handleDisbursementChange = (index, updatedItem) => {
    const newDisbursements = [...disbursements];
    newDisbursements[index] = updatedItem;
    setDisbursements(newDisbursements);
  };
  const addDisbursement = () => setDisbursements([...disbursements, initialDisbursement()]);
  const removeDisbursement = (index) => setDisbursements(disbursements.filter((_, i) => i !== index));

  const handleMappingChange = (index, updatedItem) => {
    const newMappings = [...invoiceMappings];
    newMappings[index] = updatedItem;
    setInvoiceMappings(newMappings);
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

  const prettySupportedLabels = Array.from(
    new Set(SUPPORTED_FILE_TYPES.map((entry) => entry.label))
  ).join(', ');

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
      .replace(/[/\\#?[\]*<>:"|]+/g, '_')
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

  const handleMappingFileSelect = (index, file) => {
    if (!file) return;
    if (!isSupportedFile(file)) {
      ulog('reject:unsupported-file', { index, name: file.name, type: file.type });
      showModal(`Unsupported file type. Allowed formats: ${prettySupportedLabels}.`, 'Invalid File Type');
      return;
    }
    if (file.size > MAX_ARTIFACT_BYTES) {
      ulog('reject:too-large', { index, name: file.name, size: file.size });
      showModal(`File must be under ${Math.round(MAX_ARTIFACT_BYTES / (1024 * 1024))} MB.`, 'File Too Large');
      return;
    }
    ulog('select', { index, name: file.name, type: file.type, size: file.size });
    const contentType = pickContentType(file);
    setInvoiceMappings((prevMappings) =>
      prevMappings.map((m, i) =>
        i === index
          ? {
              ...m,
              clientSideFile: file,
              fileName: file.name,
              storagePath: '',
              uploadProgress: 0,
              uploadError: null,
              downloadURL: '',
              contentType,
            }
          : m
      )
    );
  };

  const addMapping = () => {
    setInvoiceMappings([...invoiceMappings, initialMapping()]);
  };
  const removeMapping = (index) => setInvoiceMappings(invoiceMappings.filter((_, i) => i !== index));

  const handleReferenceDocChange = (index, updatedItem) => {
    const next = [...referenceDocuments];
    next[index] = updatedItem;
    setReferenceDocuments(next);
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

  const availablePaymentIdsForMapping = disbursements.map((d) => d.paymentId).filter((id) => id);

  const handleCsvImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (!text || text.trim() === '') {
        showModal('CSV file is empty or contains no processable content.', 'CSV Import Error');
        return;
      }
      try {
        const lines = text.split(/\r\n|\n/);
        if (lines.length <= 1 && !(lines.length === 1 && lines[0].trim() !== '')) {
          showModal('CSV file is empty or contains only a header row.', 'CSV Import Error');
          if (disbursementCsvInputRef.current) disbursementCsvInputRef.current.value = '';
          return;
        }
        const importedDisbursements = lines
          .slice(1)
          .map((line) => {
            const parts = line.split(',');
            if (parts.length >= 4) {
              const [paymentId, payee, amount, paymentDate] = parts;
              if (paymentId && payee && amount && paymentDate) {
                return {
                  _tempId: getUUID(),
                  paymentId: paymentId.trim(),
                  payee: payee.trim(),
                  amount: amount.trim(),
                  paymentDate: paymentDate.trim(),
                };
              }
            }
            return null;
          })
          .filter((d) => d !== null);

        if (importedDisbursements.length > 0) {
          setDisbursements(importedDisbursements);
          showModal(`${importedDisbursements.length} disbursements imported successfully. Please review. Existing manual entries were replaced.`, 'CSV Import');
        } else {
          showModal('No valid disbursements found in CSV or CSV format is incorrect. Expected columns: PaymentID,Payee,Amount,PaymentDate', 'CSV Import Error');
        }
      } catch (error) {
        console.error('Error parsing CSV:', error);
        showModal('Error parsing CSV file: ' + error.message, 'CSV Import Error');
      }
      if (disbursementCsvInputRef.current) {
        disbursementCsvInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const uploadFileAndGetMetadata = async (mappingItem, caseIdForUpload) => {
    if (!mappingItem.clientSideFile) {
      return mappingItem.fileName
        ? {
            paymentId: mappingItem.paymentId,
            fileName: mappingItem.fileName,
            storagePath: mappingItem.storagePath,
            downloadURL: mappingItem.downloadURL || '',
            contentType: mappingItem.contentType || null,
          }
        : null;
    }

    const file = mappingItem.clientSideFile;
    const uploadId = `u_${Math.random().toString(36).slice(2, 8)}`;
    ulog(uploadId, 'start', { paymentId: mappingItem.paymentId, caseIdForUpload, name: file?.name, type: file?.type, size: file?.size, online: navigator.onLine });

    if (!navigator.onLine) {
      ulog(uploadId, 'offline-abort');
      return {
        paymentId: mappingItem.paymentId,
        fileName: file?.name || 'invoice.pdf',
        uploadError: 'Browser is offline',
        storagePath: '',
        downloadURL: '',
        contentType: mappingItem.contentType || pickContentType(file),
      };
    }
    if (!caseIdForUpload) {
      const errorMsg = 'Cannot upload file: Case ID is not yet finalized for new case.';
      console.error(errorMsg, mappingItem);
      ulog(uploadId, 'abort:no-case-id');
      setInvoiceMappings((prev) => prev.map((m) => (m._tempId === mappingItem._tempId ? { ...m, uploadError: errorMsg, uploadProgress: undefined } : m)));
      throw new Error(errorMsg);
    }

    const desiredContentType = mappingItem.contentType || pickContentType(file);
    const rawName = file?.name || 'invoice.pdf';
    const safeName = ensureSafeStorageName(rawName, desiredContentType);
    const finalStoragePath = `artifacts/${appId}/case_documents/${caseIdForUpload}/${safeName}`;
    ulog(uploadId, 'path', { rawName, safeName, finalStoragePath });

    setInvoiceMappings((prev) =>
      prev.map((m) =>
        m._tempId === mappingItem._tempId
          ? {
              ...m,
              storagePath: finalStoragePath,
              uploadProgress: 0,
              uploadError: null,
              fileName: safeName,
              contentType: desiredContentType,
            }
          : m
      )
    );

    const timeoutMs = UPLOAD_TIMEOUT_MS;


    const fileRef = storageRef(storage, finalStoragePath);

    const awaitResumable = (task) => {
      return new Promise((resolve, reject) => {
        let lastLogged = -10;
        const timer = setTimeout(() => {
          try { task.cancel(); } catch {}
          ulog(uploadId, 'timeout', `${timeoutMs}ms`);
          unsubscribe();
          reject(new Error(`Upload timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const unsubscribe = task.on('state_changed',
          (snapshot) => {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            if (pct - lastLogged >= 10) {
              ulog(uploadId, 'progress', { pct, state: snapshot.state, bytesTransferred: snapshot.bytesTransferred, totalBytes: snapshot.totalBytes });
              lastLogged = pct;
            }
            setInvoiceMappings((prev) =>
              prev.map((m) => (m._tempId === mappingItem._tempId ? { ...m, uploadProgress: pct } : m))
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
        const response = error?.serverResponse ??
          error?.customData?.serverResponse ??
          error?.customData?._rawError ??
          error?.message ??
          '';
        try {
          console.error('[case-upload] raw error', error);
        } catch {}
        let parsedResponse = null;
        if (typeof response === 'string') {
          try { parsedResponse = JSON.parse(response); } catch {}
        }
        ulog(uploadId, 'error:resumable', {
          code,
          msg,
          error: error ? {
            message: error.message,
            code: error.code,
            name: error.name,
            customData: error.customData,
            serverResponse: response,
            parsedResponse,
          } : null,
        });
        setInvoiceMappings((prev) =>
          prev.map((m) => (m._tempId === mappingItem._tempId ? { ...m, uploadError: msg, uploadProgress: undefined } : m))
        );
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

    // Always use resumable upload
    const first = await runResumable();

    // Optional single retry on transient failures
    const msgLower = String(first?.uploadError || '').toLowerCase();
    const transient = msgLower.includes('retry-limit-exceeded') || msgLower.includes('network') || msgLower.includes('500') || msgLower.includes('503') || msgLower.includes('quota') || msgLower.includes('timeout');

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
            doc._tempId === docItem._tempId ? { ...doc, uploadError: msg, uploadProgress: undefined } : doc
          )
        );
        return {
          _tempId: docItem._tempId,
          fileName: displayName || file?.name || 'reference.pdf',
          uploadError: msg,
          storagePath: finalStoragePath,
          downloadURL: '',
          contentType: desiredContentType || 'application/octet-stream',
        };
      }
    };

    const firstAttempt = await runResumable();
    const lowerMessage = String(firstAttempt?.uploadError || '').toLowerCase();
    const shouldRetry =
      firstAttempt && firstAttempt.uploadError && (lowerMessage.includes('network') || lowerMessage.includes('timeout') || lowerMessage.includes('retry-limit-exceeded') || lowerMessage.includes('500') || lowerMessage.includes('503') || lowerMessage.includes('quota'));

    if (shouldRetry) {
      ulog(uploadId, 'reference:retry', firstAttempt.uploadError);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return await runResumable();
    }

    return firstAttempt;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!userId) {
      showModal('You must be logged in to create/edit a case.', 'Authentication Error');
      return;
    }

    if (!caseName.trim()) {
      showModal('Case name is required.', 'Validation Error');
      return;
    }
    if (disbursements.some((d) => !d.paymentId || !d.payee || !d.amount || !d.paymentDate)) {
      showModal('All disbursement fields (Payment ID, Payee, Amount, Payment Date) are required.', 'Validation Error');
      return;
    }
    const currentDisbursementIds = new Set(disbursements.map((d) => d.paymentId).filter(Boolean));
    if (currentDisbursementIds.size !== disbursements.filter((d) => d.paymentId).length) {
      showModal('Disbursement Payment IDs must be unique within this case.', 'Validation Error');
      return;
    }

    const activeMappings = invoiceMappings.filter((m) => m.paymentId || m.clientSideFile || m.fileName);
    if (activeMappings.some((m) => !m.paymentId || (!m.fileName && !m.clientSideFile))) {
      showModal('Each active invoice mapping must have both a Payment ID selected and an uploaded artifact.', 'Validation Error');
      return;
    }
    if (activeMappings.some((m) => m.paymentId && !currentDisbursementIds.has(m.paymentId))) {
      showModal('One or more invoice mappings reference a Payment ID that no longer exists in the disbursements list. Please correct the mappings or remove them.', 'Invalid Payment ID in Mapping');
      return;
    }

    const activeReferenceDocs = referenceDocuments.filter((doc) => {
      const name = (doc.fileName || '').trim() || (doc.clientSideFile?.name || '').trim();
      const storagePath = (doc.storagePath || '').trim();
      const downloadURL = (doc.downloadURL || '').trim();
      return Boolean(name || storagePath || downloadURL || doc.clientSideFile);
    });

    const referenceValidationFailed = activeReferenceDocs.some((doc) => {
      const name = (doc.fileName || '').trim() || (doc.clientSideFile?.name || '').trim();
      if (!name) return true;
      const hasLink =
        (doc.storagePath && doc.storagePath.trim()) ||
        (doc.downloadURL && doc.downloadURL.trim()) ||
        doc.clientSideFile;
      return !hasLink;
    });

    if (referenceValidationFailed) {
      showModal(
        'Each reference document must include a display name and either an uploaded file, a storage path, or a download URL.',
        'Validation Error'
      );
      return;
    }

    const parseAnswerValue = (value) => {
      if (value === '' || value === null || value === undefined) return null;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : NaN;
    };

    const answerKeyIssues = [];
    const isDevMode = process.env.NODE_ENV !== 'production';

    disbursements.forEach((disbursement) => {
      const answerKey = disbursement.answerKey || {};
      const parsedValues = ANSWER_KEY_FIELDS.map((field) => parseAnswerValue(answerKey[field]));
      const hasAnyEntry = parsedValues.some((value) => value !== null);

      if (!hasAnyEntry) return;

      const invalidIndex = parsedValues.findIndex((value) => value !== null && Number.isNaN(value));
      if (invalidIndex >= 0) {
        answerKeyIssues.push(
          `Answer key for Payment ID ${disbursement.paymentId || 'unknown'} has a non-numeric value in the ${ANSWER_KEY_FIELDS[invalidIndex]} field.`
        );
        return;
      }

      const amountNumber = Number(disbursement.amount);
      if (!Number.isFinite(amountNumber)) {
        answerKeyIssues.push(
          `Answer key for Payment ID ${disbursement.paymentId || 'unknown'} could not validate because the disbursement amount is not numeric.`
        );
        return;
      }

      const total = parsedValues.reduce((sum, value) => sum + (value ?? 0), 0);
      if (Math.abs(total - amountNumber) > ANSWER_KEY_TOLERANCE) {
        answerKeyIssues.push(
          `Answer key totals (${total.toFixed(2)}) must equal the disbursement amount (${amountNumber.toFixed(2)}) for Payment ID ${
            disbursement.paymentId || 'unknown'
          }.`
        );
      } else if (isDevMode) {
        console.debug('[case-form] answerKey validated', {
          paymentId: disbursement.paymentId,
          total,
          amount: amountNumber,
        });
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

    try {
      if (isNewCaseCreation) {
        const tempCaseData = {
          caseName,
          title: caseName,
          disbursements: disbursements.map(({ _tempId, ...rest }) => rest),
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
        showModal(`Case structure created (ID: ${currentCaseId}). Uploading files... This may take a moment. Please do not navigate away.`, 'Processing', null);
      } else if (editingCaseId) {
        currentCaseId = editingCaseId;
        showModal(`Updating case (ID: ${currentCaseId}). Uploading any new/changed files... Please do not navigate away.`, 'Processing', null);
      }

      if (!currentCaseId) throw new Error('Case ID is missing. Cannot proceed with file uploads.');

      const candidates = invoiceMappings.filter((m) => m.paymentId && (m.clientSideFile || m.fileName));

      const settled = await Promise.allSettled(
        candidates.map((mapping) => uploadFileAndGetMetadata(mapping, currentCaseId))
      );

      const uploadResults = settled.map((r, idx) =>
        r.status === 'fulfilled'
          ? r.value
          : { uploadError: r.reason?.message || 'Upload failed', fileName: candidates[idx]?.fileName, paymentId: candidates[idx]?.paymentId }
      );

      const failedUploads = uploadResults.filter((result) => result && result.uploadError);
      if (failedUploads.length > 0) {
        const errorMessages = failedUploads.map((f) => `- ${f.fileName || 'A file'} for Payment ID ${f.paymentId}: ${f.uploadError}`).join('\n');
        showModal(`Some file uploads failed:\n${errorMessages}\n\nPlease correct the issues by re-selecting files or removing problematic mappings, then try saving again. Case data has not been fully saved.`, 'Upload Errors');
        setLoading(false);
        return;
      }

      const finalInvoiceMappings = uploadResults
        .filter((r) => r && !r.uploadError)
        .map(({ clientSideFile, uploadProgress, _tempId, ...rest }) => rest);

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

      const disbursementPayload = mergeDisbursementDocuments(disbursements, finalInvoiceMappings);

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

  if (loading && isEditing) return <div className="p-4 text-center">Loading case details...</div>;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow-xl">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">{isEditing ? 'Edit Audit Case' : 'Create New Audit Case'}</h1>
        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <label htmlFor="caseName" className="block text-sm font-medium text-gray-700 mb-1">
              Case Name
            </label>
            <Input id="caseName" value={caseName} onChange={(e) => setCaseName(e.target.value)} placeholder="e.g., Q1 Unrecorded Liabilities Review" required />
          </div>
          <section className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="auditArea" className="block text-sm font-medium text-gray-700 mb-1">
                  Audit Area
                </label>
                <Select
                  id="auditArea"
                  value={auditArea}
                  onChange={(e) => setAuditArea(e.target.value)}
                  options={auditAreaSelectOptions}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Choose the focus area used when trainees filter or analyze cases.
                </p>
              </div>
              <div>
                <label htmlFor="caseGroupSelection" className="block text-sm font-medium text-gray-700 mb-1">
                  Case Group (optional)
                </label>
                <Select
                  id="caseGroupSelection"
                  value={caseGroupSelection}
                  onChange={(e) => setCaseGroupSelection(e.target.value)}
                  options={caseGroupSelectOptions}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Organize scenarios by cohort or curriculum. Leave as &ldquo;No group&rdquo; if not needed.
                </p>
              </div>
            </div>
            {caseGroupSelection === '__custom' ? (
              <div>
                <label htmlFor="customCaseGroupId" className="block text-sm font-medium text-gray-700 mb-1">
                  Custom Group Identifier
                </label>
                <Input
                  id="customCaseGroupId"
                  value={customCaseGroupId}
                  onChange={(e) => setCustomCaseGroupId(e.target.value)}
                  placeholder="e.g., ap-advanced-spring"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use a lowercase slug that matches your reporting conventions.
                </p>
              </div>
            ) : null}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Audience</label>
              <div className="flex items-center space-x-3">
                <input
                  id="publicVisible"
                  type="checkbox"
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  checked={publicVisible}
                  onChange={(e) => setPublicVisible(e.target.checked)}
                />
                <label htmlFor="publicVisible" className="text-sm text-gray-700">
                  Visible to all signed-in trainees
                </label>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Disable this to restrict the case to specific user IDs.
              </p>
            </div>

            <div>
              <label htmlFor="visibleToUserIds" className="block text-sm font-medium text-gray-700 mb-1">
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
              {publicVisible ? (
                <p className="text-xs text-gray-500 mt-1">
                  This case is visible to all trainees. Disable the toggle above to limit access.
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">
                  Select one or more users who should see this case.
                </p>
              )}
              {rosterError ? (
                <p className="text-xs text-red-600 mt-1">
                  {rosterError} You can still type a user ID and press Enter to add it manually.
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="caseStatus" className="block text-sm font-medium text-gray-700 mb-1">
                Case Status
              </label>
              <Select
                id="caseStatus"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={STATUS_OPTIONS}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="opensAt" className="block text-sm font-medium text-gray-700 mb-1">
                  Opens At (UTC)
                </label>
                <Input
                  id="opensAt"
                  type="datetime-local"
                  value={opensAtStr}
                  onChange={(e) => setOpensAtStr(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">Optional. Trainees will see the case after this time.</p>
              </div>
              <div>
                <label htmlFor="dueAt" className="block text-sm font-medium text-gray-700 mb-1">
                  Due At (UTC)
                </label>
                <Input
                  id="dueAt"
                  type="datetime-local"
                  value={dueAtStr}
                  onChange={(e) => setDueAtStr(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">Optional deadline for trainees.</p>
              </div>
            </div>
          </section>

          <section>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-700">Disbursements</h2>
              <div>
                <label htmlFor="csvImportDisbursements" className="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-md text-sm font-semibold cursor-pointer inline-flex items-center">
                  <UploadCloud size={16} className="inline mr-2" /> Import CSV
                </label>
                <Input id="csvImportDisbursements" type="file" accept=".csv" onChange={handleCsvImport} className="hidden" ref={disbursementCsvInputRef} />
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-2">CSV format: PaymentID,Payee,Amount,PaymentDate (with header row). Dates should be YYYY-MM-DD.</p>
            <div className="space-y-4">
              {disbursements.map((item, index) => (
                <DisbursementItem key={item._tempId} item={item} index={index} onChange={handleDisbursementChange} onRemove={removeDisbursement} />
              ))}
            </div>
            <Button onClick={addDisbursement} variant="secondary" className="mt-4 text-sm" type="button">
              <PlusCircle size={16} className="inline mr-1" /> Add Disbursement Manually
            </Button>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Invoice Document Mappings</h2>
            <p className="text-sm text-gray-500 mb-3">
              Map Payment IDs to their supporting documents (allowed: {prettySupportedLabels}; max {Math.round(
                MAX_ARTIFACT_BYTES / (1024 * 1024)
              )}{' '}
              MB per file). Files upload to Firebase Storage when you save.
            </p>
            <div className="space-y-4">
              {invoiceMappings.map((item, index) => (
                <InvoiceMappingItem
                  key={item._tempId}
                  item={item}
                  index={index}
                  onChange={handleMappingChange}
                  onRemove={removeMapping}
                  availablePaymentIds={availablePaymentIdsForMapping}
                  onFileSelect={handleMappingFileSelect}
                  caseIdForPath={editingCaseId}
                  acceptValue={FILE_INPUT_ACCEPT}
                />
              ))}
            </div>
            <Button onClick={addMapping} variant="secondary" className="mt-4 text-sm" type="button">
              <PlusCircle size={16} className="inline mr-1" /> Add Mapping
            </Button>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Reference Documents</h2>
            <p className="text-sm text-gray-500 mb-3">
              Upload or link supplemental files (e.g., AP aging, accrual schedules) for trainees to reference while working the case.
            </p>
            <div className="space-y-4">
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
            <Button onClick={addReferenceDocument} variant="secondary" className="mt-4 text-sm" type="button">
              <PlusCircle size={16} className="inline mr-1" /> Add Reference Document
            </Button>
          </section>

          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
            <Button onClick={() => navigate('/admin')} variant="secondary" type="button" disabled={loading} isLoading={loading && !isEditing}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={loading} isLoading={loading}>
              {isEditing ? 'Save Changes' : 'Create Case'}
            </Button>
          </div>
        </form>
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
  const showDropdown = open && !disabled;

  return (
    <div className="relative" data-testid="roster-multi-select">
      <div
        ref={containerRef}
        className={`flex flex-wrap items-center gap-2 border rounded-md px-2 py-2 bg-white text-sm ${
          disabled ? 'bg-gray-100 cursor-not-allowed border-gray-200' : 'border-gray-300 focus-within:ring-2 focus-within:ring-blue-500'
        }`}
      >
        {normalizedSelected.map((selected) => (
          <span
            key={selected.id}
            className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${
              disabled ? 'bg-gray-200 text-gray-600' : 'bg-blue-100 text-blue-700'
            }`}
          >
            {selected.label}
            {!disabled && (
              <button
                type="button"
                className="ml-1 text-blue-600 hover:text-blue-800 focus:outline-none"
                onClick={() => removeSelected(selected.id)}
                aria-label={`Remove ${selected.label}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          id={id}
          type="text"
          className={`flex-1 min-w-[140px] border-none focus:outline-none bg-transparent text-sm ${
            disabled ? 'text-gray-500' : 'text-gray-700'
          }`}
          value={disabled ? '' : query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={normalizedSelected.length === 0 ? placeholder : ''}
          disabled={disabled}
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
          className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-auto"
        >
          {filteredOptions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">No matches found.</li>
          ) : (
            filteredOptions.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <span className="block text-gray-700">{option.label}</span>
                  {option.email ? <span className="block text-xs text-gray-500">{option.email}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {loading ? <p className="text-xs text-gray-500 mt-1">Loading roster…</p> : null}
    </div>
  );
};

const DisbursementItem = ({ item, index, onChange, onRemove }) => {
  const handleChange = (e) => {
    onChange(index, { ...item, [e.target.name]: e.target.value });
  };

  const handleAnswerKeyChange = (field, rawValue) => {
    const normalized = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    const current = { ...(item.answerKey || {}) };

    if (normalized === '' || normalized === null || normalized === undefined) {
      delete current[field];
    } else {
      current[field] = normalized;
    }

    const updated = { ...item };
    if (Object.keys(current).length > 0) {
      updated.answerKey = current;
    } else {
      delete updated.answerKey;
    }

    onChange(index, updated);
  };

  const baseId = item._tempId || item.paymentId || `disbursement-${index}`;
  const answerKeyFieldConfigs = [
    { key: 'properlyIncluded', label: 'Properly Included' },
    { key: 'properlyExcluded', label: 'Properly Excluded' },
    { key: 'improperlyIncluded', label: 'Improperly Included' },
    { key: 'improperlyExcluded', label: 'Improperly Excluded' },
  ];

  return (
    <div className="p-3 border border-gray-200 rounded-md space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
        <Input name="paymentId" value={item.paymentId} onChange={handleChange} placeholder="Payment ID" required />
        <Input name="payee" value={item.payee} onChange={handleChange} placeholder="Payee" required />
        <Input name="amount" type="number" value={item.amount} onChange={handleChange} placeholder="Amount (e.g., 123.45)" required />
        <Input name="paymentDate" type="date" value={item.paymentDate} onChange={handleChange} placeholder="Payment Date" required />
        <Button onClick={() => onRemove(index)} variant="danger" className="h-10">
          <Trash2 size={18} />
        </Button>
      </div>

      <div className="pt-2 border-t border-gray-100">
        <p className="text-sm font-medium text-gray-700 mb-2">Answer Key (Correct Allocation) — optional</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {answerKeyFieldConfigs.map(({ key, label }) => (
            <div key={key} className="flex flex-col text-sm">
              <label className="mb-1 text-gray-700" htmlFor={`${baseId}-${key}`}>
                {label}
              </label>
              <Input
                id={`${baseId}-${key}`}
                type="number"
                step="0.01"
                min="0"
                value={item.answerKey?.[key] ?? ''}
                onChange={(e) => handleAnswerKeyChange(key, e.target.value)}
                placeholder="0.00"
              />
            </div>
          ))}
        </div>
        <div className="mt-3">
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`${baseId}-explanation`}>
            Explanation (shown on results)
          </label>
          <Textarea
            id={`${baseId}-explanation`}
            rows={2}
            value={item.answerKey?.explanation ?? ''}
            onChange={(e) => handleAnswerKeyChange('explanation', e.target.value)}
            placeholder="Brief rationale for correct allocation and why alternatives are incorrect."
          />
        </div>
      </div>
    </div>
  );
};

const InvoiceMappingItem = ({ item, index, onChange, onRemove, availablePaymentIds, onFileSelect, caseIdForPath, acceptValue }) => {
  const fileInputId = `pdfFile-${item._tempId}`;

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      onFileSelect(index, file);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start p-3 border border-gray-200 rounded-md">
      <div>
        <label htmlFor={`paymentId-${item._tempId}`} className="block text-xs font-medium text-gray-700">
          Payment ID
        </label>
        <select
          id={`paymentId-${item._tempId}`}
          name="paymentId"
          value={item.paymentId}
          onChange={(e) => onChange(index, { ...item, paymentId: e.target.value })}
          required
          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        >
          <option value="">Select Payment ID</option>
          {availablePaymentIds.map((pid) => (
            <option key={pid} value={pid}>
              {pid}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label htmlFor={fileInputId} className="block text-xs font-medium text-gray-700">
          Invoice Document
        </label>
        <Input id={fileInputId} type="file" accept={acceptValue} onChange={handleFileChange} className="mt-1" />
        {item.fileName && (
          <div className="mt-1 text-xs text-gray-600 flex items-center">
            <Paperclip size={12} className="mr-1 flex-shrink-0" />
            <span className="truncate" title={item.fileName}>
              {item.fileName}
            </span>
          </div>
        )}
        {item.uploadProgress !== undefined && item.uploadProgress >= 0 && item.uploadProgress < 100 && !item.uploadError && (
          <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2 dark:bg-gray-700">
            <div className="bg-blue-600 h-2.5 rounded-full text-xs text-white text-center leading-none" style={{ width: `${item.uploadProgress}%` }}>
              {item.uploadProgress > 10 ? `${Math.round(item.uploadProgress)}%` : ''}
            </div>
          </div>
        )}
        {item.uploadProgress === 100 && !item.uploadError && (
          <p className="text-xs text-green-600 mt-1 flex items-center">
            <CheckCircle2 size={14} className="mr-1" />Uploaded
          </p>
        )}
        {item.uploadError && (
          <p className="text-xs text-red-500 mt-1 flex items-center">
            <AlertTriangle size={14} className="mr-1" />{item.uploadError}
          </p>
        )}
      </div>
      <Button onClick={() => onRemove(index)} variant="danger" className="h-10 self-end">
        <Trash2 size={18} />
      </Button>
    </div>
  );
};

const ReferenceDocumentItem = ({ item, index, onChange, onRemove, onFileSelect, acceptValue }) => {
  const fileInputId = `referenceFile-${item._tempId}`;

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

  return (
    <div className="p-3 border border-gray-200 rounded-md space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor={`referenceName-${item._tempId}`}>
            Display Name
          </label>
          <Input
            id={`referenceName-${item._tempId}`}
            name="fileName"
            value={item.fileName}
            onChange={handleChange}
            placeholder="e.g., AP Aging Summary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor={`referenceUrl-${item._tempId}`}>
            Download URL (optional)
          </label>
          <Input
            id={`referenceUrl-${item._tempId}`}
            name="downloadURL"
            value={item.downloadURL}
            onChange={handleChange}
            placeholder="https://storage.googleapis.com/..."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor={fileInputId}>
            Upload File (optional)
          </label>
          <Input id={fileInputId} type="file" accept={acceptValue} onChange={handleFileChange} className="mt-1" />
          {(item.clientSideFile || storagePathLabel) && (
            <div className="mt-1 text-xs text-gray-600 flex items-center">
              <Paperclip size={12} className="mr-1 flex-shrink-0" />
              <span className="truncate" title={item.clientSideFile?.name || storagePathLabel || item.fileName}>
                {item.clientSideFile?.name || storagePathLabel || item.fileName}
              </span>
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor={`referencePath-${item._tempId}`}>
            Storage Path (optional)
          </label>
          <Input
            id={`referencePath-${item._tempId}`}
            name="storagePath"
            value={item.storagePath}
            onChange={handleChange}
            placeholder="Set automatically when uploading"
          />
          <p className="text-[11px] text-gray-500 mt-1">Provide only if referencing an existing Firebase Storage file.</p>
        </div>
        <div className="flex justify-end md:justify-start">
          <Button onClick={() => onRemove(index)} variant="danger" className="md:self-end">
            <Trash2 size={18} />
          </Button>
        </div>
      </div>

      {typeof item.uploadProgress === 'number' && item.uploadProgress < 100 && (
        <p className="text-xs text-blue-600">Upload in progress: {item.uploadProgress}%</p>
      )}
      {item.uploadProgress === 100 && !item.uploadError && (
        <p className="text-xs text-green-600 flex items-center">
          <CheckCircle2 size={14} className="mr-1" /> Upload complete
        </p>
      )}
      {item.uploadError && (
        <p className="text-xs text-red-500 flex items-center">
          <AlertTriangle size={14} className="mr-1" />
          {item.uploadError}
        </p>
      )}

      {(storagePathLabel || downloadUrlLabel) && (
        <div className="text-[11px] text-gray-500 space-y-0.5">
          {storagePathLabel && <div>Storage path: {storagePathLabel}</div>}
          {downloadUrlLabel && <div>Download URL: {downloadUrlLabel}</div>}
        </div>
      )}
    </div>
  );
};
