import { httpsCallable } from 'firebase/functions';
import { appId, functions } from '../AppCore';

export const createTraineeInvitations = async (emails) => {
  const callable = httpsCallable(functions, 'createTraineeInvitations');
  const result = await callable({ appId, emails });
  return result?.data?.results || [];
};

export const listOrganizationInvitations = async () => {
  const callable = httpsCallable(functions, 'listOrganizationInvitations');
  const result = await callable({ appId });
  return result?.data?.invitations || [];
};

export const acceptTraineeInvitation = async (token) => {
  const callable = httpsCallable(functions, 'acceptTraineeInvitation');
  const result = await callable({ appId, token });
  return result?.data || null;
};

export const revokeTraineeInvitation = async (invitationId) => {
  const callable = httpsCallable(functions, 'revokeTraineeInvitation');
  const result = await callable({ appId, invitationId });
  return result?.data || null;
};

export const previewInvitation = async (token) => {
  const callable = httpsCallable(functions, 'previewInvitation');
  const result = await callable({ appId, token });
  return result?.data || null;
};
