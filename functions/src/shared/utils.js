const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const stableStringify = (value) => {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const toSafeDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const asDate = value.toDate();
    return Number.isNaN(asDate?.getTime()) ? null : asDate;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const ensureSafeFileName = (fileName = '') => {
  const trimmed = String(fileName || '').trim() || 'document.pdf';
  const withoutPaths = trimmed.replace(/[/\\]/g, '-');
  return withoutPaths.replace(/[^\w.\-()\s]/g, '').replace(/\s+/g, ' ').trim();
};

const toTrimmedString = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const toOptionalString = (value) => {
  const trimmed = toTrimmedString(value);
  return trimmed === '' ? null : trimmed;
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

module.exports = {
  toNumber,
  stableStringify,
  toSafeDate,
  ensureSafeFileName,
  toTrimmedString,
  toOptionalString,
  isRecord,
};
