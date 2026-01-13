import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage, appId } from '../AppCore';
import { createCase } from '../services/caseService';
import { getCurrentUserOrgId } from '../services/userService';
import getUUID from '../utils/getUUID';
import {
  prettySupportedLabels,
  isSupportedFile,
  pickContentType,
  ensureSafeStorageName,
} from '../utils/caseFileHelpers';
import { initialHighlightedDocument } from '../constants/caseFormDefaults';

const getArtifactFileRejection = (file, { unsupportedLabel, tooLargeLabel, supportedLabels, maxBytes }) => {
  if (!isSupportedFile(file)) {
    return {
      reason: 'unsupported',
      title: 'Invalid File Type',
      message: `Unsupported ${unsupportedLabel}. Allowed formats: ${supportedLabels}.`,
    };
  }
  if (file.size > maxBytes) {
    return {
      reason: 'too_large',
      title: 'File Too Large',
      message: `${tooLargeLabel} must be under ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    };
  }
  return null;
};

export function createCaseFormUploadHandlers({
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
}) {
  const ensureUploadCaseId = async () => {
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
      caseLevel: caseLevel || 'basic',
      yearEnd: (yearEndValue || '').trim() || null,
      yearEndLabel: (yearEndInput || '').trim() || null,
      caseGroupId: resolvedCaseGroupId,
    };

    ulog('draft-case:create', {
      status: draftPayload.status,
      auditArea,
      publicVisible,
      visibleToUserIdsCount: visibleToUserIds.length,
    });
    const createdId = await createCase(draftPayload);
    setDraftCaseId(createdId);
    ulog('draft-case:created', { caseId: createdId });
    return createdId;
  };

  const uploadFileAndGetMetadata = async (mappingItem, caseIdForUpload) => {
    const uploadId = `mapping_${mappingItem._tempId || Math.random().toString(36).slice(2, 8)}`;
    const file = mappingItem.clientSideFile;
    const fallbackName = (mappingItem.fileName || '').trim() || (file?.name || '').trim();
    const parentTempId = mappingItem.disbursementTempId;

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
    const safeName = ensureSafeStorageName(
      fallbackName || file.name || 'supporting-document.pdf',
      desiredContentType
    );
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
          msg =
            'Network was unstable for too long and the upload was aborted. Please check your connection and try again.';
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

  const startImmediateMappingUpload = async (disbursementTempId, mappingTempId, caseIdForUpload) => {
    if (!caseIdForUpload) return;
    const inflightKey = `${disbursementTempId}__${mappingTempId}`;
    if (mappingInflightRef.current[inflightKey]) {
      ulog('mapping:skip:inflight', { inflightKey });
      return;
    }
    if (!navigator.onLine) {
      ulog('mapping:skip:offline', { inflightKey });
      setDisbursements((prev) =>
        prev.map((disbursement) => {
          if (disbursement._tempId !== disbursementTempId) return disbursement;
          return {
            ...disbursement,
            mappings: (disbursement.mappings || []).map((mapping) =>
              mapping._tempId === mappingTempId
                ? { ...mapping, uploadError: 'Browser is offline', uploadProgress: undefined }
                : mapping
            ),
          };
        })
      );
      return;
    }

    const latestDisbursement = (disbursementsRef.current || []).find((d) => d?._tempId === disbursementTempId);
    const latestMapping = (latestDisbursement?.mappings || []).find((m) => m?._tempId === mappingTempId);
    if (!latestMapping?.clientSideFile) {
      ulog('mapping:skip:no-client-file', { inflightKey });
      return;
    }

    const updateMappingForDisbursement = (dtid, mtid, updater) => {
      setDisbursements((prev) =>
        prev.map((disbursement) => {
          if (disbursement._tempId !== dtid) return disbursement;
          return {
            ...disbursement,
            mappings: (disbursement.mappings || []).map((mapping) =>
              mapping._tempId === mtid ? updater(mapping) : mapping
            ),
          };
        })
      );
    };

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
      setDisbursements((prev) =>
        prev.map((disbursement) => {
          if (disbursement._tempId !== disbursementTempId) return disbursement;
          return {
            ...disbursement,
            mappings: (disbursement.mappings || []).map((mapping) =>
              mapping._tempId === mappingTempId
                ? { ...mapping, uploadError: err?.message || 'Upload failed', uploadProgress: undefined }
                : mapping
            ),
          };
        })
      );
    } finally {
      delete mappingInflightRef.current[inflightKey];
    }
  };

  const handleMappingFileSelect = async (disbursementTempId, mappingTempId, file) => {
    if (!file) return;
    const rejection = getArtifactFileRejection(file, {
      unsupportedLabel: 'file type',
      tooLargeLabel: 'File',
      supportedLabels: prettySupportedLabels,
      maxBytes: MAX_ARTIFACT_BYTES,
    });
    if (rejection) {
      if (rejection.reason === 'unsupported') {
        ulog('reject:unsupported-file', { mappingTempId, name: file.name, type: file.type });
      } else {
        ulog('reject:too-large', { mappingTempId, name: file.name, size: file.size });
      }
      showModal(rejection.message, rejection.title);
      return;
    }
    ulog('select', { mappingTempId, name: file.name, type: file.type, size: file.size });
    const contentType = pickContentType(file);
    setDisbursements((prev) =>
      prev.map((disbursement) => {
        if (disbursement._tempId !== disbursementTempId) return disbursement;
        return {
          ...disbursement,
          mappings: (disbursement.mappings || []).map((mapping) =>
            mapping._tempId === mappingTempId
              ? {
                  ...mapping,
                  clientSideFile: file,
                  fileName: file.name,
                  storagePath: '',
                  uploadProgress: undefined,
                  uploadError: null,
                  downloadURL: '',
                  contentType,
                }
              : mapping
          ),
        };
      })
    );

    try {
      const caseIdForUpload = await ensureUploadCaseId();
      await startImmediateMappingUpload(disbursementTempId, mappingTempId, caseIdForUpload);
    } catch (err) {
      // Draft case creation/upload can fail (permissions/network). Keep selection intact so it can upload on Save later.
      ulog('mapping:auto-upload:setup-failed', { message: err?.message });
    }
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

    const updateHighlightedDocumentForDisbursement = (dtid, updater) => {
      setDisbursements((prev) =>
        prev.map((disbursement) => {
          if (disbursement._tempId !== dtid) return disbursement;
          const currentDoc = disbursement.highlightedDocument || initialHighlightedDocument();
          return { ...disbursement, highlightedDocument: updater(currentDoc) };
        })
      );
    };

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

  const handleHighlightedDocumentSelect = async (disbursementTempId, file) => {
    if (!file) return;
    const rejection = getArtifactFileRejection(file, {
      unsupportedLabel: 'file type',
      tooLargeLabel: 'File',
      supportedLabels: prettySupportedLabels,
      maxBytes: MAX_ARTIFACT_BYTES,
    });
    if (rejection) {
      if (rejection.reason === 'unsupported') {
        ulog('highlight:reject:unsupported-file', { disbursementTempId, name: file.name, type: file.type });
      } else {
        ulog('highlight:reject:too-large', { disbursementTempId, name: file.name, size: file.size });
      }
      showModal(rejection.message, rejection.title);
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
        ulog('highlight:disbursement-not-found', {
          disbursementTempId,
          disbursementIds: prev.map((d) => d._tempId),
        });
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
      const generationSpec =
        docItem.generationSpec && typeof docItem.generationSpec === 'object'
          ? docItem.generationSpec
          : null;
      const payload = {
        _tempId: docItem._tempId,
        fileName: fallbackName,
        type: docItem.type,
        confirmedBalance: docItem.confirmedBalance,
      };
      if (docItem.generationSpecId) payload.generationSpecId = docItem.generationSpecId;
      if (storagePath) payload.storagePath = storagePath;
      if (downloadURL) payload.downloadURL = downloadURL;
      if (docItem.contentType) payload.contentType = docItem.contentType;
      if (generationSpec) payload.generationSpec = generationSpec;
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
          msg =
            'Network was unstable for too long and the upload was aborted. Please check your connection and try again.';
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

    const updateHighlightedDocumentForDisbursement = (dtid, updater) => {
      setDisbursements((prev) =>
        prev.map((d) => {
          if (d._tempId !== dtid) return d;
          const currentDoc = d.highlightedDocument || initialHighlightedDocument();
          return { ...d, highlightedDocument: updater(currentDoc) };
        })
      );
    };

    if (!docItem) {
      ulog('highlight:skip:no-doc', { disbursementTempId, reason: 'no docItem' });
      return { disbursementTempId, payload: null };
    }

    if (!docItem.clientSideFile) {
      const fileName = (docItem.fileName || '').trim();
      const storagePath = (docItem.storagePath || '').trim();
      const downloadURL = (docItem.downloadURL || '').trim();
      if (!fileName || (!storagePath && !downloadURL)) {
        ulog('highlight:skip:no-file', { disbursementTempId, fileName });
        return { disbursementTempId, payload: null };
      }
      const payload = {
        fileName,
        storagePath,
        downloadURL,
        contentType: docItem.contentType || '',
      };
      return { disbursementTempId, payload };
    }

    const file = docItem.clientSideFile;
    const uploadId = `highlight_${Math.random().toString(36).slice(2, 8)}`;
    ulog(uploadId, 'highlight:start', {
      caseIdForUpload,
      disbursementTempId,
      name: file?.name,
      type: file?.type,
      size: file?.size,
      online: navigator.onLine,
    });

    if (!navigator.onLine) {
      ulog(uploadId, 'highlight:offline');
      return {
        disbursementTempId,
        payload: null,
        uploadError: 'Browser is offline',
        fileName: fallbackName || file?.name || 'highlight.pdf',
      };
    }
    if (!caseIdForUpload) {
      const errorMsg = 'Cannot upload highlighted document: Case ID not finalized.';
      console.error(errorMsg, disbursement);
      ulog(uploadId, 'highlight:abort:no-case-id');
      updateHighlightedDocumentForDisbursement(disbursementTempId, (current) => ({
        ...(current || initialHighlightedDocument()),
        uploadError: errorMsg,
        uploadProgress: undefined,
      }));
      throw new Error(errorMsg);
    }

    const desiredContentType = docItem.contentType || pickContentType(file);
    const rawName = file?.name || fallbackName || 'highlight.pdf';
    const safeStorageName = ensureSafeStorageName(rawName, desiredContentType);
    const displayName = ((docItem.fileName || '').trim() || safeStorageName).trim();
    const finalStoragePath = `artifacts/${appId}/case_highlights/${caseIdForUpload}/${safeStorageName}`;
    ulog(uploadId, 'highlight:path', { rawName, safeStorageName, displayName, finalStoragePath });

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
        const timer = setTimeout(() => {
          try {
            task.cancel();
          } catch {}
          ulog(uploadId, 'highlight:timeout', `${timeoutMs}ms`);
          unsubscribe();
          reject(new Error(`Upload timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const unsubscribe = task.on(
          'state_changed',
          (snapshot) => {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
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
      ulog(uploadId, 'highlight:mode', 'resumable');
      try {
        const metadata = {
          contentType: desiredContentType || 'application/octet-stream',
          customMetadata: {
            appId: String(appId || ''),
            caseId: String(caseIdForUpload || ''),
            uploadedBy: String(userId || ''),
            documentType: 'highlight',
            disbursementTempId: String(disbursementTempId || ''),
          },
        };
        const task = uploadBytesResumable(fileRef, file, metadata);
        const snapshot = await awaitResumable(task);
        const downloadURL = await getDownloadURL(snapshot.ref);
        ulog(uploadId, 'highlight:success', { downloadURL });
        return {
          disbursementTempId,
          payload: {
            fileName: displayName,
            storagePath: finalStoragePath,
            downloadURL,
            contentType: desiredContentType || 'application/octet-stream',
          },
        };
      } catch (error) {
        const code = error?.code || '';
        let msg = error?.message || 'Upload failed';
        if (code === 'storage/retry-limit-exceeded') {
          msg =
            'Network was unstable for too long and the upload was aborted. Please check your connection and try again.';
        }
        const response =
          error?.serverResponse ??
          error?.customData?.serverResponse ??
          error?.customData?._rawError ??
          error?.message ??
          '';
        const xhrStatus =
          error?.customData?.response?.status ||
          error?.customData?.response?.statusCode ||
          error?.customData?.xhrStatus ||
          '';
        try {
          console.error('[case-highlight-upload] raw error', error);
        } catch {}
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

  const handleReferenceDocFileSelect = (index, file) => {
    if (!file) return;
    const rejection = getArtifactFileRejection(file, {
      unsupportedLabel: 'reference material',
      tooLargeLabel: 'Reference file',
      supportedLabels: prettySupportedLabels,
      maxBytes: MAX_ARTIFACT_BYTES,
    });
    if (rejection) {
      if (rejection.reason === 'unsupported') {
        ulog('reference:reject:unsupported-file', { index, name: file.name, type: file.type });
      } else {
        ulog('reference:reject:too-large', { index, name: file.name, size: file.size });
      }
      showModal(rejection.message, rejection.title);
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
    const rejection = getArtifactFileRejection(file, {
      unsupportedLabel: 'file',
      tooLargeLabel: 'File',
      supportedLabels: prettySupportedLabels,
      maxBytes: MAX_ARTIFACT_BYTES,
    });
    if (rejection) {
      if (rejection.reason === 'unsupported') {
        ulog('cash-artifact:reject:unsupported-file', { index, name: file.name, type: file.type });
      } else {
        ulog('cash-artifact:reject:too-large', { index, name: file.name, size: file.size });
      }
      showModal(rejection.message, rejection.title);
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

  return {
    ensureUploadCaseId,
    startImmediateMappingUpload,
    handleMappingFileSelect,
    handleHighlightedDocumentSelect,
    startImmediateHighlightUpload,
    uploadFileAndGetMetadata,
    uploadReferenceDocument,
    uploadHighlightedDocument,
    handleReferenceDocFileSelect,
    handleCashArtifactFileSelect,
  };
}
