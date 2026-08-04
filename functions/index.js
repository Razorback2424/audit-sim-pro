const adminRoles = require('./src/admin/roles');
const analytics = require('./src/analytics/events');
const billingCheckout = require('./src/billing/checkout');
const billingWebhooks = require('./src/billing/webhooks');
const cases = require('./src/cases');
const invitations = require('./src/invitations');
const assignments = require('./src/cases/assignments');
const gates = require('./src/gates');

module.exports = {
  ...adminRoles,
  ...cases,
  ...invitations,
  ...assignments,
  ...gates,
  ...billingCheckout,
  ...billingWebhooks,
  ...analytics,
};
