import { httpsCallable } from 'firebase/functions';
import { appId, functions } from '../AppCore';

export const updateCaseAssignments = async ({ caseId, userIds }) => {
  const callable = httpsCallable(functions, 'updateCaseAssignments');
  const result = await callable({ appId, caseId, userIds });
  return result?.data || null;
};
