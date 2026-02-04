const STRIPE_GLOBAL_BILLING_ROOT = 'artifacts/global/billing';

const buildBillingPath = (appIdValue, uid) => `artifacts/${appIdValue}/users/${uid}/billing/status`;
const buildStripeEventPath = (eventId) => `${STRIPE_GLOBAL_BILLING_ROOT}/stripe_events/${eventId}`;
const buildStripeCustomerGlobalPath = (customerId) =>
  `${STRIPE_GLOBAL_BILLING_ROOT}/stripe_customers/${customerId}`;
const buildStripePaymentIntentGlobalPath = (paymentIntentId) =>
  `${STRIPE_GLOBAL_BILLING_ROOT}/stripe_payment_intents/${paymentIntentId}`;
const buildStripeCustomerScopedPath = (appIdValue, customerId) =>
  `artifacts/${appIdValue}/billing/stripe_customers/${customerId}`;
const buildStripePaymentIntentScopedPath = (appIdValue, paymentIntentId) =>
  `artifacts/${appIdValue}/billing/stripe_payment_intents/${paymentIntentId}`;

module.exports = {
  buildBillingPath,
  buildStripeEventPath,
  buildStripeCustomerGlobalPath,
  buildStripePaymentIntentGlobalPath,
  buildStripeCustomerScopedPath,
  buildStripePaymentIntentScopedPath,
};
