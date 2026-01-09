const admin = require('firebase-admin');

const findFieldValueInArrays = (value, path = 'root', inArray = false, visited = new Set()) => {
  if (value && typeof value === 'object') {
    if (visited.has(value)) return null;
    visited.add(value);
  }

  if (value instanceof admin.firestore.FieldValue) {
    return inArray ? path : null;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findFieldValueInArrays(value[i], `${path}[${i}]`, true, visited);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const found = findFieldValueInArrays(child, `${path}.${key}`, inArray, visited);
      if (found) return found;
    }
  }

  return null;
};

const assertNoFieldValueInArrays = (value, label = 'payload') => {
  const found = findFieldValueInArrays(value, label);
  if (found) {
    throw new Error(`Invalid FieldValue inside array at ${found}.`);
  }
};

module.exports = {
  findFieldValueInArrays,
  assertNoFieldValueInArrays,
};
