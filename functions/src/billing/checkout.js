const { callable, functions, admin } = require('../shared/firebaseAdmin');
const { toOptionalString } = require('../shared/utils');
const { stripe, STRIPE_SECRET_KEY } = require('./stripeClient');
const { buildBillingPath, buildStripeCustomerScopedPath, buildStripeCustomerGlobalPath, buildStripePaymentIntentScopedPath, buildStripePaymentIntentGlobalPath } = require('../shared/billingPaths');

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
  const priceId = resolveStripePrice(plan);
  if (!priceId) {
    throw new functions.https.HttpsError('invalid-argument', 'Unsupported plan.');
  }
  await ensureRecurringPrice(priceId);

  const baseUrl = resolveBaseUrl(data);
  if (!baseUrl) {
    throw new functions.https.HttpsError('failed-precondition', 'Missing APP_BASE_URL.');
  }
  const intent = toOptionalString(data?.intent);
  const caseId = toOptionalString(data?.caseId);

  const uid = context.auth.uid;
  const email = context.auth.token?.email || toOptionalString(data?.email) || undefined;
  const appIdValue = resolveAppId(data);

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

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const metadata = session?.metadata || {};
  const uidFromMetadata = metadata.uid || session.client_reference_id || null;
  if (!uidFromMetadata || uidFromMetadata !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Checkout session does not match user.');
  }

  const appIdValue = metadata.appId || DEFAULT_APP_ID;
  const plan = metadata.plan || 'individual';
  const paymentStatus = session?.payment_status || null;
  const subscriptionId = session?.subscription || null;
  const isPaid = isSuccessfulCheckoutSession(session);
  let subscriptionStatus = null;

  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      subscriptionStatus = subscription?.status || null;
    } catch (err) {
      console.warn('[confirmCheckoutSession] Failed to retrieve subscription', err);
    }
  }

  const normalizedSubscriptionStatus =
    typeof subscriptionStatus === 'string' ? subscriptionStatus.trim().toLowerCase() : '';
  const isActiveSubscription = normalizedSubscriptionStatus === 'active' || normalizedSubscriptionStatus === 'trialing';
  const billingStatus = isActiveSubscription ? 'active' : normalizedSubscriptionStatus || (isPaid ? 'active' : 'unpaid');

  if (isPaid || subscriptionId) {
    const db = admin.firestore();
    const billingRef = db.doc(buildBillingPath(appIdValue, uidFromMetadata));
    await billingRef.set(
      {
        status: billingStatus,
        plan,
        stripeCustomerId: session.customer || null,
        stripeCheckoutSessionId: session.id || null,
        stripePaymentStatus: paymentStatus,
        stripePaymentIntentId: session.payment_intent || null,
        stripeSubscriptionId: subscriptionId,
        stripeSubscriptionStatus: normalizedSubscriptionStatus || null,
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
  }

  return {
    status: paymentStatus,
    paid: isPaid || isActiveSubscription,
  };
});

module.exports = { createStripeCheckoutSession, confirmCheckoutSession, getPaymentsCapability };
