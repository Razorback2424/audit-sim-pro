const { functions, admin, callable } = require('./shared/firebaseAdmin');
const { evaluateTraineeCaseAccess, hasPaidBillingAccess } = require('./cases/access');

exports.recordRecipeGateCompletion = callable.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  if (String(context.auth.token?.role || '').toLowerCase() !== 'trainee') {
    throw new functions.https.HttpsError('permission-denied', 'Trainee access required.');
  }
  const appId = typeof data?.appId === 'string' ? data.appId.trim() : '';
  const caseId = typeof data?.caseId === 'string' ? data.caseId.trim() : '';
  const recipeId = typeof data?.recipeId === 'string' ? data.recipeId.trim() : '';
  const selectedOptionId = typeof data?.selectedOptionId === 'string' ? data.selectedOptionId.trim() : '';
  const recipeVersion = Number(data?.recipeVersion);
  if (!appId || !caseId || !recipeId || !selectedOptionId || !Number.isFinite(recipeVersion) || recipeVersion <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'caseId, recipeId, recipeVersion, and selectedOptionId are required.');
  }

  const firestore = admin.firestore();
  const caseRef = firestore.doc(`artifacts/${appId}/public/data/cases/${caseId}`);
  const caseSnap = await caseRef.get();
  if (!caseSnap.exists) throw new functions.https.HttpsError('not-found', 'Case not found.');
  const caseData = caseSnap.data() || {};
  const billingSnap = await firestore.doc(`artifacts/${appId}/users/${context.auth.uid}/billing/status`).get();
  const access = evaluateTraineeCaseAccess({
    caseData,
    uid: context.auth.uid,
    hasPaidAccess: billingSnap.exists && hasPaidBillingAccess(billingSnap.data()),
  });
  if (!access.allowed) throw new functions.https.HttpsError('permission-denied', 'Case is not available.');

  const storedVersion = Number(caseData?.instruction?.version || caseData?.recipeVersion || 1);
  if (storedVersion !== recipeVersion) throw new functions.https.HttpsError('failed-precondition', 'This instruction version is no longer current.');
  const gateCheck = caseData?.instruction?.gateCheck || caseData?.instruction?.gate_check || {};
  const options = Array.isArray(gateCheck.options)
    ? gateCheck.options
    : [];
  const correct = options.some((option) => String(option?.id || option?.value || '').trim() === selectedOptionId && Boolean(option?.correct || option?.isCorrect || option?.is_correct));
  if (!correct) throw new functions.https.HttpsError('failed-precondition', 'Gate answer is incorrect.');

  const progressRef = firestore.doc(`artifacts/${appId}/student_progress/${context.auth.uid}/recipes/${recipeId}`);
  const existing = await progressRef.get();
  const existingVersion = Number(existing.data()?.passedVersion || 0);
  if (existingVersion >= recipeVersion) return { passedVersion: existingVersion, alreadyPassed: true };
  await progressRef.set({
    passedVersion: recipeVersion,
    passedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    sourceCaseId: caseId,
    validatedBy: 'server',
  }, { merge: true });
  return { passedVersion: recipeVersion, alreadyPassed: false };
});
