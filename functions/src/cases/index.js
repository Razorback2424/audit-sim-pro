const { functions, onDocumentWritten, admin, callable } = require('../shared/firebaseAdmin');
const { getTemplateRenderer } = require('../../pdfTemplates');
const { assertNoFieldValueInArrays } = require('../../utils/firestoreGuards');
const { buildCaseDraftFromRecipe } = require('../../generation/buildCaseDraft');
const { getCaseRecipe } = require('../../generation/recipeRegistry');
const { writeAnalyticsEvent } = require('../analytics/events');

const ANSWER_TOLERANCE = 0.01;
const CLASSIFICATION_KEYS = Object.freeze([
  'properlyIncluded',
  'properlyExcluded',
  'improperlyIncluded',
  'improperlyExcluded',
]);

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const normalizeText = (val) => (typeof val === 'string' ? val.trim().toLowerCase() : '');

const parseNumber = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeExpectedClassificationKey = (raw) => {
  if (!raw) return '';
  const text = normalizeText(raw);
  if (text.includes('missing') || text.includes('unrecorded')) return 'improperlyExcluded';
  if (text.includes('improperly') && text.includes('excluded')) return 'improperlyExcluded';
  if (text.includes('improperly') && text.includes('included')) return 'improperlyIncluded';
  if (text.includes('properly') && text.includes('excluded')) return 'properlyExcluded';
  if (text.includes('properly') && text.includes('included')) return 'properlyIncluded';
  if (CLASSIFICATION_KEYS.includes(text)) return text;
  return '';
};

const extractBreakdown = (source) =>
  CLASSIFICATION_KEYS.map((key) => ({ key, amount: parseNumber(source?.[key]) }))
    .filter(({ amount }) => Math.abs(amount) > 0.0001)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

const extractDecisionFromAllocation = (allocation) => {
  if (!allocation || typeof allocation !== 'object') {
    return { primaryKey: '' };
  }

  const explicitKey = typeof allocation.singleClassification === 'string' ? allocation.singleClassification : '';
  if (CLASSIFICATION_KEYS.includes(explicitKey)) {
    return { primaryKey: explicitKey };
  }

  const breakdown = extractBreakdown(
    allocation?.splitValues && typeof allocation.splitValues === 'object'
      ? allocation.splitValues
      : allocation
  );
  if (breakdown.length > 0) {
    return { primaryKey: breakdown[0].key };
  }

  if (allocation.isException === true) return { primaryKey: 'improperlyIncluded' };
  if (allocation.isException === false) return { primaryKey: 'properlyIncluded' };
  return { primaryKey: '' };
};

const extractCorrectDecision = (item) => {
  const explicitKey =
    typeof item?.answerKeySingleClassification === 'string' ? item.answerKeySingleClassification : '';
  if (CLASSIFICATION_KEYS.includes(explicitKey)) {
    return { primaryKey: explicitKey };
  }

  const answerKey = item?.answerKey && typeof item.answerKey === 'object' ? item.answerKey : null;
  const breakdown = answerKey ? extractBreakdown(answerKey) : [];
  if (breakdown.length > 0) {
    return { primaryKey: breakdown[0].key };
  }

  const expectedKey = normalizeExpectedClassificationKey(item?.expectedClassification);
  if (expectedKey) {
    return { primaryKey: expectedKey };
  }

  return { primaryKey: '' };
};

const computeDisbursementAttemptSummary = ({ disbursements = [], studentAnswers = {} }) => {
  const selectedIds = new Set(
    studentAnswers && typeof studentAnswers === 'object' ? Object.keys(studentAnswers) : []
  );

  let missedExceptionsCount = 0;
  let falsePositivesCount = 0;
  let wrongClassificationCount = 0;
  let wrongRoutineClassificationCount = 0;
  let routineCorrectCount = 0;
  let caughtTrapsCount = 0;

  (disbursements || []).forEach((item) => {
    if (!item || !item.paymentId) return;
    const isTrap = !!item.shouldFlag;
    const answer = studentAnswers[item.paymentId] || null;
    const hasAnswer = selectedIds.has(item.paymentId);
    const studentDecision = extractDecisionFromAllocation(answer);
    const correctDecision = extractCorrectDecision(item);

    if (isTrap) {
      if (!answer?.isException) {
        missedExceptionsCount += 1;
        return;
      }

      const expectedKey = correctDecision.primaryKey;
      if (expectedKey) {
        const matches = normalizeText(studentDecision.primaryKey) === normalizeText(expectedKey);
        if (!matches) {
          wrongClassificationCount += 1;
        } else {
          caughtTrapsCount += 1;
        }
      } else {
        caughtTrapsCount += 1;
      }
      return;
    }

    if (!hasAnswer) return;
    if (answer?.isException === true) {
      falsePositivesCount += 1;
      return;
    }

    if (
      correctDecision.primaryKey &&
      normalizeText(studentDecision.primaryKey) === normalizeText(correctDecision.primaryKey)
    ) {
      routineCorrectCount += 1;
      return;
    }

    if (correctDecision.primaryKey) {
      wrongRoutineClassificationCount += 1;
    }
  });

  const criticalIssuesCount = missedExceptionsCount + wrongClassificationCount;
  const totalConsidered =
    caughtTrapsCount +
    missedExceptionsCount +
    wrongClassificationCount +
    routineCorrectCount +
    falsePositivesCount +
    wrongRoutineClassificationCount;
  const score =
    totalConsidered > 0
      ? Math.round(
          ((totalConsidered - criticalIssuesCount - falsePositivesCount - wrongRoutineClassificationCount) /
            totalConsidered) *
            100
        )
      : null;

  return {
    score,
    totalConsidered,
    trapsCount: caughtTrapsCount + missedExceptionsCount + wrongClassificationCount,
    routineCount: routineCorrectCount + falsePositivesCount + wrongRoutineClassificationCount,
    missedExceptionsCount,
    falsePositivesCount,
    wrongClassificationCount,
    wrongRoutineClassificationCount,
    criticalIssuesCount,
  };
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

const buildBillingPath = (appIdValue, uid) => `artifacts/${appIdValue}/users/${uid}/billing/status`;
const buildCaseKeysPath = (appIdValue, caseId) =>
  `artifacts/${appIdValue}/private/data/case_keys/${caseId}`;

const loadCaseKeyItems = async ({ firestore, appId, caseId, logLabel }) => {
  try {
    const privateDoc = await firestore.doc(buildCaseKeysPath(appId, caseId)).get();
    if (!privateDoc.exists) return null;
    const caseKeysData = privateDoc.data() || {};
    const items =
      caseKeysData && typeof caseKeysData.items === 'object' && caseKeysData.items !== null
        ? caseKeysData.items
        : null;
    return items;
  } catch (err) {
    console.warn(`[${logLabel}] Failed to load case keys for ${caseId} under app ${appId}`, err);
    return null;
  }
};

const commitBatches = async ({ firestore, updates }) => {
  const batchSize = 450;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = firestore.batch();
    updates.slice(i, i + batchSize).forEach(({ ref, data }) => {
      batch.set(ref, data, { merge: true });
    });
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
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
    publicVisible: accessLevel === 'demo',
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

const collectCaseStoragePaths = (caseData, bucketName, { allowDownloadUrl = true } = {}) => {
  const paths = new Set();
  const addPath = (value) => {
    const normalized = normalizeStoragePath(value, bucketName);
    if (normalized) paths.add(normalized);
  };
  const addDocument = (doc) => {
    if (!doc || typeof doc !== 'object') return;
    addPath(doc.storagePath);
    if (allowDownloadUrl && !doc.storagePath && doc.downloadURL) {
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
    if (allowDownloadUrl && !item.storagePath && item.downloadURL) {
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
  addDocuments(caseData?.cashArtifacts);
  addDocuments(caseData?.invoiceMappings);
  addItems(caseData?.auditItems);
  addItems(caseData?.disbursements);

  return Array.from(paths);
};

const buildCaseStoragePrefixes = (appId, caseId) => [
  `artifacts/${appId}/case_documents/${caseId}/`,
  `artifacts/${appId}/case_reference/${caseId}/`,
  `artifacts/${appId}/case_highlight/${caseId}/`,
  `artifacts/${appId}/case_highlights/${caseId}/`,
];

const isCaseScopedStoragePath = ({ appId, caseId, path }) => {
  if (!appId || !caseId || !path) return false;
  return buildCaseStoragePrefixes(appId, caseId).some((prefix) => path.startsWith(prefix));
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

const buildDisbursementMap = ({ disbursementList = [], caseKeyItems = null }) => {
  const disbursementMap = new Map();
  disbursementList.forEach((item) => {
    if (!item || !item.paymentId) {
      return;
    }
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
        normalized.answerKeySingleClassification = caseKeyEntry.answerKeySingleClassification;
      }
      if (caseKeyEntry.groundTruths) {
        normalized.groundTruths = caseKeyEntry.groundTruths;
      }
      if (caseKeyEntry.riskLevel && !normalized.riskLevel) {
        normalized.riskLevel = caseKeyEntry.riskLevel;
      }
    }
    disbursementMap.set(item.paymentId, normalized);
  });
  return disbursementMap;
};

const computeGradingOutput = ({ caseData = {}, caseKeyItems = null, submission = {} }) => {
  const disbursementList = Array.isArray(caseData.disbursements) ? caseData.disbursements : [];
  const cashContext = caseData.cashContext || {};
  const cashOutstandingItems = Array.isArray(caseData.cashOutstandingItems)
    ? caseData.cashOutstandingItems
    : [];
  const cashCutoffItems = Array.isArray(caseData.cashCutoffItems) ? caseData.cashCutoffItems : [];
  const cashReconciliationMap = Array.isArray(caseData.cashReconciliationMap)
    ? caseData.cashReconciliationMap
    : [];

  const caseKeyMap = buildDisbursementMap({ disbursementList, caseKeyItems });

  const normalizeRef = (value) => (value || '').toString().trim().toLowerCase();
  const outstandingById = new Map();
  cashOutstandingItems.forEach((item) => {
    if (item && item._tempId) {
      outstandingById.set(item._tempId, item);
    }
  });
  const cutoffById = new Map();
  cashCutoffItems.forEach((item) => {
    if (item && item._tempId) {
      cutoffById.set(item._tempId, item);
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

  const afterClassifications = submission?.disbursementClassifications || {};
  const afterSelection = normalizeSelection(submission?.selectedPaymentIds || []);
  const selectedIds =
    afterSelection.length > 0 ? afterSelection : Object.keys(afterClassifications).filter(Boolean);

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
    const disbursement = caseKeyMap.get(paymentId);
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

  return {
    grade: roundedScore,
    gradingDetails,
    virtualSeniorFeedback: reviewNotes,
    disbursements: Array.from(caseKeyMap.values()),
  };
};

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

    return null;
  });

const resolveRequesterIdentity = async ({ context, appId, firestore, logLabel }) => {
  const requesterRole = context.auth.token?.role;
  let requesterOrgId = context.auth.token?.orgId ?? null;
  const resolvedRole = typeof requesterRole === 'string' ? requesterRole.toLowerCase() : requesterRole;

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
  return status === 'active';
};

const DEFAULT_STUDENT_STATUSES = ['assigned', 'in_progress', 'submitted', 'draft'];
const VALID_STUDENT_STATUSES = new Set(['assigned', 'in_progress', 'submitted', 'draft', 'archived']);

const normalizeStudentStatusFilter = (value) => {
  if (!Array.isArray(value)) return DEFAULT_STUDENT_STATUSES;
  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter((entry) => VALID_STUDENT_STATUSES.has(entry));
  return normalized.length > 0 ? normalized : DEFAULT_STUDENT_STATUSES;
};

const normalizeStudentSort = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'title' ? 'title' : 'due';
};

const normalizeCursorTimestamp = (value) => {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (typeof value?.toDate === 'function') {
    return admin.firestore.Timestamp.fromDate(value.toDate());
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return admin.firestore.Timestamp.fromMillis(value);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return admin.firestore.Timestamp.fromDate(parsed);
    }
  }
  if (typeof value === 'object') {
    const seconds =
      typeof value.seconds === 'number'
        ? value.seconds
        : typeof value._seconds === 'number'
        ? value._seconds
        : null;
    if (typeof seconds === 'number') {
      const nanoseconds =
        typeof value.nanoseconds === 'number'
          ? value.nanoseconds
          : typeof value._nanoseconds === 'number'
          ? value._nanoseconds
          : 0;
      return new admin.firestore.Timestamp(seconds, nanoseconds);
    }
  }
  return null;
};

const toCursorTimestamp = (value) => {
  if (!value) return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  const safeDate = toSafeDate(value);
  return safeDate ? safeDate.getTime() : null;
};

exports.listStudentCases = callable.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appId = data?.appId;
  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }

  const firestore = admin.firestore();
  const { resolvedRole } = await resolveRequesterIdentity({
    context,
    appId,
    firestore,
    logLabel: 'listStudentCases',
  });

  if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && resolvedRole !== 'instructor' && resolvedRole !== 'trainee') {
    throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
  }

  const pageSizeRaw = Number(data?.pageSize);
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.max(1, Math.min(100, Math.floor(pageSizeRaw)))
    : 20;
  const includeOpensAtGate = data?.includeOpensAtGate === true;
  const statusFilter = normalizeStudentStatusFilter(data?.statusFilter);
  const sortBy = normalizeStudentSort(data?.sortBy);
  const cursor = data?.cursor && typeof data.cursor === 'object' ? data.cursor : null;

  const uid = context.auth.uid;
  const isPaid = resolvedRole === 'trainee' ? await hasPaidAccessServer({ firestore, appId, uid }) : true;

  const casesCollection = firestore.collection(`artifacts/${appId}/public/data/cases`);
  const filters = [admin.firestore.Filter.where('_deleted', '==', false)];

  if (statusFilter && statusFilter.length > 0) {
    filters.push(admin.firestore.Filter.where('status', 'in', statusFilter));
  }

  if (includeOpensAtGate) {
    filters.push(admin.firestore.Filter.where('opensAt', '<=', admin.firestore.Timestamp.now()));
  }

  if (resolvedRole === 'trainee') {
    if (!isPaid) {
      filters.push(admin.firestore.Filter.where('publicVisible', '==', true));
      filters.push(admin.firestore.Filter.where('accessLevel', '==', 'demo'));
    } else {
      filters.push(
        admin.firestore.Filter.or(
          admin.firestore.Filter.where('publicVisible', '==', true),
          admin.firestore.Filter.where('visibleToUserIds', 'array-contains', uid)
        )
      );
    }
  }

  let query = casesCollection.where(admin.firestore.Filter.and(...filters));

  if (sortBy === 'title') {
    query = query.orderBy('title', 'asc').orderBy('dueAt', 'asc');
  } else {
    query = query.orderBy('dueAt', 'asc').orderBy('title', 'asc');
  }

  if (cursor) {
    const cursorTitle = toTrimmedString(cursor?.title || '');
    const cursorDueAt = normalizeCursorTimestamp(cursor?.dueAt);
    if (sortBy === 'title') {
      query = query.startAfter(cursorTitle, cursorDueAt ?? null);
    } else {
      query = query.startAfter(cursorDueAt ?? null, cursorTitle);
    }
  }

  if (pageSize) {
    query = query.limit(pageSize);
  }

  const snap = await query.get();
  const items = snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {} }));
  const lastItem = items[items.length - 1];

  let nextCursor = null;
  if (lastItem) {
    const data = lastItem.data || {};
    nextCursor = {
      dueAt: toCursorTimestamp(data.dueAt ?? null),
      title: toTrimmedString(data.title || data.caseName || ''),
    };
  }

  return { items, nextCursor };
});

exports.listRosterOptions = callable.https.onCall(async (data, context) => {
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

exports.getSignedDocumentUrl = callable.https.onCall(async (data, context) => {
  const appId = data?.appId;
  const caseId = data?.caseId;
  const rawStoragePath = typeof data?.storagePath === 'string' ? data.storagePath.trim() : '';
  const rawDownloadUrl = typeof data?.downloadURL === 'string' ? data.downloadURL.trim() : '';
  const requireStoragePath = data?.requireStoragePath === true;
  const docLabel = typeof data?.docLabel === 'string' ? data.docLabel.trim() : '';
  const docKind = typeof data?.docKind === 'string' ? data.docKind.trim() : '';

  const logEvidenceFailure = async (reason) => {
    try {
      await writeAnalyticsEvent({
        appId,
        uid: context.auth?.uid || null,
        eventName: 'evidence_open_failed',
        caseId,
        props: {
          docKind: docKind || null,
          docLabel: docLabel || null,
          reason,
        },
        source: 'server',
      });
    } catch (err) {
      console.warn('[getSignedDocumentUrl] Failed to log evidence_open_failed', err);
    }
  };

  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }
  if (!caseId || typeof caseId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'caseId is required.');
  }
  if (requireStoragePath && !rawStoragePath) {
    console.warn('[getSignedDocumentUrl] Missing storagePath for required request.', {
      uid: context.auth?.uid || null,
      caseId,
      appId,
      docLabel: docLabel || null,
    });
    await logEvidenceFailure('missing_storage_path');
    throw new functions.https.HttpsError('failed-precondition', 'Document unavailable—re-upload required.');
  }
  if (!rawStoragePath && !rawDownloadUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'storagePath or downloadURL is required.');
  }

  const firestore = admin.firestore();
  const isAuthenticated = Boolean(context.auth);
  let resolvedRole = null;
  let requesterOrgId = null;

  if (isAuthenticated) {
    const identity = await resolveRequesterIdentity({
      context,
      appId,
      firestore,
      logLabel: 'getSignedDocumentUrl',
    });
    resolvedRole = identity.resolvedRole;
    requesterOrgId = identity.requesterOrgId;

    if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && resolvedRole !== 'instructor' && resolvedRole !== 'trainee') {
      await logEvidenceFailure('permission_denied');
      throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
    }

    if (resolvedRole === 'instructor' && !requesterOrgId) {
      throw new functions.https.HttpsError('failed-precondition', 'Instructor has no Org ID.');
    }
  }

  const bucket = admin.storage().bucket();
  if ((!isAuthenticated || resolvedRole === 'trainee') && !rawStoragePath) {
    console.warn('[getSignedDocumentUrl] Trainee request missing storagePath.', {
      uid: context.auth?.uid || null,
      caseId,
      appId,
      docLabel: docLabel || null,
    });
    await logEvidenceFailure('missing_storage_path');
    throw new functions.https.HttpsError('failed-precondition', 'Document unavailable—re-upload required.');
  }

  const normalizedPath = normalizeStoragePath(rawStoragePath || rawDownloadUrl, bucket.name);
  if (!normalizedPath) {
    throw new functions.https.HttpsError('invalid-argument', 'Unable to resolve storage path.');
  }

  if (caseId === 'debug') {
    if (!isAuthenticated || (resolvedRole !== 'admin' && resolvedRole !== 'owner')) {
      await logEvidenceFailure('permission_denied');
      throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions for debug documents.');
    }
    const expectedPrefix = `artifacts/${appId}/debug/reference/`;
    if (!normalizedPath.startsWith(expectedPrefix)) {
      await logEvidenceFailure('permission_denied');
      throw new functions.https.HttpsError('permission-denied', 'Document not within debug scope.');
    }
    const expiresAtMs = Date.now() + 10 * 60 * 1000;
    let url = '';
    try {
      [url] = await bucket.file(normalizedPath).getSignedUrl({
        action: 'read',
        expires: expiresAtMs,
      });
    } catch (err) {
      await logEvidenceFailure('signing_error');
      throw err;
    }
    try {
      await writeAnalyticsEvent({
        appId,
        uid: context.auth?.uid || null,
        eventName: 'evidence_signed_url_issued',
        caseId,
        props: { docKind: docKind || null, docLabel: docLabel || null },
        source: 'server',
        dedupeKey: `${context.auth?.uid || 'anon'}|${caseId}|${normalizedPath}|evidence_signed_url_issued`,
      });
    } catch (err) {
      console.warn('[getSignedDocumentUrl] Failed to log evidence_signed_url_issued', err);
    }
    return { url, expiresAt: expiresAtMs };
  }

  const resolved = await resolveCaseAppId(firestore, appId, caseId);
  if (!resolved) {
    throw new functions.https.HttpsError('not-found', 'Case not found for provided appId.');
  }
  const { appId: resolvedAppId, caseData, caseMissing } = resolved;

  if (caseMissing || !caseData) {
    throw new functions.https.HttpsError('not-found', 'Case not found.');
  }

  if (resolvedRole === 'instructor') {
    if (!caseData?.orgId || caseData.orgId !== requesterOrgId) {
      await logEvidenceFailure('permission_denied');
      throw new functions.https.HttpsError('permission-denied', 'Case is outside instructor org.');
    }
  }

  if (resolvedRole === 'trainee') {
    const uid = context.auth.uid;
    const isPaid = await hasPaidAccessServer({ firestore, appId: resolvedAppId, uid });
    const visibleToUserIds = Array.isArray(caseData?.visibleToUserIds) ? caseData.visibleToUserIds : [];
    const isPublicVisible = caseData?.publicVisible === true;
    const accessLevel = typeof caseData?.accessLevel === 'string' ? caseData.accessLevel.trim().toLowerCase() : 'paid';
    const isNotDeleted = caseData?._deleted === false;
    const opensAtMs = toCursorTimestamp(caseData?.opensAt);

    if (!isNotDeleted) {
      await logEvidenceFailure('permission_denied');
      throw new functions.https.HttpsError('permission-denied', 'Case is not available.');
    }

    if (opensAtMs && opensAtMs > Date.now()) {
      await logEvidenceFailure('permission_denied');
      throw new functions.https.HttpsError('permission-denied', 'Case is not yet available.');
    }

    if (isPaid) {
      if (!isPublicVisible && !visibleToUserIds.includes(uid)) {
        await logEvidenceFailure('permission_denied');
        throw new functions.https.HttpsError('permission-denied', 'Case is not assigned to trainee.');
      }
    } else {
      if (!(isPublicVisible && accessLevel === 'demo')) {
        await logEvidenceFailure('permission_denied');
        throw new functions.https.HttpsError('permission-denied', 'Case is not available for demo access.');
      }
    }
  }

  if (!isAuthenticated) {
    const isPublicVisible = caseData?.publicVisible === true;
    const accessLevel = typeof caseData?.accessLevel === 'string' ? caseData.accessLevel.trim().toLowerCase() : 'paid';
    const isNotDeleted = caseData?._deleted === false;
    const opensAtMs = toCursorTimestamp(caseData?.opensAt);
    if (!(isPublicVisible && accessLevel === 'demo' && isNotDeleted)) {
      await logEvidenceFailure('permission_denied');
      throw new functions.https.HttpsError('permission-denied', 'Case is not available for demo access.');
    }
    if (opensAtMs && opensAtMs > Date.now()) {
      await logEvidenceFailure('permission_denied');
      throw new functions.https.HttpsError('permission-denied', 'Case is not available for demo access.');
    }
  }

  const allowedPaths = collectCaseStoragePaths(caseData, bucket.name, {
    allowDownloadUrl: !(requireStoragePath || resolvedRole === 'trainee' || !isAuthenticated),
  });
  if (!allowedPaths.includes(normalizedPath)) {
    await logEvidenceFailure('permission_denied');
    throw new functions.https.HttpsError('permission-denied', 'Document not associated with case.');
  }

  if (
    (!isAuthenticated || (resolvedRole !== 'admin' && resolvedRole !== 'owner')) &&
    !isCaseScopedStoragePath({ appId: resolvedAppId, caseId, path: normalizedPath })
  ) {
    await logEvidenceFailure('path_outside_case_scope');
    throw new functions.https.HttpsError('permission-denied', 'Document path is outside case scope.');
  }

  const expiresAtMs = Date.now() + 10 * 60 * 1000;
  let url = '';
  try {
    [url] = await bucket.file(normalizedPath).getSignedUrl({
      action: 'read',
      expires: expiresAtMs,
    });
  } catch (err) {
    await logEvidenceFailure('signing_error');
    throw err;
  }

  try {
    await writeAnalyticsEvent({
      appId: resolvedAppId,
      uid: context.auth?.uid || null,
      eventName: 'evidence_signed_url_issued',
      caseId,
      props: { docKind: docKind || null, docLabel: docLabel || null },
      source: 'server',
      dedupeKey: `${context.auth?.uid || 'anon'}|${caseId}|${normalizedPath}|evidence_signed_url_issued`,
    });
  } catch (err) {
    console.warn('[getSignedDocumentUrl] Failed to log evidence_signed_url_issued', err);
  }

  return { url, expiresAt: expiresAtMs };
});

exports.auditOrphanedInvoices = callable.https.onCall(async (data, context) => {
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

exports.queueCaseDocGeneration = callable.https.onCall(async (data, context) => {
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

exports.generateCaseDraft = callable.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appId = toOptionalString(data?.appId);
  const recipeId = toOptionalString(data?.recipeId || data?.moduleId);
  if (!appId) {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }
  if (!recipeId) {
    throw new functions.https.HttpsError('invalid-argument', 'recipeId is required.');
  }

  const firestore = admin.firestore();
  const { resolvedRole } = await resolveRequesterIdentity({
    context,
    appId,
    firestore,
    logLabel: 'generateCaseDraft',
  });

  if (resolvedRole !== 'admin' && resolvedRole !== 'owner' && resolvedRole !== 'instructor') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }

  const overrides = isRecord(data?.overrides) ? data.overrides : {};
  try {
    const draft = buildCaseDraftFromRecipe({ recipeId, overrides });
    return { draft };
  } catch (error) {
    console.error('[generateCaseDraft] Failed to build draft', error);
    throw new functions.https.HttpsError(
      'failed-precondition',
      error?.message || 'Unable to generate case draft.'
    );
  }
});

exports.startCaseAttempt = callable.https.onCall(async (data, context) => {
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
  let allowDemoOnly = false;
  if (resolvedRole === 'trainee') {
    const isPaid = await hasPaidAccessServer({ firestore, appId, uid });
    allowDemoOnly = !isPaid;
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
    if (allowDemoOnly) {
      const accessLevel =
        typeof caseData?.accessLevel === 'string' ? caseData.accessLevel.trim().toLowerCase() : 'paid';
      return caseData?.publicVisible === true && accessLevel === 'demo';
    }
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

exports.scoreCaseAttempt = callable.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const appId = toOptionalString(data?.appId);
  const caseId = toOptionalString(data?.caseId);
  const submission = isRecord(data?.submission) ? data.submission : null;

  if (!appId) {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }
  if (!caseId) {
    throw new functions.https.HttpsError('invalid-argument', 'caseId is required.');
  }
  if (!submission) {
    throw new functions.https.HttpsError('invalid-argument', 'submission is required.');
  }

  const firestore = admin.firestore();
  const uid = context.auth.uid;

  const caseSnapshot = await firestore
    .doc(`artifacts/${appId}/public/data/cases/${caseId}`)
    .get();

  if (!caseSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'Case not found.');
  }

  const caseData = caseSnapshot.data() || {};
  if (caseData._deleted === true) {
    throw new functions.https.HttpsError('failed-precondition', 'Case is not available.');
  }

  const hasPaid = await hasPaidAccessServer({ firestore, appId, uid });
  const isPublicVisible = caseData.publicVisible === true;
  if (!isPublicVisible && !hasPaid) {
    throw new functions.https.HttpsError('permission-denied', 'Access to this case is restricted.');
  }

  const caseKeyItems = await loadCaseKeyItems({
    firestore,
    appId,
    caseId,
    logLabel: 'scoreCaseAttempt',
  });

  const gradingOutput = computeGradingOutput({
    caseData,
    caseKeyItems,
    submission,
  });

  const disbursementClassifications = isRecord(submission.disbursementClassifications)
    ? submission.disbursementClassifications
    : {};
  const attemptSummaryBase = computeDisbursementAttemptSummary({
    disbursements: gradingOutput.disbursements,
    studentAnswers: disbursementClassifications,
  });
  const summaryOverrides = isRecord(submission.attemptSummary) ? submission.attemptSummary : {};
  const requiredDocsOpened =
    typeof summaryOverrides.requiredDocsOpened === 'boolean' ? summaryOverrides.requiredDocsOpened : null;
  const timeToCompleteSecondsRaw = Number(summaryOverrides.timeToCompleteSeconds);
  const timeToCompleteSeconds =
    Number.isFinite(timeToCompleteSecondsRaw) && timeToCompleteSecondsRaw >= 0
      ? timeToCompleteSecondsRaw
      : null;

  const submissionRef = firestore.doc(
    `artifacts/${appId}/users/${uid}/caseSubmissions/${caseId}`
  );

  let attemptIndex = Number(submission.attemptIndex);
  if (!Number.isFinite(attemptIndex) || attemptIndex <= 0) {
    try {
      const existingSnap = await submissionRef.get();
      const existingAttempts = Array.isArray(existingSnap.data()?.attempts)
        ? existingSnap.data().attempts
        : [];
      attemptIndex = existingAttempts.length + 1;
    } catch (error) {
      attemptIndex = 1;
    }
  }

  const attemptTypeRaw = typeof submission.attemptType === 'string' ? submission.attemptType.trim() : '';
  const attemptTypeCandidate = attemptTypeRaw || (attemptIndex === 1 ? 'baseline' : 'practice');
  const attemptType = ['baseline', 'practice', 'final'].includes(attemptTypeCandidate)
    ? attemptTypeCandidate
    : attemptIndex === 1
    ? 'baseline'
    : 'practice';

  const attemptSummary = {
    ...attemptSummaryBase,
    requiredDocsOpened,
    timeToCompleteSeconds,
    attemptIndex,
    attemptType,
    isBaseline: attemptIndex === 1,
  };

  const {
    grade: _ignoredGrade,
    gradedAt: _ignoredGradedAt,
    gradingDetails: _ignoredGradingDetails,
    virtualSeniorFeedback: _ignoredFeedback,
    attemptSummary: _ignoredAttemptSummary,
    status,
    ...attemptData
  } = submission;

  const attemptPayload = {
    ...attemptData,
    attemptIndex,
    attemptType,
    submittedAt: admin.firestore.Timestamp.now(),
    attemptSummary,
  };

  const docPayload = {
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    attempts: admin.firestore.FieldValue.arrayUnion(attemptPayload),
    grade: gradingOutput.grade,
    gradedAt: admin.firestore.FieldValue.serverTimestamp(),
    gradingDetails: gradingOutput.gradingDetails,
    virtualSeniorFeedback: gradingOutput.virtualSeniorFeedback,
    scoredBy: 'callable',
  };

  if (status) docPayload.status = status;

  [
    'selectedPaymentIds',
    'retrievedDocuments',
    'disbursementClassifications',
    'expectedClassifications',
    'workspaceNotes',
    'fixedAssetResponses',
  ].forEach((key) => {
    if (submission[key] !== undefined) {
      docPayload[key] = submission[key];
    }
  });

  await submissionRef.set(docPayload, { merge: true });

  return {
    grade: gradingOutput.grade,
    gradingDetails: gradingOutput.gradingDetails,
    virtualSeniorFeedback: gradingOutput.virtualSeniorFeedback,
    attemptSummary,
    attemptIndex,
    attemptType,
  };
});

exports.seedCasePool = callable.https.onCall(async (data, context) => {
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

exports.setDemoCase = callable.https.onCall(async (data, context) => {
  try {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }

    const appId = data?.appId;
    const caseId = data?.caseId;
    const backfillPaid = data?.backfillPaid !== false;
    const queueDocuments = data?.queueDocuments !== false;

    if (!appId || typeof appId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
    }
    if (!caseId || typeof caseId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'caseId is required.');
    }

    const firestore = admin.firestore();
    const { resolvedRole } = await resolveRequesterIdentity({
      context,
      appId,
      firestore,
      logLabel: 'setDemoCase',
    });

    if (resolvedRole !== 'admin' && resolvedRole !== 'owner') {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    }

    const caseRef = firestore.doc(`artifacts/${appId}/public/data/cases/${caseId}`);
    const caseSnap = await caseRef.get();
    if (!caseSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Case not found.');
    }
    const caseData = caseSnap.data() || {};
    if (caseData._deleted === true) {
      throw new functions.https.HttpsError('failed-precondition', 'Cannot set a deleted case as demo.');
    }

    const demoPatch = {
      accessLevel: 'demo',
      publicVisible: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await caseRef.set(demoPatch, { merge: true });

    let updatedCount = 1;
    if (backfillPaid) {
      const casesSnap = await firestore
        .collection(`artifacts/${appId}/public/data/cases`)
        .where('_deleted', '==', false)
        .get();
      const updates = [];
      casesSnap.forEach((docSnap) => {
        if (docSnap.id === caseId) return;
        const data = docSnap.data() || {};
        const rawAccess = typeof data.accessLevel === 'string' ? data.accessLevel.trim().toLowerCase() : '';
        const hasAccessLevel = typeof data.accessLevel === 'string' && data.accessLevel.trim().length > 0;
        if (!hasAccessLevel || rawAccess !== 'paid') {
          updates.push({
            ref: docSnap.ref,
            data: {
              accessLevel: 'paid',
              publicVisible: false,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          });
        }
      });
      if (updates.length > 0) {
        await commitBatches({ firestore, updates });
        updatedCount += updates.length;
      }
    }

    const configRef = firestore.doc(`artifacts/${appId}/public/config/demo/config`);
    await configRef.set(
      {
        caseId,
        caseName: caseData.caseName || caseData.title || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    let generationJobId = null;
    let generationStatus = null;
    if (queueDocuments) {
      const needsGeneration = !isCaseReady(caseData);
      if (needsGeneration) {
        const planSnap = await firestore
          .doc(`artifacts/${appId}/private/data/case_generation_plans/${caseId}`)
          .get();
        const plan = planSnap.exists ? planSnap.data()?.plan : null;
        if (plan) {
          const job = await queueGenerationJob({
            firestore,
            appId,
            caseId,
            plan,
            requestedBy: context.auth.uid,
            orgId: null,
          });
          generationJobId = job?.jobId || null;
          generationStatus = job?.status || null;
        } else {
          generationStatus = 'missing-plan';
        }
      } else {
        generationStatus = 'ready';
      }
    }

    return {
      demoCaseId: caseId,
      updatedCount,
      generationJobId,
      generationStatus,
    };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) {
      throw err;
    }
    console.error('[setDemoCase] Failed to update demo case', err);
    throw new functions.https.HttpsError('internal', err?.message || 'Unable to set demo case.');
  }
});

exports.generateDebugRefdoc = functions
  .runWith({ enforceAppCheck: true, memory: '512MB', timeoutSeconds: 60 })
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

exports.deleteRetakeAttempt = callable.https.onCall(async (data, context) => {
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
    const caseKeyItems = await loadCaseKeyItems({
      firestore,
      appId: event.params.appId,
      caseId: event.params.caseId,
      logLabel: 'gradeSubmission',
    });
    const gradingOutput = computeGradingOutput({
      caseData,
      caseKeyItems,
      submission,
    });

    return event.data.after.ref.set(
      {
        grade: gradingOutput.grade,
        gradedAt: admin.firestore.FieldValue.serverTimestamp(),
        gradingDetails: gradingOutput.gradingDetails,
        virtualSeniorFeedback: gradingOutput.virtualSeniorFeedback,
      },
      { merge: true }
    );
  }
);
