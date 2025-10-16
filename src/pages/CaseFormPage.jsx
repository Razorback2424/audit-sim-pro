import React, { useEffect, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { storage, appId } from '../AppCore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { useAuth, Input, Textarea, Button, Select, useRoute, useModal } from '../AppCore';
import { fetchCase, createCase, updateCase } from '../services/caseService';
import getUUID from '../utils/getUUID';
import { PlusCircle, Trash2, Paperclip, CheckCircle2, AlertTriangle, UploadCloud } from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'archived', label: 'Archived' },
];

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
    }));

    const dedupedDocs = [];
    const seen = new Set();
    combinedDocs.forEach((doc) => {
      const key = `${doc.storagePath}|${doc.downloadURL}|${doc.fileName}`;
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

      next.supportingDocuments = [
        {
          storagePath: primaryDoc.storagePath || '',
          fileName: primaryDoc.fileName || '',
          downloadURL: primaryDoc.downloadURL || '',
        },
        ...additionalDocs.map((doc) => ({
          storagePath: doc.storagePath || '',
          fileName: doc.fileName || '',
          downloadURL: doc.downloadURL || '',
        })),
      ];
    } else {
      delete next.storagePath;
      delete next.fileName;
      delete next.downloadURL;
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
  const initialMapping = () => ({ _tempId: getUUID(), paymentId: '', fileName: '', storagePath: '', clientSideFile: null, uploadProgress: undefined, uploadError: null, downloadURL: '' });

  const [caseName, setCaseName] = useState('');
  const [visibleToUserIdsStr, setVisibleToUserIdsStr] = useState('');
  const [publicVisible, setPublicVisible] = useState(true);
  const [status, setStatus] = useState('assigned');
  const [opensAtStr, setOpensAtStr] = useState('');
  const [dueAtStr, setDueAtStr] = useState('');
  const [disbursements, setDisbursements] = useState([initialDisbursement()]);
  const [invoiceMappings, setInvoiceMappings] = useState([initialMapping()]);
  const [loading, setLoading] = useState(false);
  const [originalCaseData, setOriginalCaseData] = useState(null);
  const disbursementCsvInputRef = React.useRef(null);

  // ---- upload helpers (no console or flags needed)
  const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB (must align with storage.rules)
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
            setVisibleToUserIdsStr(inferredPublic ? '' : rosterList.join(', '));
            setStatus(data.status || 'assigned');
            setOpensAtStr(toDateTimeLocalInput(data.opensAt));
            setDueAtStr(toDateTimeLocalInput(data.dueAt));
            setDisbursements(data.disbursements?.map((d) => ({ ...d, _tempId: d._tempId || getUUID() })) || [initialDisbursement()]);
            setInvoiceMappings(
              data.invoiceMappings?.map((m) => ({ ...m, _tempId: m._tempId || getUUID(), clientSideFile: null, uploadProgress: m.storagePath ? 100 : undefined, uploadError: null })) || [initialMapping()]
            );
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
      setVisibleToUserIdsStr('');
      setPublicVisible(true);
      setStatus('assigned');
      setOpensAtStr('');
      setDueAtStr('');
      setDisbursements([initialDisbursement()]);
      setInvoiceMappings([initialMapping()]);
      setOriginalCaseData(null);
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

  const handleMappingFileSelect = (index, file) => {
    if (!file) return;
    const normalizedType = (file.type || '').toLowerCase();
    const isPdfMime =
      normalizedType === 'application/pdf' ||
      normalizedType === 'application/x-pdf' ||
      normalizedType.startsWith('application/pdf');
    const isPdfExt = /\.pdf$/i.test(file.name || '');

    if (!isPdfMime && !isPdfExt) {
      ulog('reject:not-pdf', { index, name: file.name, type: file.type });
      showModal('Please upload a PDF file.', 'Invalid File Type');
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      ulog('reject:too-large', { index, name: file.name, size: file.size });
      showModal(`PDF must be under ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB.`, 'File Too Large');
      return;
    }
    ulog('select', { index, name: file.name, type: file.type, size: file.size });
    setInvoiceMappings((prevMappings) =>
      prevMappings.map((m, i) =>
        i === index ? { ...m, clientSideFile: file, fileName: file.name, storagePath: '', uploadProgress: 0, uploadError: null, downloadURL: '' } : m
      )
    );
  };

  const addMapping = () => {
    setInvoiceMappings([...invoiceMappings, initialMapping()]);
  };
  const removeMapping = (index) => setInvoiceMappings(invoiceMappings.filter((_, i) => i !== index));

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
        ? { paymentId: mappingItem.paymentId, fileName: mappingItem.fileName, storagePath: mappingItem.storagePath, downloadURL: mappingItem.downloadURL || '' }
        : null;
    }

    const file = mappingItem.clientSideFile;
    const uploadId = `u_${Math.random().toString(36).slice(2, 8)}`;
    ulog(uploadId, 'start', { paymentId: mappingItem.paymentId, caseIdForUpload, name: file?.name, type: file?.type, size: file?.size, online: navigator.onLine });

    if (!navigator.onLine) {
      ulog(uploadId, 'offline-abort');
      return { paymentId: mappingItem.paymentId, fileName: file?.name || 'invoice.pdf', uploadError: 'Browser is offline', storagePath: '', downloadURL: '' };
    }
    if (!caseIdForUpload) {
      const errorMsg = 'Cannot upload file: Case ID is not yet finalized for new case.';
      console.error(errorMsg, mappingItem);
      ulog(uploadId, 'abort:no-case-id');
      setInvoiceMappings((prev) => prev.map((m) => (m._tempId === mappingItem._tempId ? { ...m, uploadError: errorMsg, uploadProgress: undefined } : m)));
      throw new Error(errorMsg);
    }

    const rawName = file?.name || 'invoice.pdf';
    let safeName = rawName.replace(/[/\\#?[\]*<>:"|]+/g, '_').replace(/\s+/g, ' ').trim();
    if (!/\.pdf$/i.test(safeName)) {
      safeName = `${safeName}.pdf`;
    }
    const finalStoragePath = `artifacts/${appId}/case_documents/${caseIdForUpload}/${safeName}`;
    ulog(uploadId, 'path', { rawName, safeName, finalStoragePath });

    setInvoiceMappings((prev) =>
      prev.map((m) => (m._tempId === mappingItem._tempId ? { ...m, storagePath: finalStoragePath, uploadProgress: 0, uploadError: null } : m))
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
          contentType: 'application/pdf',
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
        return { paymentId: mappingItem.paymentId, fileName: safeName, storagePath: finalStoragePath, downloadURL };
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
      showModal('Each active invoice mapping must have both a Payment ID selected and a PDF file associated.', 'Validation Error');
      return;
    }
    if (activeMappings.some((m) => m.paymentId && !currentDisbursementIds.has(m.paymentId))) {
      showModal('One or more invoice mappings reference a Payment ID that no longer exists in the disbursements list. Please correct the mappings or remove them.', 'Invalid Payment ID in Mapping');
      return;
    }

    const visibleToUserIdsArray = publicVisible
      ? []
      : visibleToUserIdsStr.split(',').map((id) => id.trim()).filter((id) => id);

    if (!publicVisible && visibleToUserIdsArray.length === 0) {
      showModal('Private cases must list at least one User ID.', 'Validation Error');
      return;
    }

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
          visibleToUserIds: visibleToUserIdsArray,
          publicVisible,
          status,
          opensAt: opensAtTs,
          dueAt: dueAtTs,
          createdBy: userId,
          _deleted: false,
        };
        currentCaseId = await createCase(tempCaseData);
        showModal(`Case structure created (ID: ${currentCaseId}). Uploading files... This may take a moment. Please do not navigate away.`, 'Processing', null);
      } else if (editingCaseId) {
        currentCaseId = editingCaseId;
        showModal(`Updating case (ID: ${currentCaseId}). Uploading any new/changed files... Please do not navigate away.`, 'Processing', null);
      }

      if (!currentCaseId) throw new Error('Case ID is missing. Cannot proceed with file uploads.');

      const candidates = invoiceMappings
        .filter((m) => m.paymentId && (m.clientSideFile || m.fileName));

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

      const disbursementPayload = mergeDisbursementDocuments(disbursements, finalInvoiceMappings);

      const caseDataPayload = {
        caseName,
        title: caseName,
        disbursements: disbursementPayload,
        invoiceMappings: finalInvoiceMappings,
        visibleToUserIds: visibleToUserIdsArray,
        publicVisible,
        status,
        opensAt: opensAtTs,
        dueAt: dueAtTs,
        createdBy: isNewCaseCreation || !originalCaseData?.createdBy ? userId : originalCaseData.createdBy,
        _deleted: originalCaseData?._deleted ?? false,
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
                Visible to User IDs (comma-separated)
              </label>
              <Textarea
                id="visibleToUserIds"
                value={visibleToUserIdsStr}
                onChange={(e) => setVisibleToUserIdsStr(e.target.value)}
                placeholder="Enter comma-separated User IDs when the case is private."
                disabled={publicVisible}
                className={publicVisible ? 'bg-gray-100 cursor-not-allowed' : ''}
              />
              <p className="text-xs text-gray-500 mt-1">
                Provide at least one ID when the case is restricted. Leave blank when public.
              </p>
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
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Invoice PDF Mappings</h2>
            <p className="text-sm text-gray-500 mb-3">
              Map Payment IDs to their invoice PDFs (max {Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB). Select a PDF for each mapping. Files will be uploaded to Firebase Storage on save.
            </p>
            <div className="space-y-4">
              {invoiceMappings.map((item, index) => (
                <InvoiceMappingItem key={item._tempId} item={item} index={index} onChange={handleMappingChange} onRemove={removeMapping} availablePaymentIds={availablePaymentIdsForMapping} onFileSelect={handleMappingFileSelect} caseIdForPath={editingCaseId} />
              ))}
            </div>
            <Button onClick={addMapping} variant="secondary" className="mt-4 text-sm" type="button">
              <PlusCircle size={16} className="inline mr-1" /> Add Mapping
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

const DisbursementItem = ({ item, index, onChange, onRemove }) => {
  const handleChange = (e) => {
    onChange(index, { ...item, [e.target.name]: e.target.value });
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center p-3 border border-gray-200 rounded-md">
      <Input name="paymentId" value={item.paymentId} onChange={handleChange} placeholder="Payment ID" required />
      <Input name="payee" value={item.payee} onChange={handleChange} placeholder="Payee" required />
      <Input name="amount" type="number" value={item.amount} onChange={handleChange} placeholder="Amount (e.g., 123.45)" required />
      <Input name="paymentDate" type="date" value={item.paymentDate} onChange={handleChange} placeholder="Payment Date" required />
      <Button onClick={() => onRemove(index)} variant="danger" className="h-10">
        <Trash2 size={18} />
      </Button>
    </div>
  );
};

const InvoiceMappingItem = ({ item, index, onChange, onRemove, availablePaymentIds, onFileSelect, caseIdForPath }) => {
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
        <select id={`paymentId-${item._tempId}`} name="paymentId" value={item.paymentId} onChange={(e) => onChange(index, { ...item, paymentId: e.target.value, clientSideFile: item.clientSideFile, fileName: item.fileName, storagePath: item.storagePath, uploadProgress: item.uploadProgress, uploadError: item.uploadError, downloadURL: item.downloadURL })} required className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm">
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
          Invoice PDF
        </label>
        <Input id={fileInputId} type="file" accept=".pdf,application/pdf" onChange={handleFileChange} className="mt-1" />
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
