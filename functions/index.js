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
        }
        disbursementMap.set(item.paymentId, normalized);
      }
    });

    const selectedIds =
      afterSelection.length > 0
        ? afterSelection
        : Object.keys(afterClassifications).filter(Boolean);

    let correctCount = 0;
    let totalCount = 0;
    const gradingDetails = {};

    selectedIds.forEach((paymentId) => {
      const disbursement = disbursementMap.get(paymentId);
      if (!disbursement) {
        return;
      }
      const userAllocations = afterClassifications[paymentId] || {};
      const detail = buildGradingDetail(disbursement, userAllocations);
      gradingDetails[paymentId] = detail;
      totalCount += 1;
      if (detail.isCorrect) {
        correctCount += 1;
      }
    });

    const score = totalCount > 0 ? (correctCount / totalCount) * 100 : 0;
    const roundedScore = Math.round(score * 100) / 100;

    return event.data.after.ref.set(
      {
        grade: roundedScore,
        gradedAt: admin.firestore.FieldValue.serverTimestamp(),
        gradingDetails,
      },
      { merge: true }
    );
  }
);

exports.evaluateAuditSubmission = onDocumentWritten(
  'artifacts/{appId}/users/{userId}/caseSubmissions/{caseId}',
  async (event) => {
    if (!event?.data?.after?.exists) {
      return null;
    }

    const submission = event.data.after.data() || {};
    const status = typeof submission.status === 'string'
      ? submission.status
      : submission.submittedAt
      ? 'submitted'
      : null;

    if (status !== 'submitted') {
      return null;
    }

    const beforeData = event.data.before?.exists ? event.data.before.data() : null;
    const beforeClassifications = beforeData?.disbursementClassifications || {};
    const beforeWorkspace = beforeData?.workspaceNotes || {};
    const currentClassifications = submission.disbursementClassifications || {};
    const currentWorkspace = submission.workspaceNotes || {};

    const classificationsChanged =
      stableStringify(beforeClassifications) !== stableStringify(currentClassifications);
    const workspaceChanged =
      stableStringify(beforeWorkspace) !== stableStringify(currentWorkspace);

    if (!classificationsChanged && !workspaceChanged && Array.isArray(submission.virtualSeniorFeedback)) {
      return null;
    }

    const firestore = admin.firestore();
    const keysSnap = await firestore
      .doc(`artifacts/${event.params.appId}/private/case_keys/${event.params.caseId}`)
      .get();
    const privateKeysData = keysSnap.exists ? keysSnap.data() : null;
    const privateItems =
      privateKeysData && typeof privateKeysData.items === 'object' && privateKeysData.items !== null
        ? privateKeysData.items
        : {};

    const reviewNotes = [];

    Object.keys(currentClassifications).forEach((itemId) => {
      const truth = privateItems[itemId];
      if (!truth) return;
      const workspace = currentWorkspace[itemId] && typeof currentWorkspace[itemId] === 'object'
        ? currentWorkspace[itemId]
        : {};
      const allocations = currentClassifications[itemId];
      const totals = allocations && typeof allocations === 'object' ? allocations : {};
      const normalizedTotals = Object.keys(totals).reduce((acc, key) => {
        const value = totals[key];
        const numericValue = typeof value === 'number' ? value : Number(value);
        acc[key] = Number.isFinite(numericValue) ? numericValue : 0;
        return acc;
      }, {});
      const derivedClassification =
        workspace.classification || findPrimaryClassification(normalizedTotals);
      const userWork = {
        ...workspace,
        classification: derivedClassification || '',
      };

      const durationSeconds =
        typeof userWork.interactionDuration === 'number' ? userWork.interactionDuration : null;
      if (truth.riskLevel === 'high' && typeof durationSeconds === 'number' && durationSeconds < 5) {
        reviewNotes.push({
          itemId,
          severity: 'high',
          message:
            'Review Note: You concluded on this high-risk item too quickly. Did you review all attachments?',
        });
      }

      if (
        userWork.selectedAssertion === 'cutoff' &&
        userWork.serviceEndInput &&
        truth?.groundTruths?.servicePeriodEnd
      ) {
        const userDate = new Date(userWork.serviceEndInput);
        const trueDate = new Date(truth.groundTruths.servicePeriodEnd);
        if (!Number.isNaN(userDate.getTime()) && !Number.isNaN(trueDate.getTime())) {
          const diffTime = Math.abs(userDate.getTime() - trueDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays > 1) {
            reviewNotes.push({
              itemId,
              severity: 'medium',
              message:
                'Review Note: Your conclusion is correct, but the Service Period date you documented does not match the invoice. Re-examine the document.',
            });
          }
        }
      }

      if (
        userWork.classification === 'properly_included' &&
        !userWork.evidenceLinked
      ) {
        reviewNotes.push({
          itemId,
          severity: 'medium',
          message:
            'Documentation Deficiency: You vouched for existence but failed to link the supporting evidence in the workpaper.',
        });
      }
    });

    return event.data.after.ref.set(
      {
        virtualSeniorFeedback: reviewNotes,
        heuristicsEvaluatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);
