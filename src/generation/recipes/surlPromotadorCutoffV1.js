import getUUID from '../../utils/getUUID';
import { AUDIT_AREAS } from '../../models/caseConstants';
import { buildSingleAnswerKey, DEFAULT_ANSWER_KEY_CLASSIFICATION } from '../../utils/caseFormHelpers';
import {
  initialDisbursement,
  initialInstruction,
  initialReferenceDocument,
} from '../../constants/caseFormDefaults';

const toMoney = (value) => Number(value || 0);

const buildDisbursement = ({ paymentId, payee, amount, paymentDate, answerKeyClassification, explanation }) => {
  const base = initialDisbursement();
  return {
    ...base,
    _tempId: getUUID(),
    paymentId,
    payee,
    amount: String(amount),
    paymentDate,
    answerKeyMode: 'single',
    answerKeySingleClassification: answerKeyClassification || DEFAULT_ANSWER_KEY_CLASSIFICATION,
    answerKey: buildSingleAnswerKey(answerKeyClassification, toMoney(amount), explanation),
    shouldFlag: ['improperlyExcluded', 'improperlyIncluded'].includes(answerKeyClassification),
  };
};

export const surlPromotadorCutoffV1 = {
  id: 'case.surl.promotador.v1',
  version: 1,
  label: 'SURL Cutoff (Generated)',
  description: 'Unrecorded liability trap with post-close disbursements and service-date cutoff.',
  moduleTitle: 'SURL',
  pathId: 'accounts_payable',
  tier: 'foundations',
  auditArea: AUDIT_AREAS.PAYABLES,
  primarySkill: 'Cutoff',
  build: ({ overrides } = {}) => {
    const seed = getUUID();
    const resolvedYearEnd =
      typeof overrides?.yearEnd === 'string' && overrides.yearEnd.trim()
        ? overrides.yearEnd.trim()
        : '20X2-12-31';
    const resolvedCaseLevel =
      typeof overrides?.caseLevel === 'string' && overrides.caseLevel.trim()
        ? overrides.caseLevel.trim()
        : 'basic';
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
      'invoice.promotador.v1',
      'invoice.endeavorr.v1',
      'invoice.glamit.v1',
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
      const fallback = invoiceTemplateIds[0] || 'invoice.promotador.v1';
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
      moduleCode: 'SURL-101',
      hook: {
        headline: 'Year-end expenses can hide in January invoices.',
        risk: 'Cutoff errors can overstate income and understate liabilities.',
        body: 'Scan supporting invoices and compare service dates to the period end.',
      },
      heuristic: {
        rule_text: 'Expenses follow the work, not the paper.',
        reminder: 'If the service happened in December, it belongs in December.',
      },
      gateCheck: {
        question:
          'An invoice is dated Jan 6 for services performed Dec 28. Which period should record the expense?',
        success_message: 'Correct. The expense belongs in December.',
        failure_message: 'Check the service date. The work happened in December.',
        options: [
          { id: 'opt1', text: 'December', correct: true, feedback: 'Match the expense to the service date.' },
          { id: 'opt2', text: 'January', correct: false, feedback: 'Invoice date does not control cutoff.' },
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

    const disbursementTargets = offsets.map((offset, index) => {
      let amount = Math.round(randomInt(800, 4200) / 5) * 5;
      while (amountSet.has(amount)) {
        amount += 5;
      }
      amountSet.add(amount);
      const invoiceCount =
        overrideInvoicesPerVendor !== null && overrideInvoicesPerVendor !== undefined
          ? overrideInvoicesPerVendor
          : rng() < 0.25
          ? 2
          : 1;
      return {
        paymentId: `P-${101 + index}`,
        payee: payees[index],
        paymentDate: addDaysPseudo(yearEnd, offset),
        amount,
        invoiceCount,
        serviceTiming: serviceTiming[index],
        trap: index === trapIndex,
      };
    });

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
          amount: target.amount + index * 5,
        }));
      }
      if (issues.some((issue) => issue.code === 'no-trap')) {
        nextTargets = nextTargets.map((target, index) =>
          index === 0 ? { ...target, serviceTiming: 'pre', trap: true } : target
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
        const serviceDate =
          target.serviceTiming === 'pre'
            ? addDaysPseudo(yearEnd, -(12 + idx * 3))
            : addDaysPseudo(yearEnd, 7 + idx * 5);
        const invoiceDate = addDaysPseudo(target.paymentDate, -(4 + idx));
        const shippingDate = addDaysPseudo(serviceDate, 2);
        const dueDate = addDaysPseudo(target.paymentDate, 26 + idx);
        const shouldInclude = shouldBeInAging(serviceDate, shippingDate);
        const isRecorded = target.trap && idx === 0 && shouldInclude ? false : shouldInclude;
        return {
          paymentId: target.paymentId,
          vendor: target.payee,
          invoiceNumber: `INV-${invoiceIndexStart + idx + 1}`,
          invoiceDate,
          serviceDate,
          shippingDate,
          dueDate,
          amount,
          isRecorded,
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

      const apAgingRows = invoiceCatalog
        .filter((invoice) => invoice.isRecorded)
        .map((invoice) => ({
          vendor: invoice.vendor,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          amount: invoice.amount,
          buckets: { current: invoice.amount, days30: 0, days60: 0, days90: 0, days90Plus: 0 },
        }));

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

      const buildDisbursementExplanation = (classification) => {
        if (classification === 'improperlyExcluded') {
          return 'Services or shipping occurred before year-end but missing from AP aging.';
        }
        if (classification === 'improperlyIncluded') {
          return 'Services or shipping occurred after year-end but were included in AP aging.';
        }
        if (classification === 'properlyIncluded') {
          return 'Services or shipping occurred before year-end and are included in AP aging.';
        }
        return 'Services and shipping occurred after year-end and are correctly excluded.';
      };

      const disbursements = targets.map((target) => {
        const invoices = invoiceCatalog.filter((invoice) => invoice.paymentId === target.paymentId);
        const total = invoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
        const classification = classifyDisbursement(invoices);
        return buildDisbursement({
          paymentId: target.paymentId,
          payee: target.payee,
          amount: total,
          paymentDate: target.paymentDate,
          answerKeyClassification: classification,
          explanation: buildDisbursementExplanation(classification),
        });
      });

      return { invoiceCatalog, apAgingRows, disbursements };
    };

    const validateCaseData = ({ targets, invoiceCatalog, apAgingRows, disbursements }) => {
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

      const apMap = new Map(apAgingRows.map((row) => [row.invoiceNumber, row]));
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
          } else if (Math.abs(Number(agingEntry.amount || 0) - Number(invoice.amount || 0)) > 0.01) {
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
    let apAgingRows = [];
    let disbursements = [];
    let lastIssues = [];

    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const built = buildCaseData(validatedTargets);
      invoiceCatalog = built.invoiceCatalog;
      apAgingRows = built.apAgingRows;
      disbursements = built.disbursements;
      lastIssues = validateCaseData({
        targets: validatedTargets,
        invoiceCatalog,
        apAgingRows,
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
        templateId === 'invoice.endeavorr.v1' ? 'Shipping Point' : 'FOB Shipping Point';
      const serviceInvoice = isServiceInvoice(invoice.vendor);
      const dateLabel = serviceInvoice ? 'Service Date' : '';
      const dateValue = serviceInvoice
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

    const apAgingData = {
      companyName: 'Team Up Promotional Products, LLC',
      asOfDate: 'December 31 20X2',
      rows: apAgingRows,
    };

    const referenceDocuments = [
      ...invoiceCatalog.map((invoice) => {
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
        fileName: 'AP Aging Summary.pdf',
        generationSpecId: null,
        generationSpec: {
          templateId: 'refdoc.ap-aging.v1',
          data: apAgingData,
        },
      },
    ];

    referenceDocuments.forEach((doc) => {
      doc.generationSpecId = doc._tempId;
    });

    return {
      caseName: `SURL Cutoff: January Disbursements (${yearEnd})`,
      auditArea: AUDIT_AREAS.PAYABLES,
      layoutType: 'two_pane',
      instruction,
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
