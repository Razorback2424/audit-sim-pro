const { callable, functions, admin } = require('../shared/firebaseAdmin');
const { toOptionalString } = require('../shared/utils');
const { stripe, STRIPE_SECRET_KEY } = require('./stripeClient');
const { computeEntitlementFromStripe } = require('./entitlements');
const { buildBillingPath, buildStripeCustomerScopedPath, buildStripeCustomerGlobalPath, buildStripePaymentIntentScopedPath, buildStripePaymentIntentGlobalPath } = require('../shared/billingPaths');
const { writeAnalyticsEvent } = require('../analytics/events');

const STRIPE_PRICE_INDIVIDUAL = process.env.STRIPE_PRICE_INDIVIDUAL || '';
const STRIPE_PRICE_INDIVIDUAL_ANNUAL = process.env.STRIPE_PRICE_INDIVIDUAL_ANNUAL || '';
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const DEFAULT_APP_ID = process.env.APP_ID || 'auditsim-pro-default-dev';

const resolveAppId = (data) => toOptionalString(data?.appId) || DEFAULT_APP_ID;
const resolveBaseUrl = (data) => toOptionalString(data?.baseUrl) || APP_BASE_URL;

const resolveStripePrice = (plan) => {
  const normalized = typeof plan === 'string' ? plan.trim().toLowerCase() : 'individual';
  if (normalized === 'individual') return STRIPE_PRICE_INDIVIDUAL;
  if (normalized === 'individual_annual') return STRIPE_PRICE_INDIVIDUAL_ANNUAL;
  return '';
};

const isSuccessfulCheckoutSession = (session) => {
  const status = typeof session?.payment_status === 'string' ? session.payment_status.trim().toLowerCase() : '';
  return status === 'paid' || status === 'no_payment_required';
};

const ensureRecurringPrice = async (priceId) => {
  if (!priceId) return null;
  const price = await stripe.prices.retrieve(priceId);
  const recurring = price?.recurring?.interval || null;
  if (!price?.active || !recurring) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Price is not an active recurring subscription price.'
    );
  }
  return price;
};

const getPaymentsCapability = callable.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
  if (!stripe || !STRIPE_SECRET_KEY) {
    return { enabled: false, reason: 'Stripe is not configured.' };
  }
  if (!STRIPE_PRICE_INDIVIDUAL || !STRIPE_PRICE_INDIVIDUAL_ANNUAL) {
    return {
      enabled: false,
      reason: 'Stripe price IDs are missing.',
    };
  }
  try {
    const [monthly, annual] = await Promise.all([
      ensureRecurringPrice(STRIPE_PRICE_INDIVIDUAL),
      ensureRecurringPrice(STRIPE_PRICE_INDIVIDUAL_ANNUAL),
    ]);
    return {
      enabled: true,
      prices: {
        individual: {
          interval: monthly?.recurring?.interval || null,
          currency: monthly?.currency || null,
          unitAmount: monthly?.unit_amount || null,
        },
        individual_annual: {
          interval: annual?.recurring?.interval || null,
          currency: annual?.currency || null,
          unitAmount: annual?.unit_amount || null,
        },
      },
    };
  } catch (err) {
    console.error('[getPaymentsCapability] Stripe price validation failed', err);
    return { enabled: false, reason: 'Stripe pricing is not configured correctly.' };
  }
});

const createStripeCheckoutSession = callable.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in to start checkout.');
  }
  if (!stripe || !STRIPE_SECRET_KEY) {
    throw new functions.https.HttpsError('failed-precondition', 'Stripe is not configured.');
  }

  const plan = typeof data?.plan === 'string' ? data.plan.trim().toLowerCase() : 'individual';
  const intent = toOptionalString(data?.intent);
  const caseId = toOptionalString(data?.caseId);

  const uid = context.auth.uid;
  const email = context.auth.token?.email || toOptionalString(data?.email) || undefined;
  const appIdValue = resolveAppId(data);

  try {
    const priceId = resolveStripePrice(plan);
    if (!priceId) {
      throw new functions.https.HttpsError('invalid-argument', 'Unsupported plan.');
    }
    await ensureRecurringPrice(priceId);

    const baseUrl = resolveBaseUrl(data);
    if (!baseUrl) {
      throw new functions.https.HttpsError('failed-precondition', 'Missing APP_BASE_URL.');
    }

    const successParams = new URLSearchParams({
      session_id: '{CHECKOUT_SESSION_ID}',
      ...(intent ? { intent } : {}),
      ...(caseId ? { caseId } : {}),
    });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${baseUrl}/checkout/success?${successParams.toString()}`,
      cancel_url: `${baseUrl}/checkout/cancel`,
      client_reference_id: uid,
      customer_email: email,
      subscription_data: {
        metadata: {
          uid,
          plan,
          appId: appIdValue,
          intent: intent || null,
          caseId: caseId || null,
        },
      },
      metadata: {
        uid,
        plan,
        appId: appIdValue,
        intent: intent || null,
        caseId: caseId || null,
      },
    });

    return { id: session.id, url: session.url };
  } catch (err) {
    try {
      await writeAnalyticsEvent({
        appId: appIdValue,
        uid,
        eventName: 'checkout_session_create_failed',
        props: {
          intent: intent || null,
          plan,
          errorCode: err?.code || err?.message || 'unknown',
          errorType: err?.name || null,
          provider: 'stripe',
        },
        source: 'server',
      });
    } catch (logErr) {
      console.warn('[checkout] Failed to log checkout_session_create_failed', logErr);
    }
    throw err;
  }
});

const confirmCheckoutSession = callable.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
  if (!stripe || !STRIPE_SECRET_KEY) {
    throw new functions.https.HttpsError('failed-precondition', 'Stripe is not configured.');
  }

  const sessionId = typeof data?.sessionId === 'string' ? data.sessionId.trim() : '';
  if (!sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'sessionId is required.');
  }

  let appIdValue = DEFAULT_APP_ID;
  let plan = 'individual';
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const metadata = session?.metadata || {};
    const uidFromMetadata = metadata.uid || session.client_reference_id || null;
    if (!uidFromMetadata || uidFromMetadata !== context.auth.uid) {
      throw new functions.https.HttpsError('permission-denied', 'Checkout session does not match user.');
    }

    appIdValue = metadata.appId || DEFAULT_APP_ID;
    plan = metadata.plan || 'individual';
    const paymentStatus = session?.payment_status || null;
    const subscriptionId = session?.subscription || null;
    const isPaid = isSuccessfulCheckoutSession(session);
    let entitlement = null;

    try {
      entitlement = await computeEntitlementFromStripe({
        customerId: session.customer || null,
        email: session.customer_email || null,
      });
    } catch (err) {
      console.warn('[confirmCheckoutSession] Failed to compute entitlement from Stripe', err);
    }

    const billingStatus = entitlement?.status || (isPaid ? 'active' : 'unpaid');

    if (isPaid || subscriptionId) {
      const db = admin.firestore();
      const billingRef = db.doc(buildBillingPath(appIdValue, uidFromMetadata));
      const billingSnap = await billingRef.get();
      const previousBilling = billingSnap.exists ? billingSnap.data() : null;
      const prevStatus = typeof previousBilling?.status === 'string' ? previousBilling.status.trim().toLowerCase() : '';
      const wasActive = prevStatus === 'active';
      await billingRef.set(
        {
          status: billingStatus,
          plan,
          stripeCustomerId: session.customer || entitlement?.stripeCustomerId || null,
          stripeCheckoutSessionId: session.id || null,
          stripePaymentStatus: paymentStatus,
          stripePaymentIntentId: session.payment_intent || null,
          stripeSubscriptionId: subscriptionId || entitlement?.stripeSubscriptionId || null,
          stripeSubscriptionStatus: entitlement?.stripeSubscriptionStatus || null,
          stripePriceId: entitlement?.priceId || null,
          stripeCurrentPeriodEnd: entitlement?.currentPeriodEnd || null,
          stripeCancelAtPeriodEnd: entitlement?.cancelAtPeriodEnd === true,
          lastEntitlementUpdateSource: 'confirm',
          lastEntitlementUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
          lastPaidAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (session.customer) {
        await db.doc(buildStripeCustomerScopedPath(appIdValue, session.customer)).set(
          {
            uid: uidFromMetadata,
            appId: appIdValue,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await db.doc(buildStripeCustomerGlobalPath(session.customer)).set(
          {
            uid: uidFromMetadata,
            appId: appIdValue,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      if (session.payment_intent) {
        await db.doc(buildStripePaymentIntentScopedPath(appIdValue, session.payment_intent)).set(
          {
            uid: uidFromMetadata,
            appId: appIdValue,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await db.doc(buildStripePaymentIntentGlobalPath(session.payment_intent)).set(
          {
            uid: uidFromMetadata,
            appId: appIdValue,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (!wasActive && billingStatus === 'active') {
        try {
          await writeAnalyticsEvent({
            appId: appIdValue,
            uid: uidFromMetadata,
            eventName: 'entitlement_activated',
            props: { source: 'confirm', plan },
            source: 'server',
          });
        } catch (logErr) {
          console.warn('[confirmCheckoutSession] Failed to log entitlement_activated', logErr);
        }
      }
    }

    return {
      status: paymentStatus,
      paid: isPaid || entitlement?.hasPaidAccess === true,
    };
  } catch (err) {
    try {
      await writeAnalyticsEvent({
        appId: appIdValue,
        uid: context.auth?.uid || null,
        eventName: 'checkout_confirm_failed',
        props: {
          errorCode: err?.code || err?.message || 'unknown',
          errorType: err?.name || null,
          provider: 'stripe',
        },
        source: 'server',
      });
    } catch (logErr) {
      console.warn('[confirmCheckoutSession] Failed to log checkout_confirm_failed', logErr);
    }
    throw err;
  }
});

const getEntitlementDebug = callable.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
  const callerRoleRaw = context.auth.token?.role;
  const callerRole = typeof callerRoleRaw === 'string' ? callerRoleRaw.trim().toLowerCase() : '';
  if (callerRole !== 'admin' && callerRole !== 'owner') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }

  const targetUid = toOptionalString(data?.targetUid);
  const targetEmail = toOptionalString(data?.email);
  let resolvedUid = targetUid || null;
  let resolvedEmail = targetEmail || null;

  if (!resolvedUid && resolvedEmail) {
    const userRecord = await admin.auth().getUserByEmail(resolvedEmail);
    resolvedUid = userRecord?.uid || null;
  }

  if (!resolvedUid) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid or email is required.');
  }

  if (!resolvedEmail) {
    try {
      const userRecord = await admin.auth().getUser(resolvedUid);
      resolvedEmail = userRecord?.email || null;
    } catch (err) {
      console.warn('[getEntitlementDebug] Failed to resolve user email', err);
    }
  }

  const appIdValue = resolveAppId(data);
  const billingRef = admin.firestore().doc(buildBillingPath(appIdValue, resolvedUid));
  const billingSnap = await billingRef.get();
  const billing = billingSnap.exists ? billingSnap.data() : null;

  return {
    uid: resolvedUid,
    email: resolvedEmail,
    billing: billing || null,
  };
});

const reconcileBillingAccess = callable.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const callerRoleRaw = context.auth.token?.role;
  const callerRole = typeof callerRoleRaw === 'string' ? callerRoleRaw.trim().toLowerCase() : '';
  const isAdmin = callerRole === 'admin' || callerRole === 'owner';

  const targetUid = toOptionalString(data?.targetUid);
  const targetEmail = toOptionalString(data?.email);
  const selfUid = context.auth.uid;
  const selfEmail = context.auth.token?.email || null;

  let resolvedUid = targetUid || null;
  let resolvedEmail = targetEmail || null;

  if (!isAdmin) {
    resolvedUid = selfUid;
    resolvedEmail = selfEmail;
    if (targetUid && targetUid !== selfUid) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot reconcile other users.');
    }
    if (targetEmail && selfEmail && targetEmail !== selfEmail) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot reconcile other users.');
    }
  } else {
    if (!resolvedUid && resolvedEmail) {
      const userRecord = await admin.auth().getUserByEmail(resolvedEmail);
      resolvedUid = userRecord?.uid || null;
    }
    if (!resolvedEmail && resolvedUid) {
      try {
        const userRecord = await admin.auth().getUser(resolvedUid);
        resolvedEmail = userRecord?.email || null;
      } catch (err) {
        console.warn('[reconcileBillingAccess] Failed to resolve email', err);
      }
    }
  }

  if (!resolvedUid) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid or email is required.');
  }

  const appIdValue = resolveAppId(data);
  const billingRef = admin.firestore().doc(buildBillingPath(appIdValue, resolvedUid));
  const nowMs = Date.now();
  const RATE_LIMIT_MS = 60 * 1000;
  let rateLimited = false;
  let previousBilling = null;

  await admin.firestore().runTransaction(async (txn) => {
    const snap = await txn.get(billingRef);
    previousBilling = snap.exists ? snap.data() : null;
    const lastAttempt = previousBilling?.lastReconcileAttemptAt;
    const lastAttemptMs = lastAttempt?.toMillis ? lastAttempt.toMillis() : null;
    if (lastAttemptMs && nowMs - lastAttemptMs < RATE_LIMIT_MS) {
      rateLimited = true;
      txn.set(
        billingRef,
        {
          lastReconcileAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
          lastReconcileResult: 'rate_limited',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }
    txn.set(
      billingRef,
      {
        lastReconcileAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  if (rateLimited) {
    return { result: 'rate_limited', attemptAt: nowMs };
  }

  let entitlement;
  try {
    entitlement = await computeEntitlementFromStripe({
      customerId: previousBilling?.stripeCustomerId || null,
      email: resolvedEmail || null,
    });
  } catch (err) {
    console.error('[reconcileBillingAccess] Failed to compute entitlement', err);
    await billingRef.set(
      {
        lastReconcileResult: 'error',
        lastReconcileError: err?.message || String(err),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    try {
      await writeAnalyticsEvent({
        appId: appIdValue,
        uid: resolvedUid,
        eventName: 'reconcile_invoked',
        props: {
          by: isAdmin ? 'admin' : 'self',
          result: 'failed',
          lookupMethod: resolvedEmail ? 'email' : 'uid',
        },
        source: 'server',
      });
    } catch (logErr) {
      console.warn('[reconcileBillingAccess] Failed to log reconcile_invoked', logErr);
    }
    throw new functions.https.HttpsError('internal', 'Unable to reconcile billing state.');
  }

  const nextStatus = entitlement?.status || 'inactive';
  const priorStatus = typeof previousBilling?.status === 'string' ? previousBilling.status.trim().toLowerCase() : '';
  const changed = priorStatus !== nextStatus;
  const result = changed ? 'updated' : 'no_change';

  await billingRef.set(
    {
      status: nextStatus,
      stripeCustomerId: entitlement?.stripeCustomerId || null,
      stripeSubscriptionId: entitlement?.stripeSubscriptionId || null,
      stripeSubscriptionStatus: entitlement?.stripeSubscriptionStatus || null,
      stripePriceId: entitlement?.priceId || null,
      stripeCurrentPeriodEnd: entitlement?.currentPeriodEnd || null,
      stripeCancelAtPeriodEnd: entitlement?.cancelAtPeriodEnd === true,
      lastEntitlementUpdateSource: 'reconcile',
      lastEntitlementUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
      lastReconcileResult: result,
      lastReconcileAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const wasActive = priorStatus === 'active';
  const reconcileResult = !wasActive && nextStatus === 'active' ? 'activated' : 'noop';
  try {
    await writeAnalyticsEvent({
      appId: appIdValue,
      uid: resolvedUid,
      eventName: 'reconcile_invoked',
      props: {
        by: isAdmin ? 'admin' : 'self',
        result: reconcileResult,
        lookupMethod: resolvedEmail ? 'email' : 'uid',
      },
      source: 'server',
    });
  } catch (logErr) {
    console.warn('[reconcileBillingAccess] Failed to log reconcile_invoked', logErr);
  }
  if (!wasActive && nextStatus === 'active') {
    try {
      await writeAnalyticsEvent({
        appId: appIdValue,
        uid: resolvedUid,
        eventName: 'entitlement_activated',
        props: { source: 'reconcile', plan: previousBilling?.plan || null },
        source: 'server',
      });
    } catch (logErr) {
      console.warn('[reconcileBillingAccess] Failed to log entitlement_activated', logErr);
    }
  }

  return {
    result,
    attemptAt: nowMs,
    entitlementSummary: {
      status: nextStatus,
      hasPaidAccess: entitlement?.hasPaidAccess === true,
      stripeCustomerId: entitlement?.stripeCustomerId || null,
      stripeSubscriptionId: entitlement?.stripeSubscriptionId || null,
    },
  };
});

module.exports = {
  createStripeCheckoutSession,
  confirmCheckoutSession,
  getPaymentsCapability,
  getEntitlementDebug,
  reconcileBillingAccess,
};
