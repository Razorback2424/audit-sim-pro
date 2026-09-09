const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
];

const AGING_BUCKET_OPTIONS = [
  { value: 'current', label: 'Current' },
  { value: 'days30', label: '1-30' },
  { value: 'days60', label: '31-60' },
  { value: 'days90Plus', label: '90+' },
];

const textField = (key, label, options = {}) => ({
  key,
  label,
  type: 'text',
  maxLength: 200,
  ...options,
});

const numberField = (key, label, options = {}) => ({
  key,
  label,
  type: 'number',
  ...options,
});

const percentField = (key, label, options = {}) => ({
  key,
  label,
  type: 'percent',
  ...options,
});

const selectField = (key, label, options, config = {}) => ({
  key,
  label,
  type: 'select',
  options,
  ...config,
});

const invoiceFields = ({ includeDueDate = false, includeCurrency = false, includeLine3 = true } = {}) => [
  textField('brandName', 'Brand name', { required: true }),
  textField('invoiceNumber', 'Invoice number', { required: true }),
  textField('invoiceDate', 'Invoice date', { required: true }),
  textField('issuedTo.name', 'Issued to — name', { required: true }),
  textField('issuedTo.line1', 'Issued to — address line 1'),
  textField('issuedTo.line2', 'Issued to — address line 2'),
  ...(includeLine3 ? [textField('issuedTo.line3', 'Issued to — address line 3')] : []),
  textField('shippingInfo.dateLabel', 'Shipping date label'),
  textField('shippingInfo.dateValue', 'Shipping date'),
  textField('shippingInfo.terms', 'Shipping terms'),
  ...(includeDueDate ? [textField('dueDate', 'Due date')] : []),
  percentField('taxRate', 'Tax rate', { default: 5 }),
  numberField('shipping', 'Shipping', { default: 0 }),
  ...(includeCurrency
    ? [selectField('currency', 'Currency', CURRENCY_OPTIONS, { default: 'USD' })]
    : []),
];

const invoiceRows = {
  key: 'items',
  label: 'Line items',
  addLabel: 'Add line item',
  maxRows: 40,
  columns: [
    textField('description', 'Description', { required: true, maxLength: 240 }),
    numberField('qty', 'Qty', { required: true }),
    numberField('unitPrice', 'Unit price', { required: true }),
  ],
};

const invoiceControls = ({ includeThankYou = false } = {}) => [
  {
    key: 'invoiceTotal',
    label: 'Expected invoice total',
    type: 'number',
    help: 'Optional. When valid, the renderer back-solves the subtotal to this grand total.',
    passthrough: true,
  },
  ...(includeThankYou
    ? [
        selectField('showThankYou', 'Show thank-you message', [
          { value: true, label: 'Show' },
          { value: false, label: 'Hide' },
        ], { default: true, passthrough: true }),
        {
          key: 'thankYouText',
          label: 'Thank-you text',
          type: 'textarea',
          maxLength: 200,
          default: 'THANK\nYOU',
          passthrough: true,
        },
      ]
    : []),
];

const makeInvoiceSpec = ({
  templateId,
  label,
  includeDueDate = false,
  includeCurrency = false,
  includeLine3 = true,
  includeThankYou = false,
  sample,
}) => ({
  templateId,
  label,
  fields: invoiceFields({ includeDueDate, includeCurrency, includeLine3 }),
  rows: invoiceRows,
  controls: invoiceControls({ includeThankYou }),
  sample,
  computeKind: 'invoice',
});

const TEMPLATE_FIELD_SPECS = [
  makeInvoiceSpec({
    templateId: 'invoice.seed.alpha.v1',
    label: 'Alpha Invoice',
    includeCurrency: true,
    includeLine3: false,
    includeThankYou: true,
    sample: {
      brandName: 'SEED ALPHA',
      invoiceNumber: 'INV-ALPHA-001',
      invoiceDate: '20X3-01-15',
      issuedTo: {
        name: 'Team Up Promotional Products, LLC',
        line1: '2150 Riverfront Ave',
        line2: 'Denver, CO 80202',
      },
      shippingInfo: {
        dateValue: '20X3-01-12',
        terms: 'FOB Destination',
      },
      items: [
        { description: 'Marketing print run', qty: 2, unitPrice: 1250 },
        { description: 'Booth collateral set', qty: 1, unitPrice: 860 },
        { description: 'Rush design fee', qty: 1, unitPrice: 275 },
      ],
      taxRate: 0.06,
      shipping: 75,
      currency: 'USD',
      showThankYou: true,
      thankYouText: 'THANK\nYOU',
    },
  }),
  makeInvoiceSpec({
    templateId: 'invoice.seed.beta.v1',
    label: 'Beta Invoice',
    sample: {
      brandName: 'SEED BETA',
      invoiceNumber: 'INV-BETA-204',
      invoiceDate: '20X3-01-18',
      issuedTo: {
        name: 'Team Up Promotional Products, LLC',
        line1: '2150 Riverfront Ave',
        line2: 'Denver, CO 80202',
        line3: 'Accounts Payable',
      },
      shippingInfo: {
        dateValue: '20X3-01-16',
        terms: 'Net 30',
      },
      items: [
        { description: 'Vendor onboarding kit', qty: 3, unitPrice: 540 },
        { description: 'Trade show banners', qty: 2, unitPrice: 980 },
      ],
      taxRate: 0.05,
      shipping: 40,
    },
  }),
  makeInvoiceSpec({
    templateId: 'invoice.seed.gamma.v1',
    label: 'Gamma Invoice',
    includeDueDate: true,
    sample: {
      brandName: 'SEED GAMMA',
      invoiceNumber: 'INV-GAMMA-778',
      invoiceDate: '20X3-01-22',
      issuedTo: {
        name: 'Team Up Promotional Products, LLC',
        line1: '2150 Riverfront Ave',
        line2: 'Denver, CO 80202',
      },
      shippingInfo: {
        dateValue: '20X3-01-20',
        terms: 'Net 15',
      },
      items: [
        { description: 'Seasonal promo kits', qty: 4, unitPrice: 315 },
        { description: 'Creative consulting', qty: 6, unitPrice: 140 },
      ],
      taxRate: 0.045,
      shipping: 65,
    },
  }),
  {
    templateId: 'refdoc.ap-aging.v1',
    label: 'AP Aging Summary',
    fields: [
      textField('companyName', 'Company name', { required: true }),
      textField('asOfDate', 'As-of date', { required: true }),
      selectField('currency', 'Currency', CURRENCY_OPTIONS, { default: 'USD' }),
    ],
    rows: {
      key: 'rows',
      label: 'Aging rows',
      addLabel: 'Add aging row',
      maxRows: 60,
      bucketOptions: AGING_BUCKET_OPTIONS,
      columns: [
        textField('vendor', 'Vendor', { required: true }),
        textField('invoiceNumber', 'Invoice #', { required: true }),
        textField('invoiceDate', 'Invoice date'),
        textField('dueDate', 'Due date'),
        numberField('amount', 'Amount', { required: true }),
        numberField('buckets.current', 'Current'),
        numberField('buckets.days30', '1-30'),
        numberField('buckets.days60', '31-60'),
        numberField('buckets.days90Plus', '90+'),
      ],
    },
    controls: [
      {
        key: 'controlBalance',
        label: 'Control balance',
        type: 'number',
        help: 'Form-only tie-out control. It is intentionally not included in the PDF payload.',
      },
    ],
    sample: {
      companyName: 'Team Up Promotional Products, LLC',
      asOfDate: '20X3-01-31',
      currency: 'USD',
      rows: [
        {
          vendor: 'SummitDrinkware Supply',
          invoiceNumber: 'SD-2041',
          invoiceDate: '20X2-12-28',
          dueDate: '20X3-01-27',
          amount: 9445.25,
          buckets: { current: 0, days30: 9445.25, days60: 0, days90Plus: 0 },
        },
        {
          vendor: 'LogoForge Plastics',
          invoiceNumber: 'LF-1887',
          invoiceDate: '20X3-01-09',
          dueDate: '20X3-02-08',
          amount: 5812.71,
          buckets: { current: 5812.71, days30: 0, days60: 0, days90Plus: 0 },
        },
      ],
      controlBalance: 15257.96,
    },
    computeKind: 'apAging',
  },
];

const listFieldSpecs = () => TEMPLATE_FIELD_SPECS.map((spec) => spec);

const getFieldSpec = (templateId) => {
  const spec = TEMPLATE_FIELD_SPECS.find((entry) => entry.templateId === templateId);
  if (!spec) {
    throw new Error(`Unknown template field spec: ${templateId}`);
  }
  return spec;
};

module.exports = {
  AGING_BUCKET_OPTIONS,
  CURRENCY_OPTIONS,
  TEMPLATE_FIELD_SPECS,
  getFieldSpec,
  listFieldSpecs,
};
