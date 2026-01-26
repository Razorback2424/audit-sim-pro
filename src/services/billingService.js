import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, appId, functions } from '../AppCore';

const toNumberOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toOptionalString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeSummary = (data) => {
  if (!data || typeof data !== 'object') {
    return null;
  }
  return {
    planName: data.planName || 'Pilot',
    seatCount: toNumberOrNull(data.seatCount),
    renewalDate: data.renewalDate || null,
    status: data.status || 'unknown',
    provider: toOptionalString(data.provider),
    customerId: toOptionalString(data.customerId),
    subscriptionId: toOptionalString(data.subscriptionId),
  };
};

const buildFallbackSummary = () => ({
  planName: 'Pilot',
  seatCount: null,
  renewalDate: null,
  status: 'unknown',
  provider: null,
  customerId: null,
  subscriptionId: null,
});

export const fetchBillingSummary = async ({ orgId } = {}) => {
  if (!orgId) {
    return buildFallbackSummary();
  }
  try {
    const ref = doc(db, `artifacts/${appId}/billing/orgs/${orgId}`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return normalizeSummary(snap.data()) || buildFallbackSummary();
    }
  } catch (error) {
    console.warn('[billingService] Unable to fetch billing summary, using fallback.', {
      orgId,
      error,
    });
  }
  return buildFallbackSummary();
};

export const openBillingPortal = async ({ orgId } = {}) => {
  if (!functions) {
    throw new Error('Billing portal is not configured.');
  }
  if (!orgId) {
    throw new Error('Missing orgId for billing portal.');
  }
  const callable = httpsCallable(functions, 'createBillingPortalSession');
  const response = await callable({ appId, orgId });
  const url = response?.data?.url;
  if (!url || typeof url !== 'string') {
    throw new Error('Billing portal session unavailable.');
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return url;
};
