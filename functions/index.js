// functions/index.js
const functions = require('firebase-functions/v1');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { getTemplateRenderer } = require('./pdfTemplates');
const { assertNoFieldValueInArrays } = require('./utils/firestoreGuards');
const { buildCaseDraftFromRecipe } = require('./generation/buildCaseDraft');
const { getCaseRecipe } = require('./generation/recipeRegistry');
const Stripe = require('stripe');

// Initialize Firebase Admin SDK
// This is typically done automatically when deploying to Cloud Functions.
// For local testing, you might need: admin.initializeApp({ credential: admin.credential.applicationDefault() });
admin.initializeApp();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecretKey ? Stripe(stripeSecretKey) : null;
const STRIPE_PRICE_INDIVIDUAL = process.env.STRIPE_PRICE_INDIVIDUAL || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const DEFAULT_APP_ID = process.env.APP_ID || 'auditsim-pro-default-dev';

const ANSWER_TOLERANCE = 0.01;

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

const resolveAppId = (data) => toOptionalString(data?.appId) || DEFAULT_APP_ID;
const resolveBaseUrl = (data) => toOptionalString(data?.baseUrl) || APP_BASE_URL;

const resolveStripePrice = (plan) => {
  const normalized = typeof plan === 'string' ? plan.trim().toLowerCase() : 'individual';
  if (normalized === 'individual') return STRIPE_PRICE_INDIVIDUAL;
  return '';
};

const buildBillingPath = (appIdValue, uid) => `artifacts/${appIdValue}/users/${uid}/billing`;
const buildStripeEventPath = (appIdValue, eventId) =>
  `artifacts/${appIdValue}/billing/stripe_events/${eventId}`;
const buildStripeCustomerPath = (appIdValue, customerId) =>
  `artifacts/${appIdValue}/billing/stripe_customers/${customerId}`;
const buildStripePaymentIntentPath = (appIdValue, paymentIntentId) =>
  `artifacts/${appIdValue}/billing/stripe_payment_intents/${paymentIntentId}`;
const buildAnalyticsEventsCollection = (appIdValue) =>
  `artifacts/${appIdValue}/private/data/analytics_events`;

const normalizeEventType = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const recordStripeEvent = async ({ firestore, appIdValue, event }) => {
  if (!event?.id) return { alreadyProcessed: false };
  const eventRef = firestore.doc(buildStripeEventPath(appIdValue, event.id));
  return firestore.runTransaction(async (txn) => {
    const snap = await txn.get(eventRef);
    if (snap.exists) {
      return { alreadyProcessed: true };
    }
    txn.set(
      eventRef,
      {
        eventId: event.id,
        type: event.type || null,
        livemode: event.livemode === true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { alreadyProcessed: false };
  });
};

const resolveBillingIdentityFromStripe = async ({ firestore, appIdValue, customerId, paymentIntentId }) => {
  if (paymentIntentId) {
    const intentRef = firestore.doc(buildStripePaymentIntentPath(appIdValue, paymentIntentId));
    const intentSnap = await intentRef.get();
    if (intentSnap.exists) {
      const data = intentSnap.data() || {};
      if (data.uid) {
        return { uid: data.uid, appIdValue: data.appId || appIdValue };
      }
    }
  }
  if (customerId) {
    const customerRef = firestore.doc(buildStripeCustomerPath(appIdValue, customerId));
    const customerSnap = await customerRef.get();
    if (customerSnap.exists) {
      const data = customerSnap.data() || {};
      if (data.uid) {
        return { uid: data.uid, appIdValue: data.appId || appIdValue };
      }
    }
  }
  return { uid: null, appIdValue };
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const resolveInstruction = ({ recipeDetails, draftInstruction, recipeVersion }) => {
  if (recipeDetails?.instruction && typeof recipeDetails.instruction === 'object') {
    return { ...recipeDetails.instruction, version: recipeVersion };
  }
  return { ...draftInstruction, version: recipeVersion };
};

const resolveWorkflow = ({ recipeDetails, draft }) => {
  const fallback = draft?.workflow;
  const fallbackSteps = Array.isArray(fallback?.steps) ? fallback.steps : [];
  const candidate = recipeDetails?.workflow;
  const candidateSteps = Array.isArray(candidate?.steps) ? candidate.steps : [];

  if (candidateSteps.length > 0) {
    if (fallbackSteps.includes('ca_check') && !candidateSteps.includes('ca_check')) {
      return fallback;
    }
    if (fallbackSteps.includes('ca_completeness') && !candidateSteps.includes('ca_completeness')) {
      return fallback;
    }
    return candidate;
  }

  if (fallbackSteps.length > 0) {
    return fallback;
  }

  return { steps: ['instruction', 'selection', 'testing', 'results'], gateScope: 'once' };
};

const isProgressSubmitted = (progress) => {
  if (!progress || typeof progress !== 'object') return false;
  const state = typeof progress.state === 'string' ? progress.state.toLowerCase() : '';
  const percentComplete = Number(progress.percentComplete || 0);
  const step = typeof progress.step === 'string' ? progress.step.toLowerCase() : '';
  return state === 'submitted' || percentComplete >= 100 || step === 'results';
};

const extractPrivateCaseKeyEntries = (items = []) => {
  const sanitizedItems = [];
  const privateEntries = {};

  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const {
      answerKey,
      answerKeyMode,
      answerKeySingleClassification,
      groundTruths,
      correctClassification,
      primaryAssertion,
      ...rest
    } = item;

    const paymentId = toOptionalString(rest.paymentId) || toOptionalString(item.paymentId) || `item-${index + 1}`;

    const entry = {};
    if (isRecord(answerKey) && Object.keys(answerKey).length > 0) {
      entry.answerKey = { ...answerKey };
    }
    if (typeof answerKeyMode === 'string' && answerKeyMode.trim()) {
      entry.answerKeyMode = answerKeyMode.trim();
    }
    if (typeof answerKeySingleClassification === 'string' && answerKeySingleClassification.trim()) {
      entry.answerKeySingleClassification = answerKeySingleClassification.trim();
    }
    if (isRecord(groundTruths) && Object.keys(groundTruths).length > 0) {
      entry.groundTruths = { ...groundTruths };
    }
    if (typeof correctClassification === 'string' && correctClassification.trim()) {
      entry.correctClassification = correctClassification.trim();
    }
    if (typeof primaryAssertion === 'string' && primaryAssertion.trim()) {
      entry.primaryAssertion = primaryAssertion.trim();
    }
    const resolvedRiskLevel =
      typeof rest.riskLevel === 'string' && rest.riskLevel.trim()
        ? rest.riskLevel.trim()
        : typeof item.riskLevel === 'string' && item.riskLevel.trim()
        ? item.riskLevel.trim()
        : null;
    if (resolvedRiskLevel) {
      entry.riskLevel = resolvedRiskLevel;
    }

    const hasEntry = Object.keys(entry).length > 0;

    sanitizedItems.push({
      ...rest,
      paymentId,
      hasAnswerKey: Boolean(entry.answerKey),
    });

    if (hasEntry && paymentId) {
      privateEntries[paymentId] = entry;
    }
  });

  return { sanitizedItems, privateEntries };
};

const stripUndefinedDeep = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined);
  }
  if (isRecord(value)) {
    const next = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (entry === undefined) return;
      const cleaned = stripUndefinedDeep(entry);
      if (cleaned !== undefined) {
        next[key] = cleaned;
      }
    });
    return next;
  }
  return value;
};

const hasReadyFile = (doc) => {
  if (!doc || typeof doc !== 'object') return false;
  return Boolean(doc.downloadURL || doc.storagePath);
};

const hasPendingGeneratedDoc = (doc) => {
  if (!doc || typeof doc !== 'object') return false;
  const hasSpec = Boolean(doc.generationSpec || doc.generationSpecId);
  return hasSpec && !hasReadyFile(doc);
};

const hasMissingArtifact = (doc) => {
  if (!doc || typeof doc !== 'object') return false;
  const hasFileName = typeof doc.fileName === 'string' && doc.fileName.trim();
  return hasFileName && !hasReadyFile(doc);
};

const isCaseReady = (caseData) => {
  if (!caseData || typeof caseData !== 'object') return false;
  const referenceDocuments = Array.isArray(caseData.referenceDocuments) ? caseData.referenceDocuments : [];
  const invoiceMappings = Array.isArray(caseData.invoiceMappings) ? caseData.invoiceMappings : [];
  const cashArtifacts = Array.isArray(caseData.cashArtifacts) ? caseData.cashArtifacts : [];

  const pendingGenerated = referenceDocuments.some(hasPendingGeneratedDoc) ||
    invoiceMappings.some(hasPendingGeneratedDoc);

  if (pendingGenerated) return false;

  const missingCashArtifacts = cashArtifacts.some((doc) => {
    const type = typeof doc?.type === 'string' ? doc.type.trim() : '';
    if (!type) return false;
    return hasMissingArtifact(doc);
  });

  if (missingCashArtifacts) return false;

  return true;
};

const queueGenerationJob = async ({ firestore, appId, caseId, plan, phaseId, requestedBy, orgId }) => {
  if (!plan || typeof plan !== 'object') return null;
  const planSpecs = Array.isArray(plan.referenceDocumentSpecs) ? plan.referenceDocumentSpecs : [];
  if (planSpecs.length === 0) return null;

  const planRef = firestore.doc(`artifacts/${appId}/private/data/case_generation_plans/${caseId}`);
  await planRef.set(
    {
      plan,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const jobRef = firestore.collection(`artifacts/${appId}/private/data/case_generation_jobs`).doc();
  const payload = {
    jobId: jobRef.id,
    caseId,
    appId,
    plan,
    planSource: 'auto',
    caseMissing: false,
    phaseId: phaseId ? String(phaseId).trim() : null,
    status: 'queued',
    requestedBy: requestedBy || null,
    orgId: orgId || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await jobRef.set(payload, { merge: true });

  try {
    await planRef.set(
      {
        lastJob: {
          jobId: jobRef.id,
          status: 'queued',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[queueGenerationJob] Failed to write lastJob status', err);
  }

  return { jobId: jobRef.id, status: payload.status };
};

const buildCaseFromRecipe = async ({ firestore, appId, moduleId, createdBy, orgId }) => {
  const recipeMeta = getCaseRecipe(moduleId);
  let recipeDetails = null;

  try {
    const recipeSnap = await firestore.doc(`artifacts/${appId}/public/data/recipes/${moduleId}`).get();
    if (recipeSnap.exists) {
      recipeDetails = recipeSnap.data() || null;
    }
  } catch (err) {
    console.warn('[buildCaseFromRecipe] Failed to load recipe details', err);
  }

  const draft = buildCaseDraftFromRecipe({ recipeId: moduleId, overrides: {} });
  const recipeVersion =
    Number.isFinite(Number(recipeDetails?.recipeVersion))
      ? Number(recipeDetails.recipeVersion)
      : draft.recipeVersion || Number(recipeMeta?.version) || 1;

  const instruction = resolveInstruction({
    recipeDetails,
    draftInstruction: draft.instruction,
    recipeVersion,
  });

  const title =
    toTrimmedString(recipeDetails?.title) ||
    toTrimmedString(recipeDetails?.moduleTitle) ||
    draft.caseName ||
    recipeMeta.label ||
    'Audit Case';
  const moduleTitle =
    toTrimmedString(recipeDetails?.moduleTitle) ||
    toTrimmedString(recipeMeta.moduleTitle) ||
    recipeMeta.label ||
    '';

  const workflow = resolveWorkflow({ recipeDetails, draft });
  const normalizedAccess =
    typeof recipeDetails?.accessLevel === 'string'
      ? recipeDetails.accessLevel.trim().toLowerCase()
      : typeof draft?.accessLevel === 'string'
      ? draft.accessLevel.trim().toLowerCase()
      : 'paid';
  const accessLevel = normalizedAccess === 'demo' ? 'demo' : 'paid';

  const casePayload = {
    caseName: title,
    title,
    instruction,
    disbursements: draft.disbursements,
    invoiceMappings: draft.invoiceMappings || [],
    referenceDocuments: draft.referenceDocuments,
    workpaper: draft.workpaper || null,
    publicVisible: true,
    visibleToUserIds: [],
    status: 'assigned',
    opensAt: null,
    dueAt: null,
    auditArea: recipeDetails?.auditArea || recipeMeta.auditArea || draft.auditArea,
    caseLevel: draft.caseLevel || recipeMeta.caseLevel || '',
    moduleId: moduleId,
    recipeVersion,
    moduleTitle,
    pathId: recipeDetails?.pathId || recipeMeta.pathId || '',
    tier: recipeDetails?.tier || recipeMeta.tier || 'foundations',
    primarySkill: recipeDetails?.primarySkill || recipeMeta.primarySkill || '',
    accessLevel,
    workflow,
    generationConfig: recipeDetails?.generationConfig || {},
    retakeAttempt: false,
    createdBy: createdBy || null,
    cashContext: draft.cashContext || null,
    cashOutstandingItems: draft.cashOutstandingItems || [],
    cashCutoffItems: draft.cashCutoffItems || [],
    cashRegisterItems: draft.cashRegisterItems || [],
    cashReconciliationMap: draft.cashReconciliationMap || [],
    cashArtifacts: draft.cashArtifacts || [],
  };
  if (orgId) {
    casePayload.orgId = orgId;
  }

  const { sanitizedItems, privateEntries } = extractPrivateCaseKeyEntries(casePayload.disbursements || []);
  const caseNameForSearch = toTrimmedString(casePayload.caseName || casePayload.title);
  const { disbursements: _ignoredDisbursements, ...caseDataBase } = casePayload;
  const caseData = stripUndefinedDeep({
    ...caseDataBase,
    auditItems: sanitizedItems,
    caseNameLower: caseNameForSearch ? caseNameForSearch.toLowerCase() : '',
    _deleted: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const caseKeys = stripUndefinedDeep(privateEntries);
  const generationPlan = stripUndefinedDeep(draft.generationPlan || null);

  return { caseData, caseKeys, generationPlan };
};

const buildDebugDataForTemplate = (templateId) => {
  switch (templateId) {
    case 'invoice.seed.alpha.v1':
      return {
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
      };
    case 'invoice.seed.beta.v1':
      return {
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
      };
    case 'invoice.seed.gamma.v1':
      return {
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
      };
    case 'refdoc.bank-statement.v1':
      return {
        bankName: 'Cascade National Bank',
        accountName: 'Team Up Promotional Products, LLC',
        accountAddressLine1: '2150 Riverfront Ave',
        accountAddressLine2: 'Denver, CO 80202',
        accountNumber: '*** 4812',
        periodLabel: 'January 20X3',
        openingBalance: 98120.55,
        rows: [
          { date: '20X3-01-03', description: 'Remote Deposit - Checks', amount: 15250 },
          { date: '20X3-01-06', description: 'ACH MetroNet Business Internet', amount: -1733.35 },
          { date: '20X3-01-10', description: 'Check 10451 PayPilot Payroll Services', amount: -17405 },
          { date: '20X3-01-12', description: 'Check 10452 SummitDrinkware Supply', amount: -9445.25 },
          { date: '20X3-01-18', description: 'ACH InkRiver Print & Pack', amount: -6733.35 },
          { date: '20X3-01-23', description: 'Remote Deposit - Customer Payment', amount: 8100 },
        ],
        canceledChecks: [
          {
            checkNumber: '10451',
            date: '20X3-01-10',
            payee: 'PayPilot Payroll Services',
            amountNumeric: '17,405.00',
            amountWords: 'Seventeen Thousand Four Hundred Five and 00/100',
            payer: { name: 'Team Up Promotional Products, LLC', addressLine: '2150 Riverfront Ave, Denver, CO 80202' },
            bank: { name: 'Cascade National Bank', subName: 'Member FDIC' },
            memo: 'Payroll',
            signatureName: 'K. Ramirez',
            micr: {
              routingSymbol: 'T',
              routingNumber: '102000021',
              accountSymbol: 'A',
              accountNumber: '0004812001',
              checkNumber: '10451',
            },
          },
        ],
      };
    case 'refdoc.fa-policy.v1':
      return {
        clientName: 'Clearwater Outfitters, Inc.',
        fiscalYearStart: '20X3-01-01',
        fiscalYearEnd: '20X3-12-31',
        documentAsOfDate: '20X3-12-31',
        currency: 'USD',
        capitalizationThreshold: 10000,
        capitalizeDirectCosts: ['Purchase price', 'Freight and delivery', 'Installation and testing'],
        expenseExamples: ['Routine repairs', 'Training', 'Software subscriptions'],
        depreciationStartRule: 'Placed in service / available for intended use',
        depreciationMethodDefault: 'Straight-line',
        depreciationConvention: 'Monthly',
        assetClasses: [
          { classCode: 'BLDG', className: 'Buildings', usefulLifeYears: 30, method: 'Straight-line' },
          { classCode: 'EQUIP', className: 'Equipment', usefulLifeYears: 7, method: 'Straight-line' },
          { classCode: 'VEH', className: 'Vehicles', usefulLifeYears: 5, method: 'Straight-line' },
        ],
      };
    case 'refdoc.ppe-rollforward.v1':
      return {
        clientName: 'Clearwater Outfitters, Inc.',
        fiscalYearStart: '20X3-01-01',
        fiscalYearEnd: '20X3-12-31',
        documentAsOfDate: '20X3-12-31',
        currency: 'USD',
        rows: [
          {
            classCode: 'BLDG',
            className: 'Buildings',
            beginningBalance: 900000,
            additions: 150000,
            disposals: 0,
            endingBalance: 1050000,
          },
          {
            classCode: 'EQUIP',
            className: 'Equipment',
            beginningBalance: 650000,
            additions: 80000,
            disposals: 0,
            endingBalance: 730000,
          },
        ],
        totals: {
          beginningBalance: 1550000,
          additions: 230000,
          disposals: 0,
          endingBalance: 1780000,
        },
        footerNote: 'Prepared from fixed asset subledger; agrees to general ledger.',
      };
    case 'refdoc.fa-listing.v1':
      return {
        clientName: 'Clearwater Outfitters, Inc.',
        fiscalYearStart: '20X3-01-01',
        fiscalYearEnd: '20X3-12-31',
        documentAsOfDate: '20X3-12-31',
        currency: 'USD',
        rows: [
          {
            assetId: 'FA-BLDG-001',
            description: 'Warehouse build-out (Denver)',
            classCode: 'BLDG',
            className: 'Buildings',
            location: 'Denver, CO',
            vendorName: 'Atlas Construction Co.',
            invoiceNumber: 'INV-2450',
            invoiceDate: '20X3-03-12',
            placedInServiceDate: '20X3-04-15',
            costBasis: 120000,
            usefulLifeYears: 30,
            method: 'Straight-line',
          },
          {
            assetId: 'FA-EQUIP-014',
            description: 'Automated packing line (Austin)',
            classCode: 'EQUIP',
            className: 'Equipment',
            location: 'Austin, TX',
            vendorName: 'Millstone Robotics',
            invoiceNumber: 'INV-3881',
            invoiceDate: '20X3-05-06',
            placedInServiceDate: '20X3-06-01',
            costBasis: 75000,
            usefulLifeYears: 7,
            method: 'Straight-line',
          },
        ],
      };
    case 'refdoc.check-copy.v1':
      return {
        payer: { name: 'Team Up Promotional Products, LLC', addressLine: '2150 Riverfront Ave, Denver, CO 80202' },
        checkNumber: '10482',
        date: '20X3-01-10',
        payee: 'PayPilot Payroll Services',
        amountNumeric: '17,405.00',
        amountWords: 'Seventeen Thousand Four Hundred Five and 00/100',
        bank: { name: 'Cascade National Bank', subName: 'Member FDIC' },
        memo: 'Payroll',
        signatureName: 'K. Ramirez',
        micr: {
          routingSymbol: 'T',
          routingNumber: '102000021',
          accountSymbol: 'A',
          accountNumber: '0004812001',
          checkNumber: '10482',
        },
      };
    case 'refdoc.ap-aging.v1':
      return {
        companyName: 'Team Up Promotional Products, LLC',
        asOfDate: '20X3-01-31',
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
      };
    case 'refdoc.ap-leadsheet.v1':
      return {
        workpaperTitle: 'AP Lead Sheet',
        clientName: 'Team Up Promotional Products, LLC',
        periodEnding: '20X2-12-31',
        trialBalanceName: 'AP Trade',
        priorDate: '20X1-12-31',
        currentDate: '20X2-12-31',
        groupCode: 'L02',
        groupName: 'Accounts Payable',
        subgroupName: 'Trade Payables',
        lines: [
          {
            account: '2100',
            description: 'Accounts Payable - Trade',
            priorAmount: 80500,
            unadjAmount: 82150,
            ajeAmount: -4500,
            rjeAmount: 0,
            finalAmount: 77650,
          },
        ],
        footerNote: 'Prepared for internal audit training only.',
      };
    case 'refdoc.disbursement-listing.v1':
      return {
        companyName: 'Team Up Promotional Products, LLC',
        periodLabel: 'January 20X3',
        reportTitle: 'January Disbursements Listing',
        rows: [
          {
            paymentDate: '20X3-01-10',
            checkNumber: '10451',
            paymentId: 'P-10451',
            payee: 'PayPilot Payroll Services',
            paymentType: 'Check',
            amount: 17405,
          },
          {
            paymentDate: '20X3-01-12',
            checkNumber: '10452',
            paymentId: 'P-10452',
            payee: 'SummitDrinkware Supply',
            paymentType: 'Check',
            amount: 9445.25,
          },
        ],
      };
    case 'refdoc.payroll-register.v1':
      return {
        reportTitle: 'Payroll Register',
        payPeriod: '20X3-01-01 to 20X3-01-15',
        reportScopeLabel: 'Hourly + Salaried',
        payDate: '20X3-01-20',
        companyCode: 'TU-01',
        companyNameLine1: 'Team Up Promotional Products, LLC',
        companyNameLine2: 'Payroll Department',
        pageNumber: '1',
        pageCount: '1',
        totalHours: '412.5',
        totalEmployees: '18',
        totals: [
          { label: 'Gross Pay', amount: '$82,450.00' },
          { label: 'Taxes', amount: '$19,875.00' },
          { label: 'Net Pay', amount: '$62,575.00' },
        ],
        footerNote: 'Confidential payroll report.',
      };
    case 'refdoc.remittance-bundle.v1':
      return {
        companyName: 'Team Up Promotional Products, LLC',
        vendor: 'SummitDrinkware Supply',
        paymentId: 'P-10452',
        paymentDate: '20X3-01-12',
        invoices: [
          {
            invoiceNumber: 'SD-2041',
            invoiceDate: '20X2-12-28',
            serviceDate: '20X2-12-27',
            amount: 9445.25,
            isRecorded: true,
          },
          {
            invoiceNumber: 'SD-2042',
            invoiceDate: '20X3-01-05',
            serviceDate: '20X3-01-04',
            amount: 3120,
            isRecorded: false,
          },
        ],
      };
    case 'refdoc.accrual-estimate.v1':
      return {
        companyName: 'Team Up Promotional Products, LLC',
        vendor: 'SummitDrinkware Supply',
        paymentId: 'P-10452',
        periodEnding: '20X2-12-31',
        memoDate: '20X3-01-04',
        estimateAmount: 4500,
        settlementTotal: 9445.25,
        note: 'Estimate reversed once January invoice was received.',
      };
    default:
      return {};
  }
};

const normalizeStoragePath = (rawPath, bucketName) => {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('gs://')) {
    const match = trimmed.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) return null;
    if (bucketName && match[1] !== bucketName) return null;
    return match[2];
  }
  if (trimmed.startsWith('https://firebasestorage.googleapis.com/')) {
    const match = trimmed.match(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/);
    if (!match) return null;
    if (bucketName && match[1] !== bucketName) return null;
    return decodeURIComponent(match[2]);
  }
  if (trimmed.startsWith('https://storage.googleapis.com/')) {
    const match = trimmed.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/);
    if (!match) return null;
    if (bucketName && match[1] !== bucketName) return null;
    return match[2];
  }
  return trimmed.replace(/^\/+/, '');
};

const collectCaseStoragePaths = (caseData, bucketName) => {
  const paths = new Set();
  const addPath = (value) => {
    const normalized = normalizeStoragePath(value, bucketName);
    if (normalized) paths.add(normalized);
  };
  const addDocument = (doc) => {
    if (!doc || typeof doc !== 'object') return;
    addPath(doc.storagePath);
    if (!doc.storagePath && doc.downloadURL) {
      addPath(doc.downloadURL);
    }
  };
  const addDocuments = (docs) => {
    if (!Array.isArray(docs)) return;
    docs.forEach((doc) => addDocument(doc));
  };
  const addItemDocuments = (item) => {
    if (!item || typeof item !== 'object') return;
    addPath(item.storagePath);
    if (!item.storagePath && item.downloadURL) {
      addPath(item.downloadURL);
    }
    addDocument(item.highlightedDocument);
    addDocuments(item.supportingDocuments);
  };
  const addItems = (items) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => addItemDocuments(item));
  };

  addDocuments(caseData?.referenceDocuments);
  addDocuments(caseData?.invoiceMappings);
  addItems(caseData?.auditItems);
  addItems(caseData?.disbursements);

  return Array.from(paths);
};

const collectInvoiceStoragePaths = (caseData, bucketName) => {
  const paths = new Set();
  const addPath = (value) => {
    const normalized = normalizeStoragePath(value, bucketName);
    if (normalized) paths.add(normalized);
  };
  const addDocument = (doc) => {
    if (!doc || typeof doc !== 'object') return;
    addPath(doc.storagePath);
    if (!doc.storagePath && doc.downloadURL) {
      addPath(doc.downloadURL);
    }
  };
  const addDocuments = (docs) => {
    if (!Array.isArray(docs)) return;
    docs.forEach((doc) => addDocument(doc));
  };
  const addItemDocuments = (item) => {
    if (!item || typeof item !== 'object') return;
    addPath(item.storagePath);
    if (!item.storagePath && item.downloadURL) {
      addPath(item.downloadURL);
    }
  };
  const addItems = (items) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => addItemDocuments(item));
  };

  addDocuments(caseData?.invoiceMappings);
  addItems(caseData?.auditItems);
  addItems(caseData?.disbursements);

  return Array.from(paths);
};

const loadChromium = async () => {
  let chromium;
  let executablePath;
  let chromiumArgs = [];
  let chromiumHeadless = true;
  try {
    const { chromium: chromiumCore } = require('playwright-core');
    const chromiumBinary = require('@sparticuz/chromium');
    chromium = chromiumCore;
    executablePath = await chromiumBinary.executablePath();
    chromiumArgs = chromiumBinary.args || [];
    if (chromiumBinary.headless !== undefined) {
      if (typeof chromiumBinary.headless === 'string') {
        chromiumHeadless = chromiumBinary.headless.toLowerCase() === 'true';
      } else {
        chromiumHeadless = Boolean(chromiumBinary.headless);
      }
    }
  } catch (err) {
    throw new Error('Playwright Chromium is not available in the functions runtime.');
  }
  return { chromium, executablePath, chromiumArgs, chromiumHeadless };
};

const renderPdfFromHtml = async (html, pdfOptions = {}) => {
  const { chromium, executablePath, chromiumArgs, chromiumHeadless } = await loadChromium();
  const browser = await chromium.launch({
    executablePath,
    args: chromiumArgs,
    headless: chromiumHeadless,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
    const defaultPdfOptions = { printBackground: true, preferCSSPageSize: true };
    return await page.pdf({ ...defaultPdfOptions, ...pdfOptions });
  } finally {
    await browser.close();
  }
};

const renderPngFromPdfBuffer = async (pdfBuffer, options = {}) => {
  if (!pdfBuffer || typeof pdfBuffer.toString !== 'function') {
    throw new Error('Missing PDF buffer for PNG conversion.');
  }
  const width = Number(options.width) || 1200;
  const height = Number(options.height) || 700;
  const { chromium, executablePath, chromiumArgs, chromiumHeadless } = await loadChromium();
  const browser = await chromium.launch({
    executablePath,
    args: chromiumArgs,
    headless: chromiumHeadless,
  });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const base64Pdf = pdfBuffer.toString('base64');
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #fff; }
      #pdf { width: 100%; height: 100%; border: none; }
    </style>
  </head>
  <body>
    <embed id="pdf" type="application/pdf" src="data:application/pdf;base64,${base64Pdf}#toolbar=0&navpanes=0&scrollbar=0" />
  </body>
</html>`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const embed = await page.$('#pdf');
    if (!embed) throw new Error('PDF embed failed to load.');
    return await embed.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
};

const normalizeSelection = (list) => {
  if (!Array.isArray(list)) {
    return [];
  }
  return Array.from(
    new Set(
      list
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).sort();
};

const findPrimaryClassification = (totals = {}) => {
  const sorted = Object.entries(totals)
    .map(([key, value]) => ({ key, value: toNumber(value) }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const primary = sorted.find((entry) => Math.abs(entry.value) > ANSWER_TOLERANCE);
  return primary ? primary.key : '';
};

const detectSplitMode = (disbursement, totals) => {
  if (disbursement?.answerKeyMode === 'split') {
    return true;
  }
  const nonZero = Object.values(totals).filter((value) => Math.abs(value) > ANSWER_TOLERANCE);
  return nonZero.length > 1;
};

const buildGradingDetail = (disbursement, userAllocations = {}) => {
  const answerKey = disbursement?.answerKey || {};
  const classificationKeys = Array.from(
    new Set(
      Object.keys(answerKey)
        .concat(Object.keys(userAllocations))
        .filter((key) => key !== 'explanation')
    )
  );

  if (
    classificationKeys.length === 0 &&
    typeof disbursement?.answerKeySingleClassification === 'string'
  ) {
    classificationKeys.push(disbursement.answerKeySingleClassification);
  }

  const userTotals = classificationKeys.reduce((acc, key) => {
    acc[key] = toNumber(userAllocations[key]);
    return acc;
  }, {});

  const answerTotals = classificationKeys.reduce((acc, key) => {
    acc[key] = toNumber(answerKey[key]);
    return acc;
  }, {});

  let overallCorrect = true;
  const fields = {};
  classificationKeys.forEach((key) => {
    const userVal = userTotals[key] || 0;
    const correctVal = answerTotals[key] || 0;
    const isCorrect = Math.abs(userVal - correctVal) <= ANSWER_TOLERANCE;
    fields[key] = { user: userVal, correct: correctVal, isCorrect };
    if (!isCorrect) {
      overallCorrect = false;
    }
  });

  const splitMode = detectSplitMode(disbursement, answerTotals);
  const userClassification = findPrimaryClassification(userTotals);
  const correctClassification = findPrimaryClassification(answerTotals);

  return {
    paymentId: disbursement?.paymentId,
    isCorrect: overallCorrect,
    splitMode,
    fields,
    userClassification,
    correctClassification,
    explanation:
      typeof answerKey.explanation === 'string' && answerKey.explanation.trim().length > 0
        ? answerKey.explanation
        : null,
  };
};

// This function will trigger whenever a document in the 'roles' collection is created or updated.
exports.onRoleChangeSetCustomClaim = functions.firestore
  .document('roles/{userId}')
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    const roleData = change.after.data(); // The new data of the role document

    if (!roleData || !roleData.role) {
      // If the role document was deleted or role field is missing, clear the custom claim
      await admin.auth().setCustomUserClaims(userId, {});
      console.log(`Custom claim 'role' cleared for user ${userId}`);
      return null;
    }

    const role = roleData.role;
    const orgId = roleData.orgId || null;

    try {
      await admin.auth().setCustomUserClaims(userId, { role, orgId });
      console.log(`Custom claims set for user ${userId}`, { role, orgId });
      return null;
    } catch (error) {
      console.error(`Error setting custom claim for user ${userId}:`, error);
      return null;
    }
  });

exports.onCaseDeletedCleanupStorage = functions.firestore
  .document('artifacts/{appId}/public/data/cases/{caseId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;
    const wasDeleted = before?._deleted === true;
    const isDeleted = after?._deleted === true;

    if (!isDeleted || wasDeleted) {
      return null;
    }

    const caseData = after || before || {};
    const bucket = admin.storage().bucket();
    const bucketName = bucket.name;
    const storagePaths = collectCaseStoragePaths(caseData, bucketName);

    if (storagePaths.length === 0) {
      console.log('[caseCleanup] No storage paths found', {
        caseId: context.params.caseId,
        appId: context.params.appId,
      });
      return null;
    }

    await Promise.all(
      storagePaths.map(async (path) => {
        try {
          await bucket.file(path).delete({ ignoreNotFound: true });
        } catch (err) {
          console.warn('[caseCleanup] Failed to delete file', {
            path,
            error: err?.message || err,
          });
        }
      })
    );

    console.log('[caseCleanup] Deleted case storage', {
      caseId: context.params.caseId,
      appId: context.params.appId,
      count: storagePaths.length,
    });

    return null;
  });

const resolveRequesterIdentity = async ({ context, appId, firestore, logLabel }) => {
  const requesterRole = context.auth.token?.role;
  let requesterOrgId = context.auth.token?.orgId ?? null;
  let resolvedRole = requesterRole;

  if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && resolvedRole !== 'instructor') {
    try {
      const roleSnap = await firestore.doc(`roles/${context.auth.uid}`).get();
      const docRole = roleSnap.exists ? roleSnap.data()?.role : null;
      if (typeof docRole === 'string') {
        resolvedRole = docRole.toLowerCase();
      }
    } catch (err) {
      console.warn(`[${logLabel}] Failed to resolve role doc`, err);
    }
  }

  if (!requesterOrgId && appId) {
    try {
      const profileRef = firestore.doc(
        `artifacts/${appId}/users/${context.auth.uid}/userProfileData/profile`
      );
      const profileSnap = await profileRef.get();
      if (profileSnap.exists) {
        requesterOrgId = profileSnap.data()?.orgId ?? requesterOrgId;
      }
    } catch (err) {
      console.warn(`[${logLabel}] Failed to resolve orgId from profile`, err);
    }
  }

  return { resolvedRole, requesterOrgId };
};

const hasPaidAccessServer = async ({ firestore, appId, uid }) => {
  if (!appId || !uid) return false;
  const billingSnap = await firestore.doc(buildBillingPath(appId, uid)).get();
  if (!billingSnap.exists) return false;
  const status = typeof billingSnap.data()?.status === 'string' ? billingSnap.data().status.toLowerCase() : '';
  return status === 'paid' || status === 'active';
};

exports.listRosterOptions = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appId = data?.appId;
  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }

  const firestore = admin.firestore();

  const { resolvedRole, requesterOrgId } = await resolveRequesterIdentity({
    context,
    appId,
    firestore,
    logLabel: 'listRosterOptions',
  });

  if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && resolvedRole !== 'instructor') {
    throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
  }
  let rosterQuery = firestore.collection(`artifacts/${appId}/users`);

  if (resolvedRole === 'instructor') {
    if (!requesterOrgId) {
      throw new functions.https.HttpsError('failed-precondition', 'Instructor has no Org ID.');
    }
    rosterQuery = rosterQuery.where('orgId', '==', requesterOrgId);
  }

  const rosterSnapshot = await rosterQuery.get();

  const roster = [];

  for (const userDoc of rosterSnapshot.docs) {
    const userId = userDoc.id;
    const userData = userDoc.data() || {};
    let profileData = {};

    try {
      const profileRef = firestore.doc(`artifacts/${appId}/users/${userId}/userProfileData/profile`);
      const profileSnap = await profileRef.get();
      if (profileSnap.exists) {
        profileData = profileSnap.data() || {};
      }
    } catch (err) {
      console.error(`[listRosterOptions] Failed to load profile for ${userId}`, err);
    }

    const displayName =
      profileData.displayName ||
      profileData.fullName ||
      userData.displayName ||
      userData.fullName ||
      null;
    const email =
      profileData.email ||
      profileData.emailAddress ||
      userData.email ||
      userData.emailAddress ||
      null;

    roster.push({
      id: userId,
      displayName,
      email,
      label: displayName || email || userId,
      role: userData.role || profileData.role || null,
      orgId: userData.orgId || profileData.orgId || null,
    });
  }

  return { roster };
});

exports.auditOrphanedInvoices = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appId = data?.appId;
  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }

  const sampleSizeRaw = Number(data?.sampleSize);
  const sampleSize = Number.isFinite(sampleSizeRaw)
    ? Math.min(Math.max(sampleSizeRaw, 0), 50)
    : 10;
  const deleteFiles = Boolean(data?.deleteFiles);

  const firestore = admin.firestore();
  const { resolvedRole } = await resolveRequesterIdentity({
    context,
    appId,
    firestore,
    logLabel: 'auditOrphanedInvoices',
  });

  if (resolvedRole !== 'admin' && resolvedRole !== 'owner') {
    throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
  }

  const casesSnap = await firestore.collection(`artifacts/${appId}/public/data/cases`).get();
  const activeCaseIds = new Set();
  const referencedInvoicePaths = new Set();

  casesSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (data._deleted === true) {
      return;
    }
    activeCaseIds.add(docSnap.id);
    const invoicePaths = collectInvoiceStoragePaths(data, null);
    invoicePaths.forEach((path) => referencedInvoicePaths.add(path));
  });

  const bucket = admin.storage().bucket();
  const prefix = `artifacts/${appId}/case_documents/`;
  const allFiles = [];
  let pageToken;

  do {
    const [files, , response] = await bucket.getFiles({
      prefix,
      autoPaginate: false,
      pageToken,
      maxResults: 1000,
    });
    allFiles.push(...files);
    pageToken = response?.nextPageToken;
  } while (pageToken);

  const orphaned = [];

  allFiles.forEach((file) => {
    const filePath = file?.name || '';
    if (!filePath.startsWith(prefix)) return;
    const remainder = filePath.slice(prefix.length);
    const caseId = remainder.split('/')[0] || null;
    const hasActiveCase = caseId ? activeCaseIds.has(caseId) : false;
    const isReferenced = referencedInvoicePaths.has(filePath);
    if (!hasActiveCase || !isReferenced) {
      orphaned.push(filePath);
    }
  });

  let deletedCount = 0;
  if (deleteFiles && orphaned.length > 0) {
    await Promise.all(
      orphaned.map(async (path) => {
        try {
          await bucket.file(path).delete({ ignoreNotFound: true });
          deletedCount += 1;
        } catch (err) {
          console.warn('[auditOrphanedInvoices] Failed to delete file', {
            path,
            error: err?.message || err,
          });
        }
      })
    );
  }

  return {
    totalFiles: allFiles.length,
    orphanedCount: orphaned.length,
    orphanedSample: orphaned.slice(0, sampleSize),
    deletedCount,
  };
});

const resolveCaseAppId = async (firestore, appId, caseId) => {
  const candidates = [];
  if (appId) candidates.push(appId);
  if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== appId) {
    candidates.push(process.env.GCLOUD_PROJECT);
  }
  const seen = new Set();
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      const snap = await firestore.doc(`artifacts/${candidate}/public/data/cases/${caseId}`).get();
      if (snap.exists) {
        return { appId: candidate, caseData: snap.data() || {}, caseMissing: false };
      }
    }
    // Retry briefly to handle eventual consistency right after case creation.
    if (attempt < attempts - 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 200));
      seen.clear();
    }
  }
  return appId ? { appId, caseData: null, caseMissing: true } : null;
};

exports.queueCaseDocGeneration = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appId = data?.appId;
  const caseId = data?.caseId;
  const plan = data?.plan ?? null;
  const phaseId = data?.phaseId ?? null;

  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }
  if (!caseId || typeof caseId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'caseId is required.');
  }
  if (plan !== null && typeof plan !== 'object') {
    throw new functions.https.HttpsError('invalid-argument', 'plan must be an object when provided.');
  }
  if (phaseId !== null && phaseId !== undefined && typeof phaseId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'phaseId must be a string when provided.');
  }

  const firestore = admin.firestore();
  const { resolvedRole, requesterOrgId } = await resolveRequesterIdentity({
    context,
    appId,
    firestore,
    logLabel: 'queueCaseDocGeneration',
  });

  if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && resolvedRole !== 'instructor' && resolvedRole !== 'trainee') {
    throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
  }

  if (resolvedRole === 'instructor' && !requesterOrgId) {
    throw new functions.https.HttpsError('failed-precondition', 'Instructor has no Org ID.');
  }
  const resolved = await resolveCaseAppId(firestore, appId, caseId);
  if (!resolved) {
    throw new functions.https.HttpsError('not-found', 'Case not found for provided appId.');
  }
  const { appId: resolvedAppId, caseData, caseMissing } = resolved;

  if (resolvedRole === 'trainee') {
    const visibleToUserIds = Array.isArray(caseData?.visibleToUserIds)
      ? caseData.visibleToUserIds
      : [];
    if (!visibleToUserIds.includes(context.auth.uid)) {
      throw new functions.https.HttpsError('permission-denied', 'Case is not assigned to trainee.');
    }
  }

  if (resolvedRole === 'instructor') {
    if (!requesterOrgId) {
      throw new functions.https.HttpsError('failed-precondition', 'Instructor has no Org ID.');
    }
    if (caseMissing || !caseData?.orgId || caseData.orgId !== requesterOrgId) {
      throw new functions.https.HttpsError('permission-denied', 'Case is outside instructor org.');
    }
  }

  let resolvedPlan = plan;
  let planSource = 'client';
  if (
    !resolvedPlan ||
    typeof resolvedPlan !== 'object' ||
    !Array.isArray(resolvedPlan.referenceDocumentSpecs) ||
    resolvedPlan.referenceDocumentSpecs.length === 0
  ) {
    const planSnap = await firestore
      .doc(`artifacts/${resolvedAppId}/private/data/case_generation_plans/${caseId}`)
      .get();
    resolvedPlan = planSnap.exists ? planSnap.data()?.plan : null;
    planSource = 'plan-doc';
  }

  if (
    !resolvedPlan ||
    typeof resolvedPlan !== 'object' ||
    !Array.isArray(resolvedPlan.referenceDocumentSpecs) ||
    resolvedPlan.referenceDocumentSpecs.length === 0
  ) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Generation plan is missing or incomplete for this case.'
    );
  }

  if (planSource === 'client') {
    await firestore.doc(`artifacts/${resolvedAppId}/private/data/case_generation_plans/${caseId}`).set(
      {
        plan: resolvedPlan,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  const jobRef = firestore
    .collection(`artifacts/${resolvedAppId}/private/data/case_generation_jobs`)
    .doc();

  const payload = {
    jobId: jobRef.id,
    caseId,
    appId: resolvedAppId,
    plan: resolvedPlan,
    planSource,
    caseMissing: Boolean(caseMissing),
    phaseId: phaseId ? String(phaseId).trim() : null,
    status: 'queued',
    requestedBy: context.auth.uid,
    orgId: requesterOrgId || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await jobRef.set(payload, { merge: true });

  try {
    await firestore.doc(`artifacts/${resolvedAppId}/private/data/case_generation_plans/${caseId}`).set(
      {
        lastJob: {
          jobId: jobRef.id,
          status: 'queued',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[queueCaseDocGeneration] Failed to write lastJob status', err);
  }

  return { jobId: jobRef.id, status: payload.status };
});

exports.startCaseAttempt = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appId = data?.appId;
  const moduleId = data?.moduleId;

  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }
  if (!moduleId || typeof moduleId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'moduleId is required.');
  }

  const firestore = admin.firestore();
  const { resolvedRole, requesterOrgId } = await resolveRequesterIdentity({
    context,
    appId,
    firestore,
    logLabel: 'startCaseAttempt',
  });

  if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && resolvedRole !== 'instructor' && resolvedRole !== 'trainee') {
    throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
  }

  if (resolvedRole === 'instructor' && !requesterOrgId) {
    throw new functions.https.HttpsError('failed-precondition', 'Instructor has no Org ID.');
  }

  const uid = context.auth.uid;
  if (resolvedRole === 'trainee') {
    const isPaid = await hasPaidAccessServer({ firestore, appId, uid });
    if (!isPaid) {
      throw new functions.https.HttpsError('permission-denied', 'Upgrade required.');
    }
  }

  const casesSnap = await firestore
    .collection(`artifacts/${appId}/public/data/cases`)
    .where('_deleted', '==', false)
    .where('moduleId', '==', moduleId)
    .get();

  if (casesSnap.empty) {
    throw new functions.https.HttpsError('not-found', 'No cases available for this module.');
  }

  const rawCases = casesSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data() || {},
  }));

  const allowedStatuses = new Set(['assigned', 'in_progress', 'submitted', 'draft']);
  const visibleCases = rawCases.filter(({ data: caseData }) => {
    const status = typeof caseData?.status === 'string' ? caseData.status.toLowerCase() : 'assigned';
    if (!allowedStatuses.has(status)) return false;
    if (caseData?.publicVisible === true) return true;
    const visibleToUserIds = Array.isArray(caseData?.visibleToUserIds) ? caseData.visibleToUserIds : [];
    return visibleToUserIds.includes(uid);
  });

  if (visibleCases.length === 0) {
    throw new functions.https.HttpsError('not-found', 'No cases are available for this user.');
  }

  const progressRefs = visibleCases.map(({ id }) =>
    firestore.doc(`artifacts/${appId}/student_progress/${uid}/cases/${id}`)
  );
  const progressSnaps =
    progressRefs.length > 0 ? await firestore.getAll(...progressRefs) : [];
  const progressById = new Map();
  progressSnaps.forEach((snap) => {
    progressById.set(snap.id, snap.exists ? snap.data() : null);
  });

  const completedCount = visibleCases.filter(({ id }) =>
    isProgressSubmitted(progressById.get(id))
  ).length;

  const availableCases = visibleCases.filter(({ id }) => !isProgressSubmitted(progressById.get(id)));
  const readyCases = availableCases.filter(({ data: caseData }) => isCaseReady(caseData));

  if (availableCases.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'No remaining cases are available.');
  }
  if (readyCases.length === 0) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Cases are still generating. Please wait a few minutes and try again.'
    );
  }

  const isUnstarted = (progress) => {
    if (!progress || typeof progress !== 'object') return true;
    const percentComplete = Number(progress.percentComplete || 0);
    const state = typeof progress.state === 'string' ? progress.state.toLowerCase() : '';
    return percentComplete === 0 && state !== 'in_progress';
  };

  const sortCaseCandidates = (left, right) => {
    const leftOrder = Number.isFinite(Number(left.data?.orderIndex)) ? Number(left.data.orderIndex) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(Number(right.data?.orderIndex)) ? Number(right.data.orderIndex) : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftCreated = typeof left.data?.createdAt?.toMillis === 'function' ? left.data.createdAt.toMillis() : 0;
    const rightCreated = typeof right.data?.createdAt?.toMillis === 'function' ? right.data.createdAt.toMillis() : 0;
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    const leftTitle = toTrimmedString(left.data?.title || left.data?.caseName);
    const rightTitle = toTrimmedString(right.data?.title || right.data?.caseName);
    return leftTitle.localeCompare(rightTitle);
  };

  const unstartedCases = readyCases.filter(({ id }) => isUnstarted(progressById.get(id)));
  const candidatePool = unstartedCases.length > 0 ? unstartedCases : readyCases;
  const candidate = candidatePool.slice().sort(sortCaseCandidates)[0];

  const remainingCount = visibleCases.length - completedCount;

  let backfillCaseId = null;
  if (remainingCount <= 2) {
    try {
      const { caseData, caseKeys, generationPlan } = await buildCaseFromRecipe({
        firestore,
        appId,
        moduleId,
        createdBy: uid,
      });

      const caseRef = firestore.collection(`artifacts/${appId}/public/data/cases`).doc();
      await caseRef.set(caseData, { merge: true });

      if (caseKeys && Object.keys(caseKeys).length > 0) {
        await firestore
          .doc(`artifacts/${appId}/private/data/case_keys/${caseRef.id}`)
          .set(
            {
              items: caseKeys,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
      }

      if (generationPlan) {
        const phaseList = Array.isArray(generationPlan?.phases) ? generationPlan.phases : [];
        const initialPhaseId =
          phaseList.length > 0 ? String(phaseList[0]?.id || phaseList[0] || '').trim() : '';
        await queueGenerationJob({
          firestore,
          appId,
          caseId: caseRef.id,
          plan: generationPlan,
          phaseId: initialPhaseId || null,
          requestedBy: uid,
          orgId: requesterOrgId || null,
        });
      }

      backfillCaseId = caseRef.id;
    } catch (err) {
      console.error('[startCaseAttempt] Failed to backfill case pool', err);
    }
  }

  return {
    caseId: candidate.id,
    totalCases: visibleCases.length,
    remainingCount,
    backfillCaseId,
  };
});

exports.seedCasePool = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appId = data?.appId;
  const moduleId = data?.moduleId;
  const rawCount = Number(data?.count);
  const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(50, Math.floor(rawCount))) : 10;

  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }
  if (!moduleId || typeof moduleId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'moduleId is required.');
  }

  const firestore = admin.firestore();
  const { resolvedRole, requesterOrgId } = await resolveRequesterIdentity({
    context,
    appId,
    firestore,
    logLabel: 'seedCasePool',
  });

  if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && resolvedRole !== 'instructor') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }

  if (resolvedRole === 'instructor' && !requesterOrgId) {
    throw new functions.https.HttpsError('failed-precondition', 'Instructor has no Org ID.');
  }

  try {
    getCaseRecipe(moduleId);
  } catch (err) {
    throw new functions.https.HttpsError('not-found', err?.message || 'Unknown moduleId.');
  }

  const uid = context.auth.uid;
  const createdIds = [];

  for (let i = 0; i < count; i += 1) {
    const { caseData, caseKeys, generationPlan } = await buildCaseFromRecipe({
      firestore,
      appId,
      moduleId,
      createdBy: uid,
      orgId: requesterOrgId || null,
    });

    const caseRef = firestore.collection(`artifacts/${appId}/public/data/cases`).doc();
    await caseRef.set(caseData, { merge: true });

    if (caseKeys && Object.keys(caseKeys).length > 0) {
      await firestore
        .doc(`artifacts/${appId}/private/data/case_keys/${caseRef.id}`)
        .set(
          {
            items: caseKeys,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    }

    if (generationPlan) {
      const phaseList = Array.isArray(generationPlan?.phases) ? generationPlan.phases : [];
      const initialPhaseId =
        phaseList.length > 0 ? String(phaseList[0]?.id || phaseList[0] || '').trim() : '';
      await queueGenerationJob({
        firestore,
        appId,
        caseId: caseRef.id,
        plan: generationPlan,
        phaseId: initialPhaseId || null,
        requestedBy: uid,
        orgId: requesterOrgId || null,
      });
    }

    createdIds.push(caseRef.id);
  }

  return {
    created: createdIds.length,
    caseIds: createdIds,
  };
});

exports.generateDebugRefdoc = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
  try {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }

    const appId = data?.appId;
    const templateId = data?.templateId;

    if (!appId || typeof appId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
    }
    if (!templateId || typeof templateId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'templateId is required.');
    }

    const firestore = admin.firestore();
    const { resolvedRole } = await resolveRequesterIdentity({
      context,
      appId,
      firestore,
      logLabel: 'generateDebugRefdoc',
    });

    if (resolvedRole !== 'admin' && resolvedRole !== 'owner') {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    }

    let renderer;
    try {
      renderer = getTemplateRenderer(templateId);
    } catch (err) {
      throw new functions.https.HttpsError('not-found', err?.message || `Unknown templateId: ${templateId}`);
    }

    const debugData = buildDebugDataForTemplate(templateId);
    const { html, css, pdfOptions } = renderer({ data: debugData, theme: {}, layout: {} });

    const fullHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>${css}</style>
</head>
<body>${html}</body>
</html>`;

    const buffer = await renderPdfFromHtml(fullHtml, pdfOptions || {});
    const safeTemplate = String(templateId).replace(/[^\w.\-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${safeTemplate}-${timestamp}.pdf`;
    const storagePath = `artifacts/${appId}/debug/reference/${safeTemplate}/${fileName}`;
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);

    await file.save(buffer, {
      contentType: 'application/pdf',
      resumable: false,
      metadata: {
        contentType: 'application/pdf',
        customMetadata: {
          templateId: String(templateId),
          debug: 'true',
        },
      },
    });

    return {
      templateId,
      storagePath,
      fileName,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[generateDebugRefdoc] Failed to generate debug refdoc', err);
    if (err instanceof functions.https.HttpsError) {
      throw err;
    }
    const message = err?.message || 'Failed to generate debug reference document.';
    throw new functions.https.HttpsError('internal', message);
  }
  });

exports.deleteRetakeAttempt = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appId = data?.appId;
  const caseId = data?.caseId;

  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }
  if (!caseId || typeof caseId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'caseId is required.');
  }

  const firestore = admin.firestore();
  const { resolvedRole, requesterOrgId } = await resolveRequesterIdentity({
    context,
    appId,
    firestore,
    logLabel: 'deleteRetakeAttempt',
  });

  if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && resolvedRole !== 'instructor' && resolvedRole !== 'trainee') {
    throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
  }

  const caseRef = firestore.doc(`artifacts/${appId}/public/data/cases/${caseId}`);
  const caseSnap = await caseRef.get();
  if (!caseSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Case not found.');
  }
  const caseData = caseSnap.data() || {};

  if (resolvedRole === 'trainee') {
    const visibleToUserIds = Array.isArray(caseData?.visibleToUserIds)
      ? caseData.visibleToUserIds
      : [];
    if (!visibleToUserIds.includes(context.auth.uid)) {
      throw new functions.https.HttpsError('permission-denied', 'Case is not assigned to trainee.');
    }
    const legacyRetakeEligible =
      caseData?.publicVisible === false &&
      visibleToUserIds.length === 1 &&
      visibleToUserIds[0] === context.auth.uid &&
      Boolean(caseData?.moduleId) &&
      !caseData?.orgId;
    if (caseData?.retakeAttempt !== true && !legacyRetakeEligible) {
      throw new functions.https.HttpsError('failed-precondition', 'Case is not marked as a retake.');
    }
  }

  if (resolvedRole === 'instructor') {
    if (!requesterOrgId) {
      throw new functions.https.HttpsError('failed-precondition', 'Instructor has no Org ID.');
    }
    if (!caseData?.orgId || caseData.orgId !== requesterOrgId) {
      throw new functions.https.HttpsError('permission-denied', 'Case is outside instructor org.');
    }
  }

  await caseRef.set(
    {
      _deleted: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { caseId, deleted: true };
});

exports.processCaseDocGenerationJob = onDocumentWritten(
  {
    document: 'artifacts/{appId}/private/data/case_generation_jobs/{jobId}',
    memory: '1GiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    if (!event?.data?.after?.exists) {
      return null;
    }
    const jobRef = event.data.after.ref;
    const job = event.data.after.data();
    if (!job || job.status !== 'queued') {
      return null;
    }

    const firestore = admin.firestore();
    const { appId, caseId, plan } = job;
    if (!appId || !caseId || !plan) {
      await jobRef.set(
        {
          status: 'error',
          error: 'Missing appId, caseId, or plan.',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return null;
    }

    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      if (!snap.exists) {
        return;
      }
      const current = snap.data();
      if (current?.status !== 'queued') {
        return;
      }
      tx.update(jobRef, {
        status: 'processing',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    let chromiumAvailable = true;
    try {
      const { chromium: chromiumCore } = require('playwright-core');
      const chromiumBinary = require('@sparticuz/chromium');
      const executablePath = await chromiumBinary.executablePath();
      if (!chromiumCore || !executablePath) {
        chromiumAvailable = false;
      }
    } catch (err) {
      chromiumAvailable = false;
    }

    const planRef = firestore.doc(`artifacts/${appId}/private/data/case_generation_plans/${caseId}`);

    if (!chromiumAvailable) {
      await jobRef.set(
        {
          status: 'error',
          error: 'Playwright Chromium is not available in the functions runtime.',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await planRef.set(
        {
          lastJob: {
            jobId: job?.jobId || event.params.jobId,
            status: 'error',
            error: 'Playwright Chromium is not available in the functions runtime.',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
      return null;
    }

    const allSpecs = Array.isArray(plan.referenceDocumentSpecs) ? plan.referenceDocumentSpecs : [];
    const phases = Array.isArray(plan.phases) ? plan.phases : [];
    const phaseOrder = phases.map((phase) => String(phase?.id || phase || '').trim()).filter(Boolean);
    const requestedPhaseId = String(job?.phaseId || '').trim();
    let specs = allSpecs;
    if (requestedPhaseId) {
      const phaseSpecs = allSpecs.filter((spec) => String(spec?.phaseId || '').trim() === requestedPhaseId);
      if (phaseSpecs.length > 0) {
        specs = phaseSpecs;
      }
    }
    const results = [];
    const errors = [];
    const bucket = admin.storage().bucket();
    const CHECK_COPY_TEMPLATE_ID = 'refdoc.check-copy.v1';
    const BANK_STATEMENT_TEMPLATE_ID = 'refdoc.bank-statement.v1';
    const checkImageMap = new Map();
    const normalizeCheckNumber = (value) => String(value || '').trim();
    const extractCheckNumber = (spec, generationSpec) => {
      const data = generationSpec?.data || {};
      const direct = normalizeCheckNumber(data.checkNumber || data?.micr?.checkNumber);
      if (direct) return direct;
      const name = String(spec?.fileName || '').match(/(\d{3,})/);
      return name ? name[1] : '';
    };
    const applyCheckImagesToBankStatementData = (data, map) => {
      if (!data || typeof data !== 'object' || map.size === 0) return data;
      const attach = (entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const key = normalizeCheckNumber(entry.checkNumber);
        const match = key ? map.get(key) : null;
        if (!match || !match.imageUrl) return entry;
        return { ...entry, imageUrl: match.imageUrl };
      };
      const next = { ...data };
      if (Array.isArray(next.canceledCheckPages)) {
        next.canceledCheckPages = next.canceledCheckPages.map((page) => ({
          ...page,
          checks: Array.isArray(page?.checks) ? page.checks.map(attach) : page?.checks,
        }));
      }
      if (Array.isArray(next.checkPages)) {
        next.checkPages = next.checkPages.map((page) => ({
          ...page,
          checks: Array.isArray(page?.checks) ? page.checks.map(attach) : page?.checks,
        }));
      }
      if (Array.isArray(next.canceledChecks)) {
        next.canceledChecks = next.canceledChecks.map(attach);
      }
      return next;
    };
    const generatePdfDoc = async (spec, renderDataOverride = null) => {
      const generationSpec = spec?.generationSpec || {};
      const templateId = generationSpec.templateId;
      if (!templateId) {
        throw new Error('Missing templateId.');
      }
      const renderer = getTemplateRenderer(templateId);
      const renderData = renderDataOverride ?? (generationSpec.data || {});
      const { html, css, pdfOptions } = renderer({
        data: renderData,
        theme: generationSpec.theme || {},
        layout: generationSpec.layout || {},
      });

      const fullHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>${css}</style>
</head>
<body>${html}</body>
</html>`;

      const buffer = await renderPdfFromHtml(fullHtml, pdfOptions || {});
      const fileBaseName = ensureSafeFileName(spec.fileName || `${templateId}.pdf`);
      const safeName = fileBaseName.toLowerCase().endsWith('.pdf')
        ? fileBaseName
        : `${fileBaseName}.pdf`;
      const storagePath = `artifacts/${appId}/case_reference/${caseId}/${safeName}`;
      const file = bucket.file(storagePath);

      await file.save(buffer, {
        contentType: 'application/pdf',
        resumable: false,
        metadata: {
          contentType: 'application/pdf',
          customMetadata: {
            caseId: String(caseId),
            templateId: String(templateId),
          },
        },
      });

      if (!spec?.internalOnly) {
        results.push({
          fileName: spec.fileName || safeName,
          storagePath,
          contentType: 'application/pdf',
          generationSpec,
          generationSpecId: spec.id || null,
          linkToPaymentId: spec.linkToPaymentId || generationSpec.linkToPaymentId || null,
        });
      }

      return { buffer, safeName, generationSpec };
    };

    const checkCopySpecs = specs.filter(
      (spec) => spec?.generationSpec?.templateId === CHECK_COPY_TEMPLATE_ID
    );
    const otherSpecs = specs.filter(
      (spec) => spec?.generationSpec?.templateId !== CHECK_COPY_TEMPLATE_ID
    );

    for (const spec of checkCopySpecs) {
      try {
        // Skip PNG conversion for now to avoid Chromium crashes; PDFs still generate.
        await generatePdfDoc(spec);
      } catch (err) {
        errors.push({
          fileName: spec?.fileName || null,
          templateId: spec?.generationSpec?.templateId || null,
          error: err?.message || 'Generation failed',
        });
      }
    }

    for (const spec of otherSpecs) {
      try {
        const generationSpec = spec?.generationSpec || {};
        const templateId = generationSpec.templateId;
        const renderData =
          templateId === BANK_STATEMENT_TEMPLATE_ID
            ? applyCheckImagesToBankStatementData(generationSpec.data || {}, checkImageMap)
            : null;
        await generatePdfDoc(spec, renderData);
      } catch (err) {
        errors.push({
          fileName: spec?.fileName || null,
          templateId: spec?.generationSpec?.templateId || null,
          error: err?.message || 'Generation failed',
        });
      }
    }

    const caseRef = firestore.doc(`artifacts/${appId}/public/data/cases/${caseId}`);
    const caseSnap = await caseRef.get();
    if (caseSnap.exists) {
      const caseData = caseSnap.data() || {};
      const existing = Array.isArray(caseData.referenceDocuments) ? caseData.referenceDocuments : [];
      const updated = existing.map((doc) => ({ ...doc }));

      results.forEach((result) => {
        const matchIndex = updated.findIndex((doc) => {
          if (!doc || !doc.fileName) return false;
          if (result.generationSpecId && doc.generationSpecId) {
            return doc.generationSpecId === result.generationSpecId;
          }
          if (doc.fileName !== result.fileName) return false;
          if (!doc.generationSpec || !result.generationSpec) return true;
          return doc.generationSpec.templateId === result.generationSpec.templateId;
        });

        if (matchIndex >= 0) {
          updated[matchIndex] = {
            ...updated[matchIndex],
            storagePath: result.storagePath,
            contentType: result.contentType,
            generationSpec: result.generationSpec,
            generationSpecId: result.generationSpecId || updated[matchIndex].generationSpecId || null,
            generatedAt: admin.firestore.Timestamp.now(),
          };
        } else {
          updated.push({
            fileName: result.fileName,
            storagePath: result.storagePath,
            contentType: result.contentType,
            generationSpec: result.generationSpec,
            generationSpecId: result.generationSpecId || null,
            generatedAt: admin.firestore.Timestamp.now(),
          });
        }
      });

      const invoiceMappings = Array.isArray(caseData.invoiceMappings) ? caseData.invoiceMappings : [];
      const updatedMappings = invoiceMappings.map((mapping) => ({ ...mapping }));
      const cashArtifacts = Array.isArray(caseData.cashArtifacts) ? caseData.cashArtifacts : [];
      const updatedCashArtifacts = cashArtifacts.map((artifact) => ({ ...artifact }));

      results.forEach((result) => {
        if (!result.linkToPaymentId) return;
        const existingIndex = updatedMappings.findIndex(
          (mapping) =>
            mapping &&
            mapping.paymentId === result.linkToPaymentId &&
            mapping.fileName === result.fileName
        );
        const payload = {
          paymentId: result.linkToPaymentId,
          fileName: result.fileName,
          storagePath: result.storagePath,
          contentType: result.contentType,
        };
        if (existingIndex >= 0) {
          updatedMappings[existingIndex] = {
            ...updatedMappings[existingIndex],
            ...payload,
          };
        } else {
          updatedMappings.push(payload);
        }
      });

      if (updatedCashArtifacts.length > 0) {
        results.forEach((result) => {
          if (!result.fileName) return;
          const idx = updatedCashArtifacts.findIndex(
            (artifact) => artifact && artifact.fileName === result.fileName
          );
          if (idx >= 0) {
            updatedCashArtifacts[idx] = {
              ...updatedCashArtifacts[idx],
              storagePath: result.storagePath || updatedCashArtifacts[idx].storagePath || '',
              contentType: result.contentType || updatedCashArtifacts[idx].contentType || '',
              generatedAt: admin.firestore.Timestamp.now(),
            };
          }
        });
      }

      try {
        assertNoFieldValueInArrays(
          {
            referenceDocuments: updated,
            invoiceMappings: updatedMappings,
            cashArtifacts: updatedCashArtifacts,
          },
          'caseUpdate'
        );
        await caseRef.set(
          {
            referenceDocuments: updated,
            invoiceMappings: updatedMappings,
            cashArtifacts: updatedCashArtifacts,
          },
          { merge: true }
        );
      } catch (err) {
        await jobRef.set(
          {
            status: 'error',
            error: err?.message || 'Failed to update case reference documents.',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await planRef.set(
          {
            lastJob: {
              jobId: job?.jobId || event.params.jobId,
              status: 'error',
              errorCount: errors.length + 1,
              errors: [
                ...(errors || []).slice(0, 2),
                {
                  fileName: null,
                  templateId: null,
                  error: err?.message || 'Failed to update case reference documents.',
                },
              ],
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          { merge: true }
        );
        return null;
      }
    }

    const status = errors.length === 0 ? 'completed' : results.length > 0 ? 'partial' : 'error';
    await jobRef.set(
      {
        status,
        results,
        errors,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await planRef.set(
      {
        lastJob: {
          jobId: job?.jobId || event.params.jobId,
          status,
          errorCount: errors.length,
          errors: errors.slice(0, 3),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    if (requestedPhaseId && phaseOrder.length > 0 && status !== 'error') {
      const currentIndex = phaseOrder.indexOf(requestedPhaseId);
      const nextPhaseId = currentIndex >= 0 ? phaseOrder[currentIndex + 1] : '';
      const hasNextSpecs = nextPhaseId
        ? allSpecs.some((spec) => String(spec?.phaseId || '').trim() === nextPhaseId)
        : false;
      if (nextPhaseId && hasNextSpecs) {
        const nextJobRef = firestore
          .collection(`artifacts/${appId}/private/data/case_generation_jobs`)
          .doc();
        const nextPayload = {
          jobId: nextJobRef.id,
          caseId,
          appId,
          plan,
          planSource: 'phase-chain',
          caseMissing: Boolean(job?.caseMissing),
          phaseId: nextPhaseId,
          status: 'queued',
          requestedBy: job?.requestedBy || null,
          orgId: job?.orgId || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await nextJobRef.set(nextPayload, { merge: true });
        try {
          await planRef.set(
            {
              lastJob: {
                jobId: nextJobRef.id,
                status: 'queued',
                phaseId: nextPhaseId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
            },
            { merge: true }
          );
        } catch (err) {
          console.warn('[caseGeneration] Failed to write next phase status', err);
        }
      }
    }

    return null;
  }
);

exports.gradeSubmission = onDocumentWritten(
  'artifacts/{appId}/users/{userId}/caseSubmissions/{caseId}',
  async (event) => {
    if (!event?.data?.after?.exists) {
      return null;
    }

    const submission = event.data.after.data();
    if (!submission || !submission.submittedAt) {
      return null;
    }

    const beforeData = event.data.before?.exists ? event.data.before.data() : null;
    const beforeClassifications = beforeData?.disbursementClassifications || {};
    const afterClassifications = submission.disbursementClassifications || {};
    const classificationsChanged =
      stableStringify(beforeClassifications) !== stableStringify(afterClassifications);

    const beforeSelection = normalizeSelection(beforeData?.selectedPaymentIds || []);
    const afterSelection = normalizeSelection(submission.selectedPaymentIds || []);
    const selectionChanged =
      stableStringify(beforeSelection) !== stableStringify(afterSelection);

    if (!classificationsChanged && !selectionChanged && submission.grade != null && submission.gradedAt) {
      return null;
    }

    const firestore = admin.firestore();
    const caseSnapshot = await firestore
      .doc(`artifacts/${event.params.appId}/public/data/cases/${event.params.caseId}`)
      .get();

    if (!caseSnapshot.exists) {
      console.warn(
        `[gradeSubmission] Case ${event.params.caseId} not found under app ${event.params.appId}.`
      );
      return null;
    }

    const caseData = caseSnapshot.data() || {};
    const disbursementList = Array.isArray(caseData.disbursements)
      ? caseData.disbursements
      : [];
    const cashContext = caseData.cashContext || {};
    const cashOutstandingItems = Array.isArray(caseData.cashOutstandingItems)
      ? caseData.cashOutstandingItems
      : [];
    const cashCutoffItems = Array.isArray(caseData.cashCutoffItems) ? caseData.cashCutoffItems : [];
    const cashReconciliationMap = Array.isArray(caseData.cashReconciliationMap)
      ? caseData.cashReconciliationMap
      : [];
    let caseKeyItems = null;
    try {
      const privateDoc = await firestore
        .doc(`artifacts/${event.params.appId}/private/case_keys/${event.params.caseId}`)
        .get();
      if (privateDoc.exists) {
        const caseKeysData = privateDoc.data() || {};
        caseKeyItems =
          caseKeysData && typeof caseKeysData.items === 'object' && caseKeysData.items !== null
            ? caseKeysData.items
            : null;
      }
    } catch (err) {
      console.warn(
        `[gradeSubmission] Failed to load case keys for ${event.params.caseId} under app ${event.params.appId}`,
        err
      );
    }

    const disbursementMap = new Map();
    disbursementList.forEach((item) => {
      if (item && item.paymentId) {
        const normalized = { ...item };
        const caseKeyEntry = caseKeyItems?.[item.paymentId];
        if (caseKeyEntry) {
          if (caseKeyEntry.answerKey) {
            normalized.answerKey = caseKeyEntry.answerKey;
          }
          if (caseKeyEntry.answerKeyMode) {
            normalized.answerKeyMode = caseKeyEntry.answerKeyMode;
          }
          if (caseKeyEntry.answerKeySingleClassification) {
            normalized.answerKeySingleClassification =
              caseKeyEntry.answerKeySingleClassification;
          }
          if (caseKeyEntry.groundTruths) {
            normalized.groundTruths = caseKeyEntry.groundTruths;
          }
          if (caseKeyEntry.riskLevel && !normalized.riskLevel) {
            normalized.riskLevel = caseKeyEntry.riskLevel;
          }
        }
        disbursementMap.set(item.paymentId, normalized);
      }
    });

    const normalizeRef = (value) => (value || '').toString().trim().toLowerCase();
    const outstandingById = new Map();
    const outstandingByRef = new Map();
    cashOutstandingItems.forEach((item) => {
      if (item && item._tempId) {
        outstandingById.set(item._tempId, item);
      }
      const refKey = normalizeRef(item?.reference || item?.paymentId);
      if (refKey) {
        outstandingByRef.set(refKey, item);
      }
    });
    const cutoffById = new Map();
    const cutoffByRef = new Map();
    cashCutoffItems.forEach((item) => {
      if (item && item._tempId) {
        cutoffById.set(item._tempId, item);
      }
      const refKey = normalizeRef(item?.reference);
      if (refKey) {
        cutoffByRef.set(refKey, item);
      }
    });
    const scenarioByRef = new Map();
    const cutoffByScenarioRef = new Map();
    const scenarioClassificationMap = {
      clean: 'properlyExcluded',
      unrecorded: 'improperlyExcluded',
      fictitious: 'improperlyIncluded',
    };
    cashReconciliationMap.forEach((entry) => {
      const scenario = entry?.scenarioType;
      if (!scenario) return;
      let refKey = '';
      let cutoffRef = '';
      let cutoffDate = null;
      if (entry.outstandingTempId && outstandingById.has(entry.outstandingTempId)) {
        const outItem = outstandingById.get(entry.outstandingTempId);
        refKey = normalizeRef(outItem?.reference || outItem?.paymentId);
      }
      if (!refKey && entry.cutoffTempId && cutoffById.has(entry.cutoffTempId)) {
        const cutItem = cutoffById.get(entry.cutoffTempId);
        refKey = normalizeRef(cutItem?.reference);
        cutoffRef = refKey;
        cutoffDate = toSafeDate(cutItem?.clearDate || cutItem?.clear_date);
      }
      if (refKey) {
        scenarioByRef.set(refKey, scenario);
        if (cutoffRef) {
          cutoffByScenarioRef.set(refKey, cutoffDate);
        }
      }
    });
    let headerNoteAdded = false;
    const cutoffBaseDate =
      toSafeDate(cashContext.reportingDate || cashContext.reconciliationDate) ||
      toSafeDate(caseData.auditYearEnd || caseData.yearEnd || caseData.periodEnd);
    const cutoffWindowDays = Number(cashContext.cutoffWindowDays);
    const applyCutoffWindow = Number.isFinite(cutoffWindowDays) && cutoffWindowDays > 0;
    const testingThreshold = Number(cashContext.testingThreshold);
    const applyThreshold = Number.isFinite(testingThreshold) && testingThreshold > 0;

    const selectedIds =
      afterSelection.length > 0
        ? afterSelection
        : Object.keys(afterClassifications).filter(Boolean);

    let correctCount = 0;
    let totalCount = 0;
    const gradingDetails = {};
    const reviewNotes = [];
    const workspaceNotes = submission?.workspaceNotes || {};
    const globalAuditAreaRaw =
      typeof caseData.auditArea === 'string' && caseData.auditArea.trim()
        ? caseData.auditArea.trim()
        : '';
    const globalAuditArea = globalAuditAreaRaw || 'PAYABLES';

    selectedIds.forEach((paymentId) => {
      const disbursement = disbursementMap.get(paymentId);
      if (!disbursement) {
        return;
      }
      const userAllocations = afterClassifications[paymentId] || {};
      const detail = buildGradingDetail(disbursement, userAllocations);
      const issues = [];
      const workspaceEntry = workspaceNotes[paymentId] || {};
      const noteValue =
        (typeof userAllocations.notes === 'string' && userAllocations.notes) ||
        (typeof workspaceEntry.workpaperNote === 'string' && workspaceEntry.workpaperNote) ||
        (typeof workspaceEntry.notes === 'string' && workspaceEntry.notes) ||
        '';
      const trimmedNote = noteValue.trim();
      const userClassification =
        detail?.userClassification || userAllocations.singleClassification || '';
      const isException =
        typeof userClassification === 'string' &&
        ['improperlyIncluded', 'improperlyExcluded'].includes(userClassification);
      const hasNote = trimmedNote.length > 5;

      if (isException && !hasNote) {
        issues.push(
          'Documentation Deficiency: You proposed an adjustment but failed to document your evidence.'
        );
        detail.isCorrect = false;
      }

      const groundTruths = disbursement.groundTruths || {};
      const itemAuditAreaRaw =
        typeof disbursement.auditArea === 'string' && disbursement.auditArea.trim()
          ? disbursement.auditArea.trim()
          : '';
      const auditArea = itemAuditAreaRaw || globalAuditArea;

      const normalizedTotals = Object.keys(userAllocations).reduce((acc, key) => {
        const value = userAllocations[key];
        const numericValue = typeof value === 'number' ? value : Number(value);
        acc[key] = Number.isFinite(numericValue) ? numericValue : 0;
        return acc;
      }, {});

      const classificationSource =
        (typeof workspaceEntry.classification === 'string' && workspaceEntry.classification) ||
        userClassification ||
        findPrimaryClassification(normalizedTotals) ||
        '';
      const normalizedClassification = classificationSource.toLowerCase().replace(/[\s-]/g, '');
      const isProperlyIncluded =
        normalizedClassification === 'properly_included' || normalizedClassification === 'properlyincluded';
      const interactionDuration =
        typeof workspaceEntry.interactionDuration === 'number'
          ? workspaceEntry.interactionDuration
          : null;

      if (disbursement.riskLevel === 'high' && typeof interactionDuration === 'number' && interactionDuration < 5) {
        issues.push(
          'Review Note: You concluded on this high-risk item too quickly. Did you review all attachments?'
        );
      }

      switch (auditArea) {
        case 'PAYABLES': {
          if (
            groundTruths.servicePeriodEnd &&
            disbursement.paymentDate &&
            typeof groundTruths.servicePeriodEnd === 'string' &&
            typeof disbursement.paymentDate === 'string'
          ) {
            const glDate = new Date(disbursement.paymentDate);
            const svcDate = new Date(groundTruths.servicePeriodEnd);
            if (
              !Number.isNaN(glDate.getTime()) &&
              !Number.isNaN(svcDate.getTime()) &&
              svcDate > glDate &&
              svcDate.getMonth() !== glDate.getMonth()
            ) {
              if (userClassification === 'properlyIncluded') {
                issues.push(
                  'Cut-off Error: You accepted this item, but the service period indicates it belongs in the next period.'
                );
                detail.isCorrect = false;
              }
            }
            const yearEnd = toSafeDate(
              disbursement.yearEnd || caseData?.yearEnd || caseData?.auditYearEnd || caseData?.periodEnd
            );
            if (yearEnd && !Number.isNaN(yearEnd.getTime())) {
              if (svcDate <= yearEnd && glDate > yearEnd && normalizedClassification === 'properlyexcluded') {
                issues.push(
                  'Unrecorded Liability: Service occurred before year-end but payment was after. You should propose an accrued liability (improperly excluded).'
                );
                detail.isCorrect = false;
              }
            }
            if (
              workspaceEntry.selectedAssertion === 'cutoff' &&
              workspaceEntry.serviceEndInput &&
              typeof workspaceEntry.serviceEndInput === 'string'
            ) {
              const userDate = new Date(workspaceEntry.serviceEndInput);
              const trueDate = new Date(groundTruths.servicePeriodEnd);
              if (!Number.isNaN(userDate.getTime()) && !Number.isNaN(trueDate.getTime())) {
                const diffTime = Math.abs(userDate.getTime() - trueDate.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays > 1) {
                  issues.push(
                    'Review Note: Your conclusion is correct, but the Service Period date you documented does not match the invoice. Re-examine the document.'
                  );
                }
              }
            }
          }
          break;
        }
        case 'INVENTORY': {
          const actualRaw =
            groundTruths.actualCount ??
            groundTruths.actualValue ??
            groundTruths.confirmedValue ??
            null;
          const actualQty = actualRaw !== null ? Number(actualRaw) : NaN;
          const ledgerQty = Number(disbursement.amount);
          if (Number.isFinite(actualQty) && Number.isFinite(ledgerQty) && actualQty < ledgerQty) {
            if (userClassification === 'properlyIncluded') {
              issues.push(
                `Existence Error: Physical count (${actualQty}) is lower than the system record (${ledgerQty}). You should have proposed an adjustment.`
              );
              detail.isCorrect = false;
            }
          }
          if (typeof groundTruths.condition === 'string' && groundTruths.condition.trim()) {
            const conditionLower = groundTruths.condition.toLowerCase();
            if (conditionLower.includes('damaged') && !trimmedNote.toLowerCase().includes('damaged')) {
              issues.push(
                'Valuation Missing: Inventory noted as damaged in the evidence. Document the condition and consider an adjustment.'
              );
            }
          }
          break;
        }
        case 'CASH': {
          if (isException && hasNote) {
            const noteLower = trimmedNote.toLowerCase();
            if (!noteLower.includes('outstanding') && !noteLower.includes('transit')) {
              issues.push(
                "Terminology Warning: Cash variances are typically due to 'Outstanding Checks' or 'Deposits in Transit'. Please use precise terminology."
              );
            }
          }
          const refKey = normalizeRef(disbursement.paymentId || disbursement.payee);
          const scenario = scenarioByRef.get(refKey);
          const expectedClassification = scenario ? scenarioClassificationMap[scenario] : null;
          const cutoffRefDate = cutoffByScenarioRef.get(refKey);
          const outsideCutoffWindow =
            applyCutoffWindow &&
            cutoffBaseDate &&
            cutoffRefDate &&
            !Number.isNaN(cutoffRefDate.getTime()) &&
            cutoffRefDate.getTime() - cutoffBaseDate.getTime() > cutoffWindowDays * 24 * 60 * 60 * 1000;
          const belowThreshold = applyThreshold && Number(disbursement.amount) < testingThreshold;
          if (
            scenario &&
            expectedClassification &&
            expectedClassification !== normalizedClassification &&
            !outsideCutoffWindow &&
            !belowThreshold
          ) {
            issues.push(
              `Bank Rec Mismatch: Expected ${expectedClassification} based on reconciliation scenario (${scenario}).`
            );
            detail.isCorrect = false;
          }
          break;
        }
        default:
          break;
      }

      if (isProperlyIncluded && !workspaceEntry.evidenceLinked) {
        issues.push(
          'Documentation Deficiency: You vouched for existence but failed to link the supporting evidence in the workpaper.'
        );
      }

      if (issues.length > 0) {
        reviewNotes.push({
          paymentId,
          payee: disbursement.payee || null,
          notes: issues,
        });
      }

      gradingDetails[paymentId] = detail;
      totalCount += 1;
      if (detail.isCorrect) {
        correctCount += 1;
      }
    });

    const score = totalCount > 0 ? (correctCount / totalCount) * 100 : 0;
    const roundedScore = Math.round(score * 100) / 100;

    if (cashContext.simulateMathError && !headerNoteAdded) {
      reviewNotes.push({
        paymentId: 'cash_header',
        payee: null,
        notes: [
          'Header Check: Client bank rec may contain a math/transposition error. Ensure student ties bank and book balances.',
        ],
      });
      headerNoteAdded = true;
    }

    return event.data.after.ref.set(
      {
        grade: roundedScore,
        gradedAt: admin.firestore.FieldValue.serverTimestamp(),
        gradingDetails,
        virtualSeniorFeedback: reviewNotes,
      },
      { merge: true }
    );
  }
);

exports.createStripeCheckoutSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in to start checkout.');
  }
  if (!stripe || !stripeSecretKey) {
    throw new functions.https.HttpsError('failed-precondition', 'Stripe is not configured.');
  }

  const plan = typeof data?.plan === 'string' ? data.plan.trim().toLowerCase() : 'individual';
  const priceId = resolveStripePrice(plan);
  if (!priceId) {
    throw new functions.https.HttpsError('invalid-argument', 'Unsupported plan.');
  }

  const baseUrl = resolveBaseUrl(data);
  if (!baseUrl) {
    throw new functions.https.HttpsError('failed-precondition', 'Missing APP_BASE_URL.');
  }

  const uid = context.auth.uid;
  const email = context.auth.token?.email || toOptionalString(data?.email) || undefined;
  const appIdValue = resolveAppId(data);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/checkout/cancel`,
    client_reference_id: uid,
    customer_email: email,
    metadata: {
      uid,
      plan,
      appId: appIdValue,
    },
  });

  return { id: session.id, url: session.url };
});

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  if (!stripe || !stripeSecretKey || !STRIPE_WEBHOOK_SECRET) {
    res.status(500).send('Stripe not configured');
    return;
  }
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    res.status(400).send('Missing stripe-signature');
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripeWebhook] signature verification failed', err);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    const db = admin.firestore();
    const eventObject = event.data?.object || {};
    const eventMetadata = eventObject.metadata || {};
    const inferredAppId = eventMetadata.appId || DEFAULT_APP_ID;

    const { alreadyProcessed } = await recordStripeEvent({
      firestore: db,
      appIdValue: inferredAppId,
      event,
    });
    if (alreadyProcessed) {
      res.json({ received: true, duplicate: true });
      return;
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = eventObject || {};
      const metadata = session.metadata || {};
      const uid = metadata.uid || session.client_reference_id;
      const plan = metadata.plan || 'individual';
      const appIdValue = metadata.appId || inferredAppId;

      if (uid) {
        const billingRef = db.doc(buildBillingPath(appIdValue, uid));
        await billingRef.set(
          {
            status: 'paid',
            plan,
            stripeCustomerId: session.customer || null,
            stripeCheckoutSessionId: session.id || null,
            stripePaymentStatus: session.payment_status || null,
            stripePaymentIntentId: session.payment_intent || null,
            lastPaidAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (session.customer) {
          await db.doc(buildStripeCustomerPath(appIdValue, session.customer)).set(
            {
              uid,
              appId: appIdValue,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        if (session.payment_intent) {
          await db.doc(buildStripePaymentIntentPath(appIdValue, session.payment_intent)).set(
            {
              uid,
              appId: appIdValue,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }
    }

    if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
      const charge = eventObject || {};
      const customerId = charge.customer || null;
      const paymentIntentId = charge.payment_intent || null;
      const { uid, appIdValue } = await resolveBillingIdentityFromStripe({
        firestore: db,
        appIdValue: inferredAppId,
        customerId,
        paymentIntentId,
      });

      if (uid) {
        await db.doc(buildBillingPath(appIdValue, uid)).set(
          {
            status: 'revoked',
            stripePaymentStatus: charge.status || null,
            revokedReason: event.type,
            revokedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[stripeWebhook] handler failed', err);
    res.status(500).send('Webhook handler failed');
  }
});

exports.trackAnalyticsEvent = functions.https.onCall(async (data, context) => {
  const appIdValue = resolveAppId(data);
  const eventType = normalizeEventType(data?.eventType);
  const allowedEvents = new Set([
    'registration_completed',
    'checkout_started',
    'checkout_completed',
    'demo_started',
    'demo_submitted',
    'upgrade_clicked',
  ]);
  if (!allowedEvents.has(eventType)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unsupported event type.');
  }

  const payload = {
    eventType,
    uid: context.auth?.uid || null,
    demoSessionId: toOptionalString(data?.demoSessionId),
    metadata: isRecord(data?.metadata) ? data.metadata : null,
    userAgent: context.rawRequest?.headers?.['user-agent'] || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const db = admin.firestore();
  await db.collection(buildAnalyticsEventsCollection(appIdValue)).add(payload);
  return { ok: true };
});
