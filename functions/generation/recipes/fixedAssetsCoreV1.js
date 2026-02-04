const { getUUID } = require('../getUUID');
const { AUDIT_AREAS } = require('../shared/caseConstants');
const { buildSingleAnswerKey } = require('../shared/caseFormHelpers');
const {
  initialDisbursement,
  initialInstruction,
  initialReferenceDocument,
  initialFaClass,
  initialFaAddition,
} = require('../shared/caseFormDefaults');

const buildDisbursement = ({ paymentId, payee, amount, paymentDate, explanation }) => {
  const base = initialDisbursement();
  return {
    ...base,
    paymentId,
    payee,
    amount: String(amount),
    paymentDate,
    answerKeyMode: 'single',
    answerKeySingleClassification: 'properlyIncluded',
    answerKey: buildSingleAnswerKey('properlyIncluded', Number(amount), explanation),
  };
};

const buildReferenceDocument = ({ fileName, key, generationSpec, generationSpecId }) => ({
  ...initialReferenceDocument(),
  fileName,
  key,
  generationSpec,
  generationSpecId,
});

const buildFaClass = (payload) => ({
  ...initialFaClass(),
  ...payload,
});

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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const randomInt = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min;

const pickOne = (rng, list) => list[randomInt(rng, 0, list.length - 1)];

const pad2 = (value) => String(value).padStart(2, '0');

const buildPseudoYear = (baseYear, offset) => {
  const match = String(baseYear || '').match(/^20X(\d)$/);
  if (!match) return baseYear;
  const num = clamp(Number(match[1]) - offset, 0, 9);
  return `20X${num}`;
};

const buildDateInYear = (rng, yearToken) => {
  const month = randomInt(rng, 1, 12);
  const day = randomInt(rng, 1, 28);
  return `${yearToken}-${pad2(month)}-${pad2(day)}`;
};

const formatClientSlug = (value) =>
  String(value || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .trim() || 'Client';

const roundTo = (value, step = 100) => Math.round(Number(value || 0) / step) * step;

const buildInvoiceData = ({ clientName, invoiceNumber, invoiceDate, vendorName, description, amount }) => ({
  brandName: String(vendorName || '').toUpperCase(),
  invoiceNumber,
  invoiceDate,
  issuedTo: {
    name: clientName,
    line1: '2150 Riverfront Ave',
    line2: 'Denver, CO 80202',
  },
  shippingInfo: {
    dateValue: invoiceDate,
    terms: 'Net 30',
  },
  items: [
    { description: description || 'Capital asset purchase', qty: 1, unitPrice: Number(amount || 0) },
  ],
  taxRate: 0,
  shipping: 0,
});

const numberToWords = (value) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return String(value || '');
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

const formatCheckAmountNumeric = (value) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const buildCheckCopyData = ({ clientName, vendorName, amount, checkNumber, checkDate }) => ({
  payer: { name: clientName, addressLine: '2150 Riverfront Ave, Denver, CO 80202' },
  checkNumber,
  date: checkDate,
  payee: vendorName,
  amountNumeric: formatCheckAmountNumeric(amount),
  amountWords: formatCheckAmountWords(amount),
  bank: { name: 'Cascade National Bank', subName: 'Member FDIC' },
  memo: 'Capital asset purchase',
  signatureName: 'K. Ramirez',
  micr: {
    routingSymbol: 'T',
    routingNumber: '102000021',
    accountSymbol: 'A',
    accountNumber: '0004812001',
    checkNumber,
  },
});

const fixedAssetsCoreV1 = {
  id: 'case.fixed-assets.core.v1',
  version: 2,
  label: 'Fixed Assets Core (Generated)',
  description: 'PP&E rollforward tie-out, scoping, additions, disposals, and analytics.',
  moduleTitle: 'Fixed Assets',
  pathId: 'foundations',
  pathTitle: 'Foundations',
  tier: 'foundations',
  caseLevel: 'basic',
  auditArea: AUDIT_AREAS.FIXED_ASSETS,
  primarySkill: 'Fixed Assets',
  layoutType: 'fixed_assets',
  build: ({ overrides } = {}) => {
    const seed = getUUID();
    const rng = createRng(seed);
    const resolvedYearEnd =
      typeof overrides?.yearEnd === 'string' && overrides.yearEnd.trim()
        ? overrides.yearEnd.trim()
        : '20X3-12-31';
    const yearToken = resolvedYearEnd.slice(0, 4) || '20X3';
    const fiscalYearStart = `${yearToken}-01-01`;
    const fiscalYearEnd = resolvedYearEnd;
    const clientName =
      typeof overrides?.clientName === 'string' && overrides.clientName.trim()
        ? overrides.clientName.trim()
        : 'Clearwater Outfitters, Inc.';
    const documentAsOfDate = resolvedYearEnd;
    const currency = 'USD';

    const instruction = {
      ...initialInstruction(),
      title: 'Fixed Assets: Rollforward + Testing',
      moduleCode: 'FA-CORE-101',
      hook: {
        headline: 'If the rollforward does not tie, you cannot trust the population.',
        risk: 'Misstatements hide in additions and disposals when the lead schedule has plugs.',
        body: 'Tick and tie the rollforward, then scope your testing based on tolerable misstatement.',
      },
      heuristic: {
        rule_text: 'Trace TB -> rollforward -> detail with no mystery plugs before testing.',
        reminder: 'Additions and disposals should reconcile to GL activity and support.',
      },
      gateCheck: {
        question: 'A class rollforward does not foot. What should you do before selecting items to test?',
        success_message: 'Correct. Resolve the rollforward tie-out before testing.',
        failure_message: 'You cannot test a population until the rollforward ties to the books.',
        options: [
          {
            id: 'opt1',
            text: 'Pause testing and resolve the rollforward tie-out to the TB/GL.',
            correct: true,
            feedback: 'The rollforward must be complete and accurate before sampling.',
          },
          {
            id: 'opt2',
            text: 'Proceed to testing and note the tie-out issue later.',
            correct: false,
            feedback: 'Testing should not begin until the population is reconciled.',
          },
        ],
      },
    };

    const capitalizationThreshold =
      Number(overrides?.capitalizationThreshold) > 0
        ? Number(overrides.capitalizationThreshold)
        : 10000;

    const policyInputs = {
      capitalizationThreshold,
      capitalizeDirectCosts: [
        'Purchase price (net of discounts)',
        'Freight and delivery',
        'Installation and testing',
        'Direct labor to place asset in service',
      ],
      expenseExamples: [
        'Routine repairs and maintenance',
        'Training and onboarding',
        'Software subscriptions and warranties',
      ],
      depreciationStartRule: 'Placed in service / available for intended use',
      depreciationMethodDefault: 'Straight-line',
      depreciationConvention: 'Monthly',
    };

    const assetClasses = [
      { classCode: 'BLDG', className: 'Buildings', usefulLifeYears: 30, method: 'Straight-line' },
      { classCode: 'EQUIP', className: 'Equipment', usefulLifeYears: 7, method: 'Straight-line' },
      { classCode: 'VEH', className: 'Vehicles', usefulLifeYears: 5, method: 'Straight-line' },
      { classCode: 'FF&E', className: 'Furniture & Fixtures', usefulLifeYears: 7, method: 'Straight-line' },
    ];

    const vendorNames = [
      'Atlas Construction Co.',
      'Millstone Robotics',
      'Northlake Industrial',
      'Fleetline Motors',
      'Granite Supply Group',
      'Brightline Systems',
      'Summit Works',
      'Crescent Fabrication',
      'Redwood Interiors',
      'Beacon Equipment Leasing',
    ];

    const locations = [
      'Denver, CO',
      'Phoenix, AZ',
      'Cincinnati, OH',
      'Austin, TX',
      'Raleigh, NC',
      'Boise, ID',
    ];

    const descriptionsByClass = {
      BLDG: ['Warehouse build-out', 'Office expansion', 'Loading dock upgrade'],
      EQUIP: ['Automated packing line', 'CNC machining center', 'Robotic palletizer'],
      VEH: ['Delivery van', 'Forklift unit', 'Service truck'],
      'FF&E': ['Showroom fixtures', 'Conference room furniture', 'Warehouse racking'],
    };

    const glAccountsByClass = {
      BLDG: '1500 - Buildings',
      EQUIP: '1600 - Equipment',
      VEH: '1650 - Vehicles',
      'FF&E': '1700 - Furniture & Fixtures',
    };

    const costRanges = {
      BLDG: [45000, 180000],
      EQUIP: [9000, 95000],
      VEH: [20000, 70000],
      'FF&E': [4000, 35000],
    };

    const totalRowsTarget = randomInt(rng, 24, 34);
    const additionsTarget = randomInt(rng, 7, 11);

    let assetCounter = 1;
    const buildRow = ({ classInfo, isAddition }) => {
      const costRange = costRanges[classInfo.classCode] || [8000, 60000];
      const costBasis = roundTo(randomInt(rng, costRange[0], costRange[1]), 100);
      const descriptionBase = pickOne(rng, descriptionsByClass[classInfo.classCode] || ['Capital project']);
      const location = pickOne(rng, locations);
      const vendorName = pickOne(rng, vendorNames);
      const invoiceNumber = `INV-${randomInt(rng, 1000, 9999)}`;
      const invoiceDate = buildDateInYear(rng, isAddition ? yearToken : buildPseudoYear(yearToken, 1));
      const placedInServiceDate = isAddition
        ? buildDateInYear(rng, yearToken)
        : buildDateInYear(rng, buildPseudoYear(yearToken, randomInt(rng, 1, 2)));
      const assetId = `FA-${classInfo.classCode}-${String(assetCounter).padStart(3, '0')}`;
      assetCounter += 1;

      return {
        assetId,
        description: `${descriptionBase} (${location.split(',')[0]})`,
        classCode: classInfo.classCode,
        className: classInfo.className,
        location,
        vendorName,
        invoiceNumber,
        invoiceDate,
        placedInServiceDate,
        costBasis,
        status: 'active',
        disposalDate: null,
        disposalProceeds: null,
        usefulLifeYears: classInfo.usefulLifeYears,
        method: classInfo.method,
      };
    };

    const additionsRows = Array.from({ length: additionsTarget }, () => {
      const classInfo = pickOne(rng, assetClasses);
      return buildRow({ classInfo, isAddition: true });
    });
    const priorRows = Array.from({ length: totalRowsTarget - additionsTarget }, () => {
      const classInfo = pickOne(rng, assetClasses);
      return buildRow({ classInfo, isAddition: false });
    });

    const listingRows = [...additionsRows, ...priorRows].sort((a, b) => a.assetId.localeCompare(b.assetId));

    const invoiceTemplateIds = ['invoice.seed.alpha.v1', 'invoice.seed.beta.v1', 'invoice.seed.gamma.v1'];
    const pickInvoiceTemplateId = (value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) return invoiceTemplateIds[0];
      return invoiceTemplateIds[hashSeed(normalized) % invoiceTemplateIds.length];
    };

    const additionsByClass = listingRows.reduce((acc, row) => {
      if (row.status !== 'active') return acc;
      if (String(row.placedInServiceDate || '').startsWith(yearToken)) {
        acc[row.classCode] = (acc[row.classCode] || 0) + Number(row.costBasis || 0);
      }
      return acc;
    }, {});

    const boyByClass = listingRows.reduce((acc, row) => {
      if (row.status !== 'active') return acc;
      if (!String(row.placedInServiceDate || '').startsWith(yearToken)) {
        acc[row.classCode] = (acc[row.classCode] || 0) + Number(row.costBasis || 0);
      }
      return acc;
    }, {});

    const rollforwardRows = assetClasses
      .map((classInfo) => {
        const begin = boyByClass[classInfo.classCode] || 0;
        const add = additionsByClass[classInfo.classCode] || 0;
        const disp = 0;
        const end = begin + add - disp;
        if (begin === 0 && add === 0) return null;
        return {
          classCode: classInfo.classCode,
          className: classInfo.className,
          beginningBalance: begin,
          additions: add,
          disposals: disp,
          endingBalance: end,
        };
      })
      .filter(Boolean);

    const rollforwardTotals = rollforwardRows.reduce(
      (acc, row) => ({
        beginningBalance: acc.beginningBalance + Number(row.beginningBalance || 0),
        additions: acc.additions + Number(row.additions || 0),
        disposals: acc.disposals + Number(row.disposals || 0),
        endingBalance: acc.endingBalance + Number(row.endingBalance || 0),
      }),
      { beginningBalance: 0, additions: 0, disposals: 0, endingBalance: 0 }
    );

    const faSummary = rollforwardRows.map((row) =>
      buildFaClass({
        className: row.className,
        beginningBalance: String(row.beginningBalance),
        additions: String(row.additions),
        disposals: String(row.disposals),
        endingBalance: String(row.endingBalance),
      })
    );

    const additionsTotal = rollforwardTotals.additions || 0;
    const tm = Math.max(25000, roundTo(additionsTotal * 0.1, 1000));
    const weightedAverageLife = Math.round(
      assetClasses.reduce((sum, cls) => sum + Number(cls.usefulLifeYears || 0), 0) / assetClasses.length
    );

    const faRisk = {
      tolerableMisstatement: String(tm),
      capitalizationThreshold: String(capitalizationThreshold),
      weightedAverageLife: String(weightedAverageLife || 8),
      strategy: 'all_over_tm',
      sampleSize: '2',
    };

    const additionsForTesting = additionsRows.map((row) => {
      const classInfo = assetClasses.find((cls) => cls.classCode === row.classCode) || {};
      return {
        ...initialFaAddition(),
        vendor: row.vendorName,
        description: row.description,
        amount: String(row.costBasis),
        inServiceDate: row.placedInServiceDate,
        glAccount: glAccountsByClass[row.classCode] || '',
        natureOfExpenditure: 'capital_asset',
        properPeriod: 'current',
        amountThreshold: String(capitalizationThreshold),
        usefulLife: String(classInfo.usefulLifeYears || ''),
      };
    });

    const policyData = {
      clientName,
      fiscalYearStart,
      fiscalYearEnd,
      currency,
      documentAsOfDate,
      capitalizationThreshold,
      capitalizeDirectCosts: policyInputs.capitalizeDirectCosts,
      expenseExamples: policyInputs.expenseExamples,
      depreciationStartRule: policyInputs.depreciationStartRule,
      depreciationMethodDefault: policyInputs.depreciationMethodDefault,
      depreciationConvention: policyInputs.depreciationConvention,
      assetClasses: assetClasses.map((cls) => ({
        classCode: cls.classCode,
        className: cls.className,
        usefulLifeYears: cls.usefulLifeYears,
        method: cls.method,
      })),
    };

    const rollforwardData = {
      clientName,
      fiscalYearStart,
      fiscalYearEnd,
      currency,
      documentAsOfDate,
      rows: rollforwardRows,
      totals: rollforwardTotals,
      footerNote: 'Prepared from fixed asset subledger; agrees to general ledger.',
    };

    const listingData = {
      clientName,
      fiscalYearStart,
      fiscalYearEnd,
      currency,
      documentAsOfDate,
      rows: listingRows,
    };

    const clientSlug = formatClientSlug(clientName);
    const policyFileName = `${clientSlug}CapitalizationPolicy${yearToken}.pdf`;
    const rollforwardFileName = `${clientSlug}PPE_Rollforward${yearToken}.pdf`;
    const listingFileName = `${clientSlug}FixedAssetListing${yearToken}.pdf`;

    const invoiceSpecs = additionsRows.map((row, index) => {
      const templateId = pickInvoiceTemplateId(row.vendorName);
      const invoiceData = buildInvoiceData({
        clientName,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: row.invoiceDate,
        vendorName: row.vendorName,
        description: row.description,
        amount: row.costBasis,
      });
      const invoiceFileName = `${clientSlug}Invoice-${row.assetId}.pdf`;
      return {
        id: getUUID(),
        key: 'fa_invoice',
        fileName: invoiceFileName,
        generationSpec: {
          templateId,
          data: invoiceData,
          invoiceTotal: Number(row.costBasis || 0),
        },
        meta: {
          assetId: row.assetId,
          index,
        },
      };
    });

    const paymentSpecs = additionsRows.map((row, index) => {
      const checkNumber = String(5200 + index);
      const checkDate = row.invoiceDate;
      const checkFileName = `${clientSlug}CheckCopy-${row.assetId}.pdf`;
      return {
        id: getUUID(),
        key: 'fa_payment',
        fileName: checkFileName,
        generationSpec: {
          templateId: 'refdoc.check-copy.v1',
          data: buildCheckCopyData({
            clientName,
            vendorName: row.vendorName,
            amount: row.costBasis,
            checkNumber,
            checkDate,
          }),
        },
        meta: {
          assetId: row.assetId,
          index,
        },
      };
    });

    const referenceDocumentSpecs = [
      {
        id: getUUID(),
        key: 'capitalization_policy',
        fileName: policyFileName,
        generationSpec: {
          templateId: 'refdoc.fa-policy.v1',
          data: policyData,
        },
      },
      {
        id: getUUID(),
        key: 'ppe_rollforward',
        fileName: rollforwardFileName,
        generationSpec: {
          templateId: 'refdoc.ppe-rollforward.v1',
          data: rollforwardData,
        },
      },
      {
        id: getUUID(),
        key: 'fixed_asset_listing',
        fileName: listingFileName,
        generationSpec: {
          templateId: 'refdoc.fa-listing.v1',
          data: listingData,
        },
      },
      ...invoiceSpecs,
      ...paymentSpecs,
    ];

    const referenceDocuments = referenceDocumentSpecs.map((spec) =>
      buildReferenceDocument({
        fileName: spec.fileName,
        key: spec.key,
        generationSpec: spec.generationSpec,
        generationSpecId: spec.id,
      })
    );

    const disbursements = [
      buildDisbursement({
        paymentId: 'FA-BASE-01',
        payee: 'Internal Control',
        amount: 100,
        paymentDate: `${yearToken}-02-01`,
        explanation: 'Baseline disbursement to satisfy case validation requirements.',
      }),
    ];

    return {
      caseName: 'Fixed Assets Rollforward',
      auditArea: AUDIT_AREAS.FIXED_ASSETS,
      layoutType: 'fixed_assets',
      instruction,
      referenceDocuments,
      disbursements,
      faSummary,
      faRisk,
      faAdditions: additionsForTesting,
      faDisposals: [],
      generationPlan: {
        seed,
        yearEnd: resolvedYearEnd,
        caseLevel: 'basic',
        notes:
          'Reference documents are generated from templates; run the PDF generator to populate storagePath/downloadURL.',
        referenceDocumentSpecs,
      },
    };
  },
};

module.exports = { fixedAssetsCoreV1 };
