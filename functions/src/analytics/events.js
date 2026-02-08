const { callable, admin, functions } = require('../shared/firebaseAdmin');
const crypto = require('crypto');
const { toOptionalString, isRecord } = require('../shared/utils');
const { resolveRequesterIdentity } = require('../shared/roles');

const DEFAULT_APP_ID = process.env.APP_ID || 'auditsim-pro-default-dev';
const MAX_PROPS_BYTES = 2000;
const DEDUPE_TTL_MS = 60 * 1000;
const dedupeCache = new Map();

const ALLOWED_EVENT_NAMES = new Set([
  'attempt_started',
  'attempt_restarted',
  'attempt_submitted',
  'attempt_results_viewed',
  'cta_save_report_clicked',
  'cta_checkout_clicked',
  'checkout_session_create_failed',
  'checkout_confirm_failed',
  'entitlement_activated',
  'guided_review_opened',
  'evidence_signed_url_issued',
  'evidence_open_failed',
  'webhook_failed',
  'reconcile_invoked',
]);

const resolveAppIdFromContext = (context) => toOptionalString(context?.auth?.token?.appId) || DEFAULT_APP_ID;
const resolveAppIdFromData = (data) => toOptionalString(data?.appId) || DEFAULT_APP_ID;

const buildAnalyticsEventsCollection = (appIdValue) => `artifacts/${appIdValue}/analytics/events`;

const normalizeEventName = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const sanitizeProps = (props) => {
  if (!isRecord(props)) return null;
  try {
    const raw = JSON.stringify(props);
    if (raw.length > MAX_PROPS_BYTES) {
      return null;
    }
  } catch {
    return null;
  }
  return props;
};

const writeAnalyticsEvent = async ({
  appId,
  uid,
  eventName,
  caseId = null,
  attemptId = null,
  sessionId = null,
  props = null,
  source = 'server',
  dedupeKey = null,
  dedupeTtlMs = DEDUPE_TTL_MS,
}) => {
  const normalizedEventName = normalizeEventName(eventName);
  if (!ALLOWED_EVENT_NAMES.has(normalizedEventName)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unsupported event name.');
  }
  if (dedupeKey) {
    const cacheKey = crypto.createHash('sha256').update(String(dedupeKey)).digest('hex');
    const now = Date.now();
    const lastSeen = dedupeCache.get(cacheKey);
    if (lastSeen && now - lastSeen < dedupeTtlMs) {
      return;
    }
    dedupeCache.set(cacheKey, now);
    if (dedupeCache.size > 500) {
      for (const [key, timestamp] of dedupeCache.entries()) {
        if (now - timestamp > dedupeTtlMs) {
          dedupeCache.delete(key);
        }
      }
    }
  }
  const payload = {
    eventName: normalizedEventName,
    appId: appId || DEFAULT_APP_ID,
    uid: uid || null,
    caseId: caseId || null,
    attemptId: attemptId || null,
    sessionId: sessionId || null,
    props: sanitizeProps(props),
    source,
    ts: admin.firestore.FieldValue.serverTimestamp(),
  };
  const db = admin.firestore();
  await db.collection(buildAnalyticsEventsCollection(payload.appId)).add(payload);
};

const trackAnalyticsEvent = callable.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appIdValue = resolveAppIdFromData(data);
  const eventName = normalizeEventName(data?.eventName);
  const caseId = toOptionalString(data?.caseId);
  const attemptId = toOptionalString(data?.attemptId);
  const rawProps = isRecord(data?.props) ? { ...data.props } : null;
  let sessionId = null;
  if (rawProps && typeof rawProps.sessionId === 'string') {
    sessionId = rawProps.sessionId.trim() || null;
    delete rawProps.sessionId;
  }

  await writeAnalyticsEvent({
    appId: appIdValue,
    uid: context.auth.uid,
    eventName,
    caseId,
    attemptId,
    sessionId,
    props: rawProps,
    source: 'client',
  });

  return { ok: true };
});

const submitProblemReport = callable.https.onCall(async (data, context) => {
  const appIdValue = resolveAppIdFromContext(context);
  const message = toOptionalString(data?.message);
  if (!message) {
    throw new functions.https.HttpsError('invalid-argument', 'Message is required.');
  }
  const payload = {
    uid: context.auth?.uid || null,
    role: context.auth?.token?.role || null,
    demoSessionId: toOptionalString(data?.demoSessionId),
    caseId: toOptionalString(data?.caseId),
    route: toOptionalString(data?.route),
    message,
    userAgent: context.rawRequest?.headers?.['user-agent'] || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const db = admin.firestore();
  await db.collection(`artifacts/${appIdValue}/private/data/problem_reports`).add(payload);
  return { ok: true };
});

const getBetaDashboard = callable.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appIdValue = resolveAppIdFromData(data);
  const firestore = admin.firestore();
  const { resolvedRole } = await resolveRequesterIdentity({
    context,
    appId: appIdValue,
    firestore,
    logLabel: 'getBetaDashboard',
  });

  if (resolvedRole !== 'admin' && resolvedRole !== 'owner') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }

  const now = admin.firestore.Timestamp.now();
  const days = Number.isFinite(Number(data?.days)) ? Math.max(1, Math.min(30, Number(data.days))) : 7;
  const startMs = now.toMillis() - days * 24 * 60 * 60 * 1000;
  const startAt = admin.firestore.Timestamp.fromMillis(startMs);

  const eventsRef = firestore.collection(buildAnalyticsEventsCollection(appIdValue));
  const eventsSnap = await eventsRef
    .where('ts', '>=', startAt)
    .orderBy('ts', 'desc')
    .limit(5000)
    .get();

  const counts = {};
  const recentEvents = [];
  eventsSnap.forEach((docSnap) => {
    const entry = docSnap.data() || {};
    const eventName = typeof entry.eventName === 'string' ? entry.eventName : 'unknown';
    counts[eventName] = (counts[eventName] || 0) + 1;
    if (recentEvents.length < 50) {
      recentEvents.push({
        id: docSnap.id,
        eventName,
        uid: entry.uid || null,
        caseId: entry.caseId || null,
        route: entry.props?.route || null,
        ts: entry.ts || null,
      });
    }
  });

  const reportsRef = firestore.collection(`artifacts/${appIdValue}/private/data/problem_reports`);
  const reportsSnap = await reportsRef.orderBy('createdAt', 'desc').limit(50).get();
  const reports = reportsSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));

  return {
    windowDays: days,
    counts,
    recentEvents,
    reports,
  };
});

module.exports = {
  trackAnalyticsEvent,
  writeAnalyticsEvent,
  submitProblemReport,
  getBetaDashboard,
};
