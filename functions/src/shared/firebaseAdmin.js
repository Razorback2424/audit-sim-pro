const functions = require('firebase-functions/v1');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();

const callable = functions.runWith({ enforceAppCheck: true });

module.exports = {
  functions,
  onDocumentWritten,
  admin,
  callable,
};
