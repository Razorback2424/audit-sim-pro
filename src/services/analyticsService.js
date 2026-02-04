import { httpsCallable } from 'firebase/functions';
import { appId, functions } from '../AppCore';
import getUUID from '../utils/getUUID';

const DEMO_SESSION_KEY = 'audit_sim_demo_session_id';

export const ANALYTICS_EVENTS = {
  REGISTRATION_COMPLETED: 'registration_completed',
  CHECKOUT_STARTED: 'checkout_started',
  CHECKOUT_COMPLETED: 'checkout_completed',
  CASE_LIST_VIEWED: 'case_list_viewed',
  CASE_OPENED: 'case_opened',
  CASE_STARTED: 'case_started',
  CASE_SUBMITTED: 'case_submitted',
  CASE_RESULTS_VIEWED: 'case_results_viewed',
  PAYWALL_SHOWN: 'paywall_shown',
  REPORT_PROBLEM_OPENED: 'report_problem_opened',
  REPORT_PROBLEM_SUBMITTED: 'report_problem_submitted',
  DEMO_STARTED: 'demo_started',
  DEMO_SUBMITTED: 'demo_submitted',
  UPGRADE_CLICKED: 'upgrade_clicked',
};

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

export const submitProblemReport = async ({ message, caseId, route } = {}) => {
  if (!message) {
    throw new Error('Please describe the issue.');
  }
  const callable = httpsCallable(functions, 'submitProblemReport');
  const payload = {
    appId,
    message,
    caseId: caseId || null,
    route: route || null,
    demoSessionId: getDemoSessionId(),
  };
  const result = await callable(payload);
  return result?.data || {};
};

export const fetchBetaDashboard = async ({ days = 7 } = {}) => {
  const callable = httpsCallable(functions, 'getBetaDashboard');
  const result = await callable({ appId, days });
  return result?.data || null;
};
