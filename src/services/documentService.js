import { httpsCallable } from 'firebase/functions';
import { appId, functions } from '../AppCore';

export const getSignedDocumentUrl = async ({
  caseId,
  storagePath,
  downloadURL,
  requireStoragePath = false,
  docLabel,
  docKind,
} = {}) => {
  if (!caseId) {
    throw new Error('getSignedDocumentUrl requires a caseId.');
  }
  const trimmedStoragePath = typeof storagePath === 'string' ? storagePath.trim() : '';
  const trimmedDownloadUrl = typeof downloadURL === 'string' ? downloadURL.trim() : '';
  const trimmedDocLabel = typeof docLabel === 'string' ? docLabel.trim() : '';
  const trimmedDocKind = typeof docKind === 'string' ? docKind.trim() : '';
  if (requireStoragePath && !trimmedStoragePath) {
    console.warn('[documents] Missing storagePath for signed URL request.', {
      caseId,
      docLabel: trimmedDocLabel || null,
    });
    throw new Error('Document unavailable—re-upload required by an admin.');
  }
  if (!trimmedStoragePath && !trimmedDownloadUrl) {
    throw new Error('getSignedDocumentUrl requires a storagePath or downloadURL.');
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info('[documents] Signed URL request', {
      caseId,
      hasStoragePath: Boolean(trimmedStoragePath),
      requireStoragePath,
    });
  }

  const callable = httpsCallable(functions, 'getSignedDocumentUrl');
  const result = await callable({
    appId,
    caseId,
    storagePath: trimmedStoragePath || null,
    downloadURL: trimmedDownloadUrl || null,
    requireStoragePath: requireStoragePath === true,
    docLabel: trimmedDocLabel || null,
    docKind: trimmedDocKind || null,
  });

  const url = result?.data?.url || '';
  if (!url) {
    throw new Error('No signed URL returned.');
  }
  return url;
};

export const openCaseDocument = async ({
  caseId,
  storagePath,
  downloadURL,
  requireStoragePath = false,
  docKind,
  target = '_blank',
} = {}) => {
  const url = await getSignedDocumentUrl({
    caseId,
    storagePath,
    downloadURL,
    requireStoragePath,
    docKind,
  });
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(url, target, 'noopener');
  }
  return url;
};
