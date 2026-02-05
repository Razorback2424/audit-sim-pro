const { functions, admin } = require('../shared/firebaseAdmin');
const { stripe, STRIPE_SECRET_KEY } = require('./stripeClient');
const { toOptionalString } = require('../shared/utils');
const {
  buildBillingPath,
  buildStripeCustomerGlobalPath,
  buildStripePaymentIntentGlobalPath,
  buildStripeCustomerScopedPath,
  buildStripePaymentIntentScopedPath,
  buildStripeEventPath,
} = require('../shared/billingPaths');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const DEFAULT_APP_ID = process.env.APP_ID || 'auditsim-pro-default-dev';

const isSuccessfulCheckoutSession = (session) => {
  const status = typeof session?.payment_status === 'string' ? session.payment_status.trim().toLowerCase() : '';
  return status === 'paid' || status === 'no_payment_required';
};

const normalizeStripeStatus = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const mapSubscriptionStatus = (status) => {
  const normalized = normalizeStripeStatus(status);
  if (normalized === 'active' || normalized === 'trialing') return 'active';
  if (normalized === 'past_due') return 'past_due';
  if (normalized === 'unpaid' || normalized === 'incomplete') return 'unpaid';
  if (normalized === 'canceled' || normalized === 'incomplete_expired') return 'canceled';
  return normalized || 'unpaid';
};

const recordStripeEvent = async ({ firestore, event }) => {
  if (!event?.id) return { alreadyProcessed: false, eventRef: null };
  const eventRef = firestore.doc(buildStripeEventPath(event.id));
  return firestore.runTransaction(async (txn) => {
    const snap = await txn.get(eventRef);
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.state === 'processed') {
        return { alreadyProcessed: true, eventRef };
      }
      const attemptCount = Number.isFinite(Number(data.attemptCount))
        ? Number(data.attemptCount) + 1
        : 1;
      txn.set(
        eventRef,
        {
          state: 'processing',
          attemptCount,
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { alreadyProcessed: false, eventRef };
    }
    txn.set(
      eventRef,
      {
        eventId: event.id,
        type: event.type || null,
        livemode: event.livemode === true,
        state: 'processing',
        attemptCount: 1,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { alreadyProcessed: false, eventRef };
  });
};

const resolveBillingIdentityFromStripe = async ({ firestore, appIdValue, customerId, paymentIntentId }) => {
  if (paymentIntentId) {
    const globalIntentRef = firestore.doc(buildStripePaymentIntentGlobalPath(paymentIntentId));
    const globalIntentSnap = await globalIntentRef.get();
    if (globalIntentSnap.exists) {
      const data = globalIntentSnap.data() || {};
      if (data.uid && data.appId) {
        return { uid: data.uid, appIdValue: data.appId };
      }
    }
    if (appIdValue) {
      const intentRef = firestore.doc(buildStripePaymentIntentScopedPath(appIdValue, paymentIntentId));
      const intentSnap = await intentRef.get();
      if (intentSnap.exists) {
        const data = intentSnap.data() || {};
        if (data.uid) {
          return { uid: data.uid, appIdValue: data.appId || appIdValue };
        }
      }
    }
  }
  if (customerId) {
    const globalCustomerRef = firestore.doc(buildStripeCustomerGlobalPath(customerId));
    const globalCustomerSnap = await globalCustomerRef.get();
    if (globalCustomerSnap.exists) {
      const data = globalCustomerSnap.data() || {};
      if (data.uid && data.appId) {
        return { uid: data.uid, appIdValue: data.appId };
      }
    }
    if (appIdValue) {
      const customerRef = firestore.doc(buildStripeCustomerScopedPath(appIdValue, customerId));
      const customerSnap = await customerRef.get();
      if (customerSnap.exists) {
        const data = customerSnap.data() || {};
        if (data.uid) {
          return { uid: data.uid, appIdValue: data.appId || appIdValue };
        }
      }
    }
  }
  return { uid: null, appIdValue };
};

const stripeWebhook = functions.https.onRequest(async (req, res) => {
  if (!stripe || !STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    res.status(500).send('Stripe not configured');
    return;
  }
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    res.status(400).send('Missing stripe-signature');
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripeWebhook] signature verification failed', err);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    const db = admin.firestore();
    const eventObject = event.data?.object || {};
    const eventMetadata = eventObject.metadata || {};
    const appIdFromMetadata =
      typeof eventMetadata.appId === 'string' && eventMetadata.appId.trim()
        ? eventMetadata.appId.trim()
        : null;
    const inferredAppId = appIdFromMetadata || DEFAULT_APP_ID;

    const { alreadyProcessed, eventRef } = await recordStripeEvent({
      firestore: db,
      event,
    });
    if (alreadyProcessed) {
      res.json({ received: true, duplicate: true });
      return;
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = eventObject || {};
      if (!isSuccessfulCheckoutSession(session)) {
        console.warn('[stripeWebhook] Checkout session not paid yet', {
          eventId: event.id,
          sessionId: session.id || null,
          paymentStatus: session.payment_status || null,
        });
      } else {
        const metadata = session.metadata || {};
        const uid = metadata.uid || session.client_reference_id;
        const plan = metadata.plan || 'individual';
        const appIdValue = metadata.appId || inferredAppId;
        const subscriptionId = session.subscription || null;
        let subscriptionStatus = null;

        if (subscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            subscriptionStatus = subscription?.status || null;
          } catch (err) {
            console.warn('[stripeWebhook] Failed to retrieve subscription', err);
          }
        }

        if (uid) {
          const billingStatus = subscriptionId ? mapSubscriptionStatus(subscriptionStatus) : 'active';
          const billingRef = db.doc(buildBillingPath(appIdValue, uid));
          await billingRef.set(
            {
              status: billingStatus,
              plan,
              stripeCustomerId: session.customer || null,
              stripeCheckoutSessionId: session.id || null,
              stripePaymentStatus: session.payment_status || null,
              stripePaymentIntentId: session.payment_intent || null,
              stripeSubscriptionId: subscriptionId,
              stripeSubscriptionStatus: normalizeStripeStatus(subscriptionStatus) || null,
              lastPaidAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          if (session.customer) {
            await db.doc(buildStripeCustomerScopedPath(appIdValue, session.customer)).set(
              {
                uid,
                appId: appIdValue,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            await db.doc(buildStripeCustomerGlobalPath(session.customer)).set(
              {
                uid,
                appId: appIdValue,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
          if (session.payment_intent) {
            await db.doc(buildStripePaymentIntentScopedPath(appIdValue, session.payment_intent)).set(
              {
                uid,
                appId: appIdValue,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            await db.doc(buildStripePaymentIntentGlobalPath(session.payment_intent)).set(
              {
                uid,
                appId: appIdValue,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        }
      }
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = eventObject || {};
      const customerId = subscription.customer || null;
      const subscriptionId = subscription.id || null;
      const subscriptionStatus = mapSubscriptionStatus(subscription.status);
      const metadata = subscription.metadata || {};
      const appIdValue = toOptionalString(metadata.appId) || inferredAppId;
      const plan = metadata.plan || 'individual';

      const { uid, appIdValue: resolvedAppId } = await resolveBillingIdentityFromStripe({
        firestore: db,
        appIdValue,
        customerId,
        paymentIntentId: null,
      });

      if (uid && resolvedAppId) {
        await db.doc(buildBillingPath(resolvedAppId, uid)).set(
          {
            status: subscriptionStatus,
            plan,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripeSubscriptionStatus: normalizeStripeStatus(subscription.status) || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        console.warn('[stripeWebhook] Unable to resolve billing identity for subscription event', {
          eventId: event.id,
          customerId,
          subscriptionId,
        });
      }
    }

    if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.payment_failed') {
      const invoice = eventObject || {};
      const customerId = invoice.customer || null;
      const subscriptionId = invoice.subscription || null;
      const metadata = invoice.metadata || {};
      const appIdValue = toOptionalString(metadata.appId) || inferredAppId;
      const plan = metadata.plan || 'individual';
      const status = event.type === 'invoice.payment_succeeded' ? 'active' : 'past_due';

      const { uid, appIdValue: resolvedAppId } = await resolveBillingIdentityFromStripe({
        firestore: db,
        appIdValue,
        customerId,
        paymentIntentId: null,
      });

      if (uid && resolvedAppId) {
        await db.doc(buildBillingPath(resolvedAppId, uid)).set(
          {
            status,
            plan,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        console.warn('[stripeWebhook] Unable to resolve billing identity for invoice event', {
          eventId: event.id,
          customerId,
          subscriptionId,
        });
      }
    }

    if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
      const charge = eventObject || {};
      const customerId = charge.customer || null;
      const paymentIntentId = charge.payment_intent || null;
      const { uid, appIdValue } = await resolveBillingIdentityFromStripe({
        firestore: db,
        appIdValue: appIdFromMetadata,
        customerId,
        paymentIntentId,
      });

      if (uid && appIdValue) {
        await db.doc(buildBillingPath(appIdValue, uid)).set(
          {
            status: 'canceled',
            stripePaymentStatus: charge.status || null,
            revokedReason: event.type,
            revokedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        console.warn('[stripeWebhook] Unable to resolve billing identity for revocation', {
          eventId: event.id,
          customerId,
          paymentIntentId,
        });
      }
    }

    if (eventRef) {
      await eventRef.set(
        {
          state: 'processed',
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastError: admin.firestore.FieldValue.delete(),
        },
        { merge: true }
      );
    }

    res.json({ received: true });
  } catch (err) {
    try {
      const db = admin.firestore();
      if (event?.id) {
        await db.doc(buildStripeEventPath(event.id)).set(
          {
            state: 'processing',
            lastError: err?.message || String(err),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (updateErr) {
      console.error('[stripeWebhook] Failed to record webhook error', updateErr);
    }
    console.error('[stripeWebhook] handler failed', err);
    res.status(500).send('Webhook handler failed');
  }
});

module.exports = { stripeWebhook };
