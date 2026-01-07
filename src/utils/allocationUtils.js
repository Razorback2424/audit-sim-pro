export const createEmptySplitValuesForFields = (fields) => {
  const splits = {};
  fields.forEach(({ key }) => {
    splits[key] = '';
  });
  return splits;
};

export const buildEmptyAllocationStateForFields = (fields) => ({
  mode: 'single',
  singleClassification: '',
  splitValues: createEmptySplitValuesForFields(fields),
  notes: '',
});

const toValidClassificationKey = (value, keySet) =>
  typeof value === 'string' && keySet.has(value) ? value : '';

export const normalizeAllocationShapeForFields = (rawAllocation, fields, keySet) => {
  if (!rawAllocation || typeof rawAllocation !== 'object') {
    return buildEmptyAllocationStateForFields(fields);
  }

  const legacyDetected = fields.some(({ key }) => rawAllocation[key] !== undefined);
  if (legacyDetected && !rawAllocation.mode) {
    const legacy = buildEmptyAllocationStateForFields(fields);
    legacy.notes = typeof rawAllocation.notes === 'string' ? rawAllocation.notes : '';
    const nonZeroKeys = [];

    fields.forEach(({ key }) => {
      const value = rawAllocation[key];
      const asString = value === undefined || value === null || value === '' ? '' : String(value);
      legacy.splitValues[key] = asString;
      const numericValue = Number(asString);
      if (Number.isFinite(numericValue) && Math.abs(numericValue) > 0) {
        nonZeroKeys.push(key);
      }
    });

    if (nonZeroKeys.length <= 1) {
      legacy.mode = 'single';
      legacy.singleClassification = nonZeroKeys[0] ?? '';
      legacy.splitValues = createEmptySplitValuesForFields(fields);
    } else {
      legacy.mode = 'split';
    }

    return legacy;
  }

  const normalized = buildEmptyAllocationStateForFields(fields);
  normalized.notes = typeof rawAllocation.notes === 'string' ? rawAllocation.notes : '';
  const requestedSplitMode = rawAllocation.mode === 'split';
  normalized.mode = requestedSplitMode ? 'split' : 'single';
  normalized.singleClassification = toValidClassificationKey(rawAllocation.singleClassification, keySet);

  fields.forEach(({ key }) => {
    const value =
      (rawAllocation.splitValues && rawAllocation.splitValues[key] !== undefined
        ? rawAllocation.splitValues[key]
        : rawAllocation[key]) ?? '';
    normalized.splitValues[key] = value === null ? '' : String(value);
  });

  const hasMeaningfulSplit = fields.some(({ key }) => {
    const rawValue = normalized.splitValues[key];
    if (rawValue === '' || rawValue === null || rawValue === undefined) return false;
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) && Math.abs(numeric) > 0;
  });

  if (requestedSplitMode) {
    return normalized;
  }

  if (normalized.mode === 'split' && !hasMeaningfulSplit) {
    const fallbackClassification = toValidClassificationKey(normalized.singleClassification, keySet);
    normalized.mode = 'single';
    normalized.singleClassification = fallbackClassification;
    normalized.splitValues = createEmptySplitValuesForFields(fields);
  }

  return normalized;
};

export const allocationsAreEqualForFields = (left, right, fields, keySet) => {
  const a = normalizeAllocationShapeForFields(left, fields, keySet);
  const b = normalizeAllocationShapeForFields(right, fields, keySet);

  if (a.mode !== b.mode) return false;
  if ((a.singleClassification || '') !== (b.singleClassification || '')) return false;
  if ((a.notes || '') !== (b.notes || '')) return false;

  return fields.every(({ key }) => (a.splitValues[key] ?? '') === (b.splitValues[key] ?? ''));
};

export const isSameClassificationMapForFields = (currentMap, nextMap, fields, keySet) => {
  const currentKeys = Object.keys(currentMap);
  const nextKeys = Object.keys(nextMap);
  if (currentKeys.length !== nextKeys.length) return false;
  return currentKeys.every((key) =>
    allocationsAreEqualForFields(currentMap[key], nextMap[key], fields, keySet)
  );
};

export const normalizeAllocationInput = (rawValue) => {
  if (rawValue === null || rawValue === undefined) return '';
  const stringValue = String(rawValue).trim();
  if (stringValue === '') return '';

  const withoutCurrency = stringValue.replace(/[$\s]/g, '');
  const withoutCommas = withoutCurrency.replace(/,/g, '');
  const digitsAndDots = withoutCommas.replace(/[^0-9.]/g, '');
  if (digitsAndDots === '') return '';

  const parts = digitsAndDots.split('.');
  let wholePart = parts.shift() || '';
  const decimalPart = parts.join('');
  if (wholePart === '') {
    wholePart = '0';
  }

  let normalized = decimalPart ? `${wholePart}.${decimalPart}` : wholePart;
  if (digitsAndDots.endsWith('.') && decimalPart === '') {
    normalized = `${wholePart}.`;
  }

  return normalized;
};

export const parseAmount = (value) => {
  if (value === '' || value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  const normalized = normalizeAllocationInput(value);
  if (normalized === '' || normalized === '.') return 0;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : NaN;
};
