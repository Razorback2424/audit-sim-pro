import {
  buildPayloadFromForm,
  computeDerived,
  formStateFromData,
} from './templateDataBuilder';
import { listFieldSpecs } from './templateFieldSpecs';

const clone = (value) => JSON.parse(JSON.stringify(value));

test('round-trips the four template samples into renderer payloads', () => {
  listFieldSpecs().forEach((spec) => {
    const expected = clone(spec.sample);
    delete expected.controlBalance;
    const formState = formStateFromData(spec, spec.sample);
    expect(buildPayloadFromForm(spec, formState)).toEqual(expected);
  });
});

test('converts displayed percent values back to renderer rates', () => {
  const spec = listFieldSpecs().find((entry) => entry.templateId === 'invoice.seed.gamma.v1');
  const formState = formStateFromData(spec, spec.sample);
  expect(formState.values.taxRate).toBe(4.5);
  expect(buildPayloadFromForm(spec, formState).taxRate).toBe(0.045);
});

test('blank invoiceTotal is absent from the payload', () => {
  const spec = listFieldSpecs()[0];
  const formState = formStateFromData(spec, { ...spec.sample, invoiceTotal: '' });
  const payload = buildPayloadFromForm(spec, formState);
  expect(Object.prototype.hasOwnProperty.call(payload, 'invoiceTotal')).toBe(false);
});

test('cleared invoice tax uses the renderer default in derived totals', () => {
  const spec = listFieldSpecs()[0];
  const formState = formStateFromData(spec, spec.sample);
  formState.values.taxRate = '';
  const derived = computeDerived(spec, formState);
  expect(derived.totals.tax).toBeCloseTo(181.75, 6);
  expect(buildPayloadFromForm(spec, formState)).not.toHaveProperty('taxRate');
});

test('invoice derived totals match the renderer formula across randomized inputs', () => {
  const spec = listFieldSpecs()[0];
  let seed = 73;
  const nextRandom = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const rows = Array.from({ length: 1 + Math.floor(nextRandom() * 6) }, () => ({
      qty: Math.round(nextRandom() * 10 * 100) / 100,
      unitPrice: Math.round(nextRandom() * 5000 * 100) / 100,
    }));
    const taxRate = Math.round(nextRandom() * 12 * 100) / 100;
    const shipping = Math.round(nextRandom() * 250 * 100) / 100;
    const expectedSubtotal = rows.reduce((sum, row) => sum + row.qty * row.unitPrice, 0);
    const expectedTax = expectedSubtotal * (taxRate / 100);
    const derived = computeDerived(spec, {
      values: { taxRate, shipping, invoiceTotal: '' },
      rows,
    });

    expect(derived.totals.subtotal).toBeCloseTo(expectedSubtotal, 8);
    expect(derived.totals.tax).toBeCloseTo(expectedTax, 8);
    expect(derived.totals.shipping).toBeCloseTo(shipping, 8);
    expect(derived.totals.grandTotal).toBeCloseTo(expectedSubtotal + expectedTax + shipping, 8);
  }
});

test('forced invoice totals mirror renderer behavior above and below the guard', () => {
  const spec = listFieldSpecs()[0];
  const base = formStateFromData(spec, spec.sample);
  const forced = clone(base);
  forced.values.invoiceTotal = 5000;
  const forcedDerived = computeDerived(spec, forced);
  expect(forcedDerived.totals.grandTotal).toBe(5000);
  expect(forcedDerived.totals.forcedApplied).toBe(true);
  expect(forcedDerived.warnings.map((entry) => entry.type)).toContain('expected-total-mismatch');

  const ignored = clone(base);
  ignored.values.invoiceTotal = 10;
  const ignoredDerived = computeDerived(spec, ignored);
  expect(ignoredDerived.totals.grandTotal).toBeCloseTo(3928.1, 4);
  expect(ignoredDerived.totals.forcedApplied).toBe(false);
  expect(ignoredDerived.warnings.map((entry) => entry.type)).toContain('forced-total-ignored');
});

test('clean aging sample has no warnings and mismatches remain actionable', () => {
  const spec = listFieldSpecs().find((entry) => entry.templateId === 'refdoc.ap-aging.v1');
  const cleanState = formStateFromData(spec, spec.sample);
  expect(computeDerived(spec, cleanState).warnings).toHaveLength(0);

  const rowMismatch = clone(cleanState);
  rowMismatch.rows[0].buckets.days30 = 100;
  const rowWarnings = computeDerived(spec, rowMismatch).warnings;
  expect(rowWarnings.filter((entry) => entry.type === 'row-bucket-mismatch')).toHaveLength(1);
  expect(rowWarnings.find((entry) => entry.type === 'row-bucket-mismatch').rowIndex).toBe(0);

  const controlMismatch = clone(cleanState);
  controlMismatch.values.controlBalance = 100;
  const controlWarnings = computeDerived(spec, controlMismatch).warnings;
  expect(controlWarnings.filter((entry) => entry.type === 'control-balance-mismatch')).toHaveLength(1);
});
