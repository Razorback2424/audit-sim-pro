const Stripe = require('stripe');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_SECRET_KEY ? Stripe(STRIPE_SECRET_KEY) : null;

module.exports = {
  stripe,
  STRIPE_SECRET_KEY,
};
