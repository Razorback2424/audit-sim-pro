const { functions } = require('../shared/firebaseAdmin');
const { stripe, STRIPE_SECRET_KEY } = require('./stripeClient');

const normalizeStripeStatus = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const mapSubscriptionStatus = (status) => {
  const normalized = normalizeStripeStatus(status);
  if (normalized === 'active' || normalized === 'trialing') return 'active';
  if (normalized === 'past_due') return 'past_due';
  if (normalized === 'unpaid' || normalized === 'incomplete') return 'unpaid';
  if (normalized === 'canceled' || normalized === 'incomplete_expired') return 'canceled';
  return normalized || 'inactive';
};

const resolveStripeCustomerId = async ({ customerId, email }) => {
  if (customerId) return customerId;
  if (!email) return null;
  const customers = await stripe.customers.list({ email, limit: 1 });
  const customer = Array.isArray(customers?.data) ? customers.data[0] : null;
  return customer?.id || null;
};

const pickSubscription = (subscriptions = []) => {
  if (!subscriptions.length) return null;
  const active = subscriptions.find((sub) => ['active', 'trialing'].includes(normalizeStripeStatus(sub.status)));
  if (active) return active;
  const pastDue = subscriptions.find((sub) => ['past_due', 'unpaid', 'incomplete'].includes(normalizeStripeStatus(sub.status)));
  if (pastDue) return pastDue;
  const canceled = subscriptions.find((sub) => ['canceled', 'incomplete_expired'].includes(normalizeStripeStatus(sub.status)));
  if (canceled) return canceled;
  return subscriptions[0] || null;
};

const computeEntitlementFromStripe = async ({ customerId, email }) => {
  if (!stripe || !STRIPE_SECRET_KEY) {
    throw new functions.https.HttpsError('failed-precondition', 'Stripe is not configured.');
  }

  const resolvedCustomerId = await resolveStripeCustomerId({ customerId, email });
  if (!resolvedCustomerId) {
    return {
      hasPaidAccess: false,
      status: 'inactive',
      source: 'stripe',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: null,
      priceId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: null,
    };
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: resolvedCustomerId,
    status: 'all',
    limit: 5,
    expand: ['data.items.data.price'],
  });
  const records = Array.isArray(subscriptions?.data) ? subscriptions.data : [];
  const picked = pickSubscription(records);
  const normalizedStatus = normalizeStripeStatus(picked?.status);
  const status = picked ? mapSubscriptionStatus(picked.status) : 'inactive';
  const priceId = picked?.items?.data?.[0]?.price?.id || null;
  const currentPeriodEnd = picked?.current_period_end ? picked.current_period_end * 1000 : null;
  const cancelAtPeriodEnd = picked?.cancel_at_period_end === true;

  return {
    hasPaidAccess: status === 'active',
    status,
    source: 'stripe',
    stripeCustomerId: resolvedCustomerId,
    stripeSubscriptionId: picked?.id || null,
    stripeSubscriptionStatus: normalizedStatus || null,
    priceId,
    currentPeriodEnd,
    cancelAtPeriodEnd,
  };
};

module.exports = {
  computeEntitlementFromStripe,
  mapSubscriptionStatus,
  normalizeStripeStatus,
};
