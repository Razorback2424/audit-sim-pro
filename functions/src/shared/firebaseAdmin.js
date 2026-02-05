const functions = require('firebase-functions/v1');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET ||
  process.env.STORAGE_BUCKET ||
  (process.env.GCLOUD_PROJECT ? `${process.env.GCLOUD_PROJECT}.firebasestorage.app` : undefined) ||
  (process.env.GCLOUD_PROJECT ? `${process.env.GCLOUD_PROJECT}.appspot.com` : undefined);

admin.initializeApp(storageBucket ? { storageBucket } : undefined);

const callable = functions.runWith({ enforceAppCheck: true });

module.exports = {
  functions,
  onDocumentWritten,
  admin,
  callable,
};
