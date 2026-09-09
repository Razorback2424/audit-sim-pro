// AUTO-GENERATED from functions/generation/shared. Do not edit directly.
const EPSILON = 0.005;
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const isObject = (value) => value !== null && typeof value === 'object';

const isBlank = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

const isFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const getOptionEntries = (field) =>
  (field?.options || []).map((option) =>
    option && typeof option === 'object' && Object.prototype.hasOwnProperty.call(option, 'value')
      ? option
      : { value: option, label: String(option) }
  );

const optionValueFromForm = (field, value) => {
  const match = getOptionEntries(field).find((option) => String(option.value) === String(value));
  return match ? match.value : value;
};

const formValueFromData = (field, value) => {
  if (field.type === 'percent') {
    const number = isFiniteNumber(value);
    return number === null ? '' : number * 100;
  }
  if (field.type === 'select') return String(value);
  return value;
};

const getPath = (object, path) => {
  if (!isObject(object) || typeof path !== 'string' || !path) return undefined;
  return path.split('.').reduce((current, segment) => {
    if (DANGEROUS_PATH_SEGMENTS.has(segment) || !isObject(current)) return undefined;
    return current[segment];
  }, object);
};

const setPath = (object, path, value) => {
  if (!isObject(object) || typeof path !== 'string' || !path) return object;
  const segments = path.split('.');
  if (segments.some((segment) => DANGEROUS_PATH_SEGMENTS.has(segment))) return object;
  let cursor = object;
  segments.slice(0, -1).forEach((segment) => {
    if (!isObject(cursor[segment]) || Array.isArray(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment];
  });
  cursor[segments[segments.length - 1]] = value;
  return object;
};

const fieldDefault = (field) => {
  if (!Object.prototype.hasOwnProperty.call(field, 'default')) return '';
  if (field.type === 'select') return String(field.default);
  return field.default;
};

const emptyRowFromSpec = (spec) => {
  const row = {};
  (spec?.rows?.columns || []).forEach((field) => setPath(row, field.key, fieldDefault(field)));
  return row;
};

const emptyFormState = (spec) => {
  const values = {};
  (spec?.fields || []).forEach((field) => setPath(values, field.key, fieldDefault(field)));
  (spec?.controls || []).forEach((field) => setPath(values, field.key, fieldDefault(field)));
  return {
    values,
    rows: spec?.rows ? [emptyRowFromSpec(spec)] : [],
  };
};

const formStateFromData = (spec, data = {}) => {
  const values = {};
  [...(spec?.fields || []), ...(spec?.controls || [])].forEach((field) => {
    const rawValue = getPath(data, field.key);
    if (rawValue === undefined || rawValue === null) return;
    setPath(values, field.key, formValueFromData(field, rawValue));
  });

  const rows = Array.isArray(data?.[spec?.rows?.key])
    ? data[spec.rows.key].map((sourceRow) => {
        const row = {};
        if (!isObject(sourceRow) || Array.isArray(sourceRow)) return row;
        (spec.rows.columns || []).forEach((field) => {
          const rawValue = getPath(sourceRow, field.key);
          if (rawValue === undefined || rawValue === null) return;
          setPath(row, field.key, formValueFromData(field, rawValue));
        });
        return row;
      })
    : [];

  return { values, rows };
};

const payloadValueFromForm = (field, value) => {
  if (isBlank(value)) return undefined;
  if (field.type === 'text' || field.type === 'textarea') return String(value);
  if (field.type === 'select') return optionValueFromForm(field, value);
  const number = isFiniteNumber(value);
  if (number === null) return undefined;
  if (field.type === 'percent') return number / 100;
  return number;
};

const buildPayloadFromForm = (spec, formState = {}) => {
  const payload = {};
  const values = formState.values || {};
  const fields = [
    ...(spec?.fields || []),
    ...(spec?.controls || []).filter((field) => field.passthrough),
  ];

  fields.forEach((field) => {
    const value = payloadValueFromForm(field, getPath(values, field.key));
    if (value !== undefined) setPath(payload, field.key, value);
  });

  if (spec?.rows) {
    const sourceRows = Array.isArray(formState.rows) ? formState.rows : [];
    payload[spec.rows.key] = sourceRows.slice(0, spec.rows.maxRows).map((sourceRow) => {
      const row = {};
      (spec.rows.columns || []).forEach((field) => {
        const value = payloadValueFromForm(field, getPath(sourceRow, field.key));
        if (value !== undefined) setPath(row, field.key, value);
      });
      return row;
    });
  }

  return payload;
};

const numericValue = (value) => {
  const number = isFiniteNumber(value);
  return number === null ? 0 : number;
};

const percentValue = (value) => numericValue(value) / 100;

const findField = (spec, key) =>
  [...(spec?.fields || []), ...(spec?.controls || [])].find((field) => field.key === key);

const numericFormValue = (spec, key, value, rendererDefault) => {
  const field = findField(spec, key);
  const candidate = isBlank(value)
    ? Object.prototype.hasOwnProperty.call(field || {}, 'default')
      ? field.default
      : rendererDefault
    : value;
  const number = isFiniteNumber(candidate);
  return number === null ? rendererDefault : number;
};

const warning = (type, message, rowIndex) => ({
  type,
  message,
  ...(rowIndex === undefined ? {} : { rowIndex }),
});

const computeInvoiceDerived = (spec, formState) => {
  const values = formState.values || {};
  const rows = Array.isArray(formState.rows) ? formState.rows : [];
  const taxRate = percentValue(numericFormValue(spec, 'taxRate', getPath(values, 'taxRate'), 5));
  const shipping = numericFormValue(spec, 'shipping', getPath(values, 'shipping'), 0);
  const subtotal = rows.reduce(
    (sum, row) => sum + numericValue(getPath(row, 'qty')) * numericValue(getPath(row, 'unitPrice')),
    0
  );
  const tax = subtotal * taxRate;
  const calculatedGrandTotal = subtotal + tax + shipping;
  const forcedTotal = isBlank(getPath(values, 'invoiceTotal'))
    ? null
    : isFiniteNumber(getPath(values, 'invoiceTotal'));
  const warnings = [];
  const totals = {
    subtotal,
    tax,
    shipping,
    ship: shipping,
    grandTotal: calculatedGrandTotal,
    calculatedGrandTotal,
    expectedTotal: forcedTotal,
    forcedTotal,
    forcedApplied: false,
  };

  if (forcedTotal !== null) {
    if (Math.abs(forcedTotal - calculatedGrandTotal) > EPSILON) {
      warnings.push(
        warning('expected-total-mismatch', 'Expected total mismatch: entered total differs from calculated total.')
      );
    }
    const adjustedSubtotal = forcedTotal - tax - shipping;
    if (adjustedSubtotal >= 0) {
      totals.subtotal = adjustedSubtotal;
      totals.grandTotal = forcedTotal;
      totals.forcedApplied = true;
    } else {
      warnings.push(
        warning(
          'forced-total-ignored',
          'Forced total is below tax + shipping; the renderer will ignore it.'
        )
      );
    }
  }

  return { totals, warnings };
};

const computeApAgingDerived = (spec, formState) => {
  const values = formState.values || {};
  const rows = Array.isArray(formState.rows) ? formState.rows : [];
  const totals = rows.reduce(
    (acc, row) => {
      acc.amount += numericValue(getPath(row, 'amount'));
      acc.current += numericValue(getPath(row, 'buckets.current'));
      acc.days30 += numericValue(getPath(row, 'buckets.days30'));
      acc.days60 += numericValue(getPath(row, 'buckets.days60'));
      acc.days90Plus += numericValue(getPath(row, 'buckets.days90Plus'));
      return acc;
    },
    { amount: 0, current: 0, days30: 0, days60: 0, days90Plus: 0 }
  );
  totals.bucketTotal = totals.current + totals.days30 + totals.days60 + totals.days90Plus;
  const warnings = [];
  const controlBalanceValue = getPath(values, 'controlBalance');
  const hasControlBalance = !isBlank(controlBalanceValue) && isFiniteNumber(controlBalanceValue) !== null;
  totals.controlBalance = hasControlBalance ? numericValue(controlBalanceValue) : totals.amount;

  if (hasControlBalance && Math.abs(totals.controlBalance - totals.amount) > EPSILON) {
    warnings.push(
      warning('control-balance-mismatch', 'Control balance does not equal the sum of aging amounts.')
    );
  }

  rows.forEach((row, rowIndex) => {
    const amount = numericValue(getPath(row, 'amount'));
    const bucketTotal =
      numericValue(getPath(row, 'buckets.current')) +
      numericValue(getPath(row, 'buckets.days30')) +
      numericValue(getPath(row, 'buckets.days60')) +
      numericValue(getPath(row, 'buckets.days90Plus'));
    if (Math.abs(bucketTotal - amount) > EPSILON) {
      warnings.push(
        warning(
          'row-bucket-mismatch',
          `Row ${rowIndex + 1} bucket total does not equal the row amount.`,
          rowIndex
        )
      );
    }
  });

  if (Math.abs(totals.bucketTotal - totals.amount) > EPSILON) {
    warnings.push(
      warning('bucket-total-mismatch', 'Aging bucket totals do not equal the sum of aging amounts.')
    );
  }

  return { totals, warnings };
};

const computeDerived = (spec, formState = {}) => {
  if (spec?.computeKind === 'apAging') return computeApAgingDerived(spec, formState);
  return computeInvoiceDerived(spec, formState);
};

export {
  EPSILON,
  buildPayloadFromForm,
  computeDerived,
  emptyFormState,
  emptyRowFromSpec,
  formStateFromData,
  getPath,
  setPath,
};
