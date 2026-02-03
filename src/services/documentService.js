import { httpsCallable } from 'firebase/functions';
import { appId, functions } from '../AppCore';

export const getSignedDocumentUrl = async ({ caseId, storagePath, downloadURL } = {}) => {
  if (!caseId) {
    throw new Error('getSignedDocumentUrl requires a caseId.');
  }
  const trimmedStoragePath = typeof storagePath === 'string' ? storagePath.trim() : '';
  const trimmedDownloadUrl = typeof downloadURL === 'string' ? downloadURL.trim() : '';
  if (!trimmedStoragePath && !trimmedDownloadUrl) {
    throw new Error('getSignedDocumentUrl requires a storagePath or downloadURL.');
  }

  const callable = httpsCallable(functions, 'getSignedDocumentUrl');
  const result = await callable({
    appId,
    caseId,
    storagePath: trimmedStoragePath || null,
    downloadURL: trimmedDownloadUrl || null,
  });

  const url = result?.data?.url || '';
  if (!url) {
    throw new Error('No signed URL returned.');
  }
  return url;
};
