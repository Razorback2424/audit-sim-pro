import { httpsCallable } from 'firebase/functions';
import { appId, functions } from '../AppCore';

export const auditOrphanedInvoices = async ({ deleteFiles = false, sampleSize = 10 } = {}) => {
  if (!functions) {
    throw new Error('Firebase functions instance is not initialized.');
  }
  const callable = httpsCallable(functions, 'auditOrphanedInvoices');
  const response = await callable({ appId, deleteFiles, sampleSize });
  return response?.data || {};
};
