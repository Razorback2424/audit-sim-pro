// functions/index.js
const functions = require('firebase-functions');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { getTemplateRenderer } = require('./pdfTemplates');
const { assertNoFieldValueInArrays } = require('./utils/firestoreGuards');

// Initialize Firebase Admin SDK
// This is typically done automatically when deploying to Cloud Functions.
// For local testing, you might need: admin.initializeApp({ credential: admin.credential.applicationDefault() });
admin.initializeApp();

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

const renderPdfFromHtml = async (html, pdfOptions = {}) => {
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

const resolveRequesterIdentity = async ({ context, appId, firestore, logLabel }) => {
  const requesterRole = context.auth.token?.role;
  let requesterOrgId = context.auth.token?.orgId ?? null;
  let resolvedRole = requesterRole;

  if (resolvedRole !== 'admin' && resolvedRole !== 'instructor') {
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

  if (resolvedRole !== 'admin' && resolvedRole !== 'instructor') {
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

  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }
  if (!caseId || typeof caseId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'caseId is required.');
  }
  if (plan !== null && typeof plan !== 'object') {
    throw new functions.https.HttpsError('invalid-argument', 'plan must be an object when provided.');
  }

  const firestore = admin.firestore();
  const { resolvedRole, requesterOrgId } = await resolveRequesterIdentity({
    context,
    appId,
    firestore,
    logLabel: 'queueCaseDocGeneration',
  });

  if (resolvedRole !== 'admin' && resolvedRole !== 'instructor') {
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

    const specs = Array.isArray(plan.referenceDocumentSpecs) ? plan.referenceDocumentSpecs : [];
    const results = [];
    const errors = [];

    for (const spec of specs) {
      try {
        const generationSpec = spec?.generationSpec || {};
        const templateId = generationSpec.templateId;
        if (!templateId) {
          throw new Error('Missing templateId.');
        }
        const renderer = getTemplateRenderer(templateId);
        const { html, css, pdfOptions } = renderer({
          data: generationSpec.data || {},
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
        const bucket = admin.storage().bucket();
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

        results.push({
          fileName: spec.fileName || safeName,
          storagePath,
          contentType: 'application/pdf',
          generationSpec,
          generationSpecId: spec.id || null,
          linkToPaymentId: spec.linkToPaymentId || generationSpec.linkToPaymentId || null,
        });
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

      try {
        assertNoFieldValueInArrays(
          { referenceDocuments: updated, invoiceMappings: updatedMappings },
          'caseUpdate'
        );
        await caseRef.set(
          { referenceDocuments: updated, invoiceMappings: updatedMappings },
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
