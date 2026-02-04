const { getUUID } = require('../getUUID');
const { AUDIT_AREAS } = require('../shared/caseConstants');
const { buildSingleAnswerKey, DEFAULT_ANSWER_KEY_CLASSIFICATION } = require('../shared/caseFormHelpers');
const {
  initialDisbursement,
  initialInstruction,
  initialReferenceDocument,
} = require('../shared/caseFormDefaults');

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

const surlIntermediateCutoffV1 = {
  id: 'case.surl.intermediate.v1',
  version: 1,
  label: 'SURL Intermediate Cutoff (Generated)',
  description: 'Intermediate SURL with tie-out gate, scoped selection, and allocation trap.',
  moduleTitle: 'SURL',
  pathId: 'foundations',
  pathTitle: 'Foundations',
  tier: 'foundations',
  caseLevel: 'intermediate',
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
        : 'intermediate';
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
      moduleCode: 'SURL-201',
      hook: {
        headline: 'Tie-out first, then follow the scope.',
        risk: 'If the population is wrong or the scope is ignored, real liabilities stay hidden.',
        body: 'Confirm the AP reports are usable, then select every disbursement at or above the scope threshold.',
      },
      heuristic: {
        rule_text: "You can't test a broken population, and you can't eyeball scope.",
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

    const PAYROLL_VENDOR = 'PayPilot Payroll Services';

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
      PAYROLL_VENDOR,
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
    const offsets = shuffle(Array.from({ length: 31 }, (_, idx) => 30 + idx))
      .slice(0, disbursementCount)
      .sort((a, b) => a - b);
    const amountSet = new Set();
    const serviceTiming = Array.from({ length: disbursementCount }, () =>
      rng() < 0.45 ? 'pre' : 'post'
    );
    if (!serviceTiming.includes('pre')) {
      serviceTiming[0] = 'pre';
    }
    const preIndexes = serviceTiming
      .map((value, index) => (value === 'pre' ? index : null))
      .filter((value) => value !== null);
    const trapIndex = preIndexes[randomInt(0, preIndexes.length - 1)];
    const allocationTrapIndex = (() => {
      if (preIndexes.length <= 1) return trapIndex;
      const eligible = preIndexes.filter((index) => index !== trapIndex);
      return eligible[randomInt(0, eligible.length - 1)];
    })();

    const disbursementTargets = offsets.map((offset, index) => {
      const isAllocationTrap = index === allocationTrapIndex;
      let amount = Math.round(randomInt(12000, 90000) / 25) * 25;
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
      const resolvedInvoiceCount = isAllocationTrap ? 1 : invoiceCount;
      return {
        paymentId: `P-${101 + index}`,
        payee: payees[index],
        paymentDate: addDaysPseudo(yearEnd, offset),
        amount,
        invoiceCount: resolvedInvoiceCount,
        serviceTiming: serviceTiming[index],
        trap: index === trapIndex,
        allocationTrap: isAllocationTrap,
        requiresPayrollRegister: isAllocationTrap,
      };
    });

    const allocationTrapTarget = disbursementTargets.find((target) => target.allocationTrap);
    if (allocationTrapTarget) {
      allocationTrapTarget.payee = PAYROLL_VENDOR;
      const maxAmount = Math.max(...disbursementTargets.map((target) => Number(target.amount || 0)));
      const roundTo25 = (value) => Math.round(Number(value || 0) / 25) * 25;
      const bumpAmount = Math.max(10000, maxAmount * 0.12);
      let bumped = roundTo25(maxAmount + bumpAmount);
      const currentAmount = allocationTrapTarget.amount;
      amountSet.delete(currentAmount);
      while (amountSet.has(bumped)) {
        bumped += 25;
      }
      amountSet.add(bumped);
      allocationTrapTarget.amount = bumped;
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
          });
        }
      }
      if (issues.some((issue) => issue.code === 'disbursement-count-high')) {
        nextTargets = nextTargets.slice(0, 15);
      }
      if (issues.some((issue) => issue.code === 'payment-date-window')) {
        nextTargets = nextTargets.map((target, index) => ({
          ...target,
          paymentDate: addDaysPseudo(yearEnd, 35 + index),
        }));
      }
      if (issues.some((issue) => issue.code === 'payment-date-variation')) {
        nextTargets = nextTargets.map((target, index) => ({
          ...target,
          paymentDate: addDaysPseudo(target.paymentDate, index),
        }));
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
      if (issues.some((issue) => issue.code === 'no-trap')) {
        nextTargets = nextTargets.map((target, index) =>
          index === 0 ? { ...target, serviceTiming: 'pre', trap: true } : target
        );
      }
      const allocationTarget = nextTargets.find((target) => target.allocationTrap);
      if (allocationTarget) {
        allocationTarget.payee = PAYROLL_VENDOR;
        allocationTarget.requiresPayrollRegister = true;
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

    const computeAllocationSplit = (invoice, totalAmount) => {
      if (!invoice || !yearEndDate) return null;
      const start = parseCutoffDate(invoice.servicePeriodStart);
      const end = parseCutoffDate(invoice.servicePeriodEnd);
      if (!start || !end) return null;
      const msPerDay = 1000 * 60 * 60 * 24;
      const totalDays = Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
      if (totalDays <= 0) return null;
      const cutoffEnd = new Date(Math.min(end.getTime(), yearEndDate.getTime()));
      const preDays =
        cutoffEnd.getTime() >= start.getTime()
          ? Math.round((cutoffEnd.getTime() - start.getTime()) / msPerDay) + 1
          : 0;
      const preAmount = roundMoney((Number(totalAmount || 0) * preDays) / totalDays);
      const postAmount = roundMoney(Number(totalAmount || 0) - preAmount);
      return {
        preAmount,
        postAmount,
        preDays,
        totalDays,
        startLabel: invoice.servicePeriodStart,
        endLabel: invoice.servicePeriodEnd,
      };
    };

    const buildInvoicesForTarget = (target, invoiceIndexStart) => {
      const count = Math.max(1, Number(target.invoiceCount || 1));
      const amounts = [];
      if (count === 1) {
        amounts.push(target.amount);
      } else {
        const primary = Math.round(target.amount * 0.6);
        const secondary = target.amount - primary;
        amounts.push(primary, secondary);
      }
      return amounts.map((amount, idx) => {
        const isAllocationTrap = target.allocationTrap && idx === 0;
        const servicePeriodStart = isAllocationTrap
          ? addDaysPseudo(yearEnd, -randomInt(4, 5))
          : null;
        const servicePeriodEnd = isAllocationTrap
          ? addDaysPseudo(yearEnd, randomInt(4, 10))
          : null;
        const serviceDate =
          servicePeriodStart ||
          (target.serviceTiming === 'pre'
            ? addDaysPseudo(yearEnd, -(12 + idx * 3))
            : addDaysPseudo(yearEnd, 7 + idx * 5));
        const invoiceDate = addDaysPseudo(target.paymentDate, -(4 + idx));
        const shippingDate = isAllocationTrap ? null : addDaysPseudo(serviceDate, 2);
        const dueDate = addDaysPseudo(target.paymentDate, 26 + idx);
        const shouldInclude = shouldBeInAging(serviceDate, shippingDate);
        let isRecorded = shouldInclude;
        if (target.trap && idx === 0 && shouldInclude) {
          isRecorded = false;
        } else if (target.allocationTrap && idx === 0 && shouldInclude) {
          isRecorded = true;
        }
        return {
          paymentId: target.paymentId,
          vendor: target.payee,
          invoiceNumber: `INV-${invoiceIndexStart + idx + 1}`,
          invoiceDate,
          serviceDate,
          servicePeriodStart,
          servicePeriodEnd,
          shippingDate,
          dueDate,
          amount,
          isRecorded,
          isAllocationTrap,
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
        const current = totalsByPayment.get(invoice.paymentId) || 0;
        totalsByPayment.set(invoice.paymentId, current + Number(invoice.amount || 0));
      });
      targets.forEach((target) => {
        const total = totalsByPayment.get(target.paymentId);
        if (Number.isFinite(total)) {
          target.amount = total;
        }
      });

      const allocationInvoice = invoiceCatalog.find(
        (invoice) => invoice.servicePeriodStart && invoice.servicePeriodEnd
      );
      const allocationSplit = allocationInvoice
        ? computeAllocationSplit(allocationInvoice, Number(allocationInvoice.amount || 0))
        : null;
      if (allocationInvoice && allocationSplit) {
        allocationInvoice.apAgingAmount = allocationSplit.preAmount;
      }
      const payrollRegisterFileName = allocationSplit
        ? `Payroll Register (${allocationSplit.startLabel} - ${allocationSplit.endLabel}).pdf`
        : 'Payroll Register.pdf';

      const apAgingRowsCorrected = invoiceCatalog
        .filter((invoice) => invoice.isRecorded)
        .map((invoice) => ({
          amount: Number(invoice.apAgingAmount ?? invoice.amount),
          vendor: invoice.vendor,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          buckets: {
            current: Number(invoice.apAgingAmount ?? invoice.amount),
            days30: 0,
            days60: 0,
            days90: 0,
            days90Plus: 0,
          },
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

      const buildDisbursementExplanation = ({ classification, invoices }) => {
        const yearEndLabel = yearEnd;
        const resolveDate = (invoice) => {
          if (!invoice || typeof invoice !== 'object') return { label: 'Activity date', value: '' };
          if (invoice.serviceDate) return { label: 'Service date', value: invoice.serviceDate };
          if (invoice.shippingDate) return { label: 'Shipping date', value: invoice.shippingDate };
          return { label: 'Activity date', value: '' };
        };

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
        const total = invoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
        const allocationInvoice = invoices.find((invoice) => invoice.servicePeriodStart && invoice.servicePeriodEnd);
        if (target.allocationTrap && allocationInvoice && allocationSplit) {
          const split = allocationSplit;
          if (split) {
            const explanation = `Service period ${split.startLabel} - ${split.endLabel} spans year-end. Allocate ${split.preDays}/${split.totalDays} to the pre-year-end period.`;
            return buildDisbursement({
              paymentId: target.paymentId,
              payee: target.payee,
              amount: total,
              paymentDate: target.paymentDate,
              answerKeyMode: 'split',
              answerKeyClassification: 'properlyIncluded',
              answerKey: {
                properlyIncluded: split.preAmount,
                properlyExcluded: split.postAmount,
                improperlyIncluded: 0,
                improperlyExcluded: 0,
                explanation,
              },
              shouldFlag: false,
            });
          }
        }
        const classification = classifyDisbursement(invoices);
        return buildDisbursement({
          paymentId: target.paymentId,
          payee: target.payee,
          amount: total,
          paymentDate: target.paymentDate,
          answerKeyClassification: classification,
          explanation: buildDisbursementExplanation({ classification, invoices }),
        });
      });

      return {
        invoiceCatalog,
        apAgingRowsCorrected,
        apAgingRowsMismatch,
        leadScheduleRows,
        disbursements,
        allocationInvoice,
        allocationSplit,
        payrollRegisterFileName,
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
        return daysAfter <= 0 || daysAfter < 30 || daysAfter > 60;
      });
      if (windowIssues) {
        issues.push({
          code: 'payment-date-window',
          message: 'Payment dates must be 1-2 months after year-end.',
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
        const total = invoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
        if (Math.abs(total - Number(disbursement.amount || 0)) > 0.01) {
          issues.push({
            code: 'invoice-total-mismatch',
            message: `Invoice totals do not match disbursement ${disbursement.paymentId}.`,
          });
        }
      });

      invoiceCatalog.forEach((invoice) => {
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
        if (shouldInclude && invoice.isRecorded) {
          if (!agingEntry) {
            issues.push({
              code: 'aging-missing',
              message: `Invoice ${invoice.invoiceNumber} should appear in AP aging.`,
            });
          } else if (
            Math.abs(
              Number(agingEntry.amount || 0) -
                Number(invoice.apAgingAmount ?? invoice.amount ?? 0)
            ) > 0.01
          ) {
            issues.push({
              code: 'aging-amount-mismatch',
              message: `AP aging amount mismatch for ${invoice.invoiceNumber}.`,
            });
          }
        } else if (shouldInclude && !invoice.isRecorded && !agingEntry) {
          trapCount += 1;
        } else if (!shouldInclude && agingEntry) {
          issues.push({
            code: 'aging-should-not-appear',
            message: `Invoice ${invoice.invoiceNumber} should not appear in AP aging.`,
          });
        }
      });
      if (trapCount === 0) {
        issues.push({ code: 'no-trap', message: 'No unrecorded prior-period invoices found.' });
      }
      const hasSplitAllocation = disbursements.some((item) => item?.answerKeyMode === 'split');
      if (!hasSplitAllocation) {
        issues.push({ code: 'allocation-trap-missing', message: 'No allocation split item was generated.' });
      }

      if (!invoiceCatalog.every((invoice) => invoice.invoiceNumber && invoice.vendor)) {
        issues.push({ code: 'invoice-data', message: 'Invoice data missing identifiers.' });
      }

      if (paymentDates.length !== new Set(paymentDates).size) {
        issues.push({ code: 'payment-date-variation', message: 'Payment dates are not varied.' });
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
    let allocationInvoice = null;
    let allocationSplit = null;
    let payrollRegisterFileName = 'Payroll Register.pdf';

    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const built = buildCaseData(validatedTargets);
      invoiceCatalog = built.invoiceCatalog;
      apAgingRowsCorrected = built.apAgingRowsCorrected;
      apAgingRowsMismatch = built.apAgingRowsMismatch;
      leadScheduleRows = built.leadScheduleRows;
      disbursements = built.disbursements;
      allocationInvoice = built.allocationInvoice || null;
      allocationSplit = built.allocationSplit || null;
      payrollRegisterFileName = built.payrollRegisterFileName || payrollRegisterFileName;
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

    const payrollServiceStart = allocationSplit?.startLabel || addDaysPseudo(yearEnd, -12);
    const payrollServiceEnd = allocationSplit?.endLabel || addDaysPseudo(yearEnd, 10);
    const payrollPayDate = addDaysPseudo(payrollServiceEnd, 4);
    const payrollGross = roundMoney(Number(allocationInvoice?.amount || 128940));
    const payrollEmployeeTaxes = roundMoney(payrollGross * 0.22);
    const payrollDeductions = roundMoney(payrollGross * 0.08);
    const payrollNetPay = roundMoney(payrollGross - payrollEmployeeTaxes - payrollDeductions);
    const payrollEmployerTaxes = roundMoney(payrollGross * 0.0765);
    const formatPayrollMoney = (value) =>
      Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

    const payrollRegisterData = {
      reportTitle: 'Payroll Register',
      payPeriod: `${payrollServiceStart} - ${payrollServiceEnd}`,
      reportScopeLabel: 'Company Totals',
      payDate: payrollPayDate,
      companyCode: 'TU-01',
      companyNameLine1: 'Team Up Promotional Products, LLC',
      companyNameLine2: 'Payroll Services',
      pageNumber: '1',
      pageCount: '1',
      totalHours: '1,486.50',
      totalEmployees: '42',
      totals: [
        { label: 'Gross Wages', amount: formatPayrollMoney(payrollGross) },
        { label: 'Employee Taxes Withheld', amount: formatPayrollMoney(payrollEmployeeTaxes) },
        { label: 'Deductions & Benefits', amount: formatPayrollMoney(payrollDeductions) },
        { label: 'Net Pay', amount: formatPayrollMoney(payrollNetPay) },
        { label: 'Employer Payroll Taxes', amount: formatPayrollMoney(payrollEmployerTaxes) },
      ],
      footerNote:
        'Service period spans year-end. AP aging includes the pre-year-end portion; allocate the remainder to the next period.',
    };

    const referenceDocuments = [
      ...invoiceCatalog
        .filter((invoice) => !invoice.isAllocationTrap)
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
        fileName: payrollRegisterFileName,
        generationSpecId: null,
        generationSpec: {
          templateId: 'refdoc.payroll-register.v1',
          data: payrollRegisterData,
          linkToPaymentId:
            allocationInvoice?.paymentId ||
            validatedTargets.find((target) => target.allocationTrap)?.paymentId ||
            null,
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
    ];

    referenceDocuments.forEach((doc) => {
      doc.generationSpecId = doc._tempId;
    });

    const tieOutGate = {
      enabled: true,
      skillTag: 'ca_tie_out',
      assessmentQuestion: 'Do the AP aging and AP ledger totals tie out?',
      assessmentOptions: [
        {
          id: 'assess_yes',
          text: 'Yes, they tie out.',
          correct: false,
          outcome: 'match',
          feedback: 'Double-check the totals and the report run dates before moving on.',
        },
        {
          id: 'assess_no',
          text: 'No, they do not tie out.',
          correct: true,
          outcome: 'mismatch',
          feedback: 'Good catch. Resolve the mismatch before selecting items to test.',
        },
      ],
      actionQuestion: 'You indicated the reports do not tie. What is the best next step?',
      successMessage: 'Correct. Get a corrected population before selecting items.',
      failureMessage: 'Not yet. Resolve the tie-out before you select items to test.',
      actionOptions: [
        {
          id: 'opt1',
          text: 'Proceed with selection and note the mismatch for later.',
          correct: false,
          feedback: 'You need a corrected population before you can scope testing.',
        },
        {
          id: 'opt2',
          text: 'Ask the client to correct the tie-out and rerun the reports.',
          correct: true,
          feedback: 'That is the right next step.',
        },
        {
          id: 'opt3',
          text: 'Ignore the aging and test disbursements randomly.',
          correct: false,
          feedback: 'Testing off a broken population risks missing liabilities.',
        },
      ],
      referenceDocNames: ['AP Aging Summary (Initial).pdf', 'AP Lead Schedule (GL).pdf'],
      correctedReferenceDocNames: ['AP Aging Summary (Corrected).pdf', 'AP Lead Schedule (GL).pdf'],
      requireOpenedDocs: true,
      mismatch: {
        agingTotal: sumAmounts(apAgingRowsMismatch),
        ledgerTotal: sumAmounts(leadScheduleRows),
      },
    };

    const selectionScope = {
      performanceMateriality,
      scopePercent,
      thresholdAmount,
      skillTag: 'scope_threshold',
    };

    return {
      caseName: `SURL Cutoff: January Disbursements (${yearEnd})`,
      auditArea: AUDIT_AREAS.PAYABLES,
      layoutType: 'two_pane',
      instruction,
      workpaper: {
        layoutType: 'two_pane',
        layoutConfig: { tieOutGate, selectionScope },
      },
      workflow: {
        steps: ['instruction', 'ca_check', 'selection', 'testing', 'results'],
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
        referenceDocumentSpecs: referenceDocuments.map((doc) => ({
          id: doc.generationSpecId || doc._tempId,
          fileName: doc.fileName,
          generationSpec: doc.generationSpec,
          linkToPaymentId: doc.generationSpec?.linkToPaymentId || null,
        })),
      },
    };
  },
};

module.exports = { surlIntermediateCutoffV1 };
