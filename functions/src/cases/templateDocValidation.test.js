const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const { sanitizeTemplateData } = require('./templateDocValidation');
const { getFieldSpec, listFieldSpecs } = require('../../generation/shared/templateFieldSpecs');
const { buildPayloadFromForm, formStateFromData } = require('../../generation/shared/templateDataBuilder');

const buildDebugDataForTemplate = (templateId) => {
  const source = fs.readFileSync(`${__dirname}/index.js`, 'utf8');
  const match = source.match(
    /const buildDebugDataForTemplate = \(templateId\) => \{[\s\S]*?\n\};\n\nconst normalizeStoragePath/
  );
  assert.ok(match, 'debug fixture function should be present');
  const functionSource = match[0].replace(/\n\nconst normalizeStoragePath$/, '\n');
  return new vm.Script(`${functionSource}\nbuildDebugDataForTemplate;`).runInNewContext({})(templateId);
};

test('the Studio specs round-trip the existing debug fixtures', () => {
  listFieldSpecs().forEach((spec) => {
    const fixture = JSON.parse(JSON.stringify(buildDebugDataForTemplate(spec.templateId)));
    const formState = formStateFromData(spec, fixture);
    assert.deepEqual(buildPayloadFromForm(spec, formState), fixture);
  });
});

test('sanitizes a sample without changing renderer fields', () => {
  const spec = getFieldSpec('invoice.seed.beta.v1');
  const payload = buildPayloadFromForm(spec, formStateFromData(spec, spec.sample));
  assert.deepEqual(sanitizeTemplateData(spec.templateId, payload), payload);
});

test('rejects templates outside the explicit Studio allowlist', () => {
  assert.throws(
    () => sanitizeTemplateData('refdoc.bank-statement.v1', {}),
    /not allowed in Document Studio/
  );
});

test('drops theme and layout from client data', () => {
  const result = sanitizeTemplateData('invoice.seed.alpha.v1', {
    brandName: 'Safe',
    theme: { ink: 'red' },
    layout: { pageMargin: '0' },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'theme'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'layout'), false);
  assert.equal(result.brandName, 'Safe');
});

test('does not turn a blank invoiceTotal into zero', () => {
  const result = sanitizeTemplateData('invoice.seed.alpha.v1', { invoiceTotal: '' });
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'invoiceTotal'), false);
});

test('rejects prototype-polluted input and bounds rows and strings', () => {
  const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => sanitizeTemplateData('refdoc.ap-aging.v1', polluted), /Unsafe key/);

  const result = sanitizeTemplateData('refdoc.ap-aging.v1', {
    companyName: 'x'.repeat(1000),
    rows: Array.from({ length: 100 }, () => ({ vendor: 'Vendor' })),
  });
  assert.equal(result.companyName.length, 200);
  assert.equal(result.rows.length, 60);
});

test('clamps invalid numeric values and percent values', () => {
  const result = sanitizeTemplateData('invoice.seed.alpha.v1', {
    taxRate: 2,
    shipping: 1e30,
    items: [{ qty: 'Infinity', unitPrice: NaN, description: 'x' }],
  });
  assert.equal(result.taxRate, 1);
  assert.equal(result.shipping, 1e9);
  assert.deepEqual(result.items[0], { description: 'x' });
});
