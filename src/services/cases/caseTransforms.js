import { Timestamp, serverTimestamp } from 'firebase/firestore';
import { toCaseModel } from '../../models/case';
import {
  AUDIT_AREA_VALUES,
  CASE_GROUP_VALUES,
  DEFAULT_AUDIT_AREA,
  DEFAULT_ITEM_TYPE,
  CASE_LEVEL_VALUES,
  normalizeCaseLevel,
} from '../../models/caseConstants';
import { DEBUG_LOGS } from './caseDebug';

export const VALID_CASE_STATUSES = ['assigned', 'in_progress', 'submitted', 'archived', 'draft'];

const isRecord = (value) => typeof value === 'object' && value !== null;

export const toTrimmedString = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const toOptionalString = (value) => {
  const trimmed = toTrimmedString(value);
  return trimmed === '' ? null : trimmed;
};

const VALID_TIERS = new Set(['foundations', 'core', 'advanced']);

const normalizeTier = (value) => {
  const trimmed = toOptionalString(value);
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  return VALID_TIERS.has(normalized) ? normalized : null;
};

const normalizeStringArray = (value) =>
  Array.isArray(value)
    ? value
        .map((entry) => toTrimmedString(entry))
        .filter((entry) => entry.length > 0)
    : [];

const normalizeNumberOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeAccessLevel = (value) => {
  if (typeof value !== 'string') return 'paid';
  const normalized = value.trim().toLowerCase();
  return normalized === 'demo' ? 'demo' : 'paid';
};

const isPlainObject = (value) =>
  Object.prototype.toString.call(value) === '[object Object]';

const stripUndefinedDeep = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined);
  }
  if (isPlainObject(value)) {
    const next = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (entry === undefined) return;
      const cleaned = stripUndefinedDeep(entry);
      if (cleaned !== undefined) {
        next[key] = cleaned;
      }
    });
    return next;
  }
  return value;
};

const normalizePrimarySkill = (value, { moduleId, moduleTitle, title, caseName }) => {
  const skill = toTrimmedString(value);
  if (skill) return skill;
  const label = `${toTrimmedString(moduleTitle || title || caseName)} ${toTrimmedString(moduleId)}`.trim();
  const isSurl = /surl/i.test(label);
  if (isSurl) {
    return 'SURL';
  }
  return skill;
};

const extractPrivateCaseKeyEntries = (items = []) => {
  const sanitizedItems = [];
  const privateEntries = {};

  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const {
      answerKey,
      answerKeyMode,
      answerKeySingleClassification,
      groundTruths,
      correctClassification,
      primaryAssertion,
      ...rest
    } = item;

    const paymentId =
      toOptionalString(rest.paymentId) ||
      toOptionalString(item.paymentId) ||
      `item-${index + 1}`;

    const entry = {};
    if (isRecord(answerKey) && Object.keys(answerKey).length > 0) {
      entry.answerKey = { ...answerKey };
    }
    if (typeof answerKeyMode === 'string' && answerKeyMode.trim()) {
      entry.answerKeyMode = answerKeyMode.trim();
    }
    if (
      typeof answerKeySingleClassification === 'string' &&
      answerKeySingleClassification.trim()
    ) {
      entry.answerKeySingleClassification = answerKeySingleClassification.trim();
    }
    if (isRecord(groundTruths) && Object.keys(groundTruths).length > 0) {
      entry.groundTruths = { ...groundTruths };
    }
    if (typeof correctClassification === 'string' && correctClassification.trim()) {
      entry.correctClassification = correctClassification.trim();
    }
    if (typeof primaryAssertion === 'string' && primaryAssertion.trim()) {
      entry.primaryAssertion = primaryAssertion.trim();
    }
    const resolvedRiskLevel =
      typeof rest.riskLevel === 'string' && rest.riskLevel.trim()
        ? rest.riskLevel.trim()
        : typeof item.riskLevel === 'string' && item.riskLevel.trim()
        ? item.riskLevel.trim()
        : null;
    if (resolvedRiskLevel) {
      entry.riskLevel = resolvedRiskLevel;
    }

    const hasEntry = Object.keys(entry).length > 0;

    sanitizedItems.push({
      ...rest,
      paymentId,
      hasAnswerKey: Boolean(entry.answerKey),
    });

    if (hasEntry && paymentId) {
      privateEntries[paymentId] = entry;
    }
  });

  return { sanitizedItems, privateEntries };
};

const normalizeAuditArea = (value) => {
  const auditArea = toOptionalString(value);
  if (auditArea && AUDIT_AREA_VALUES.includes(auditArea)) {
    return auditArea;
  }
  return DEFAULT_AUDIT_AREA;
};

const normalizeCaseGroupId = (value) => {
  const groupId = toOptionalString(value);
  if (!groupId) return null;
  if (CASE_GROUP_VALUES.length > 0 && !CASE_GROUP_VALUES.includes(groupId)) {
    return null;
  }
  return groupId;
};

const normalizeInvoiceMappings = (mappings = []) => {
  if (!Array.isArray(mappings)) return [];
  const cleaned = [];
  mappings.forEach((item) => {
    if (!isRecord(item)) return;
    const itemId =
      toOptionalString(item.paymentId) ||
      toOptionalString(item.auditItemId) ||
      toOptionalString(item.id);
    if (!itemId) return;
    cleaned.push({
      paymentId: itemId,
      auditItemId: itemId,
      storagePath: toOptionalString(item.storagePath),
      fileName: toOptionalString(item.fileName),
      downloadURL: toOptionalString(item.downloadURL),
      contentType: toOptionalString(item.contentType),
    });
  });
  return cleaned;
};

const normalizeReferenceDocuments = (documents = []) => {
  if (!Array.isArray(documents)) return [];
  const normalized = [];
  const seen = new Set();
  documents.forEach((item) => {
    if (!isRecord(item)) return;
    const fileName = toOptionalString(item.fileName);
    const storagePath = toOptionalString(item.storagePath);
    const downloadURL = toOptionalString(item.downloadURL);
    const contentType = toOptionalString(item.contentType);
    const generationSpec = isRecord(item.generationSpec) ? item.generationSpec : null;
    const generationSpecId = toOptionalString(item.generationSpecId);
    if (!fileName) return;
    if (!storagePath && !downloadURL && !generationSpec) return;
    const generationKey = generationSpec ? JSON.stringify(generationSpec) : '';
    const key = `${fileName}|${storagePath ?? ''}|${downloadURL ?? ''}|${contentType ?? ''}|${generationKey}|${generationSpecId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const doc = {
      fileName,
      storagePath: storagePath ?? null,
      downloadURL: downloadURL ?? null,
      contentType: contentType ?? null,
    };
    if (generationSpec) {
      doc.generationSpec = generationSpec;
    }
    if (generationSpecId) {
      doc.generationSpecId = generationSpecId;
    }
    normalized.push(doc);
  });
  return normalized;
};

const stripDownloadUrlFromDoc = (doc) => {
  if (!doc || typeof doc !== 'object') return doc;
  const { downloadURL: _ignoredDownloadUrl, ...rest } = doc;
  return rest;
};

const stripDownloadUrlsFromCaseData = (caseData) => {
  if (!caseData || typeof caseData !== 'object') return caseData;
  const next = { ...caseData };
  if (Array.isArray(next.invoiceMappings)) {
    next.invoiceMappings = next.invoiceMappings.map((doc) => stripDownloadUrlFromDoc(doc));
  }
  if (Array.isArray(next.referenceDocuments)) {
    next.referenceDocuments = next.referenceDocuments.map((doc) => stripDownloadUrlFromDoc(doc));
  }
  if (Array.isArray(next.cashArtifacts)) {
    next.cashArtifacts = next.cashArtifacts.map((doc) => stripDownloadUrlFromDoc(doc));
  }
  if (Array.isArray(next.auditItems)) {
    next.auditItems = next.auditItems.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const cleaned = stripDownloadUrlFromDoc(item);
      if (Array.isArray(cleaned.supportingDocuments)) {
        cleaned.supportingDocuments = cleaned.supportingDocuments.map((doc) => stripDownloadUrlFromDoc(doc));
      }
      if (cleaned.highlightedDocument && typeof cleaned.highlightedDocument === 'object') {
        cleaned.highlightedDocument = stripDownloadUrlFromDoc(cleaned.highlightedDocument);
      }
      return cleaned;
    });
  }
  return next;
};

const groupInvoiceMappings = (mappings = []) => {
  const groups = new Map();
  mappings.forEach((mapping) => {
    const existing = groups.get(mapping.paymentId) || [];
    existing.push(mapping);
    groups.set(mapping.paymentId, existing);
  });
  return groups;
};

const normalizeAuditItem = (item, index, invoiceGroups) => {
  if (!isRecord(item)) {
    if (DEBUG_LOGS) {
      console.warn('[caseService] normalizeAuditItem: skipping non-object item', { index, item });
    }
    return null;
  }
  const fallbackId = `item-${index + 1}`;
  const resolvedId = toOptionalString(item.id) || toOptionalString(item.paymentId) || fallbackId;
  const invoices = resolvedId ? invoiceGroups.get(resolvedId) || [] : [];
  const [primaryInvoice, ...restInvoices] = invoices;

  const normalized = {
    id: resolvedId,
    paymentId: resolvedId,
    type: toOptionalString(item.type) || DEFAULT_ITEM_TYPE,
    payee: toTrimmedString(item.payee),
    amount: typeof item.amount === 'number' ? item.amount : toTrimmedString(item.amount),
    paymentDate: toTrimmedString(item.paymentDate),
    expectedClassification: toOptionalString(item.expectedClassification),
  };

  if (item.hasAnswerKey !== undefined) {
    normalized.hasAnswerKey = Boolean(item.hasAnswerKey);
  }

  const transactionType = toOptionalString(item.transactionType);
  if (transactionType) normalized.transactionType = transactionType;

  const itemAuditArea = toOptionalString(item.auditArea);
  if (itemAuditArea) normalized.auditArea = itemAuditArea;

  const title = toOptionalString(item.title) || normalized.payee || `Item ${index + 1}`;
  if (title) normalized.title = title;

  if (normalized.amount !== undefined && normalized.amount !== null && normalized.amount !== '') {
    normalized.value = normalized.amount;
  }

  const description = toOptionalString(item.description);
  if (description) normalized.description = description;

  const notes = toOptionalString(item.notes);
  if (notes) normalized.notes = notes;

  if (isRecord(item.meta)) {
    normalized.meta = { ...item.meta };
  }

  const riskLevelRaw = toOptionalString(item.riskLevel);
  if (riskLevelRaw && ['low', 'medium', 'high'].includes(riskLevelRaw.toLowerCase())) {
    normalized.riskLevel = riskLevelRaw.toLowerCase();
  }

  if (isRecord(item.directionalFlags)) {
    normalized.directionalFlags = {
      allowVouching: Boolean(item.directionalFlags.allowVouching),
      allowTracing: Boolean(item.directionalFlags.allowTracing),
    };
  }

  if (Array.isArray(item.evidencePoints)) {
    const cleanedEvidencePoints = item.evidencePoints
      .filter((point) => isRecord(point))
      .map((point) => ({
        label: toTrimmedString(point.label),
        value: toTrimmedString(point.value),
        assertion: toTrimmedString(point.assertion),
        toleranceDays:
          point.toleranceDays === '' || point.toleranceDays === null || point.toleranceDays === undefined
            ? undefined
            : Number(point.toleranceDays),
      }))
      .filter((point) => point.label || point.value || point.assertion);

    if (cleanedEvidencePoints.length > 0) {
      cleanedEvidencePoints.forEach((point) => {
        if (point.toleranceDays !== undefined && !Number.isFinite(point.toleranceDays)) {
          delete point.toleranceDays;
        }
      });
      normalized.evidencePoints = cleanedEvidencePoints;
    }
  }

  const toStringArray = (value) =>
    Array.isArray(value)
      ? value.map((v) => toOptionalString(v)).filter(Boolean)
      : [];

  const trapList = toStringArray(item.trapType);
  if (trapList.length > 0) {
    normalized.trapType = trapList;
  } else {
    const singleTrap = toOptionalString(item.trapType);
    if (singleTrap) normalized.trapType = [singleTrap];
  }

  const correctAssertions = toStringArray(item.correctAssertions || item.requiredAssertions);
  if (correctAssertions.length > 0) {
    normalized.correctAssertions = correctAssertions;
  }

  const requiredAssertions = toStringArray(item.requiredAssertions || item.correctAssertions);
  if (requiredAssertions.length > 0) {
    normalized.requiredAssertions = requiredAssertions;
  }

  const errorReasons = toStringArray(item.errorReasons);
  if (errorReasons.length > 0) {
    normalized.errorReasons = errorReasons;
  }

  if (item.shouldFlag !== undefined) {
    normalized.shouldFlag = Boolean(item.shouldFlag);
  }

  if (isRecord(item.validator)) {
    const validator = { ...item.validator };
    if (validator.config && !isRecord(validator.config)) {
      delete validator.config;
    }
    normalized.validator = validator;
  }

  const storagePath = toOptionalString(primaryInvoice?.storagePath ?? item.storagePath);
  if (storagePath) normalized.storagePath = storagePath;

  const downloadURL = toOptionalString(primaryInvoice?.downloadURL ?? item.downloadURL);
  if (downloadURL) normalized.downloadURL = downloadURL;

  const fileName = toOptionalString(primaryInvoice?.fileName ?? item.fileName);
  if (fileName) normalized.fileName = fileName;

  const contentType = toOptionalString(primaryInvoice?.contentType ?? item.contentType);
  if (contentType) normalized.contentType = contentType;

  const supportingDocsSource = Array.isArray(item.supportingDocuments) ? item.supportingDocuments : [];
  const normalizedDocs = [
    primaryInvoice,
    ...restInvoices,
  ]
    .filter(Boolean)
    .map((doc) => ({
      storagePath: toOptionalString(doc.storagePath),
      fileName: toOptionalString(doc.fileName),
      downloadURL: toOptionalString(doc.downloadURL),
      contentType: toOptionalString(doc.contentType),
    }));

  supportingDocsSource
    .filter((doc) => isRecord(doc))
    .forEach((doc) => {
      normalizedDocs.push({
        storagePath: toOptionalString(doc.storagePath),
        fileName: toOptionalString(doc.fileName),
        downloadURL: toOptionalString(doc.downloadURL),
        contentType: toOptionalString(doc.contentType),
      });
    });

  const dedupedDocs = [];
  const seen = new Set();
  normalizedDocs.forEach((doc) => {
    const key = `${doc.storagePath ?? ''}|${doc.downloadURL ?? ''}|${doc.fileName ?? ''}|${doc.contentType ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (doc.storagePath || doc.downloadURL || doc.fileName) {
      dedupedDocs.push(doc);
    }
  });

  if (dedupedDocs.length > 0) {
    normalized.supportingDocuments = dedupedDocs;
  }

  const highlightedSource = isRecord(item.highlightedDocument) ? item.highlightedDocument : null;
  if (highlightedSource) {
    const highlightedDocument = {
      storagePath: toOptionalString(highlightedSource.storagePath),
      fileName: toOptionalString(highlightedSource.fileName),
      downloadURL: toOptionalString(highlightedSource.downloadURL),
      contentType: toOptionalString(highlightedSource.contentType),
    };
    if (highlightedDocument.storagePath || highlightedDocument.downloadURL || highlightedDocument.fileName) {
      normalized.highlightedDocument = highlightedDocument;
    }
  }

  // Normalize optional answer key shape for correctness/explanations
  if (isRecord(item.answerKey)) {
    const ak = item.answerKey || {};
    const toNumOrUndefined = (v) => {
      if (v === '' || v === null || v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const answerKey = {};
    const pi = toNumOrUndefined(ak.properlyIncluded);
    const pe = toNumOrUndefined(ak.properlyExcluded);
    const ii = toNumOrUndefined(ak.improperlyIncluded);
    const ie = toNumOrUndefined(ak.improperlyExcluded);
    if (pi !== undefined) answerKey.properlyIncluded = pi;
    if (pe !== undefined) answerKey.properlyExcluded = pe;
    if (ii !== undefined) answerKey.improperlyIncluded = ii;
    if (ie !== undefined) answerKey.improperlyExcluded = ie;
    const explanation = toOptionalString(ak.explanation);
    if (explanation) answerKey.explanation = explanation;
    if (Object.keys(answerKey).length > 0) {
      normalized.answerKey = answerKey;
    }
  }

  return normalized;
};

const normalizeAuditItems = (items = [], invoiceMappings = []) => {
  const list = Array.isArray(items) ? items : [];
  const invoiceGroups = groupInvoiceMappings(normalizeInvoiceMappings(invoiceMappings));
  const normalizedList = [];
  list.forEach((item, index) => {
    const normalized = normalizeAuditItem(item, index, invoiceGroups);
    if (normalized) {
      normalizedList.push(normalized);
    } else {
      if (DEBUG_LOGS) {
        console.warn('[caseService] normalizeAuditItems: item dropped during normalization', { index });
      }
    }
  });
  return normalizedList;
};

export const toNormalizedCaseModel = (id, raw = {}) => {
  const normalizedAuditItems = normalizeAuditItems(
    raw?.auditItems ?? raw?.disbursements,
    raw?.invoiceMappings
  );
  const normalized = {
    ...raw,
    invoiceMappings: normalizeInvoiceMappings(raw?.invoiceMappings),
    auditItems: normalizedAuditItems,
    disbursements: normalizedAuditItems,
    referenceDocuments: normalizeReferenceDocuments(raw?.referenceDocuments),
  };
  return toCaseModel(id, normalized);
};

export const mergeCaseKeysIntoCaseModel = (caseModel, caseKeysData) => {
  if (!caseModel) return caseModel;
  const itemsMap = isRecord(caseKeysData?.items) ? caseKeysData.items : null;
  if (!itemsMap) return caseModel;

  const disbursements = Array.isArray(caseModel.disbursements) ? caseModel.disbursements : [];
  const mergedDisbursements = disbursements.map((item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }
    const paymentId = item.paymentId;
    if (!paymentId || !isRecord(itemsMap[paymentId])) {
      return item;
    }
    const entry = itemsMap[paymentId];
    const merged = { ...item };
    if (isRecord(entry.answerKey)) {
      merged.answerKey = { ...entry.answerKey };
      merged.hasAnswerKey = true;
    }
    if (typeof entry.answerKeyMode === 'string') {
      merged.answerKeyMode = entry.answerKeyMode;
    }
    if (typeof entry.answerKeySingleClassification === 'string') {
      merged.answerKeySingleClassification = entry.answerKeySingleClassification;
    }
    if (typeof entry.correctClassification === 'string') {
      merged.correctClassification = entry.correctClassification;
    }
    if (typeof entry.primaryAssertion === 'string') {
      merged.primaryAssertion = entry.primaryAssertion;
    }
    if (isRecord(entry.groundTruths)) {
      merged.groundTruths = { ...entry.groundTruths };
    }
    if (typeof entry.riskLevel === 'string' && entry.riskLevel.trim()) {
      merged.riskLevel = entry.riskLevel.trim().toLowerCase();
    }
    return merged;
  });

  return {
    ...caseModel,
    disbursements: mergedDisbursements,
    auditItems: mergedDisbursements,
  };
};

const toTimestampOrNull = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return value;
  if (
    (typeof value?.seconds === 'number' || typeof value?._seconds === 'number') &&
    (typeof value?.nanoseconds === 'number' || typeof value?._nanoseconds === 'number')
  ) {
    try {
      const seconds = typeof value.seconds === 'number' ? value.seconds : value._seconds;
      const nanoseconds = typeof value.nanoseconds === 'number' ? value.nanoseconds : value._nanoseconds;
      return new Timestamp(seconds, nanoseconds);
    } catch (err) {
      /* ignore malformed timestamp */
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return Timestamp.fromDate(parsed);
    }
  }
  return null;
};

export const normalizeCaseTemporalFields = (raw) => {
  if (!raw || typeof raw !== 'object') return raw;
  const sanitized = { ...raw };
  if ('opensAt' in sanitized) sanitized.opensAt = toTimestampOrNull(sanitized.opensAt);
  if ('dueAt' in sanitized) sanitized.dueAt = toTimestampOrNull(sanitized.dueAt);
  if ('createdAt' in sanitized) sanitized.createdAt = toTimestampOrNull(sanitized.createdAt);
  if ('updatedAt' in sanitized) sanitized.updatedAt = toTimestampOrNull(sanitized.updatedAt);
  return sanitized;
};

export const sanitizeCaseWriteData = (rawData = {}, { isCreate = false } = {}) => {
  const { createdAt: _ignoredCreatedAt, updatedAt: _ignoredUpdatedAt, ...data } = rawData;
  const sanitized = { ...data };

  sanitized.invoiceMappings = normalizeInvoiceMappings(sanitized.invoiceMappings);
  const normalizedItems = normalizeAuditItems(
    sanitized.auditItems ?? sanitized.disbursements,
    sanitized.invoiceMappings
  );
  const { sanitizedItems, privateEntries } = extractPrivateCaseKeyEntries(normalizedItems);
  sanitized.auditItems = sanitizedItems;
  delete sanitized.disbursements;
  sanitized.referenceDocuments = normalizeReferenceDocuments(sanitized.referenceDocuments);
  if (sanitized.workpaper && typeof sanitized.workpaper === 'object') {
    sanitized.workpaper = { ...sanitized.workpaper };
  } else if ('workpaper' in sanitized) {
    delete sanitized.workpaper;
  }

  if (typeof sanitized.publicVisible !== 'boolean') {
    sanitized.publicVisible = true;
  }

  if (typeof sanitized._deleted !== 'boolean') {
    sanitized._deleted = false;
  }

  if (typeof sanitized.status !== 'string' || !VALID_CASE_STATUSES.includes(sanitized.status)) {
    sanitized.status = 'assigned';
  }

  sanitized.auditArea = normalizeAuditArea(sanitized.auditArea);
  sanitized.caseGroupId = normalizeCaseGroupId(sanitized.caseGroupId);
  sanitized.caseLevel = normalizeCaseLevel(sanitized.caseLevel);
  sanitized.accessLevel = normalizeAccessLevel(sanitized.accessLevel);

  sanitized.pathId = toOptionalString(sanitized.pathId) || toOptionalString(sanitized.auditArea);
  sanitized.pathCategory = toOptionalString(sanitized.pathCategory);
  sanitized.pathTitle = toTrimmedString(sanitized.pathTitle);
  sanitized.pathDescription = toTrimmedString(sanitized.pathDescription);
  sanitized.tier = normalizeTier(sanitized.tier);
  sanitized.moduleId = toOptionalString(sanitized.moduleId);
  sanitized.recipeVersion = normalizeNumberOrNull(sanitized.recipeVersion);
  sanitized.moduleTitle = toTrimmedString(sanitized.moduleTitle) || toTrimmedString(sanitized.title);
  sanitized.primarySkill = normalizePrimarySkill(sanitized.primarySkill, {
    moduleId: sanitized.moduleId,
    moduleTitle: sanitized.moduleTitle,
    title: sanitized.title,
    caseName: sanitized.caseName,
  });
  sanitized.secondarySkills = normalizeStringArray(sanitized.secondarySkills);
  sanitized.estimatedMinutes = normalizeNumberOrNull(sanitized.estimatedMinutes);
  sanitized.orderIndex = normalizeNumberOrNull(sanitized.orderIndex);

  const normalizedCaseName = toTrimmedString(sanitized.caseName);
  const fallbackTitle = toTrimmedString(sanitized.title);
  const caseNameForSearch = normalizedCaseName || fallbackTitle;
  sanitized.caseNameLower = caseNameForSearch ? caseNameForSearch.toLowerCase() : '';

  if ('opensAt' in sanitized) {
    sanitized.opensAt = sanitized.opensAt ?? null;
  } else if (isCreate) {
    sanitized.opensAt = null;
  }

  if ('dueAt' in sanitized) {
    sanitized.dueAt = sanitized.dueAt ?? null;
  } else if (isCreate) {
    sanitized.dueAt = null;
  }

  sanitized.updatedAt = serverTimestamp();
  if (isCreate) {
    sanitized.createdAt = serverTimestamp();
  } else if ('createdAt' in sanitized) {
    sanitized.createdAt = sanitized.createdAt ?? serverTimestamp();
  }

  const caseKeysDoc = stripUndefinedDeep({
    items: privateEntries,
    updatedAt: serverTimestamp(),
  });

  const strippedCaseData = stripDownloadUrlsFromCaseData(stripUndefinedDeep(sanitized));
  return { caseData: strippedCaseData, caseKeysDoc };
};

export const buildCaseRepairPatch = (data = {}) => {
  const patch = {};

  if (typeof data.publicVisible !== 'boolean') {
    patch.publicVisible = true;
  }

  if (typeof data._deleted !== 'boolean') {
    patch._deleted = false;
  }

  if (typeof data.status !== 'string' || !VALID_CASE_STATUSES.includes(data.status)) {
    patch.status = 'assigned';
  }

  if (!data.auditArea || !AUDIT_AREA_VALUES.includes(toOptionalString(data.auditArea))) {
    patch.auditArea = normalizeAuditArea(data.auditArea);
  }

  if (!data.caseLevel || !CASE_LEVEL_VALUES.includes(toOptionalString(data.caseLevel))) {
    patch.caseLevel = normalizeCaseLevel(data.caseLevel);
  }

  const normalizedCaseName = toTrimmedString(data.caseName);
  const fallbackTitle = toTrimmedString(data.title);
  const expectedLower = (normalizedCaseName || fallbackTitle || '').toLowerCase();
  if ((data.caseNameLower ?? '') !== expectedLower) {
    patch.caseNameLower = expectedLower;
  }

  if (!('caseGroupId' in data)) {
    patch.caseGroupId = null;
  } else {
    const normalizedGroup = normalizeCaseGroupId(data.caseGroupId);
    if (normalizedGroup !== (toOptionalString(data.caseGroupId) || null)) {
      patch.caseGroupId = normalizedGroup;
    }
  }

  if (!('opensAt' in data)) {
    patch.opensAt = null;
  } else if (data.opensAt !== null && !(data.opensAt instanceof Timestamp)) {
    patch.opensAt = toTimestampOrNull(data.opensAt);
  }

  if (!('dueAt' in data)) {
    patch.dueAt = null;
  } else if (data.dueAt !== null && !(data.dueAt instanceof Timestamp)) {
    patch.dueAt = toTimestampOrNull(data.dueAt);
  }

  if (!data.createdAt) {
    patch.createdAt = serverTimestamp();
  } else if (!(data.createdAt instanceof Timestamp)) {
    patch.createdAt = toTimestampOrNull(data.createdAt) || serverTimestamp();
  }

  if (!Array.isArray(data.referenceDocuments)) {
    if (data.referenceDocuments !== undefined) {
      patch.referenceDocuments = normalizeReferenceDocuments(data.referenceDocuments);
    } else {
      patch.referenceDocuments = [];
    }
  } else {
    const normalizedDocs = normalizeReferenceDocuments(data.referenceDocuments);
    const hasMismatch =
      normalizedDocs.length !== data.referenceDocuments.length ||
      normalizedDocs.some((doc, idx) => {
        const original = data.referenceDocuments[idx] || {};
        return (
          doc.fileName !== toOptionalString(original.fileName) ||
          doc.storagePath !== (toOptionalString(original.storagePath) ?? null) ||
          doc.downloadURL !== (toOptionalString(original.downloadURL) ?? null) ||
          doc.generationSpecId !== (toOptionalString(original.generationSpecId) ?? null) ||
          JSON.stringify(doc.generationSpec || null) !==
            JSON.stringify(isRecord(original.generationSpec) ? original.generationSpec : null)
        );
      });
    if (hasMismatch) {
      patch.referenceDocuments = normalizedDocs;
    }
  }

  return patch;
};

export const getCaseMappingHealth = (caseData) => {
  const disbursements = Array.isArray(caseData?.disbursements) ? caseData.disbursements : [];
  const totalDisbursements = disbursements.length;
  if (totalDisbursements === 0) {
    return {
      totalDisbursements: 0,
      mappedDisbursements: 0,
      unmappedDisbursements: 0,
      mappedPercent: 0,
    };
  }

  const mappedPayments = new Set(
    (Array.isArray(caseData?.invoiceMappings) ? caseData.invoiceMappings : [])
      .map((mapping) => normalizePaymentId(mapping?.paymentId))
      .filter(Boolean)
  );

  let mappedDisbursements = 0;

  disbursements.forEach((item) => {
    const normalizedPaymentId = normalizePaymentId(item?.paymentId);
    const hasSupportingDocs = Array.isArray(item?.supportingDocuments) && item.supportingDocuments.length > 0;
    const isMapped = normalizedPaymentId ? mappedPayments.has(normalizedPaymentId) : false;
    if (isMapped || hasSupportingDocs) {
      mappedDisbursements += 1;
    }
  });

  const unmappedDisbursements = Math.max(totalDisbursements - mappedDisbursements, 0);
  const mappedPercent = totalDisbursements > 0
    ? Math.round((mappedDisbursements / totalDisbursements) * 100)
    : 0;

  return {
    totalDisbursements,
    mappedDisbursements,
    unmappedDisbursements,
    mappedPercent,
  };
};

export const normalizePaymentId = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

export const computeDisbursementAlerts = (caseData) => {
  const alerts = [];
  const disbursements = Array.isArray(caseData.disbursements) ? caseData.disbursements : [];
  if (disbursements.length === 0) return alerts;

  const caseId = caseData?.id;
  const caseName = caseData?.caseName || caseData?.title || 'Untitled case';
  const mappedPayments = new Set(
    (Array.isArray(caseData.invoiceMappings) ? caseData.invoiceMappings : [])
      .map((mapping) => normalizePaymentId(mapping?.paymentId))
      .filter(Boolean)
  );

  disbursements.forEach((item) => {
    const normalizedPaymentId = normalizePaymentId(item?.paymentId);
    const paymentId = normalizedPaymentId || 'Unknown payment';
    const hasAnswerKey =
      item?.hasAnswerKey ||
      (item && item.answerKey && Object.keys(item.answerKey).length > 0);
    const hasSupportingDocs = Array.isArray(item?.supportingDocuments) && item.supportingDocuments.length > 0;
    const isMapped = normalizedPaymentId ? mappedPayments.has(normalizedPaymentId) : false;

    if (!hasAnswerKey) {
      alerts.push({
        id: `${caseData.id}-missing-ak-${paymentId}`,
        caseId,
        caseName,
        type: 'Answer key',
        message: `Missing answer key for ${paymentId}.`,
        context: caseData.caseName,
        actionPath: `/admin/case-overview/${caseData.id}?section=disbursements&focus=${encodeURIComponent(paymentId)}`,
      });
    }

    if (!isMapped && !hasSupportingDocs) {
      alerts.push({
        id: `${caseData.id}-unmapped-${paymentId}`,
        caseId,
        caseName,
        type: 'Mapping',
        message: `Unmapped disbursement ${paymentId}.`,
        context: caseData.caseName,
        actionPath: `/admin/case-data-audit?caseId=${caseData.id}&focus=${encodeURIComponent(paymentId)}`,
      });
    }
  });

  return alerts;
};

export const toMillis = (timestamp) => {
  if (!timestamp) return null;
  if (typeof timestamp.toMillis === 'function') {
    try {
      return timestamp.toMillis();
    } catch (err) {
      return null;
    }
  }
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  if (typeof timestamp === 'number') {
    return timestamp;
  }
  if (typeof timestamp === 'string') {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
  }
  return null;
};
