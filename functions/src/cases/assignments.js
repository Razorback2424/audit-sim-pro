const { functions, admin, callable } = require('../shared/firebaseAdmin');
const { resolveRequesterIdentity } = require('../shared/roles');

exports.updateCaseAssignments = callable.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  const appId = typeof data?.appId === 'string' ? data.appId.trim() : '';
  const caseId = typeof data?.caseId === 'string' ? data.caseId.trim() : '';
  const userIds = Array.isArray(data?.userIds) ? [...new Set(data.userIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))] : [];
  if (!appId || !caseId || userIds.length > 200) throw new functions.https.HttpsError('invalid-argument', 'appId, caseId, and a valid userIds list are required.');

  const firestore = admin.firestore();
  const identity = await resolveRequesterIdentity({ context, appId, firestore, logLabel: 'updateCaseAssignments' });
  if (!['admin', 'owner', 'instructor'].includes(identity.resolvedRole)) throw new functions.https.HttpsError('permission-denied', 'Organization manager access required.');
  if (identity.resolvedRole !== 'admin' && !identity.requesterOrgId) throw new functions.https.HttpsError('failed-precondition', 'Organization is not configured.');

  const caseRef = firestore.doc(`artifacts/${appId}/public/data/cases/${caseId}`);
  const caseSnap = await caseRef.get();
  if (!caseSnap.exists) throw new functions.https.HttpsError('not-found', 'Case not found.');
  const caseData = caseSnap.data() || {};
  if (identity.resolvedRole !== 'admin' && caseData.orgId !== identity.requesterOrgId) throw new functions.https.HttpsError('permission-denied', 'Case is outside your organization.');
  if (caseData._deleted === true || caseData.status === 'draft') throw new functions.https.HttpsError('failed-precondition', 'Only published cases can be assigned.');

  if (userIds.length > 0) {
    const userRefs = userIds.map((uid) => firestore.doc(`artifacts/${appId}/users/${uid}/userProfileData/profile`));
    const profiles = await firestore.getAll(...userRefs);
    profiles.forEach((profile) => {
      const data = profile.exists ? profile.data() : null;
      if (!data || data.role !== 'trainee' || (identity.resolvedRole !== 'admin' && data.orgId !== identity.requesterOrgId)) {
        throw new functions.https.HttpsError('failed-precondition', 'Every assigned user must be an accepted trainee in the same organization.');
      }
    });
  }

  await caseRef.set({
    publicVisible: userIds.length === 0 ? caseData.publicVisible : false,
    visibleToUserIds: userIds,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    assignmentUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    assignmentUpdatedBy: context.auth.uid,
  }, { merge: true });
  return { caseId, userIds };
});
