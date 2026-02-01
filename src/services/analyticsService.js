import { httpsCallable } from 'firebase/functions';
import { appId, functions } from '../AppCore';
import getUUID from '../utils/getUUID';

const DEMO_SESSION_KEY = 'audit_sim_demo_session_id';

export const getDemoSessionId = () => {
  try {
    if (typeof window === 'undefined') return null;
    const existing = window.localStorage.getItem(DEMO_SESSION_KEY);
    if (existing) return existing;
    const next = getUUID();
    window.localStorage.setItem(DEMO_SESSION_KEY, next);
    return next;
  } catch {
    return null;
  }
};

export const trackAnalyticsEvent = async ({ eventType, metadata, demoSessionId } = {}) => {
  if (!eventType) return;
  const callable = httpsCallable(functions, 'trackAnalyticsEvent');
  const payload = {
    appId,
    eventType,
    metadata: metadata && typeof metadata === 'object' ? metadata : null,
    demoSessionId: demoSessionId || getDemoSessionId(),
  };
  try {
    await callable(payload);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[analytics] Failed to track event', eventType, err?.message || err);
    }
  }
};
