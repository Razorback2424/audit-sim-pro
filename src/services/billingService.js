import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { appId, functions, db, FirestorePaths } from '../AppCore';

export const createCheckoutSession = async ({ plan, baseUrl, intent, caseId }) => {
  const callable = httpsCallable(functions, 'createStripeCheckoutSession');
  const payload = {
    plan,
    appId,
    baseUrl,
    intent: intent || null,
    caseId: caseId || null,
  };
  const result = await callable(payload);
  return result?.data || {};
};

export const fetchPaymentsCapability = async () => {
  const callable = httpsCallable(functions, 'getPaymentsCapability');
  const result = await callable({});
  return result?.data || {};
};

export const confirmCheckoutSession = async ({ sessionId }) => {
  const callable = httpsCallable(functions, 'confirmCheckoutSession');
  const result = await callable({ sessionId });
  return result?.data || {};
};

export const fetchEntitlementDebug = async ({ targetUid, email } = {}) => {
  const callable = httpsCallable(functions, 'getEntitlementDebug');
  const result = await callable({ targetUid: targetUid || null, email: email || null, appId });
  return result?.data || {};
};

export const reconcileBillingAccess = async ({ targetUid, email } = {}) => {
  const callable = httpsCallable(functions, 'reconcileBillingAccess');
  const result = await callable({ targetUid: targetUid || null, email: email || null, appId });
  return result?.data || {};
};

export const fetchBillingSummary = async ({ orgId, appId: appIdOverride } = {}) => {
  if (!orgId) return null;
  const ref = doc(db, `artifacts/${appIdOverride || appId}/billing/orgs/${orgId}`);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
};

export const fetchUserBilling = async ({ uid, appId: appIdOverride } = {}) => {
  if (!uid) return null;
  const ref = doc(db, FirestorePaths.BILLING_DOCUMENT(appIdOverride || appId, uid));
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
};

export const subscribeUserBilling = ({ uid, appId: appIdOverride } = {}, onData, onError) => {
  if (!uid) {
    if (typeof onData === 'function') onData(null);
    return () => null;
  }
  const ref = doc(db, FirestorePaths.BILLING_DOCUMENT(appIdOverride || appId, uid));
  return onSnapshot(
    ref,
    (snap) => {
      const data = snap.exists() ? snap.data() : null;
      if (typeof onData === 'function') onData(data);
    },
    onError
  );
};

export const isBillingPaid = (billing) => {
  const status = typeof billing?.status === 'string' ? billing.status.trim().toLowerCase() : '';
  return status === 'active' || status === 'no_payment_required';
};
