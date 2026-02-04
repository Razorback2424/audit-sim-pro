const adminRoles = require('./src/admin/roles');
const analytics = require('./src/analytics/events');
const billingCheckout = require('./src/billing/checkout');
const billingWebhooks = require('./src/billing/webhooks');
const cases = require('./src/cases');

module.exports = {
  ...adminRoles,
  ...cases,
  ...billingCheckout,
  ...billingWebhooks,
  ...analytics,
};
