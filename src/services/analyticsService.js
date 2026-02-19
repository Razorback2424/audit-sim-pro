import { httpsCallable } from 'firebase/functions';
import { appId, functions } from '../AppCore';
import getUUID from '../utils/getUUID';

const sessionId = (() => {
  try {
    return getUUID();
  } catch {
    return null;
  }
})();

export const ANALYTICS_EVENTS = {
  ATTEMPT_STARTED: 'attempt_started',
  ATTEMPT_RESTARTED: 'attempt_restarted',
  ATTEMPT_SUBMITTED: 'attempt_submitted',
  ATTEMPT_RESULTS_VIEWED: 'attempt_results_viewed',
  ATTEMPT_DOCUMENT_OPENED: 'attempt_document_opened',
  ADMIN_CASE_IMPORT_COMPLETED: 'admin_case_import_completed',
  ADMIN_CASE_UPLOAD_COMPLETED: 'admin_case_upload_completed',
  ADMIN_CASE_MAPPING_COMPLETED: 'admin_case_mapping_completed',
  ADMIN_CASE_PUBLISHED: 'admin_case_published',
  CTA_SAVE_REPORT_CLICKED: 'cta_save_report_clicked',
  CTA_CHECKOUT_CLICKED: 'cta_checkout_clicked',
  GUIDED_REVIEW_OPENED: 'guided_review_opened',
};

export const trackAnalyticsEvent = async ({ eventName, caseId, attemptId, props } = {}) => {
  if (!eventName) return;
  const callable = httpsCallable(functions, 'trackAnalyticsEvent');
  const payload = {
    eventName,
    caseId: caseId || null,
    attemptId: attemptId || null,
    props:
      props && typeof props === 'object'
        ? { ...props, ...(sessionId ? { sessionId } : {}) }
        : sessionId
        ? { sessionId }
        : null,
  };
  try {
    await callable(payload);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[analytics] Failed to track event', eventName, err?.message || err);
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
  };
  const result = await callable(payload);
  return result?.data || {};
};

export const fetchBetaDashboard = async ({ days = 7 } = {}) => {
  const callable = httpsCallable(functions, 'getBetaDashboard');
  const result = await callable({ appId, days });
  return result?.data || null;
};
