// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// This is typically done automatically when deploying to Cloud Functions.
// For local testing, you might need: admin.initializeApp({ credential: admin.credential.applicationDefault() });
admin.initializeApp();

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

    try {
      await admin.auth().setCustomUserClaims(userId, { role: role });
      console.log(`Custom claim 'role' set to '${role}' for user ${userId}`);
      return null;
    } catch (error) {
      console.error(`Error setting custom claim for user ${userId}:`, error);
      return null;
    }
  });
