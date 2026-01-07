import {
  buildEmptyAllocationStateForFields,
  createEmptySplitValuesForFields,
  normalizeAllocationInput,
  parseAmount,
  normalizeAllocationShapeForFields,
  allocationsAreEqualForFields,
} from '../allocationUtils';

const sampleFields = [
  { key: 'valid', label: 'Valid' },
  { key: 'exception', label: 'Exception' },
];
const sampleKeySet = new Set(sampleFields.map(({ key }) => key));

describe('allocationUtils', () => {
  test('createEmptySplitValuesForFields builds zeroed map', () => {
    expect(createEmptySplitValuesForFields(sampleFields)).toEqual({ valid: '', exception: '' });
  });

  test('buildEmptyAllocationStateForFields seeds default structure', () => {
    expect(buildEmptyAllocationStateForFields(sampleFields)).toEqual({
      mode: 'single',
      singleClassification: '',
      splitValues: { valid: '', exception: '' },
      notes: '',
    });
  });

  test('normalizeAllocationInput strips formatting', () => {
    expect(normalizeAllocationInput('$1,234.50')).toBe('1234.50');
    expect(normalizeAllocationInput('  500 ')).toBe('500');
    expect(normalizeAllocationInput('abc')).toBe('');
  });

  test('parseAmount converts strings and numbers safely', () => {
    expect(parseAmount('$1,200.10')).toBeCloseTo(1200.1);
    expect(parseAmount(42)).toBe(42);
    expect(parseAmount('')).toBe(0);
  });

  test('normalizeAllocationShapeForFields handles legacy single allocation', () => {
    const normalized = normalizeAllocationShapeForFields(
      { valid: '100', notes: 'test' },
      sampleFields,
      sampleKeySet
    );
    expect(normalized).toEqual({
      mode: 'single',
      singleClassification: 'valid',
      splitValues: { valid: '', exception: '' },
      notes: 'test',
    });
  });

  test('allocationsAreEqualForFields performs deep equality', () => {
    const base = {
      mode: 'split',
      splitValues: { valid: '50', exception: '50' },
      notes: 'note',
    };
    expect(
      allocationsAreEqualForFields(base, { ...base, splitValues: { valid: '50', exception: '50' } }, sampleFields, sampleKeySet)
    ).toBe(true);
    expect(
      allocationsAreEqualForFields(base, { ...base, splitValues: { valid: '40', exception: '60' } }, sampleFields, sampleKeySet)
    ).toBe(false);
  });
});
