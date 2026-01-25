import getUUID from '../../utils/getUUID';
import { AUDIT_AREAS } from '../../models/caseConstants';
import { buildSingleAnswerKey, DEFAULT_ANSWER_KEY_CLASSIFICATION } from '../../utils/caseFormHelpers';
import {
  initialDisbursement,
  initialInstruction,
  initialReferenceDocument,
} from '../../constants/caseFormDefaults';

const toMoney = (value) => Number(value || 0);

const buildDisbursement = ({
  paymentId,
  payee,
  amount,
  paymentDate,
  answerKeyMode = 'single',
  answerKeyClassification,
  answerKey,
  explanation,
  shouldFlag,
  meta,
}) => {
  const base = initialDisbursement();
  const resolvedAnswerKey =
    answerKey && typeof answerKey === 'object'
      ? answerKey
      : buildSingleAnswerKey(answerKeyClassification, toMoney(amount), explanation);
  const resolvedShouldFlag =
    typeof shouldFlag === 'boolean'
      ? shouldFlag
      : ['improperlyExcluded', 'improperlyIncluded'].includes(answerKeyClassification);
  return {
    ...base,
    _tempId: getUUID(),
    paymentId,
    payee,
    amount: String(amount),
    paymentDate,
    answerKeyMode,
    answerKeySingleClassification: answerKeyClassification || DEFAULT_ANSWER_KEY_CLASSIFICATION,
    answerKey: resolvedAnswerKey,
    shouldFlag: resolvedShouldFlag,
    meta: meta && typeof meta === 'object' ? { ...meta } : {},
  };
};

export const surlAdvancedCutoffV1 = {
  id: 'case.surl.advanced.v1',
  version: 1,
  label: 'SURL Advanced Cutoff (Generated)',
  description: 'Advanced SURL with tie-out gate, scoped selection, and allocation trap.',
  moduleTitle: 'SURL',
  pathId: 'foundations',
  pathTitle: 'Foundations',
  tier: 'advanced',
  caseLevel: 'advanced',
  auditArea: AUDIT_AREAS.PAYABLES,
  primarySkill: 'SURL',
  build: ({ overrides } = {}) => {
    const seed = getUUID();
    const resolvedYearEnd =
      typeof overrides?.yearEnd === 'string' && overrides.yearEnd.trim()
        ? overrides.yearEnd.trim()
        : '20X2-12-31';
    const resolvedCaseLevel =
      typeof overrides?.caseLevel === 'string' && overrides.caseLevel.trim()
        ? overrides.caseLevel.trim()
        : 'advanced';
    const hashSeed = (value) => {
      let hash = 2166136261;
      const str = String(value);
      for (let i = 0; i < str.length; i += 1) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    };
    const createRng = (value) => {
      let state = hashSeed(value);
      return () => {
        state += 0x6d2b79f5;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const rng = createRng(seed);
    const randomInt = (min, max) =>
      Math.floor(rng() * (max - min + 1)) + min;
    const shuffle = (list) => {
      const next = [...list];
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    };
    const invoiceTemplateIds = [
      'invoice.seed.alpha.v1',
      'invoice.seed.beta.v1',
      'invoice.seed.gamma.v1',
    ];
    const invoiceTemplateByVendor = new Map();
    const taxRateOptions = [0.045, 0.05, 0.0725, 0.0825];
    const taxRateByVendor = new Map();
    const normalizeVendor = (value) => String(value || '').trim().toLowerCase();
    const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    const formatMoneyNumber = (value) =>
      Number(value || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const numberToWords = (value) => {
      const num = Number(value || 0);
      if (!Number.isFinite(num)) return '';
      if (num === 0) return 'Zero';

      const ones = [
        '',
        'One',
        'Two',
        'Three',
        'Four',
        'Five',
        'Six',
        'Seven',
        'Eight',
        'Nine',
        'Ten',
        'Eleven',
        'Twelve',
        'Thirteen',
        'Fourteen',
        'Fifteen',
        'Sixteen',
        'Seventeen',
        'Eighteen',
        'Nineteen',
      ];
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      const toWordsUnderThousand = (n) => {
        if (n === 0) return '';
        if (n < 20) return ones[n];
        if (n < 100) {
          const whole = tens[Math.floor(n / 10)];
          const rest = ones[n % 10];
          return rest ? `${whole} ${rest}` : whole;
        }
        const hundreds = ones[Math.floor(n / 100)];
        const remainder = n % 100;
        const tail = toWordsUnderThousand(remainder);
        return tail ? `${hundreds} Hundred ${tail}` : `${hundreds} Hundred`;
      };

      const absValue = Math.floor(Math.abs(num));
      if (absValue > 999999999) return String(absValue);

      const millions = Math.floor(absValue / 1000000);
      const thousands = Math.floor((absValue % 1000000) / 1000);
      const remainder = absValue % 1000;
      const parts = [];
      if (millions) parts.push(`${toWordsUnderThousand(millions)} Million`);
      if (thousands) parts.push(`${toWordsUnderThousand(thousands)} Thousand`);
      if (remainder) parts.push(toWordsUnderThousand(remainder));
      return parts.join(' ');
    };
    const formatCheckAmountWords = (value) => {
      const abs = Math.abs(Number(value || 0));
      const dollars = Math.floor(abs);
      const cents = Math.round((abs - dollars) * 100);
      const centsLabel = String(cents).padStart(2, '0');
      const words = numberToWords(dollars) || 'Zero';
      return `${words} and ${centsLabel}/100`;
    };
    const pickInvoiceTemplateId = (vendor) => {
      const normalized = normalizeVendor(vendor);
      if (invoiceTemplateByVendor.has(normalized)) {
        return invoiceTemplateByVendor.get(normalized);
      }
      const fallback = invoiceTemplateIds[0] || 'invoice.seed.alpha.v1';
      const index = invoiceTemplateIds.length > 0
        ? hashSeed(normalized || fallback) % invoiceTemplateIds.length
        : 0;
      const templateId = invoiceTemplateIds[index] || fallback;
      invoiceTemplateByVendor.set(normalized, templateId);
      return templateId;
    };
    const getVendorTaxRate = (vendor) => {
      const normalized = normalizeVendor(vendor);
      if (taxRateByVendor.has(normalized)) {
        return taxRateByVendor.get(normalized);
      }
      const index = taxRateOptions.length > 0
        ? hashSeed(`${normalized || 'vendor'}|tax`) % taxRateOptions.length
        : 0;
      const taxRate = taxRateOptions[index] ?? 0.05;
      taxRateByVendor.set(normalized, taxRate);
      return taxRate;
    };
    const serviceDefaults = { qtyRange: [1, 6], unitRange: [65, 240], flexible: true };
    const goodsDefaults = { qtyRange: [25, 450], unitRange: [2, 55], flexible: false };
    const buildVendorCatalog = (items) =>
      items.map((item) => {
        const defaults = item.kind === 'good' ? goodsDefaults : serviceDefaults;
        const qtyRange = item.qtyRange || defaults.qtyRange;
        const unitRange = item.unitRange || defaults.unitRange;
        return {
          description: item.description,
          minQty: qtyRange[0],
          maxQty: qtyRange[1],
          minUnitPrice: unitRange[0],
          maxUnitPrice: unitRange[1],
          flexible: item.flexible ?? defaults.flexible,
          kind: item.kind,
        };
      });
    const vendorCatalogs = new Map(
      [
        [
          'BrightStitch Apparel Co.',
          buildVendorCatalog([
            { description: '5.3 oz cotton t-shirts, blank', kind: 'good', unitRange: [4, 12] },
            { description: 'Midweight fleece hoodies, blank', kind: 'good', unitRange: [16, 34] },
            { description: 'Performance polos, blank', kind: 'good', unitRange: [12, 26] },
            { description: 'Beanies, blank', kind: 'good', unitRange: [4, 11] },
            { description: 'Embroidery-ready twill caps, blank', kind: 'good', unitRange: [6, 15] },
            {
              description: 'Size run / case pack assorting fee',
              kind: 'service',
              qtyRange: [1, 4],
              unitRange: [95, 240],
            },
          ]),
        ],
        [
          'LogoForge Plastics',
          buildVendorCatalog([
            { description: 'Custom molded keychains', kind: 'good', unitRange: [1.5, 4.5] },
            { description: 'Plastic badge reels with logo insert', kind: 'good', unitRange: [2.5, 6] },
            {
              description: 'Injection-mold tooling setup',
              kind: 'service',
              qtyRange: [1, 2],
              unitRange: [650, 1800],
            },
            {
              description: 'Pantone color matching for resin',
              kind: 'service',
              qtyRange: [1, 3],
              unitRange: [85, 220],
            },
            {
              description: 'Polybagging per unit',
              kind: 'service',
              qtyRange: [50, 600],
              unitRange: [0.2, 0.6],
            },
            { description: 'Sample set (pre-production)', kind: 'good', qtyRange: [1, 4], unitRange: [18, 45] },
          ]),
        ],
        [
          'InkRiver Print & Pack',
          buildVendorCatalog([
            {
              description: 'Screen print setup fee (per color)',
              kind: 'service',
              qtyRange: [1, 4],
              unitRange: [65, 140],
            },
            {
              description: 'Screen printing on garments (per print location)',
              kind: 'service',
              qtyRange: [50, 450],
              unitRange: [2.5, 6.5],
            },
            {
              description: 'DTG printing on garments',
              kind: 'service',
              qtyRange: [30, 250],
              unitRange: [4, 9],
            },
            { description: 'Heat press application', kind: 'service', qtyRange: [40, 400], unitRange: [1.5, 4] },
            { description: 'Kitting/assembly labor', kind: 'service', qtyRange: [20, 200], unitRange: [1, 3.5] },
            { description: 'Individual polybagging', kind: 'service', qtyRange: [50, 600], unitRange: [0.25, 0.75] },
            { description: 'Proof review/rush fee', kind: 'service', qtyRange: [1, 3], unitRange: [75, 200] },
          ]),
        ],
        [
          'Pinnacle Penworks',
          buildVendorCatalog([
            { description: 'Soft-touch metal click pens with 1-color imprint', kind: 'good', unitRange: [1.4, 3.4] },
            { description: 'Plastic retractable pens with full-color imprint', kind: 'good', unitRange: [0.6, 1.6] },
            { description: 'Stylus pens with laser engraving', kind: 'good', unitRange: [1.8, 4.2] },
            { description: 'Pen refill cartridges', kind: 'good', unitRange: [0.25, 0.85] },
            { description: 'Setup charge for pad print', kind: 'service', qtyRange: [1, 3], unitRange: [45, 120] },
            { description: 'Custom ink color change fee', kind: 'service', qtyRange: [1, 3], unitRange: [30, 85] },
          ]),
        ],
        [
          'SummitDrinkware Supply',
          buildVendorCatalog([
            { description: '20 oz stainless steel tumblers', kind: 'good', unitRange: [6, 14] },
            { description: '32 oz insulated bottles', kind: 'good', unitRange: [7, 16] },
            { description: 'Ceramic mugs (11 oz)', kind: 'good', unitRange: [3.5, 8] },
            { description: 'Replacement lids', kind: 'good', unitRange: [0.9, 2.5] },
            { description: 'Laser engraving setup fee', kind: 'service', qtyRange: [1, 3], unitRange: [60, 160] },
            { description: 'Individual gift boxing', kind: 'service', qtyRange: [50, 500], unitRange: [0.4, 1.2] },
          ]),
        ],
        [
          'Evergreen Paper & Packaging',
          buildVendorCatalog([
            { description: 'Corrugated shipping boxes (standard sizes)', kind: 'good', unitRange: [1.2, 3.4] },
            { description: 'Custom printed mailer boxes', kind: 'good', unitRange: [2.6, 5.8] },
            { description: 'Packing tape (branded)', kind: 'good', unitRange: [1.1, 2.6] },
            { description: 'Kraft crinkle paper', kind: 'good', unitRange: [0.8, 2.2] },
            { description: 'Packing slip printing', kind: 'service', qtyRange: [50, 600], unitRange: [0.15, 0.5] },
            {
              description: 'Custom die-line design / packaging artwork',
              kind: 'service',
              qtyRange: [1, 3],
              unitRange: [85, 240],
            },
          ]),
        ],
        [
          'ArrowShip Logistics',
          buildVendorCatalog([
            {
              description: 'Parcel shipping charges (UPS Ground equivalent)',
              kind: 'service',
              qtyRange: [1, 10],
              unitRange: [18, 65],
            },
            { description: 'International shipping surcharge', kind: 'service', qtyRange: [1, 6], unitRange: [35, 110] },
            { description: 'Residential delivery surcharge', kind: 'service', qtyRange: [1, 8], unitRange: [12, 35] },
            { description: 'Signature required add-on', kind: 'service', qtyRange: [1, 8], unitRange: [6, 18] },
            { description: 'Freight booking/dispatch fee', kind: 'service', qtyRange: [1, 4], unitRange: [55, 160] },
            { description: 'Claims handling / documentation fee', kind: 'service', qtyRange: [1, 3], unitRange: [45, 120] },
          ]),
        ],
        [
          'Warehouse Harbor 3PL',
          buildVendorCatalog([
            { description: 'Monthly storage (per pallet)', kind: 'service', qtyRange: [5, 80], unitRange: [14, 36] },
            { description: 'Inbound receiving (per carton)', kind: 'service', qtyRange: [20, 240], unitRange: [1.1, 3.2] },
            { description: 'Pick & pack (per order)', kind: 'service', qtyRange: [20, 180], unitRange: [2.2, 5.5] },
            { description: 'Insert/kitting add-on (per unit)', kind: 'service', qtyRange: [25, 220], unitRange: [0.6, 1.8] },
            { description: 'Returns processing (per package)', kind: 'service', qtyRange: [10, 80], unitRange: [3.5, 9] },
            { description: 'Inventory cycle count', kind: 'service', qtyRange: [1, 4], unitRange: [85, 210] },
          ]),
        ],
        [
          'BadgeCraft Awards',
          buildVendorCatalog([
            { description: 'Engraved acrylic name badges', kind: 'good', unitRange: [3.5, 8] },
            { description: 'Laser-etched metal plates', kind: 'good', unitRange: [4.5, 11] },
            { description: 'Custom trophies', kind: 'good', unitRange: [28, 75] },
            { description: 'Plaques with full-color plates', kind: 'good', unitRange: [20, 55] },
            { description: 'Artwork/setup fee for engraving', kind: 'service', qtyRange: [1, 3], unitRange: [45, 120] },
            { description: 'Rush production surcharge', kind: 'service', qtyRange: [1, 4], unitRange: [35, 110] },
          ]),
        ],
        [
          'SparkPromo Creative Studio',
          buildVendorCatalog([
            { description: 'Vector logo redraw', kind: 'service', qtyRange: [1, 3], unitRange: [85, 210] },
            { description: 'Product mockup rendering', kind: 'service', qtyRange: [1, 4], unitRange: [120, 320] },
            { description: 'Prepress file prep', kind: 'service', qtyRange: [1, 6], unitRange: [60, 160] },
            { description: 'Brand guideline one-sheet creation', kind: 'service', qtyRange: [1, 3], unitRange: [180, 420] },
            { description: 'Hourly design retainer', kind: 'service', qtyRange: [4, 16], unitRange: [65, 140] },
            { description: 'Client proof revisions', kind: 'service', qtyRange: [1, 6], unitRange: [45, 120] },
          ]),
        ],
        [
          'PayPilot Payroll Services',
          buildVendorCatalog([
            { description: 'Payroll processing fee (per pay run)', kind: 'service', qtyRange: [1, 4], unitRange: [65, 180] },
            { description: 'Per-employee payroll charge', kind: 'service', qtyRange: [15, 120], unitRange: [1.2, 3.4] },
            { description: 'Federal & state tax filing', kind: 'service', qtyRange: [1, 4], unitRange: [85, 220] },
            { description: 'Year-end W-2 preparation', kind: 'service', qtyRange: [1, 3], unitRange: [120, 320] },
            { description: 'Garnishment administration fee', kind: 'service', qtyRange: [1, 4], unitRange: [30, 90] },
            { description: 'Direct deposit processing', kind: 'service', qtyRange: [15, 120], unitRange: [0.6, 1.6] },
          ]),
        ],
        [
          'BenefitBridge HR',
          buildVendorCatalog([
            { description: 'Benefits administration (monthly)', kind: 'service', qtyRange: [1, 3], unitRange: [180, 420] },
            { description: 'New hire onboarding packet setup', kind: 'service', qtyRange: [1, 6], unitRange: [85, 220] },
            { description: 'COBRA administration', kind: 'service', qtyRange: [1, 4], unitRange: [120, 320] },
            { description: 'Employee handbook review', kind: 'service', qtyRange: [1, 3], unitRange: [250, 520] },
            { description: 'HR compliance hotline', kind: 'service', qtyRange: [1, 3], unitRange: [95, 210] },
            { description: 'Open enrollment support', kind: 'service', qtyRange: [1, 4], unitRange: [140, 360] },
          ]),
        ],
        [
          'LedgerLift Accounting',
          buildVendorCatalog([
            { description: 'Monthly bookkeeping services', kind: 'service', qtyRange: [1, 3], unitRange: [420, 980] },
            { description: 'Bank/credit card reconciliations', kind: 'service', qtyRange: [1, 6], unitRange: [120, 320] },
            { description: 'Sales tax return preparation', kind: 'service', qtyRange: [1, 3], unitRange: [95, 260] },
            { description: 'Accounts payable processing', kind: 'service', qtyRange: [1, 6], unitRange: [140, 340] },
            { description: 'Month-end close package', kind: 'service', qtyRange: [1, 3], unitRange: [380, 900] },
            { description: 'Fractional controller consult', kind: 'service', qtyRange: [2, 10], unitRange: [120, 240] },
          ]),
        ],
        [
          'MetroNet Business Internet',
          buildVendorCatalog([
            { description: 'Business internet service (monthly)', kind: 'service', qtyRange: [1, 3], unitRange: [190, 420] },
            { description: 'Static IP add-on (monthly)', kind: 'service', qtyRange: [1, 3], unitRange: [15, 45] },
            { description: 'Modem/router rental (monthly)', kind: 'service', qtyRange: [1, 3], unitRange: [12, 35] },
            { description: 'Installation/activation fee', kind: 'service', qtyRange: [1, 2], unitRange: [120, 320] },
            { description: 'On-site service call', kind: 'service', qtyRange: [1, 3], unitRange: [95, 220] },
            { description: 'Managed Wi-Fi support', kind: 'service', qtyRange: [1, 3], unitRange: [85, 210] },
          ]),
        ],
        [
          'BluePeak Energy & Gas',
          buildVendorCatalog([
            { description: 'Electricity usage charges', kind: 'service', qtyRange: [1, 3], unitRange: [420, 1200] },
            { description: 'Natural gas usage charges', kind: 'service', qtyRange: [1, 3], unitRange: [260, 820] },
            { description: 'Demand charge', kind: 'service', qtyRange: [1, 2], unitRange: [180, 620] },
            { description: 'Service availability / base fee', kind: 'service', qtyRange: [1, 3], unitRange: [45, 160] },
            { description: 'Late payment fee', kind: 'service', qtyRange: [1, 2], unitRange: [25, 85] },
            { description: 'Energy audit visit', kind: 'service', qtyRange: [1, 2], unitRange: [180, 420] },
          ]),
        ],
      ].map(([name, catalog]) => [normalizeVendor(name), catalog])
    );
    const vendorLineItemCatalogs = new Map();
    const availableLineItemsByVendor = new Map();
    const randomStep = (min, max, step = 5) => {
      const start = Math.ceil(min / step);
      const end = Math.floor(max / step);
      return step * randomInt(start, end);
    };
    const fallbackCatalog = buildVendorCatalog([
      { description: 'Service line item', kind: 'service' },
    ]);
    const getVendorCatalog = (vendor) => {
      const normalized = normalizeVendor(vendor);
      return vendorCatalogs.get(normalized) || fallbackCatalog;
    };
    const isServiceOnlyVendor = (vendor) => {
      const catalog = getVendorCatalog(vendor);
      return catalog.every((item) => item.kind === 'service');
    };
    const getVendorLineItems = (vendor) => {
      const normalized = normalizeVendor(vendor);
      if (vendorLineItemCatalogs.has(normalized)) {
        return vendorLineItemCatalogs.get(normalized);
      }
      const lineItemOptions = getVendorCatalog(vendor);
      if (!availableLineItemsByVendor.has(normalized)) {
        availableLineItemsByVendor.set(normalized, shuffle([...lineItemOptions]));
      }
      const availableLineItems = availableLineItemsByVendor.get(normalized);
      const desiredSize = randomInt(3, 7);
      const catalogSize = Math.min(desiredSize, lineItemOptions.length);
      const picked = [];
      const flexibleIndex = availableLineItems.findIndex((item) => item.flexible);
      if (flexibleIndex >= 0) {
        picked.push(availableLineItems.splice(flexibleIndex, 1)[0]);
      }
      while (picked.length < catalogSize && availableLineItems.length > 0) {
        picked.push(availableLineItems.shift());
      }
      if (picked.length < catalogSize) {
        const refill = shuffle(lineItemOptions);
        while (picked.length < catalogSize && refill.length > 0) {
          picked.push(refill.pop());
        }
      }
      const pricedItems = picked.map((item) => ({
        ...item,
        unitPrice: randomStep(item.minUnitPrice, item.maxUnitPrice, 5),
      }));
      vendorLineItemCatalogs.set(normalized, pricedItems);
      return pricedItems;
    };
    const buildQuantityOptions = (minQty, maxQty, randomize = true) => {
      if (maxQty - minQty > 100 || !randomize) {
        // For large ranges, just scan linearly (greedy-ish approach: max to min)
        // or simple min to max. Let's do max to min to fill value faster.
        const options = [];
        for (let qty = maxQty; qty >= minQty; qty -= 1) {
          options.push(qty);
        }
        return options;
      }
      const options = [];
      for (let qty = minQty; qty <= maxQty; qty += 1) {
        options.push(qty);
      }
      return shuffle(options);
    };
    const solveLineItemQuantities = (items, targetTotal) => {
      const minTotals = new Array(items.length + 1).fill(0);
      const maxTotals = new Array(items.length + 1).fill(0);
      for (let i = items.length - 1; i >= 0; i -= 1) {
        minTotals[i] = minTotals[i + 1] + items[i].minQty * items[i].unitPrice;
        maxTotals[i] = maxTotals[i + 1] + items[i].maxQty * items[i].unitPrice;
      }
      if (targetTotal < minTotals[0] || targetTotal > maxTotals[0]) return null;
      
      let ops = 0;
      const MAX_OPS = 2000; // Cap computational effort per solve attempt

      const solve = (index, remaining) => {
        ops += 1;
        if (ops > MAX_OPS) return null;

        if (index === items.length) {
          return Math.abs(remaining) < 0.01 ? [] : null;
        }
        const item = items[index];
        // Don't randomize large ranges to save perf
        const qtyOptions = buildQuantityOptions(item.minQty, item.maxQty, ops < 500);
        
        for (let i = 0; i < qtyOptions.length; i += 1) {
          const qty = qtyOptions[i];
          const nextRemaining = remaining - qty * item.unitPrice;
          if (nextRemaining < minTotals[index + 1] || nextRemaining > maxTotals[index + 1]) {
            continue;
          }
          const next = solve(index + 1, nextRemaining);
          if (next) return [qty, ...next];
          if (ops > MAX_OPS) return null;
        }
        return null;
      };
      return solve(0, targetTotal);
    };
    const buildLineItemsForInvoice = (vendor, targetTotal) => {
      const catalog = getVendorLineItems(vendor);
      const maxItems = Math.min(5, catalog.length);
      const minItems = Math.min(2, maxItems);
      let best = null;
      let bestDelta = Number.POSITIVE_INFINITY;
      const maxAttempts = 10;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const count = randomInt(minItems, maxItems);
        const selection = shuffle(catalog).slice(0, count);
        if (!selection.some((item) => item.flexible)) {
          const flexibleItem = catalog.find(
            (item) => item.flexible && !selection.includes(item)
          );
          if (flexibleItem) {
            selection[0] = flexibleItem;
          }
        }
        if (selection.length < minItems) continue;
        const quantities = solveLineItemQuantities(selection, targetTotal);
        if (quantities) {
          return {
            items: selection.map((item, index) => ({
              description: item.description,
              qty: quantities[index],
              unitPrice: item.unitPrice,
            })),
            total: targetTotal,
          };
        }
        const fallbackItems = selection.map((item) => ({
          description: item.description,
          qty: randomInt(item.minQty, item.maxQty),
          unitPrice: item.unitPrice,
        }));
        const fallbackTotal = fallbackItems.reduce(
          (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
          0
        );
        const delta = Math.abs(fallbackTotal - targetTotal);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = { items: fallbackItems, total: fallbackTotal };
        }
      }
      if (best) return best;
      const fallbackItems = catalog.slice(0, Math.min(2, catalog.length)).map((item) => ({
        description: item.description,
        qty: item.minQty,
        unitPrice: item.unitPrice,
      }));
      const fallbackTotal = fallbackItems.reduce(
        (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
        0
      );
      return {
        items:
          fallbackItems.length > 0
            ? fallbackItems
            : [{ description: 'Service line item', qty: 1, unitPrice: targetTotal }],
        total: fallbackItems.length > 0 ? fallbackTotal : targetTotal,
      };
    };
    const computeLineItemSubtotal = (items) =>
      items.reduce(
        (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
        0
      );
    const computeShippingForSubtotal = (subtotal) => {
      const minRaw = Math.max(25, subtotal * 0.01);
      const maxRaw = Math.max(minRaw, subtotal * 0.035);
      const maxCap = 300;
      const min = Math.min(minRaw, maxCap);
      const max = Math.min(Math.max(maxRaw, min), maxCap);
      return randomStep(min, max, 5);
    };

    const instruction = {
      ...initialInstruction(),
      title: 'Search for Unrecorded Liabilities',
      moduleCode: 'SURL-301',
      hook: {
        headline: 'Tie-out first, then follow the scope.',
        risk: 'If the population is wrong or the scope is ignored, real liabilities stay hidden.',
        body: 'Confirm the AP reports are usable, then select every disbursement at or above the scope threshold.',
      },
      heuristic: {
        rule_text: 'You can’t test a broken population, and you can’t eyeball scope.',
        reminder: 'Tie-out first. Then select every disbursement above the threshold.',
      },
      gateCheck: {
        question:
          'A payment clears in January for work performed in December. Which period should record the expense?',
        success_message: 'Correct. The expense belongs to the year the work occurred.',
        failure_message: 'Focus on when the service happened, not when cash left.',
        options: [
          { id: 'opt1', text: 'December', correct: true, feedback: 'Match the expense to the service period.' },
          { id: 'opt2', text: 'January', correct: false, feedback: 'Cash timing does not control cutoff.' },
        ],
      },
    };

    const yearEnd = resolvedYearEnd;
    const tieOutShouldMatch = true;

    const parsePseudoDate = (value) => {
      if (!value) return null;
      const normalized = String(value).replace(/^20X/, '200');
      const parsed = new Date(normalized);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed;
    };

    const parseCutoffDate = (value) => parsePseudoDate(value);

    const formatPseudoDate = (date) => {
      const year = String(date.getFullYear());
      const yearToken = `20X${year.slice(-1)}`;
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${yearToken}-${month}-${day}`;
    };

    const addDaysPseudo = (value, days) => {
      const parsed = parsePseudoDate(value);
      if (!parsed) return value;
      const next = new Date(parsed);
      next.setDate(next.getDate() + days);
      return formatPseudoDate(next);
    };

    const yearEndDate = parseCutoffDate(yearEnd);

    const payeePool = [
      'BrightStitch Apparel Co.',
      'LogoForge Plastics',
      'InkRiver Print & Pack',
      'Pinnacle Penworks',
      'SummitDrinkware Supply',
      'Evergreen Paper & Packaging',
      'ArrowShip Logistics',
      'Warehouse Harbor 3PL',
      'BadgeCraft Awards',
      'SparkPromo Creative Studio',
      'PayPilot Payroll Services',
      'BenefitBridge HR',
      'LedgerLift Accounting',
      'MetroNet Business Internet',
      'BluePeak Energy & Gas',
    ];

    const normalizeOverrideCount = (value, min, max) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      const rounded = Math.round(parsed);
      return Math.min(Math.max(rounded, min), max);
    };

    const overrideDisbursementCount = normalizeOverrideCount(overrides?.disbursementCount, 1, 30);
    const overrideVendorCount = normalizeOverrideCount(overrides?.vendorCount, 1, payeePool.length);
    const overrideInvoicesPerVendor = normalizeOverrideCount(overrides?.invoicesPerVendor, 1, 6);

    let disbursementCount = overrideDisbursementCount ?? randomInt(10, 15);
    if (overrideVendorCount && overrideVendorCount > disbursementCount) {
      disbursementCount = overrideVendorCount;
    }

    const selectedVendors = shuffle(payeePool).slice(
      0,
      Math.min(payeePool.length, overrideVendorCount || disbursementCount)
    );
    const payees = shuffle(
      Array.from({ length: disbursementCount }, (_, idx) => selectedVendors[idx % selectedVendors.length])
    );
    const buildOffsets = (count) => {
      if (count <= 1) return [randomInt(1, 31)];
      const allDays = shuffle(Array.from({ length: 31 }, (_, idx) => 1 + idx));
      const maxDuplicateSlots = Math.min(3, count - 1);
      const duplicateSlots = maxDuplicateSlots > 0 ? randomInt(1, maxDuplicateSlots) : 0;
      const uniqueCount = Math.max(1, count - duplicateSlots);
      const uniqueDays = allDays.slice(0, uniqueCount).sort((a, b) => a - b);
      const duplicateDays = shuffle(uniqueDays).slice(0, Math.min(duplicateSlots, uniqueDays.length));
      const offsets = [...uniqueDays, ...duplicateDays];
      while (offsets.length < count) {
        offsets.push(uniqueDays[randomInt(0, uniqueDays.length - 1)]);
      }
      return offsets.sort((a, b) => a - b);
    };
    const offsets = buildOffsets(disbursementCount);
    const amountSet = new Set();
    const serviceTiming = Array.from({ length: disbursementCount }, () =>
      rng() < 0.45 ? 'pre' : 'post'
    );
    if (!serviceTiming.includes('pre')) {
      serviceTiming[0] = 'pre';
    }
    if (!serviceTiming.includes('post')) {
      serviceTiming[serviceTiming.length - 1] = 'post';
    }
    let preIndexes = serviceTiming
      .map((value, index) => (value === 'pre' ? index : null))
      .filter((value) => value !== null);
    let postIndexes = serviceTiming
      .map((value, index) => (value === 'post' ? index : null))
      .filter((value) => value !== null);
    if (preIndexes.length < 2 && postIndexes.length > 0) {
      serviceTiming[postIndexes[0]] = 'pre';
      preIndexes = serviceTiming
        .map((value, index) => (value === 'pre' ? index : null))
        .filter((value) => value !== null);
      postIndexes = serviceTiming
        .map((value, index) => (value === 'post' ? index : null))
        .filter((value) => value !== null);
    }
    if (postIndexes.length === 0 && preIndexes.length > 1) {
      const flipIndex = preIndexes[preIndexes.length - 1];
      serviceTiming[flipIndex] = 'post';
      preIndexes = serviceTiming
        .map((value, index) => (value === 'pre' ? index : null))
        .filter((value) => value !== null);
      postIndexes = serviceTiming
        .map((value, index) => (value === 'post' ? index : null))
        .filter((value) => value !== null);
    }
    const bundleIndex = preIndexes[randomInt(0, preIndexes.length - 1)];
    const remainingPre = preIndexes.filter((index) => index !== bundleIndex);
    const accrualIndex = remainingPre.length > 0
      ? remainingPre[randomInt(0, remainingPre.length - 1)]
      : bundleIndex;
    const timingIndex = postIndexes.length > 0
      ? postIndexes[randomInt(0, postIndexes.length - 1)]
      : preIndexes.find((index) => index !== bundleIndex && index !== accrualIndex) ?? bundleIndex;
    const getTrapType = (index) => {
      if (index === bundleIndex) return 'bundle';
      if (index === timingIndex) return 'timing';
      if (index === accrualIndex) return 'accrual';
      return null;
    };

    const disbursementTargets = offsets.map((offset, index) => {
      const trapType = getTrapType(index);
      const isOverscope = Boolean(trapType);
      const minAmount = isOverscope ? 75000 : 12000;
      const maxAmount = isOverscope ? 125000 : 85000;
      let amount = Math.round(randomInt(minAmount, maxAmount) / 25) * 25;
      while (amountSet.has(amount)) {
        amount += 25;
      }
      amountSet.add(amount);
      const invoiceCount =
        overrideInvoicesPerVendor !== null && overrideInvoicesPerVendor !== undefined
          ? overrideInvoicesPerVendor
          : rng() < 0.25
          ? 2
          : 1;
      const resolvedInvoiceCount =
        trapType === 'bundle'
          ? 10
          : trapType === 'accrual'
          ? 3
          : invoiceCount;
      return {
        paymentId: `P-${101 + index}`,
        payee: payees[index],
        paymentDate: addDaysPseudo(yearEnd, offset),
        amount,
        invoiceCount: resolvedInvoiceCount,
        serviceTiming: serviceTiming[index],
        trapType,
        trap: trapType === 'bundle',
      };
    });
    const overscopeTargets = disbursementTargets.filter((target) => target.trapType);
    if (overscopeTargets.length > 0) {
      const maxAmount = Math.max(...disbursementTargets.map((target) => Number(target.amount || 0)));
      const roundTo25 = (value) => Math.round(Number(value || 0) / 25) * 25;
      let bumped = roundTo25(maxAmount + 12000);
      overscopeTargets.forEach((target) => {
        const currentAmount = target.amount;
        amountSet.delete(currentAmount);
        while (amountSet.has(bumped)) {
          bumped += 25;
        }
        amountSet.add(bumped);
        target.amount = bumped;
        bumped += 5000;
      });
    }

    const normalizeTargets = (targets, issues) => {
      let nextTargets = [...targets];
      if (issues.some((issue) => issue.code === 'disbursement-count-low')) {
        const needed = 10 - nextTargets.length;
        for (let i = 0; i < needed; i += 1) {
          const base = nextTargets[nextTargets.length - 1];
          const nextId = 120 + i;
          nextTargets.push({
            ...base,
            paymentId: `P-${nextId}`,
            payee: `${base.payee} Co. ${i + 1}`,
            paymentDate: addDaysPseudo(base.paymentDate, 2 + i),
            amount: base.amount + 75 * (i + 1),
            trap: false,
            trapType: null,
          });
        }
      }
      if (issues.some((issue) => issue.code === 'disbursement-count-high')) {
        nextTargets = nextTargets.slice(0, 15);
      }
      if (issues.some((issue) => issue.code === 'payment-date-window')) {
        nextTargets = nextTargets.map((target, index) => ({
          ...target,
          paymentDate: addDaysPseudo(yearEnd, 2 + index),
        }));
      }
      if (issues.some((issue) => issue.code === 'payment-date-variation')) {
        const duplicateEvery = Math.max(3, Math.floor(nextTargets.length / 3));
        nextTargets = nextTargets.map((target, index) => {
          if (index > 0 && index % duplicateEvery === 0) {
            return { ...target, paymentDate: nextTargets[index - 1].paymentDate };
          }
          return target;
        });
      }
      if (issues.some((issue) => issue.code === 'payee-variation')) {
        const seen = new Map();
        nextTargets = nextTargets.map((target) => {
          const key = target.payee.toLowerCase();
          const count = (seen.get(key) || 0) + 1;
          seen.set(key, count);
          if (count === 1) return target;
          return { ...target, payee: `${target.payee} ${count}` };
        });
      }
      if (issues.some((issue) => issue.code === 'amount-variation')) {
        nextTargets = nextTargets.map((target, index) => ({
          ...target,
          amount: target.amount + index * 25,
        }));
      }
      if (issues.some((issue) => issue.code === 'bundle-trap-missing')) {
        nextTargets = nextTargets.map((target, index) =>
          index === 0
            ? {
                ...target,
                serviceTiming: 'pre',
                trapType: 'bundle',
                trap: true,
                invoiceCount: 10,
              }
            : target
        );
      }
      if (issues.some((issue) => issue.code === 'timing-trap-missing')) {
        nextTargets = nextTargets.map((target, index) =>
          index === 1
            ? {
                ...target,
                serviceTiming: 'post',
                trapType: 'timing',
                trap: false,
              }
            : target
        );
      }
      if (issues.some((issue) => issue.code === 'accrual-trap-missing')) {
        nextTargets = nextTargets.map((target, index) =>
          index === 2
            ? {
                ...target,
                serviceTiming: 'pre',
                trapType: 'accrual',
                trap: false,
                invoiceCount: 3,
              }
            : target
        );
      }
      return nextTargets;
    };

    const shouldBeInAging = (serviceDate, shippingDate) => {
      if (!yearEndDate) return false;
      const parsedService = parseCutoffDate(serviceDate);
      const parsedShipping = parseCutoffDate(shippingDate);
      if (!parsedService && !parsedShipping) return false;
      if (parsedService && parsedService.getTime() > yearEndDate.getTime()) return false;
      if (parsedShipping && parsedShipping.getTime() > yearEndDate.getTime()) return false;
      return true;
    };

    const splitAmountByWeights = (total, count) => {
      if (!Number.isFinite(total) || total <= 0 || count <= 1) {
        return [roundMoney(total)];
      }
      const weights = Array.from({ length: count }, () => 0.6 + rng() * 0.8);
      const sumWeights = weights.reduce((sum, w) => sum + w, 0) || 1;
      const raw = weights.map((w) => (total * w) / sumWeights);
      const rounded = raw.map((value) => roundMoney(value));
      const delta = roundMoney(total - rounded.reduce((sum, value) => sum + value, 0));
      rounded[0] = roundMoney(rounded[0] + delta);
      return rounded;
    };

    const buildInvoicesForTarget = (target, invoiceIndexStart) => {
      const trapType = target.trapType;
      if (trapType === 'bundle') {
        const count = Math.max(8, Number(target.invoiceCount || 10));
        const unrecordedIndex = randomInt(0, count - 1);
        const unrecordedAmount = roundMoney(Number(target.amount || 0) * (0.08 + rng() * 0.07));
        const remainingTotal = Math.max(0, Number(target.amount || 0) - unrecordedAmount);
        const remainingAmounts = splitAmountByWeights(remainingTotal, count - 1);
        const amounts = [];
        for (let i = 0; i < count; i += 1) {
          if (i === unrecordedIndex) {
            amounts.push(unrecordedAmount);
          } else {
            amounts.push(remainingAmounts.shift() || 0);
          }
        }
        return amounts.map((amount, idx) => {
          const serviceDate = addDaysPseudo(yearEnd, -(8 + idx * 2));
          const invoiceDate = addDaysPseudo(yearEnd, -(15 + idx));
          const shippingDate = addDaysPseudo(serviceDate, 2);
          const dueDate = addDaysPseudo(target.paymentDate, 20 + idx);
          const shouldInclude = shouldBeInAging(serviceDate, shippingDate);
          const isRecorded = idx === unrecordedIndex ? false : shouldInclude;
          return {
            paymentId: target.paymentId,
            vendor: target.payee,
            invoiceNumber: `INV-${invoiceIndexStart + idx + 1}`,
            invoiceDate,
            serviceDate,
            servicePeriodStart: null,
            servicePeriodEnd: null,
            shippingDate,
            dueDate,
            amount,
            isRecorded,
            trapType: target.trapType || null,
          };
        });
      }

      if (trapType === 'timing') {
        const amount = Number(target.amount || 0);
        const servicePeriodStart = addDaysPseudo(yearEnd, 1);
        const servicePeriodEnd = addDaysPseudo(yearEnd, 90);
        const serviceDate = servicePeriodStart;
        const invoiceDate = addDaysPseudo(yearEnd, -12);
        const shippingDate = addDaysPseudo(serviceDate, 5);
        const dueDate = addDaysPseudo(target.paymentDate, 20);
        return [
          {
            paymentId: target.paymentId,
            vendor: target.payee,
            invoiceNumber: `INV-${invoiceIndexStart + 1}`,
            invoiceDate,
            serviceDate,
            servicePeriodStart,
            servicePeriodEnd,
            shippingDate,
            dueDate,
            amount,
            isRecorded: true,
            trapType: target.trapType || null,
          },
        ];
      }

      if (trapType === 'accrual') {
        const count = Math.max(2, Number(target.invoiceCount || 3));
        const amounts = splitAmountByWeights(Number(target.amount || 0), count);
        const settlementInvoices = amounts.map((amount, idx) => {
          const serviceDate = addDaysPseudo(yearEnd, -(20 + idx * 3));
          const invoiceDate = addDaysPseudo(yearEnd, 5 + idx * 2);
          const shippingDate = addDaysPseudo(serviceDate, 2);
          const dueDate = addDaysPseudo(target.paymentDate, 15 + idx * 3);
          return {
            paymentId: target.paymentId,
            vendor: target.payee,
            invoiceNumber: `INV-${invoiceIndexStart + idx + 1}`,
            invoiceDate,
            serviceDate,
            servicePeriodStart: null,
            servicePeriodEnd: null,
            shippingDate,
            dueDate,
            amount,
            isRecorded: false,
            trapType: target.trapType || null,
          };
        });
        const settlementTotal = settlementInvoices.reduce(
          (sum, inv) => sum + Number(inv.amount || 0),
          0
        );
        const accrualEstimate = roundMoney(settlementTotal * (0.95 + rng() * 0.04));
        const estimateInvoice = {
          paymentId: target.paymentId,
          vendor: target.payee,
          invoiceNumber: `ACCR-${invoiceIndexStart + count + 1}`,
          invoiceDate: yearEnd,
          serviceDate: addDaysPseudo(yearEnd, -6),
          servicePeriodStart: null,
          servicePeriodEnd: null,
          shippingDate: null,
          dueDate: yearEnd,
          amount: accrualEstimate,
          apAgingAmount: accrualEstimate,
          isRecorded: true,
          isEstimateOnly: true,
          trapType: target.trapType || null,
        };
        return [...settlementInvoices, estimateInvoice];
      }

      const count = Math.max(1, Number(target.invoiceCount || 1));
      const amounts = count === 1
        ? [target.amount]
        : (() => {
            const primary = Math.round(target.amount * 0.6);
            const secondary = target.amount - primary;
            return [primary, secondary];
          })();
      return amounts.map((amount, idx) => {
        const serviceDate =
          target.serviceTiming === 'pre'
            ? addDaysPseudo(yearEnd, -(12 + idx * 3))
            : addDaysPseudo(yearEnd, 7 + idx * 5);
        const invoiceDate = addDaysPseudo(target.paymentDate, -(4 + idx));
        const shippingDate = addDaysPseudo(serviceDate, 2);
        const dueDate = addDaysPseudo(target.paymentDate, 26 + idx);
        const shouldInclude = shouldBeInAging(serviceDate, shippingDate);
        const isTimingTrap = target.trapType === 'timing';
        const isRecorded = isTimingTrap
          ? true
          : target.trap && idx === 0 && shouldInclude
          ? false
          : shouldInclude;
        return {
          paymentId: target.paymentId,
          vendor: target.payee,
          invoiceNumber: `INV-${invoiceIndexStart + idx + 1}`,
          invoiceDate,
          serviceDate,
          servicePeriodStart: null,
          servicePeriodEnd: null,
          shippingDate,
          dueDate,
          amount,
          isRecorded,
          trapType: target.trapType || null,
        };
      });
    };

    const buildCaseData = (targets) => {
      let invoiceIndex = 1000 + randomInt(0, 99);
      const invoiceCatalog = [];
      targets.forEach((target) => {
        const invoices = buildInvoicesForTarget(target, invoiceIndex);
        invoiceIndex += invoices.length;
        invoiceCatalog.push(...invoices);
      });
      invoiceCatalog.forEach((invoice) => {
        if (invoice.isEstimateOnly) {
          invoice.lineItems = [];
          invoice.subtotal = Number(invoice.amount || 0);
          invoice.taxRate = 0;
          invoice.shipping = 0;
          return;
        }
        const lineItemsResult = buildLineItemsForInvoice(
          invoice.vendor,
          Number(invoice.amount || 0)
        );
        const lineItems = lineItemsResult.items;
        const subtotal = computeLineItemSubtotal(lineItems);
        const taxRate = getVendorTaxRate(invoice.vendor);
        const shipping = computeShippingForSubtotal(subtotal);
        const total = roundMoney(subtotal + subtotal * taxRate + shipping);
        invoice.lineItems = lineItems;
        invoice.subtotal = subtotal;
        invoice.taxRate = taxRate;
        invoice.shipping = shipping;
        invoice.amount = total;
      });
      const totalsByPayment = new Map();
      invoiceCatalog.forEach((invoice) => {
        if (invoice.isEstimateOnly) return;
        const current = totalsByPayment.get(invoice.paymentId) || 0;
        totalsByPayment.set(invoice.paymentId, current + Number(invoice.amount || 0));
      });
      targets.forEach((target) => {
        const total = totalsByPayment.get(target.paymentId);
        if (Number.isFinite(total)) {
          target.amount = total;
        }
      });

      const apAgingRowsCorrected = invoiceCatalog
        .filter((invoice) => invoice.isRecorded)
        .map((invoice) => ({
          vendor: invoice.vendor,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          amount: invoice.amount,
          buckets: { current: invoice.amount, days30: 0, days60: 0, days90: 0, days90Plus: 0 },
        }));

      const computeAgingTotal = (rows = []) =>
        rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

      const apAgingTotal = computeAgingTotal(apAgingRowsCorrected);
      const apAgingRowsMismatch = (() => {
        if (apAgingRowsCorrected.length === 0) return [];
        const largestIndex = apAgingRowsCorrected.reduce(
          (best, row, index) =>
            Number(row.amount || 0) > Number(apAgingRowsCorrected[best].amount || 0) ? index : best,
          0
        );
        const deltaRaw = apAgingTotal * (0.02 + rng() * 0.06);
        const minDelta = Math.min(5000, apAgingTotal * 0.05);
        const maxDelta = Math.max(minDelta, apAgingTotal * 0.15);
        const delta = roundMoney(Math.min(maxDelta, Math.max(minDelta, deltaRaw)));
        return apAgingRowsCorrected.map((row, index) => {
          if (index !== largestIndex) return { ...row };
          const nextAmount = Math.max(0, roundMoney(Number(row.amount || 0) - delta));
          return {
            ...row,
            amount: nextAmount,
            buckets: { current: nextAmount, days30: 0, days60: 0, days90: 0, days90Plus: 0 },
          };
        });
      })();
      const apAgingRowsInitial = tieOutShouldMatch
        ? apAgingRowsCorrected.map((row) => ({
            ...row,
            buckets: { ...(row.buckets || {}) },
          }))
        : apAgingRowsMismatch;

      const leadScheduleRows = [
        {
          vendor: 'Accounts Payable - Trade',
          invoiceNumber: 'GL-AP',
          invoiceDate: yearEnd,
          dueDate: yearEnd,
          amount: apAgingTotal,
          buckets: { current: apAgingTotal, days30: 0, days60: 0, days90: 0, days90Plus: 0 },
        },
      ];

      const classifyDisbursement = (invoices) => {
        const hasPriorPeriod = invoices.some((inv) =>
          shouldBeInAging(inv.serviceDate, inv.shippingDate)
        );
        const hasUnrecordedPrior = invoices.some(
          (inv) => shouldBeInAging(inv.serviceDate, inv.shippingDate) && !inv.isRecorded
        );
        const hasImproperInclusion = invoices.some(
          (inv) => !shouldBeInAging(inv.serviceDate, inv.shippingDate) && inv.isRecorded
        );
        if (hasUnrecordedPrior) return 'improperlyExcluded';
        if (hasImproperInclusion) return 'improperlyIncluded';
        if (hasPriorPeriod) return 'properlyIncluded';
        return 'properlyExcluded';
      };

      const formatMoney = (value) =>
        Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

      const buildDisbursementExplanation = ({ classification, invoices, trapType, meta }) => {
        const yearEndLabel = yearEnd;
        const resolveDate = (invoice) => {
          if (!invoice || typeof invoice !== 'object') return { label: 'Activity date', value: '' };
          if (invoice.serviceDate) return { label: 'Service date', value: invoice.serviceDate };
          if (invoice.shippingDate) return { label: 'Shipping date', value: invoice.shippingDate };
          return { label: 'Activity date', value: '' };
        };

        if (trapType === 'bundle') {
          const missingInvoice = invoices.find(
            (inv) => shouldBeInAging(inv.serviceDate, inv.shippingDate) && !inv.isRecorded
          );
          const { label, value } = resolveDate(missingInvoice);
          const missingAmount = Number(missingInvoice?.amount || 0);
          return `Bundled payment includes ${invoices.length} invoices. ${label} ${value || 'before year-end'} was before ${yearEndLabel}, but invoice ${missingInvoice?.invoiceNumber || ''} was missing from AP aging. Accrue ${formatMoney(missingAmount)}.`;
        }
        if (trapType === 'timing') {
          const invoice = invoices[0] || null;
          const serviceLabel =
            invoice?.servicePeriodStart && invoice?.servicePeriodEnd
              ? `${invoice.servicePeriodStart} - ${invoice.servicePeriodEnd}`
              : invoice?.serviceDate || '';
          return `Invoice dated ${invoice?.invoiceDate || 'before year-end'} covers ${serviceLabel || 'a future period'} after ${yearEndLabel}, but it was accrued. This should be excluded from year-end liabilities.`;
        }
        if (trapType === 'accrual') {
          const estimateAmount = Number(meta?.accrualEstimate || 0);
          const settlementTotal = Number(meta?.settlementTotal || 0);
          return `Year-end accrual of ${formatMoney(estimateAmount)} was recorded for this obligation. The later invoices total ${formatMoney(settlementTotal)}, which is within a reasonable estimate range, so no adjustment is needed.`;
        }

        const pickInvoice = (predicate) => invoices.find(predicate) || invoices[0] || null;
        if (classification === 'improperlyExcluded') {
          const invoice = pickInvoice((inv) => shouldBeInAging(inv.serviceDate, inv.shippingDate) && !inv.isRecorded);
          const { label, value } = resolveDate(invoice);
          return `${label} ${value || 'before year-end'} was before ${yearEndLabel}, but the invoice was missing from AP aging.`;
        }
        if (classification === 'improperlyIncluded') {
          const invoice = pickInvoice((inv) => !shouldBeInAging(inv.serviceDate, inv.shippingDate) && inv.isRecorded);
          const { label, value } = resolveDate(invoice);
          return `${label} ${value || 'after year-end'} was after ${yearEndLabel}, but the invoice was included in AP aging.`;
        }
        if (classification === 'properlyIncluded') {
          const invoice = pickInvoice((inv) => shouldBeInAging(inv.serviceDate, inv.shippingDate) && inv.isRecorded);
          const { label, value } = resolveDate(invoice);
          return `${label} ${value || 'before year-end'} was before ${yearEndLabel}, and the invoice appears in AP aging.`;
        }
        const invoice = pickInvoice((inv) => !shouldBeInAging(inv.serviceDate, inv.shippingDate) && !inv.isRecorded);
        const { label, value } = resolveDate(invoice);
        return `${label} ${value || 'after year-end'} was after ${yearEndLabel}, so it was correctly excluded from AP aging.`;
      };

      const disbursements = targets.map((target) => {
        const invoices = invoiceCatalog.filter((invoice) => invoice.paymentId === target.paymentId);
        const settlementInvoices = invoices.filter((invoice) => !invoice.isEstimateOnly);
        const total = settlementInvoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
        if (target.trapType === 'bundle') {
          const recordedTotal = invoices
            .filter((inv) => shouldBeInAging(inv.serviceDate, inv.shippingDate) && inv.isRecorded)
            .reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
          const missingTotal = invoices
            .filter((inv) => shouldBeInAging(inv.serviceDate, inv.shippingDate) && !inv.isRecorded)
            .reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
          const explanation = buildDisbursementExplanation({
            classification: 'improperlyExcluded',
            invoices,
            trapType: 'bundle',
          });
          return buildDisbursement({
            paymentId: target.paymentId,
            payee: target.payee,
            amount: total,
            paymentDate: target.paymentDate,
            answerKeyMode: 'split',
            answerKeyClassification: 'improperlyExcluded',
            answerKey: {
              properlyIncluded: roundMoney(recordedTotal),
              properlyExcluded: 0,
              improperlyIncluded: 0,
              improperlyExcluded: roundMoney(missingTotal),
              explanation,
            },
            shouldFlag: true,
            meta: { trapType: 'bundle', bundleInvoiceCount: invoices.length },
          });
        }
        const classification =
          target.trapType === 'timing'
            ? 'improperlyIncluded'
            : target.trapType === 'accrual'
            ? 'properlyIncluded'
            : classifyDisbursement(invoices);
        const accrualEstimateInvoice =
          target.trapType === 'accrual'
            ? invoices.find((inv) => inv.isEstimateOnly)
            : null;
        const accrualEstimate =
          target.trapType === 'accrual' ? Number(accrualEstimateInvoice?.amount || 0) : null;
        const meta =
          target.trapType === 'accrual'
            ? { trapType: 'accrual', accrualEstimate, settlementTotal: total }
            : target.trapType === 'timing'
            ? { trapType: 'timing' }
            : {};
        return buildDisbursement({
          paymentId: target.paymentId,
          payee: target.payee,
          amount: total,
          paymentDate: target.paymentDate,
          answerKeyClassification: classification,
          explanation: buildDisbursementExplanation({
            classification,
            invoices,
            trapType: target.trapType,
            meta,
          }),
          meta,
        });
      });

      return {
        invoiceCatalog,
        apAgingRowsCorrected,
        apAgingRowsMismatch: apAgingRowsInitial,
        leadScheduleRows,
        disbursements,
      };
    };

    const validateCaseData = ({ targets, invoiceCatalog, apAgingRowsCorrected, disbursements }) => {
      const issues = [];
      if (disbursements.length < 10) {
        issues.push({ code: 'disbursement-count-low', message: 'Fewer than 10 disbursements generated.' });
      }
      if (disbursements.length > 15) {
        issues.push({ code: 'disbursement-count-high', message: 'More than 15 disbursements generated.' });
      }

      const paymentDates = targets.map((target) => target.paymentDate);
      const payeeSet = new Set(targets.map((target) => target.payee));
      const amountSet = new Set(targets.map((target) => target.amount));
      if (payeeSet.size < Math.min(targets.length, 8)) {
        issues.push({ code: 'payee-variation', message: 'Insufficient payee variation.' });
      }
      if (amountSet.size < Math.min(targets.length, 8)) {
        issues.push({ code: 'amount-variation', message: 'Insufficient amount variation.' });
      }

      const windowIssues = targets.some((target) => {
        const parsed = parsePseudoDate(target.paymentDate);
        if (!parsed || !yearEndDate) return true;
        const daysAfter = Math.round((parsed - yearEndDate) / (1000 * 60 * 60 * 24));
        return daysAfter <= 0 || daysAfter > 31;
      });
      if (windowIssues) {
        issues.push({
          code: 'payment-date-window',
          message: 'Payment dates must fall in January after year-end.',
        });
      }

      disbursements.forEach((disbursement) => {
        const invoices = invoiceCatalog.filter((inv) => inv.paymentId === disbursement.paymentId);
        if (invoices.length === 0) {
          issues.push({
            code: 'missing-invoices',
            message: `No invoices mapped to ${disbursement.paymentId}.`,
          });
          return;
        }
        const total = invoices
          .filter((inv) => !inv.isEstimateOnly)
          .reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
        if (Math.abs(total - Number(disbursement.amount || 0)) > 0.01) {
          issues.push({
            code: 'invoice-total-mismatch',
            message: `Invoice totals do not match disbursement ${disbursement.paymentId}.`,
          });
        }
      });

      invoiceCatalog.forEach((invoice) => {
        if (invoice.isEstimateOnly) return;
        const items = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
        if (items.length === 0) {
          issues.push({
            code: 'invoice-items-missing',
            message: `Invoice ${invoice.invoiceNumber} has no line items.`,
          });
          return;
        }
        const subtotal = computeLineItemSubtotal(items);
        const taxRate = Number(invoice.taxRate ?? 0);
        const shipping = Number(invoice.shipping ?? 0);
        const computedTotal = roundMoney(subtotal + subtotal * taxRate + shipping);
        if (!Number.isFinite(taxRate) || taxRate <= 0) {
          issues.push({
            code: 'invoice-tax-missing',
            message: `Invoice ${invoice.invoiceNumber} missing tax rate.`,
          });
        }
        if (!Number.isFinite(shipping) || shipping < 0) {
          issues.push({
            code: 'invoice-shipping-missing',
            message: `Invoice ${invoice.invoiceNumber} missing shipping amount.`,
          });
        }
        if (Math.abs(computedTotal - Number(invoice.amount || 0)) > 0.01) {
          issues.push({
            code: 'invoice-charge-mismatch',
            message: `Invoice totals do not match subtotal, tax, and shipping for ${invoice.invoiceNumber}.`,
          });
        }
      });

      const apMap = new Map(apAgingRowsCorrected.map((row) => [row.invoiceNumber, row]));
      let trapCount = 0;
      invoiceCatalog.forEach((invoice) => {
        const shouldInclude = shouldBeInAging(invoice.serviceDate, invoice.shippingDate);
        const agingEntry = apMap.get(invoice.invoiceNumber);
        const isTimingTrap = invoice.trapType === 'timing';
        if (shouldInclude && invoice.isRecorded) {
          if (!agingEntry) {
            issues.push({
              code: 'aging-missing',
              message: `Invoice ${invoice.invoiceNumber} should appear in AP aging.`,
            });
          } else if (Math.abs(Number(agingEntry.amount || 0) - Number(invoice.amount || 0)) > 0.01) {
            issues.push({
              code: 'aging-amount-mismatch',
              message: `AP aging amount mismatch for ${invoice.invoiceNumber}.`,
            });
          }
        } else if (shouldInclude && !invoice.isRecorded && !agingEntry) {
          trapCount += 1;
        } else if (!shouldInclude && agingEntry && !isTimingTrap) {
          issues.push({
            code: 'aging-should-not-appear',
            message: `Invoice ${invoice.invoiceNumber} should not appear in AP aging.`,
          });
        }
      });
      if (trapCount === 0) {
        issues.push({ code: 'bundle-trap-missing', message: 'No bundled unrecorded invoice found.' });
      }
      const hasBundle = targets.some((target) => target.trapType === 'bundle');
      if (!hasBundle) {
        issues.push({ code: 'bundle-trap-missing', message: 'Bundle trap is missing.' });
      }
      const hasTiming = targets.some((target) => target.trapType === 'timing');
      if (!hasTiming) {
        issues.push({ code: 'timing-trap-missing', message: 'Timing misconception trap is missing.' });
      }
      const hasAccrual = targets.some((target) => target.trapType === 'accrual');
      if (!hasAccrual) {
        issues.push({ code: 'accrual-trap-missing', message: 'Accrual settlement trap is missing.' });
      }
      const hasSplitAllocation = disbursements.some(
        (item) => item?.answerKeyMode === 'split' && item?.meta?.trapType === 'bundle'
      );
      if (!hasSplitAllocation) {
        issues.push({ code: 'bundle-split-missing', message: 'Bundled payment split was not generated.' });
      }

      if (!invoiceCatalog.every((invoice) => invoice.invoiceNumber && invoice.vendor)) {
        issues.push({ code: 'invoice-data', message: 'Invoice data missing identifiers.' });
      }

      if (paymentDates.length === new Set(paymentDates).size) {
        issues.push({
          code: 'payment-date-variation',
          message: 'Payment dates should include multiple disbursements on the same day.',
        });
      }

      return issues;
    };

    let validatedTargets = disbursementTargets;
    let invoiceCatalog = [];
    let apAgingRowsCorrected = [];
    let apAgingRowsMismatch = [];
    let leadScheduleRows = [];
    let disbursements = [];
    let lastIssues = [];

    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const built = buildCaseData(validatedTargets);
      invoiceCatalog = built.invoiceCatalog;
      apAgingRowsCorrected = built.apAgingRowsCorrected;
      apAgingRowsMismatch = built.apAgingRowsMismatch;
      leadScheduleRows = built.leadScheduleRows;
      disbursements = built.disbursements;
      lastIssues = validateCaseData({
        targets: validatedTargets,
        invoiceCatalog,
        apAgingRowsCorrected,
        disbursements,
      });
      if (lastIssues.length === 0) break;
      validatedTargets = normalizeTargets(validatedTargets, lastIssues);
    }

    if (lastIssues.length > 0) {
      throw new Error(
        `Case generation failed validation after ${maxAttempts} attempts: ${lastIssues
          .map((i) => i.message)
          .join(' ')}`
      );
    }

    const computeInvoiceTotal = (data) => {
      const items = Array.isArray(data?.items) ? data.items : [];
      const subtotal = items.reduce(
        (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
        0
      );
      const tax = subtotal * Number(data?.taxRate || 0);
      const shipping = Number(data?.shipping || 0);
      return roundMoney(subtotal + tax + shipping);
    };

    const isServiceInvoice = (vendor) => isServiceOnlyVendor(vendor);
    const buildServiceDateValue = (startDate) => {
      if (!startDate) return '';
      if (rng() < 0.55) {
        return startDate;
      }
      const endDate = addDaysPseudo(startDate, randomInt(1, 7));
      return `${startDate} - ${endDate}`;
    };
    const buildInvoiceData = (invoice, templateId) => {
      const lineItems =
        Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0
          ? invoice.lineItems
          : buildLineItemsForInvoice(invoice.vendor, Number(invoice.amount || 0)).items;
      const subtotal = computeLineItemSubtotal(lineItems);
      const taxRate = Number.isFinite(invoice.taxRate)
        ? invoice.taxRate
        : getVendorTaxRate(invoice.vendor);
      const shipping = Number.isFinite(invoice.shipping)
        ? invoice.shipping
        : computeShippingForSubtotal(subtotal);
      const shippingTerms =
        templateId === 'invoice.seed.beta.v1' ? 'Shipping Point' : 'FOB Shipping Point';
      const serviceInvoice = isServiceInvoice(invoice.vendor);
      const servicePeriodLabel =
        invoice.servicePeriodStart && invoice.servicePeriodEnd
          ? `${invoice.servicePeriodStart} - ${invoice.servicePeriodEnd}`
          : '';
      const dateLabel = servicePeriodLabel
        ? 'Service Period'
        : serviceInvoice
        ? 'Service Date'
        : '';
      const dateValue = servicePeriodLabel
        ? servicePeriodLabel
        : serviceInvoice
        ? buildServiceDateValue(invoice.serviceDate || invoice.shippingDate || invoice.invoiceDate)
        : invoice.shippingDate;
      const data = {
        brandName: invoice.vendor.toUpperCase(),
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate || invoice.invoiceDate,
        issuedTo: {
          name: 'Team Up Promotional Products, LLC',
          line1: '123 Anywhere St.',
          line2: 'Fake City, WA 97650',
        },
        shippingInfo: {
          dateShipped: dateValue,
          dateLabel,
          dateValue,
          terms: shippingTerms,
        },
        items: lineItems,
        taxRate,
        shipping,
        showThankYou: true,
        thankYouText: 'THANK\nYOU',
      };
      data.invoiceTotal = computeInvoiceTotal(data);
      return data;
    };

    const sumAmounts = (list) =>
      list.reduce((sum, item) => sum + Number(item?.amount || 0), 0);

    const disbursementTotal = sumAmounts(disbursements);
    const minScopePercent = 0.1;
    const maxScopePercent = 0.15;
    const scopePercent = minScopePercent + rng() * (maxScopePercent - minScopePercent);
    const sortedAmounts = disbursements
      .map((item) => Number(item?.amount || 0))
      .filter((amount) => Number.isFinite(amount) && amount > 0)
      .sort((a, b) => b - a);
    const minRequired = 3;
    const maxRequired = 7;
    const targetRequired = Math.min(
      sortedAmounts.length,
      Math.max(minRequired, randomInt(minRequired, maxRequired))
    );
    const roundDownThousand = (value) => Math.floor(Number(value || 0) / 1000) * 1000;
    const amountsSet = new Set(sortedAmounts.map((amount) => roundMoney(amount)));
    const normalizeThreshold = (value) => {
      let next = roundDownThousand(value);
      if (!Number.isFinite(next) || next <= 0) return 0;
      while (amountsSet.has(next) && next > 0) {
        next = roundDownThousand(next - 1000);
      }
      return next;
    };

    let thresholdAmount = normalizeThreshold(sortedAmounts[targetRequired - 1] || 0);
    const countAboveThreshold = (threshold) =>
      disbursements.filter((item) => Number(item?.amount || 0) >= threshold).length;

    if (thresholdAmount <= 0) {
      thresholdAmount = normalizeThreshold(sortedAmounts[0] || 0);
    }

    let overscopeCount = countAboveThreshold(thresholdAmount);
    while (overscopeCount > maxRequired) {
      thresholdAmount = roundDownThousand(thresholdAmount + 1000);
      overscopeCount = countAboveThreshold(thresholdAmount);
    }
    while (overscopeCount < minRequired && thresholdAmount > 0) {
      thresholdAmount = normalizeThreshold(thresholdAmount - 1000);
      overscopeCount = countAboveThreshold(thresholdAmount);
    }
    while (amountsSet.has(thresholdAmount) && thresholdAmount > 0) {
      const nextHigher = roundDownThousand(thresholdAmount + 1000);
      const higherCount = countAboveThreshold(nextHigher);
      if (higherCount >= minRequired) {
        thresholdAmount = nextHigher;
        overscopeCount = higherCount;
        continue;
      }
      const nextLower = normalizeThreshold(thresholdAmount - 1000);
      if (nextLower <= 0) break;
      thresholdAmount = nextLower;
      overscopeCount = countAboveThreshold(thresholdAmount);
    }

    const performanceMateriality = roundMoney(
      thresholdAmount > 0 ? thresholdAmount / scopePercent : disbursementTotal * 0.25
    );

    const accrualTolerance = roundMoney((performanceMateriality / 0.75) * 0.05);
    const formatMoney = (value) =>
      Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    if (Number.isFinite(accrualTolerance) && accrualTolerance > 0) {
      const estimateInvoice = invoiceCatalog.find((invoice) => invoice.isEstimateOnly);
      if (estimateInvoice) {
        const settlementTotal = invoiceCatalog
          .filter(
            (invoice) =>
              invoice.paymentId === estimateInvoice.paymentId && !invoice.isEstimateOnly
          )
          .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
        const accrualRng = createRng(`${seed}|accrual-estimate`);
        const variance = roundMoney((0.2 + accrualRng() * 0.6) * accrualTolerance);
        const sign = accrualRng() < 0.5 ? -1 : 1;
        const currentEstimate = Number(estimateInvoice.amount || 0);
        let nextEstimate = roundMoney(settlementTotal + sign * variance);
        if (nextEstimate <= 0) {
          nextEstimate = roundMoney(settlementTotal + Math.abs(variance));
        }
        const delta = roundMoney(nextEstimate - currentEstimate);
        if (Math.abs(delta) > 0.01) {
          estimateInvoice.amount = nextEstimate;
          estimateInvoice.apAgingAmount = nextEstimate;
          estimateInvoice.subtotal = nextEstimate;
          const updateAgingRows = (rows) =>
            rows.map((row) => {
              if (row.invoiceNumber !== estimateInvoice.invoiceNumber) return row;
              const nextAmount = roundMoney(Number(row.amount || 0) + delta);
              return {
                ...row,
                amount: nextAmount,
                buckets: { current: nextAmount, days30: 0, days60: 0, days90: 0, days90Plus: 0 },
              };
            });
          apAgingRowsCorrected = updateAgingRows(apAgingRowsCorrected);
          apAgingRowsMismatch = updateAgingRows(apAgingRowsMismatch);
          leadScheduleRows = leadScheduleRows.map((row) => {
            if (row.invoiceNumber !== 'GL-AP') return row;
            const nextAmount = roundMoney(Number(row.amount || 0) + delta);
            return {
              ...row,
              amount: nextAmount,
              buckets: { current: nextAmount, days30: 0, days60: 0, days90: 0, days90Plus: 0 },
            };
          });
          disbursements = disbursements.map((item) => {
            if (!item || item.paymentId !== estimateInvoice.paymentId) return item;
            const nextMeta = {
              ...(item.meta || {}),
              trapType: 'accrual',
              accrualEstimate: nextEstimate,
              settlementTotal,
            };
            const explanation =
              `Year-end accrual of ${formatMoney(nextEstimate)} was recorded for this obligation. ` +
              `The later invoices total ${formatMoney(settlementTotal)}, which is within a reasonable estimate range, ` +
              'so no adjustment is needed.';
            const nextAnswerKey =
              item.answerKey && typeof item.answerKey === 'object'
                ? { ...item.answerKey, explanation }
                : item.answerKey;
            return {
              ...item,
              meta: nextMeta,
              answerKey: nextAnswerKey,
            };
          });
        }
      }
    }

    const apAgingMismatchData = {
      companyName: 'Team Up Promotional Products, LLC',
      asOfDate: 'December 31 20X2',
      rows: apAgingRowsMismatch,
    };

    const apAgingCorrectedData = {
      companyName: 'Team Up Promotional Products, LLC',
      asOfDate: 'December 31 20X2',
      rows: apAgingRowsCorrected,
    };

    const apAgingTotalForLead = sumAmounts(apAgingRowsCorrected);
    const priorBalanceRatio = 0.85 + rng() * 0.3;
    const priorBalance = roundMoney(Math.max(0, apAgingTotalForLead * priorBalanceRatio));
    const apLeadScheduleData = {
      clientName: 'Team Up Promotional Products, LLC',
      workpaperTitle: 'AP Lead Schedule (GL)',
      periodEnding: 'December 31 20X2',
      trialBalanceName: 'Trial Balance',
      currentDate: 'December 31 20X2',
      priorDate: 'December 31 20X1',
      lines: leadScheduleRows.map((row) => ({
        account: '2000',
        description: row.vendor || 'Accounts Payable - Trade',
        priorAmount: priorBalance,
        unadjAmount: row.amount,
        finalAmount: row.amount,
      })),
      total: {
        prior_amount: priorBalance,
        unadj_amount: sumAmounts(leadScheduleRows),
        final_amount: sumAmounts(leadScheduleRows),
      },
    };

    const periodLabel = (() => {
      const token = String(yearEnd).slice(0, 4);
      const yearDigit = Number(token.slice(-1));
      const nextToken = Number.isFinite(yearDigit) ? `20X${yearDigit + 1}` : token;
      return `January ${nextToken}`;
    })();
    const statementRng = createRng(`${seed}|statement`);
    const statementRandomInt = (min, max) =>
      Math.floor(statementRng() * (max - min + 1)) + min;
    const statementShuffle = (list) => {
      const next = [...list];
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(statementRng() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    };
    const sortedDisbursementRows = disbursements
      .map((item) => ({
        paymentId: item.paymentId,
        payee: item.payee,
        paymentDate: item.paymentDate,
        amount: Number(item.amount || 0),
      }))
      .sort((a, b) => {
        const dateA = parsePseudoDate(a.paymentDate);
        const dateB = parsePseudoDate(b.paymentDate);
        if (dateA && dateB) return dateA - dateB;
        return String(a.paymentDate || '').localeCompare(String(b.paymentDate || ''));
      });
    const checkStart = 10420 + randomInt(8, 80);
    const disbursementRowsWithChecks = sortedDisbursementRows.map((row, index) => {
      const selector = hashSeed(`${seed}|paymentType|${row.paymentId || index}`) % 10;
      const paymentType = selector < 6 ? 'Check' : selector < 9 ? 'ACH' : 'Wire';
      return {
        ...row,
        paymentType,
        checkNumber: '',
      };
    });
    let electronicIndices = disbursementRowsWithChecks
      .map((row, index) => (row.paymentType === 'Check' ? null : index))
      .filter((value) => value !== null);
    let checkIndices = disbursementRowsWithChecks
      .map((row, index) => (row.paymentType === 'Check' ? index : null))
      .filter((value) => value !== null);
    if (electronicIndices.length === 0 && disbursementRowsWithChecks.length > 0) {
      const fallbackIndex = Math.max(0, disbursementRowsWithChecks.length - 1);
      disbursementRowsWithChecks[fallbackIndex] = {
        ...disbursementRowsWithChecks[fallbackIndex],
        paymentType: 'ACH',
        checkNumber: '',
      };
      electronicIndices = [fallbackIndex];
      checkIndices = disbursementRowsWithChecks
        .map((row, index) => (row.paymentType === 'Check' ? index : null))
        .filter((value) => value !== null);
    }
    const canUseCheckGap = checkIndices.length >= 2;
    const canUseElectronicGap = electronicIndices.length > 0;
    const gapScenario = (() => {
      if (canUseCheckGap && canUseElectronicGap) return rng() < 0.5 ? 'check-gap' : 'missing-electronic';
      if (canUseCheckGap) return 'check-gap';
      if (canUseElectronicGap) return 'missing-electronic';
      return 'missing-electronic';
    })();
    const checkGapIndex =
      gapScenario === 'check-gap' && checkIndices.length >= 2
        ? randomInt(1, checkIndices.length - 1)
        : null;
    let checkCounter = 0;
    disbursementRowsWithChecks.forEach((row) => {
      if (row.paymentType !== 'Check') return;
      const gapOffset = checkGapIndex !== null && checkCounter >= checkGapIndex ? 1 : 0;
      row.checkNumber = String(checkStart + checkCounter + gapOffset);
      checkCounter += 1;
    });
    const missingCheckNumber =
      gapScenario === 'check-gap' && checkGapIndex !== null ? String(checkStart + checkGapIndex) : null;
    const missingIndex =
      gapScenario === 'missing-electronic' && electronicIndices.length > 0
        ? electronicIndices[randomInt(0, electronicIndices.length - 1)]
        : null;
    const listingRows = disbursementRowsWithChecks.map(({ paymentId, ...rest }) => rest);
    const disbursementListingRowsInitial =
      missingIndex !== null ? listingRows.filter((_row, index) => index !== missingIndex) : listingRows;
    const disbursementListingRowsCorrected = listingRows;
    const disbursementListingInitialData = {
      companyName: 'Team Up Promotional Products, LLC',
      periodLabel,
      rows: disbursementListingRowsInitial,
    };
    const disbursementListingCorrectedData = {
      companyName: 'Team Up Promotional Products, LLC',
      periodLabel,
      rows: disbursementListingRowsCorrected,
    };
    const outstandingCheckCount =
      checkIndices.length >= 4 ? 2 : checkIndices.length >= 2 ? 1 : 0;
    const outstandingCheckIndices = new Set(
      statementShuffle(checkIndices).slice(0, outstandingCheckCount)
    );
    const clearedDisbursementRows = disbursementRowsWithChecks.filter((row, index) => {
      if (row.paymentType !== 'Check') return true;
      return !outstandingCheckIndices.has(index);
    });
    const priorPeriodCheckCount = 1 + statementRandomInt(0, 1);
    const usedCheckNumbers = new Set(
      disbursementRowsWithChecks
        .filter((row) => row.paymentType === 'Check' && row.checkNumber)
        .map((row) => Number(row.checkNumber))
    );
    let priorCheckNumber = checkStart - statementRandomInt(25, 90);
    const priorPayees = statementShuffle(payeePool).slice(0, priorPeriodCheckCount);
    const priorPeriodChecks = Array.from({ length: priorPeriodCheckCount }, (_value, idx) => {
      while (usedCheckNumbers.has(priorCheckNumber) || priorCheckNumber <= 0) {
        priorCheckNumber -= 1;
      }
      const clearedDate = addDaysPseudo(yearEnd, statementRandomInt(2, 27));
      const checkDate = addDaysPseudo(yearEnd, -statementRandomInt(5, 55));
      const amount = roundMoney(statementRandomInt(1200, 45000) / 25 * 25);
      const payee = priorPayees[idx] || `Vendor ${idx + 1}`;
      const checkNumber = String(priorCheckNumber);
      usedCheckNumbers.add(priorCheckNumber);
      priorCheckNumber -= statementRandomInt(1, 6);
      return {
        checkNumber,
        payee,
        amount,
        clearedDate,
        checkDate,
      };
    });
    const resolveClearedDate = (paymentDate) => {
      const parsed = parsePseudoDate(paymentDate);
      if (!parsed) return paymentDate;
      const day = parsed.getDate();
      const delay = statementRandomInt(0, 6);
      if (day + delay > 28) return paymentDate;
      return addDaysPseudo(paymentDate, delay);
    };
    const bankStatementDebitRows = [
      ...clearedDisbursementRows.map((row) => {
        const base = {
          date: row.paymentType === 'Check' ? resolveClearedDate(row.paymentDate) : row.paymentDate,
          reference: row.paymentId,
          amount: -Number(row.amount || 0),
          payee: row.payee,
        };
        if (row.paymentType === 'Check') {
          return {
            ...base,
            description: `Check ${row.checkNumber} ${row.payee}`,
            checkNumber: row.checkNumber,
          };
        }
        const prefix = row.paymentType === 'Wire' ? 'Wire' : 'ACH';
        return {
          ...base,
          description: `${prefix} ${row.payee}`,
        };
      }),
      ...priorPeriodChecks.map((check) => ({
        date: check.clearedDate,
        reference: `CHK-${check.checkNumber}`,
        amount: -Number(check.amount || 0),
        payee: check.payee,
        description: `Check ${check.checkNumber} ${check.payee}`,
        checkNumber: check.checkNumber,
      })),
    ];

    // Add a few realistic credits so the statement isn't "No credits this period."
    // Keep these independent of the SURL disbursement population.
    const creditCount = 2 + randomInt(0, 2); // 2–4 credits
    const creditStartOffset = randomInt(2, 8);
    const creditRows = Array.from({ length: creditCount }, (_v, idx) => {
      const creditDate = addDaysPseudo(yearEnd, creditStartOffset + idx * randomInt(4, 9));
      const creditAmount = roundMoney(randomInt(18000, 62000) / 25 * 25);
      const refNo = `DEP-${randomInt(4100, 9800)}`;
      const descriptions = [
        'ACH Credit - Customer Deposit',
        'Wire Received - Client Payment',
        'Remote Deposit - Checks',
        'ACH Credit - Merchant Settlement',
      ];
      const description = descriptions[hashSeed(`${seed}|credit|${idx}`) % descriptions.length];
      return {
        date: creditDate,
        description,
        reference: refNo,
        amount: Number(creditAmount),
      };
    });

    // Combine and sort rows by date so debits/credits interleave naturally.
    const bankStatementRows = [...bankStatementDebitRows, ...creditRows].sort((a, b) => {
      const dateA = parsePseudoDate(a.date);
      const dateB = parsePseudoDate(b.date);
      if (dateA && dateB) return dateA - dateB;
      return String(a.date || '').localeCompare(String(b.date || ''));
    });

    const totalDebits = bankStatementRows.reduce(
      (sum, row) => sum + (Number(row.amount || 0) < 0 ? Math.abs(Number(row.amount || 0)) : 0),
      0
    );
    const totalCredits = bankStatementRows.reduce(
      (sum, row) => sum + (Number(row.amount || 0) > 0 ? Number(row.amount || 0) : 0),
      0
    );

    // Opening balance should be large enough to cover debits with a cushion.
    // Include credits in the cushion so the ending balance doesn't go negative.
    const openingBalance = roundMoney(Math.max(25000, (totalDebits - totalCredits) * (1.15 + rng() * 0.35)));

    const bankName = 'Cascade National Bank';
    const accountName = 'Team Up Promotional Products, LLC';
    const accountNumber = '*** 4812';
    const buildCheckCopyData = ({ checkNumber, date, payee, amount, memo }) => ({
      payer: {
        name: accountName,
        addressLine: '2150 Riverfront Ave, Denver, CO 80202',
      },
      checkNumber,
      date,
      payee,
      amountNumeric: formatMoneyNumber(amount),
      amountWords: formatCheckAmountWords(amount),
      bank: {
        name: bankName,
        subName: 'Member FDIC',
      },
      memo: memo || 'A/P Disbursement',
      signatureName: 'K. Ramirez',
      micr: {
        routingSymbol: 'T',
        routingNumber: '102000021',
        accountSymbol: 'A',
        accountNumber: '0004812001',
        checkNumber,
      },
    });

    // Build "canceled check pages" from check payments only.
    const clearedCheckRows = clearedDisbursementRows.filter((row) => row.paymentType === 'Check');
    const canceledCheckRows = [
      ...clearedCheckRows.map((row) => ({
        checkNumber: row.checkNumber,
        date: row.paymentDate,
        amount: Number(row.amount || 0),
        payee: row.payee,
        memo: 'A/P Disbursement',
      })),
      ...priorPeriodChecks.map((check) => ({
        checkNumber: check.checkNumber,
        date: check.checkDate,
        amount: Number(check.amount || 0),
        payee: check.payee,
        memo: 'Prior period check',
      })),
    ];
    const checksPerPage = 6;
    const canceledCheckPages = [];
    for (let i = 0; i < canceledCheckRows.length; i += checksPerPage) {
      const slice = canceledCheckRows.slice(i, i + checksPerPage);
      canceledCheckPages.push({
        checks: slice.map((row) => ({
          ...buildCheckCopyData(row),
          amount: Number(row.amount || 0),
          // imageUrl intentionally omitted for now; the PDF template can fallback to text.
          // imageUrl: '...'
        })),
      });
    }

    const bankStatementData = {
      bankName,
      accountName,
      accountNumber,
      periodLabel,
      openingBalance,
      rows: bankStatementRows,
      // Ensure the PDF template stacks debits then credits vertically (default), but keep explicit.
      layout: { txLayout: 'stacked' },
      canceledCheckPages,
    };
    const voidedCheckDoc = (() => {
      if (!missingCheckNumber) return null;
      const voidedAmount = roundMoney(statementRandomInt(800, 24000) / 25 * 25);
      return {
        ...initialReferenceDocument(),
        _tempId: getUUID(),
        fileName: `Voided Check ${missingCheckNumber}.pdf`,
        generationSpecId: null,
        generationSpec: {
          templateId: 'refdoc.check-copy.v1',
          data: {
            payer: {
              name: accountName,
              addressLine: '2150 Riverfront Ave, Denver, CO 80202',
            },
            checkNumber: missingCheckNumber,
            date: addDaysPseudo(yearEnd, statementRandomInt(3, 18)),
            payee: statementShuffle(payeePool)[0] || 'Vendor',
            amountNumeric: formatMoneyNumber(voidedAmount),
            amountWords: formatCheckAmountWords(voidedAmount),
            bank: {
              name: bankName,
              subName: 'Member FDIC',
            },
            memo: 'VOID - Check canceled',
            signatureName: 'K. Ramirez',
            micr: {
              routingSymbol: 'T',
              routingNumber: '102000021',
              accountSymbol: 'A',
              accountNumber: '0004812001',
              checkNumber: missingCheckNumber,
            },
          },
        },
      };
    })();
    const checkCopySpecs = disbursementRowsWithChecks
      .filter((row) => row.paymentType === 'Check' && row.checkNumber)
      .map((row) => {
        const amountValue = Number(row.amount || 0);
        const checkNumber = row.checkNumber || row.paymentId;
        const data = buildCheckCopyData({
          checkNumber,
          date: row.paymentDate,
          payee: row.payee,
          amount: amountValue,
        });
        return {
          id: getUUID(),
          fileName: `Check Copy ${checkNumber}.pdf`,
          generationSpec: {
            templateId: 'refdoc.check-copy.v1',
            data,
            linkToPaymentId: row.paymentId,
          },
          linkToPaymentId: row.paymentId,
          phaseId: 'step2',
          internalOnly: true,
        };
      });
    const referenceDocuments = [
      ...invoiceCatalog
        .filter((invoice) => !invoice.isEstimateOnly)
        .map((invoice) => {
        const templateId = pickInvoiceTemplateId(invoice.vendor);
        const data = buildInvoiceData(invoice, templateId);
        return {
          ...initialReferenceDocument(),
          _tempId: getUUID(),
          fileName: `${invoice.vendor} Invoice ${invoice.invoiceNumber}.pdf`,
          generationSpecId: null,
          generationSpec: {
            templateId,
            data,
            invoiceTotal: data.invoiceTotal,
            serviceDate: invoice.serviceDate,
            shippingDate: invoice.shippingDate,
            linkToPaymentId: invoice.paymentId,
            isRecorded: invoice.isRecorded,
          },
        };
      }),
      {
        ...initialReferenceDocument(),
        _tempId: getUUID(),
        fileName: 'AP Aging Summary (Initial).pdf',
        generationSpecId: null,
        generationSpec: {
          templateId: 'refdoc.ap-aging.v1',
          data: apAgingMismatchData,
        },
      },
      {
        ...initialReferenceDocument(),
        _tempId: getUUID(),
        fileName: 'January Disbursements Listing (Initial).pdf',
        generationSpecId: null,
        generationSpec: {
          templateId: 'refdoc.disbursement-listing.v1',
          data: disbursementListingInitialData,
        },
      },
      {
        ...initialReferenceDocument(),
        _tempId: getUUID(),
        fileName: 'January Bank Statement.pdf',
        generationSpecId: null,
        generationSpec: {
          templateId: 'refdoc.bank-statement.v1',
          data: bankStatementData,
        },
      },
      {
        ...initialReferenceDocument(),
        _tempId: getUUID(),
        fileName: 'AP Lead Schedule (GL).pdf',
        generationSpecId: null,
        generationSpec: {
          templateId: 'refdoc.ap-leadsheet.v1',
          data: apLeadScheduleData,
        },
      },
      {
        ...initialReferenceDocument(),
        _tempId: getUUID(),
        fileName: 'AP Aging Summary (Corrected).pdf',
        generationSpecId: null,
        generationSpec: {
          templateId: 'refdoc.ap-aging.v1',
          data: apAgingCorrectedData,
        },
      },
      ...(gapScenario === 'missing-electronic'
        ? [
            {
              ...initialReferenceDocument(),
              _tempId: getUUID(),
              fileName: 'January Disbursements Listing (Corrected).pdf',
              generationSpecId: null,
              generationSpec: {
                templateId: 'refdoc.disbursement-listing.v1',
                data: disbursementListingCorrectedData,
              },
            },
          ]
        : []),
      ...(voidedCheckDoc ? [voidedCheckDoc] : []),
    ];

    referenceDocuments.forEach((doc) => {
      doc.generationSpecId = doc._tempId;
    });

    const tieOutGate = {
      enabled: true,
      skillTag: 'ca_tie_out',
      stepTitle: 'AP Aging C&A',
      description: 'Confirm the AP aging ties to the ledger before you evaluate the population.',
      assessmentQuestion: 'Do the AP aging and AP ledger totals tie out?',
      assessmentOptions: [
        {
          id: 'assess_yes',
          text: 'Yes, they tie out.',
          correct: true,
          outcome: 'match',
          feedback: 'Totals tie out. Move on to population completeness.',
        },
        {
          id: 'assess_no',
          text: 'No, they do not tie out.',
          correct: false,
          outcome: 'mismatch',
          feedback: 'Re-check the totals before moving on.',
        },
      ],
      passedMessage: 'Tie-out complete. Continue to the completeness check.',
      referenceDocNames: ['AP Aging Summary (Initial).pdf', 'AP Lead Schedule (GL).pdf'],
      correctedReferenceDocNames: ['AP Aging Summary (Corrected).pdf', 'AP Lead Schedule (GL).pdf'],
      requireOpenedDocs: true,
      mismatch: {
        agingTotal: sumAmounts(apAgingRowsMismatch),
        ledgerTotal: sumAmounts(leadScheduleRows),
      },
    };

    const completenessReferenceDocNames = [
      'January Disbursements Listing (Initial).pdf',
      'January Bank Statement.pdf',
    ];
    const voidedCheckFileName = voidedCheckDoc?.fileName || null;
    const completenessCorrectedReferenceDocNames =
      gapScenario === 'check-gap'
        ? voidedCheckFileName
          ? [voidedCheckFileName]
          : []
        : ['January Disbursements Listing (Corrected).pdf', 'January Bank Statement.pdf'];
    const isCheckGapScenario = gapScenario === 'check-gap';

    const completenessActionOptions = isCheckGapScenario
      ? [
          {
            id: 'opt1',
            text: 'There is a gap in the check sequence, and the client supported it with a voided check copy.',
            correct: true,
            feedback: 'Exactly. The gap is explained by a voided check, so the listing is complete.',
          },
          {
            id: 'opt2',
            text: 'The bank statement shows an ACH/wire that is missing from the listing.',
            correct: false,
            feedback: 'That would indicate a missing electronic payment, not a check gap.',
          },
          {
            id: 'opt3',
            text: 'The listing looks like it is filtered to checks only.',
            correct: false,
            feedback: 'Possible, but the evidence here is a specific check-number gap.',
          },
          {
            id: 'opt4',
            text: 'The totals do not tie, so the listing must be incomplete.',
            correct: false,
            feedback: 'Totals can tie even when the sequence shows a gap.',
          },
        ]
      : [
          {
            id: 'opt1',
            text: 'The bank statement shows an ACH/wire that is missing from the listing.',
            correct: true,
            feedback: 'Correct. The electronic payment is on the bank statement but not on the listing.',
          },
          {
            id: 'opt2',
            text: 'There is a gap in the check sequence, and the client supported it with a voided check copy.',
            correct: false,
            feedback: 'That would explain a check gap, not a missing electronic payment.',
          },
          {
            id: 'opt3',
            text: 'The listing includes only payments above the scope threshold.',
            correct: false,
            feedback: 'Scope thresholds come after completeness. The population should be full.',
          },
          {
            id: 'opt4',
            text: 'The bank statement has prior-period checks clearing in January.',
            correct: false,
            feedback: 'Those explain statement-only items, not a missing electronic payment.',
          },
        ];

    const completenessGate = {
      enabled: true,
      skillTag: 'ca_completeness',
      stepTitle: 'Disbursement Listing C&A',
      description:
        'Validate the January disbursement listing against the bank statement before you select items to test.',
      assessmentQuestion: 'Does the January disbursement listing appear complete?',
      assessmentOptions: [
        {
          id: 'assess_yes',
          text: 'Yes, the listing looks complete.',
          correct: false,
          outcome: 'match',
          feedback: 'Look for gaps or missing activity compared to the bank statement.',
        },
        {
          id: 'assess_no',
          text: 'No, it looks incomplete.',
          correct: true,
          outcome: 'incomplete',
          feedback: 'Good catch. Identify the right response.',
        },
      ],
      actionQuestion: 'What exactly did you see that made you answer that way?',
      successMessage: isCheckGapScenario
        ? 'Correct. You identified the check-number gap and the supporting void evidence.'
        : 'Correct. You spotted the missing electronic payment on the bank statement.',
      failureMessage: 'Not yet. Point to the specific evidence that makes the listing incomplete.',
      actionOptions: completenessActionOptions,
      passedMessage: isCheckGapScenario
        ? 'Disbursement listing C&A complete. Void documentation explains the gap.'
        : 'Disbursement listing C&A complete. Use the corrected disbursement listing for selection.',
      includeAllReferenceDocs: true,
      referenceDocNames: completenessReferenceDocNames,
      correctedReferenceDocNames: completenessCorrectedReferenceDocNames,
      requireOpenedDocs: true,
    };

    const selectionScope = {
      performanceMateriality,
      scopePercent,
      thresholdAmount,
      skillTag: 'scope_threshold',
      lockOnPass: true,
    };
    const step2DocNames = new Set([
      'AP Aging Summary (Initial).pdf',
      'AP Lead Schedule (GL).pdf',
      'AP Aging Summary (Corrected).pdf',
      'January Disbursements Listing (Initial).pdf',
      'January Disbursements Listing (Corrected).pdf',
      'January Bank Statement.pdf',
    ]);
    const referenceSpecs = referenceDocuments.map((doc) => ({
      id: doc.generationSpecId || doc._tempId,
      fileName: doc.fileName,
      generationSpec: doc.generationSpec,
      linkToPaymentId: doc.generationSpec?.linkToPaymentId || null,
      phaseId: step2DocNames.has(doc.fileName) ? 'step2' : 'step3',
    }));
    const generationSpecs = [...referenceSpecs, ...checkCopySpecs];

    return {
      caseName: `SURL Cutoff: January Disbursements (${yearEnd})`,
      auditArea: AUDIT_AREAS.PAYABLES,
      layoutType: 'two_pane',
      instruction,
      workpaper: {
        layoutType: 'two_pane',
        layoutConfig: { tieOutGate, completenessGate, selectionScope },
      },
      workflow: {
        steps: ['instruction', 'ca_check', 'ca_completeness', 'selection', 'testing', 'results'],
        gateScope: 'per_attempt',
      },
      disbursements,
      referenceDocuments,
      generationPlan: {
        seed,
        yearEnd,
        caseLevel: resolvedCaseLevel,
        overrides: {
          disbursementCount: overrideDisbursementCount ?? null,
          vendorCount: overrideVendorCount ?? null,
          invoicesPerVendor: overrideInvoicesPerVendor ?? null,
        },
        notes:
          'Reference documents are generated from templates; run the PDF generator to populate storagePath/downloadURL.',
        phases: [
          { id: 'step2', label: 'C&A gates' },
          { id: 'step3', label: 'Selection + testing' },
        ],
        referenceDocumentSpecs: generationSpecs,
      },
    };
  },
};
