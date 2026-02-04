const { functions, admin } = require('../shared/firebaseAdmin');

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

module.exports = { onRoleChangeSetCustomClaim };
