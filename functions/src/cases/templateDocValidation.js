const {
  getFieldSpec,
} = require('../../generation/shared/templateFieldSpecs');
const {
  getPath,
  setPath,
} = require('../../generation/shared/templateDataBuilder');

const STUDIO_ALLOWED_TEMPLATE_IDS = new Set([
  'refdoc.ap-aging.v1',
  'invoice.seed.alpha.v1',
  'invoice.seed.beta.v1',
  'invoice.seed.gamma.v1',
]);

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MAX_SERIALIZED_LENGTH = 100_000;
const NUMBER_MIN = -1e9;
const NUMBER_MAX = 1e9;

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertSafeKeys = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => assertSafeKeys(entry, seen));
    return;
  }

  Object.keys(value).forEach((key) => {
    if (DANGEROUS_KEYS.has(key)) {
      throw new Error(`Unsafe key is not allowed: ${key}`);
    }
    assertSafeKeys(value[key], seen);
  });
};

const optionEntries = (field) =>
  (field?.options || []).map((option) =>
    option && typeof option === 'object' && Object.prototype.hasOwnProperty.call(option, 'value')
      ? option
      : { value: option }
  );

const roundNumber = (value) => Math.round(value * 10000) / 10000;

const sanitizeScalar = (field, rawValue) => {
  if (rawValue === undefined || rawValue === null) return undefined;
  if (
    (field.type === 'number' || field.type === 'percent') &&
    typeof rawValue === 'string' &&
    rawValue.trim() === ''
  ) {
    return undefined;
  }

  if (field.type === 'text' || field.type === 'textarea') {
    return String(rawValue)
      .replace(CONTROL_CHARACTERS, '')
      .slice(0, field.maxLength ?? 200);
  }

  if (field.type === 'number' || field.type === 'percent') {
    const number = Number(rawValue);
    if (!Number.isFinite(number)) return undefined;
    const clamped = Math.max(NUMBER_MIN, Math.min(NUMBER_MAX, number));
    return roundNumber(field.type === 'percent' ? Math.max(0, Math.min(1, clamped)) : clamped);
  }

  if (field.type === 'select') {
    const match = optionEntries(field).find((option) => String(option.value) === String(rawValue));
    if (match) return match.value;
    if (Object.prototype.hasOwnProperty.call(field, 'default')) return field.default;
    return undefined;
  }

  return undefined;
};

const sanitizeFields = (fields, rawData, target) => {
  fields.forEach((field) => {
    const sanitized = sanitizeScalar(field, getPath(rawData, field.key));
    if (sanitized !== undefined) setPath(target, field.key, sanitized);
  });
};

const sanitizeRows = (spec, rawData, target) => {
  const rawRows = rawData?.[spec.rows.key];
  const rows = Array.isArray(rawRows) ? rawRows.slice(0, spec.rows.maxRows) : [];
  target[spec.rows.key] = rows
    .filter((row) => isPlainObject(row))
    .map((rawRow) => {
      const row = {};
      sanitizeFields(spec.rows.columns || [], rawRow, row);
      return row;
    });
};

const sanitizeTemplateData = (templateId, rawData) => {
  if (!STUDIO_ALLOWED_TEMPLATE_IDS.has(templateId)) {
    throw new Error(`Template is not allowed in Document Studio: ${templateId}`);
  }
  if (!isPlainObject(rawData)) {
    throw new Error('Document data must be a plain object.');
  }

  assertSafeKeys(rawData);
  const spec = getFieldSpec(templateId);
  const sanitized = {};

  sanitizeFields(spec.fields || [], rawData, sanitized);
  sanitizeFields(
    (spec.controls || []).filter((field) => field.passthrough),
    rawData,
    sanitized
  );
  sanitizeRows(spec, rawData, sanitized);

  let serialized;
  try {
    serialized = JSON.stringify(sanitized);
  } catch (err) {
    throw new Error('Document data could not be serialized.');
  }
  if (serialized.length > MAX_SERIALIZED_LENGTH) {
    throw new Error('Document data is too large.');
  }

  return sanitized;
};

module.exports = {
  MAX_SERIALIZED_LENGTH,
  STUDIO_ALLOWED_TEMPLATE_IDS,
  isPlainObject,
  sanitizeTemplateData,
};
