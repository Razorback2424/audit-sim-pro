const { functions, admin, callable } = require('../shared/firebaseAdmin');

const ALLOWED_ROLES = new Set(['trainee', 'instructor', 'admin', 'owner']);

const onRoleChangeSetCustomClaim = functions.firestore
  .document('roles/{userId}')
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    const roleData = change.after.data();

    if (!roleData || !roleData.role) {
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

const adminSetUserRole = callable.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const callerRoleRaw = context.auth.token?.role;
  const callerRole = typeof callerRoleRaw === 'string' ? callerRoleRaw.trim().toLowerCase() : '';
  if (callerRole !== 'admin' && callerRole !== 'owner') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
  }

  const targetUid = typeof data?.targetUid === 'string' ? data.targetUid.trim() : '';
  const requestedRole = typeof data?.role === 'string' ? data.role.trim().toLowerCase() : '';

  if (!targetUid) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid is required.');
  }
  if (!ALLOWED_ROLES.has(requestedRole)) {
    throw new functions.https.HttpsError('invalid-argument', 'Role is not allowed.');
  }

  const targetUser = await admin.auth().getUser(targetUid);
  const existingClaims = targetUser.customClaims || {};
  const nextClaims = {
    ...existingClaims,
    role: requestedRole,
  };

  await admin.auth().setCustomUserClaims(targetUid, nextClaims);

  try {
    const roleDoc = {
      role: requestedRole,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: context.auth.uid,
    };
    if (existingClaims.orgId) {
      roleDoc.orgId = existingClaims.orgId;
    }
    await admin.firestore().doc(`roles/${targetUid}`).set(roleDoc, { merge: true });
  } catch (err) {
    console.warn('[adminSetUserRole] Failed to write roles doc', err);
  }

  return { ok: true, targetUid, role: requestedRole };
});

module.exports = { onRoleChangeSetCustomClaim, adminSetUserRole };
