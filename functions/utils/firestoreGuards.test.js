const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { findFieldValueInArrays, assertNoFieldValueInArrays } = require('./firestoreGuards');

test('findFieldValueInArrays flags FieldValue inside arrays', () => {
  const payload = {
    referenceDocuments: [
      {
        fileName: 'doc.pdf',
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    ],
  };
  const found = findFieldValueInArrays(payload, 'payload');
  assert.equal(found, 'payload.referenceDocuments[0].generatedAt');
});

test('findFieldValueInArrays ignores FieldValue outside arrays', () => {
  const payload = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    referenceDocuments: [{ fileName: 'doc.pdf' }],
  };
  const found = findFieldValueInArrays(payload, 'payload');
  assert.equal(found, null);
});

test('assertNoFieldValueInArrays throws with a helpful message', () => {
  const payload = {
    referenceDocuments: [
      {
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    ],
  };
  assert.throws(
    () => assertNoFieldValueInArrays(payload, 'payload'),
    /Invalid FieldValue inside array at payload\.referenceDocuments\[0\]\.generatedAt/
  );
});
