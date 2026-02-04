const { callable, admin, functions } = require('../shared/firebaseAdmin');
const { toOptionalString, isRecord } = require('../shared/utils');
const { resolveRequesterIdentity } = require('../shared/roles');

const DEFAULT_APP_ID = process.env.APP_ID || 'auditsim-pro-default-dev';

const resolveAppId = (data) => toOptionalString(data?.appId) || DEFAULT_APP_ID;

const buildAnalyticsEventsCollection = (appIdValue) =>
  `artifacts/${appIdValue}/private/data/analytics_events`;

const normalizeEventType = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const trackAnalyticsEvent = callable.https.onCall(async (data, context) => {
  const appIdValue = resolveAppId(data);
  const eventType = normalizeEventType(data?.eventType);
  const allowedEvents = new Set([
    'registration_completed',
    'checkout_started',
    'checkout_completed',
    'case_list_viewed',
    'case_opened',
    'case_started',
    'case_submitted',
    'case_results_viewed',
    'paywall_shown',
    'report_problem_opened',
    'report_problem_submitted',
    'demo_started',
    'demo_submitted',
    'upgrade_clicked',
  ]);
  if (!allowedEvents.has(eventType)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unsupported event type.');
  }

  const payload = {
    eventType,
    uid: context.auth?.uid || null,
    demoSessionId: toOptionalString(data?.demoSessionId),
    metadata: isRecord(data?.metadata) ? data.metadata : null,
    userAgent: context.rawRequest?.headers?.['user-agent'] || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const db = admin.firestore();
  await db.collection(buildAnalyticsEventsCollection(appIdValue)).add(payload);
  return { ok: true };
});

const submitProblemReport = callable.https.onCall(async (data, context) => {
  const appIdValue = resolveAppId(data);
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

  const appIdValue = resolveAppId(data);
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
    .where('createdAt', '>=', startAt)
    .orderBy('createdAt', 'desc')
    .limit(5000)
    .get();

  const counts = {};
  const recentEvents = [];
  eventsSnap.forEach((docSnap) => {
    const entry = docSnap.data() || {};
    const eventType = typeof entry.eventType === 'string' ? entry.eventType : 'unknown';
    counts[eventType] = (counts[eventType] || 0) + 1;
    if (recentEvents.length < 50) {
      recentEvents.push({
        id: docSnap.id,
        eventType,
        uid: entry.uid || null,
        caseId: entry.metadata?.caseId || null,
        route: entry.metadata?.route || null,
        createdAt: entry.createdAt || null,
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
  submitProblemReport,
  getBetaDashboard,
};
