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

exports.listRosterOptions = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const role = context.auth.token?.role;
  if (role !== 'admin') {
    const roleDoc = await admin.firestore().doc(`roles/${context.auth.uid}`).get();
    const effectiveRole = roleDoc.exists ? roleDoc.data()?.role : null;
    if (effectiveRole !== 'admin') {
      throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
    }
  }

  const appId = data?.appId;
  if (!appId || typeof appId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required.');
  }

  const firestore = admin.firestore();
  const rosterCollection = firestore.collection(`artifacts/${appId}/users`);
  const rosterSnapshot = await rosterCollection.get();

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
    });
  }

  return { roster };
});
