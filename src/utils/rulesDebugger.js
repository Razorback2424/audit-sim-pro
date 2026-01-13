
// Logic ported from firestore.rules for client-side debugging

const isMap = (v) => Object.prototype.toString.call(v) === '[object Object]';
const isList = (v) => Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isNumber = (v) => typeof v === 'number';
const isBool = (v) => typeof v === 'boolean';

const hasAll = (obj, keys) => {
  if (!isMap(obj)) return false;
  const objKeys = Object.keys(obj);
  return keys.every(k => objKeys.includes(k));
};

const isValidSupportingDocument = (doc, path = '') => {
  if (!isMap(doc)) return { valid: false, reason: `${path}: not a map` };
  if ('storagePath' in doc && doc.storagePath !== null && !isString(doc.storagePath)) return { valid: false, reason: `${path}.storagePath: not string` };
  if ('downloadURL' in doc && doc.downloadURL !== null && !isString(doc.downloadURL)) return { valid: false, reason: `${path}.downloadURL: not string` };
  if ('fileName' in doc && doc.fileName !== null && !isString(doc.fileName)) return { valid: false, reason: `${path}.fileName: not string` };
  if ('contentType' in doc && doc.contentType !== null && !isString(doc.contentType)) return { valid: false, reason: `${path}.contentType: not string` };
  return { valid: true };
};

const isValidAuditItem = (item, path = '') => {
  if (!isMap(item)) return { valid: false, reason: `${path}: not a map` };
  if (!hasAll(item, ['id', 'type'])) return { valid: false, reason: `${path}: missing id or type` };
  if (!isString(item.id)) return { valid: false, reason: `${path}.id: not string` };
  if (!['transaction', 'inventory_count', 'payroll_record'].includes(item.type)) return { valid: false, reason: `${path}.type: invalid value ${item.type}` };
  
  if ('payee' in item && item.payee !== null && !isString(item.payee)) return { valid: false, reason: `${path}.payee: not string` };
  
  // Note: Rules allow amount to be string or number
  if ('amount' in item && item.amount !== null && !isString(item.amount) && !isNumber(item.amount)) return { valid: false, reason: `${path}.amount: not string or number` };
  
  if ('paymentDate' in item && item.paymentDate !== null && !isString(item.paymentDate)) return { valid: false, reason: `${path}.paymentDate: not string` };
  if ('expectedClassification' in item && item.expectedClassification !== null && !isString(item.expectedClassification)) return { valid: false, reason: `${path}.expectedClassification: not string` };
  if ('answerKey' in item && item.answerKey !== null) return { valid: false, reason: `${path}.answerKey: should be null or missing` };
  if ('hasAnswerKey' in item && item.hasAnswerKey !== null && !isBool(item.hasAnswerKey)) return { valid: false, reason: `${path}.hasAnswerKey: not bool` };
  
  if ('trapType' in item && item.trapType !== null && !isList(item.trapType) && !isString(item.trapType)) return { valid: false, reason: `${path}.trapType: not list or string` };
  if ('shouldFlag' in item && item.shouldFlag !== null && !isBool(item.shouldFlag)) return { valid: false, reason: `${path}.shouldFlag: not bool` };
  if ('requiredAssertions' in item && item.requiredAssertions !== null && !isList(item.requiredAssertions)) return { valid: false, reason: `${path}.requiredAssertions: not list` };
  if ('correctAssertions' in item && item.correctAssertions !== null && !isList(item.correctAssertions)) return { valid: false, reason: `${path}.correctAssertions: not list` };
  if ('errorReasons' in item && item.errorReasons !== null && !isList(item.errorReasons)) return { valid: false, reason: `${path}.errorReasons: not list` };
  if ('validator' in item && item.validator !== null && !isMap(item.validator)) return { valid: false, reason: `${path}.validator: not map` };
  if ('groundTruths' in item && item.groundTruths !== null) return { valid: false, reason: `${path}.groundTruths: must be null or missing` };
  
  if ('storagePath' in item && item.storagePath !== null && !isString(item.storagePath)) return { valid: false, reason: `${path}.storagePath: not string` };
  if ('downloadURL' in item && item.downloadURL !== null && !isString(item.downloadURL)) return { valid: false, reason: `${path}.downloadURL: not string` };
  if ('fileName' in item && item.fileName !== null && !isString(item.fileName)) return { valid: false, reason: `${path}.fileName: not string` };
  if ('contentType' in item && item.contentType !== null && !isString(item.contentType)) return { valid: false, reason: `${path}.contentType: not string` };

  if ('supportingDocuments' in item) {
    if (!isList(item.supportingDocuments)) return { valid: false, reason: `${path}.supportingDocuments: not list` };
    if (item.supportingDocuments.length > 0) {
      const check = isValidSupportingDocument(item.supportingDocuments[0], `${path}.supportingDocuments[0]`);
      if (!check.valid) return check;
    }
  }

  if ('description' in item && item.description !== null && !isString(item.description)) return { valid: false, reason: `${path}.description: not string` };
  if ('notes' in item && item.notes !== null && !isString(item.notes)) return { valid: false, reason: `${path}.notes: not string` };
  if ('meta' in item && item.meta !== null && !isMap(item.meta)) return { valid: false, reason: `${path}.meta: not map` };

  return { valid: true };
};

const isValidInvoiceMapping = (m, path = '') => {
  if (!isMap(m)) return { valid: false, reason: `${path}: not a map` };
  if (!hasAll(m, ['paymentId'])) return { valid: false, reason: `${path}: missing paymentId` };
  if (!isString(m.paymentId)) return { valid: false, reason: `${path}.paymentId: not string` };
  
  if ('storagePath' in m && m.storagePath !== null && !isString(m.storagePath)) return { valid: false, reason: `${path}.storagePath: not string` };
  if ('downloadURL' in m && m.downloadURL !== null && !isString(m.downloadURL)) return { valid: false, reason: `${path}.downloadURL: not string` };
  if ('fileName' in m && m.fileName !== null && !isString(m.fileName)) return { valid: false, reason: `${path}.fileName: not string` };
  if ('contentType' in m && m.contentType !== null && !isString(m.contentType)) return { valid: false, reason: `${path}.contentType: not string` };

  return { valid: true };
};

export const debugValidateTraineeCase = (data) => {
  const errors = [];
  const log = (msg) => errors.push(msg);

  if (!hasAll(data, ['publicVisible', 'status', '_deleted'])) log('Missing required root keys (publicVisible, status, _deleted)');
  if (!isBool(data.publicVisible)) log('publicVisible not bool');
  if (!isBool(data._deleted)) log('_deleted not bool');
  if (!['assigned', 'in_progress', 'submitted', 'archived', 'draft'].includes(data.status)) log(`Invalid status: ${data.status}`);
  
  // Note: createdAt and updatedAt are skipped here as they are server timestamps

  if ('createdBy' in data && data.createdBy !== null && !isString(data.createdBy)) log('createdBy not string');
  if ('caseLevel' in data && data.caseLevel !== null && !['basic', 'intermediate', 'advanced'].includes(data.caseLevel)) log(`Invalid caseLevel: ${data.caseLevel}`);
  
  if ('auditItems' in data) {
    if (!isList(data.auditItems)) {
      log('auditItems not list');
    } else if (data.auditItems.length > 0) {
      // Check ALL items for debugging, though rules only check [0] currently (but intent is to be valid)
      // We will check [0] specifically to match rules logic strictness
      const check0 = isValidAuditItem(data.auditItems[0], 'auditItems[0]');
      if (!check0.valid) log(check0.reason);
      
      // Optional: check others
      data.auditItems.forEach((item, idx) => {
        const check = isValidAuditItem(item, `auditItems[${idx}]`);
        if (!check.valid) log(`[Non-blocking if idx>0] ${check.reason}`);
      });
    }
  }

  if ('disbursements' in data) {
    if (!isList(data.disbursements)) {
        log('disbursements not list');
    } else if (data.disbursements.length > 0) {
        const check0 = isValidAuditItem(data.disbursements[0], 'disbursements[0]');
        if (!check0.valid) log(check0.reason);
    }
  }

  if ('invoiceMappings' in data) {
    if (!isList(data.invoiceMappings)) {
      log('invoiceMappings not list');
    } else if (data.invoiceMappings.length > 0) {
      const check0 = isValidInvoiceMapping(data.invoiceMappings[0], 'invoiceMappings[0]');
      if (!check0.valid) log(check0.reason);
    }
  }

  return { valid: errors.length === 0, errors };
};
