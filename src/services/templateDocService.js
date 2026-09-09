import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export const generateTemplateDoc = async ({ appId, templateId, data }) => {
  if (!appId) throw new Error('Missing appId.');
  if (!templateId) throw new Error('Missing templateId.');
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Missing document data.');
  }

  const callable = httpsCallable(functions, 'generateTemplateDoc');
  const result = await callable({ appId, templateId, data });
  return result?.data || null;
};
