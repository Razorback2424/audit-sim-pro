const { callable, functions, admin } = require('../shared/firebaseAdmin');
const { toOptionalString } = require('../shared/utils');
const { stripe, STRIPE_SECRET_KEY } = require('./stripeClient');
const { buildBillingPath, buildStripeCustomerScopedPath, buildStripeCustomerGlobalPath, buildStripePaymentIntentScopedPath, buildStripePaymentIntentGlobalPath } = require('../shared/billingPaths');

const STRIPE_PRICE_INDIVIDUAL = process.env.STRIPE_PRICE_INDIVIDUAL || '';
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const DEFAULT_APP_ID = process.env.APP_ID || 'auditsim-pro-default-dev';

const resolveAppId = (data) => toOptionalString(data?.appId) || DEFAULT_APP_ID;
const resolveBaseUrl = (data) => toOptionalString(data?.baseUrl) || APP_BASE_URL;

const resolveStripePrice = (plan) => {
  const normalized = typeof plan === 'string' ? plan.trim().toLowerCase() : 'individual';
  if (normalized === 'individual') return STRIPE_PRICE_INDIVIDUAL;
  return '';
};

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

  const baseUrl = resolveBaseUrl(data);
  if (!baseUrl) {
    throw new functions.https.HttpsError('failed-precondition', 'Missing APP_BASE_URL.');
  }

  const uid = context.auth.uid;
  const email = context.auth.token?.email || toOptionalString(data?.email) || undefined;
  const appIdValue = resolveAppId(data);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/checkout/cancel`,
    client_reference_id: uid,
    customer_email: email,
    metadata: {
      uid,
      plan,
      appId: appIdValue,
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
  const isPaid = paymentStatus === 'paid';

  if (isPaid) {
    const db = admin.firestore();
    const billingRef = db.doc(buildBillingPath(appIdValue, uidFromMetadata));
    await billingRef.set(
      {
        status: 'paid',
        plan,
        stripeCustomerId: session.customer || null,
        stripeCheckoutSessionId: session.id || null,
        stripePaymentStatus: paymentStatus,
        stripePaymentIntentId: session.payment_intent || null,
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
    paid: isPaid,
  };
});

module.exports = { createStripeCheckoutSession, confirmCheckoutSession };
