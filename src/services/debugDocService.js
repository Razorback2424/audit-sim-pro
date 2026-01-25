import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export const generateDebugReferenceDoc = async ({ templateId, appId }) => {
  if (!templateId) {
    throw new Error('Missing templateId.');
  }
  if (!appId) {
    throw new Error('Missing appId.');
  }
  const callable = httpsCallable(functions, 'generateDebugRefdoc');
  const result = await callable({ templateId, appId });
  return result?.data || null;
};
