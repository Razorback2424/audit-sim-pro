// functions/index.js
const functions = require('firebase-functions');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

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

exports.listRosterOptions = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const requesterRole = context.auth.token?.role;
  const requesterOrgId = context.auth.token?.orgId ?? null;

  if (requesterRole !== 'admin' && requesterRole !== 'instructor') {
    throw new functions.https.HttpsError('permission-denied', 'Insufficient permissions.');
  }

  const appId = data?.appId;
  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }

  const firestore = admin.firestore();
  let rosterQuery = firestore.collection(`artifacts/${appId}/users`);

  if (requesterRole === 'instructor') {
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
