import { currencyFormatter } from '../utils/formatters';

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const cutoffValidator = (disbursement, config = {}) => {
  const messages = [];

  const serviceEndRaw =
    disbursement.groundTruths?.servicePeriodEnd || disbursement.groundTruths?.invoiceDate;
  const paymentDate = parseDate(disbursement.paymentDate);
  const serviceDate = parseDate(serviceEndRaw);

  if (serviceDate && paymentDate) {
    const diffDays = Math.round(
      (paymentDate.getTime() - serviceDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const toleranceDays = Number(config.toleranceDays) || 0;
    if (diffDays > toleranceDays) {
      messages.push(
        `Service ended ${diffDays} day${diffDays === 1 ? '' : 's'} before the recorded date — revisit cutoff.`
      );
    }
  }

  return messages;
};

const matchAmountValidator = (disbursement, config = {}) => {
  const messages = [];

  const expected = Number(disbursement.groundTruths?.confirmedValue || disbursement.amount);
  const recorded = Number(disbursement.amount);
  if (Number.isFinite(expected) && Number.isFinite(recorded)) {
    const delta = Math.abs(expected - recorded);
    const threshold = Number(config.tolerance || 0);
    if (delta > threshold) {
      messages.push(`Amount differs from evidence by ${currencyFormatter.format(delta)} — investigate the variance.`);
    }
  }

  return messages;
};

const invoiceDateCheck = (disbursement) => {
  const messages = [];
  const invoiceDate = parseDate(disbursement.groundTruths?.invoiceDate);
  const paymentDate = parseDate(disbursement.paymentDate);
  if (invoiceDate && paymentDate && invoiceDate.getTime() > paymentDate.getTime()) {
    messages.push('Invoice date is after book date — check if support is misdated.');
  }
  return messages;
};

const validatorRegistry = {
  cutoff: cutoffValidator,
  match_amount: matchAmountValidator,
};

const sharedChecks = [invoiceDateCheck];

export const deriveImmediateFeedbackForItem = (disbursement) => {
  const messages = [];
  if (!disbursement) return messages;

  const validatorType = disbursement.validator?.type;
  const config = disbursement.validator?.config || {};
  const validator = validatorType ? validatorRegistry[validatorType] : null;

  if (typeof validator === 'function') {
    const result = validator(disbursement, config);
    if (Array.isArray(result)) {
      result.filter(Boolean).forEach((msg) => messages.push(msg));
    }
  }

  sharedChecks.forEach((check) => {
    const result = check(disbursement, config);
    if (Array.isArray(result)) {
      result.filter(Boolean).forEach((msg) => messages.push(msg));
    }
  });

  return messages;
};

export const getRegisteredValidatorTypes = () => Object.keys(validatorRegistry);

export const validators = validatorRegistry;
