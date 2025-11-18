import {
  collection,
  doc,
  getDoc,
  addDoc,
  setDoc,
  query,
  onSnapshot,
  where,
  getDocs,
  orderBy,
  limit,
  startAfter,
  or,
  and,
  serverTimestamp,
  writeBatch,
  Timestamp,
  getCountFromServer,
} from 'firebase/firestore';
import { db, FirestorePaths } from '../AppCore';
import { getNow } from '../utils/dates';
import { toCaseModel } from '../models/case';
import {
  AUDIT_AREA_VALUES,
  CASE_GROUP_VALUES,
  DEFAULT_AUDIT_AREA,
  DEFAULT_ITEM_TYPE,
} from '../models/caseConstants';

const VALID_CASE_STATUSES = ['assigned', 'in_progress', 'submitted', 'archived', 'draft'];

export const CASE_SORT_OPTIONS = {
  UPDATED_DESC: 'updated_desc',
  UPDATED_ASC: 'updated_asc',
  CREATED_DESC: 'created_desc',
  CREATED_ASC: 'created_asc',
  NAME_ASC: 'name_asc',
  NAME_DESC: 'name_desc',
  STATUS_ASC: 'status_asc',
  STATUS_DESC: 'status_desc',
};

export const DEFAULT_CASE_SORT = CASE_SORT_OPTIONS.UPDATED_DESC;

const CASE_SORT_CONFIG = {
  [CASE_SORT_OPTIONS.UPDATED_DESC]: {
    field: 'updatedAt',
    direction: 'desc',
    secondary: [
      { field: 'createdAt', direction: 'desc' },
      { field: 'caseNameLower', direction: 'asc' },
    ],
  },
  [CASE_SORT_OPTIONS.UPDATED_ASC]: {
    field: 'updatedAt',
    direction: 'asc',
    secondary: [
      { field: 'createdAt', direction: 'asc' },
      { field: 'caseNameLower', direction: 'asc' },
    ],
  },
  [CASE_SORT_OPTIONS.CREATED_DESC]: {
    field: 'createdAt',
    direction: 'desc',
    secondary: [{ field: 'caseNameLower', direction: 'asc' }],
  },
  [CASE_SORT_OPTIONS.CREATED_ASC]: {
    field: 'createdAt',
    direction: 'asc',
    secondary: [{ field: 'caseNameLower', direction: 'asc' }],
  },
  [CASE_SORT_OPTIONS.NAME_ASC]: {
    field: 'caseNameLower',
    direction: 'asc',
    secondary: [{ field: 'createdAt', direction: 'desc' }],
  },
  [CASE_SORT_OPTIONS.NAME_DESC]: {
    field: 'caseNameLower',
    direction: 'desc',
    secondary: [{ field: 'createdAt', direction: 'desc' }],
  },
  [CASE_SORT_OPTIONS.STATUS_ASC]: {
    field: 'status',
    direction: 'asc',
    secondary: [
      { field: 'caseNameLower', direction: 'asc' },
      { field: 'createdAt', direction: 'desc' },
    ],
  },
  [CASE_SORT_OPTIONS.STATUS_DESC]: {
    field: 'status',
    direction: 'desc',
    secondary: [
      { field: 'caseNameLower', direction: 'asc' },
      { field: 'createdAt', direction: 'desc' },
    ],
  },
};

export const CASE_SORT_CHOICES = [
  { value: CASE_SORT_OPTIONS.UPDATED_DESC, label: 'Recently updated' },
  { value: CASE_SORT_OPTIONS.UPDATED_ASC, label: 'Oldest updated' },
  { value: CASE_SORT_OPTIONS.CREATED_DESC, label: 'Newest created' },
  { value: CASE_SORT_OPTIONS.CREATED_ASC, label: 'Oldest created' },
  { value: CASE_SORT_OPTIONS.NAME_ASC, label: 'Name A → Z' },
  { value: CASE_SORT_OPTIONS.NAME_DESC, label: 'Name Z → A' },
  { value: CASE_SORT_OPTIONS.STATUS_ASC, label: 'Status A → Z' },
  { value: CASE_SORT_OPTIONS.STATUS_DESC, label: 'Status Z → A' },
];

const isRecord = (value) => typeof value === 'object' && value !== null;

const toTrimmedString = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const normalizeStatusFilters = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => VALID_CASE_STATUSES.includes(item));
};

const normalizeVisibilityFilters = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter((item) => item === 'public' || item === 'private' || item === 'rostered');
};

const normalizeAuditAreaFilter = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return AUDIT_AREA_VALUES.includes(trimmed) ? trimmed : null;
};

const toVisibilityBooleanFilters = (filters) => {
  if (!Array.isArray(filters) || filters.length === 0) return [];
  const mapped = filters.map((value) => (value === 'public' ? true : false));
  return Array.from(new Set(mapped));
};

const normalizeSearchValue = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const toOptionalString = (value) => {
  const trimmed = toTrimmedString(value);
  return trimmed === '' ? null : trimmed;
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
    if (!fileName) return;
    if (!storagePath && !downloadURL) return;
    const key = `${fileName}|${storagePath ?? ''}|${downloadURL ?? ''}|${contentType ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({
      fileName,
      storagePath: storagePath ?? null,
      downloadURL: downloadURL ?? null,
      contentType: contentType ?? null,
    });
  });
  return normalized;
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
  if (!isRecord(item)) return null;
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
    }
  });
  return normalizedList;
};

const toNormalizedCaseModel = (id, raw = {}) => {
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

const buildAdminCasesQueryParts = ({ searchTerm, statusFilters, visibilityFilters, auditAreaFilter, sortKey }) => {
  const deletedFilter = where('_deleted', '==', false);
  const filters = [deletedFilter];

  if (statusFilters.length === 1) {
    filters.push(where('status', '==', statusFilters[0]));
  } else if (statusFilters.length > 1) {
    filters.push(where('status', 'in', statusFilters.slice(0, 10)));
  }

  const visibilityBooleanFilters = toVisibilityBooleanFilters(visibilityFilters);
  if (visibilityBooleanFilters.length === 1) {
    filters.push(where('publicVisible', '==', visibilityBooleanFilters[0]));
  }

  if (auditAreaFilter) {
    filters.push(where('auditArea', '==', auditAreaFilter));
  }

  const order = [];

  if (searchTerm) {
    filters.push(where('caseNameLower', '>=', searchTerm));
    filters.push(where('caseNameLower', '<=', `${searchTerm}\uf8ff`));
    order.push(orderBy('caseNameLower', 'asc'));
    order.push(orderBy('createdAt', 'desc'));
  } else {
    const config = CASE_SORT_CONFIG[sortKey] ?? CASE_SORT_CONFIG[DEFAULT_CASE_SORT];
    order.push(orderBy(config.field, config.direction));
    (config.secondary || []).forEach(({ field, direction }) => {
      order.push(orderBy(field, direction));
    });
  }

  return { filters, order, deletedFilter };
};

const toTimestampOrNull = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value?.seconds === 'number' && typeof value?.nanoseconds === 'number') {
    try {
      return new Timestamp(value.seconds, value.nanoseconds);
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

const sanitizeCaseWriteData = (rawData = {}, { isCreate = false } = {}) => {
  const { createdAt: _ignoredCreatedAt, updatedAt: _ignoredUpdatedAt, ...data } = rawData;
  const sanitized = { ...data };

  sanitized.invoiceMappings = normalizeInvoiceMappings(sanitized.invoiceMappings);
  const normalizedItems = normalizeAuditItems(
    sanitized.auditItems ?? sanitized.disbursements,
    sanitized.invoiceMappings
  );
  sanitized.auditItems = normalizedItems;
  delete sanitized.disbursements;
  sanitized.referenceDocuments = normalizeReferenceDocuments(sanitized.referenceDocuments);

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

  return sanitized;
};

const buildCaseRepairPatch = (data = {}) => {
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
          doc.downloadURL !== (toOptionalString(original.downloadURL) ?? null)
        );
      });
    if (hasMismatch) {
      patch.referenceDocuments = normalizedDocs;
    }
  }

  return patch;
};

export const fetchCasesPage = async ({
  search = '',
  status = [],
  visibility = [],
  auditArea = '',
  sort = DEFAULT_CASE_SORT,
  page = 1,
  limit: limitInput = 12,
  orgId = null,
} = {}) => {
  const casesCollection = collection(db, FirestorePaths.CASES_COLLECTION());
  const searchTerm = normalizeSearchValue(search);
  const statusFilters = normalizeStatusFilters(status);
  const visibilityFilters = normalizeVisibilityFilters(visibility);
  const auditAreaFilter = normalizeAuditAreaFilter(auditArea);
  const sortKey = CASE_SORT_CONFIG[sort] ? sort : DEFAULT_CASE_SORT;

  const parsedPage = Number.parseInt(page, 10);
  const desiredPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const parsedLimit = Number.parseInt(limitInput, 10);
  const pageSize = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 12;

  const { filters, order, deletedFilter } = buildAdminCasesQueryParts({
    searchTerm,
    statusFilters,
    visibilityFilters,
    auditAreaFilter,
    sortKey,
  });

  if (orgId) {
    filters.push(where('orgId', '==', orgId));
  }

  console.log('[caseService] Query parts:', { filters, order });

  const countSnapshot = await getCountFromServer(query(casesCollection, ...filters));
  const total = countSnapshot.data().count ?? 0;
  const maxPage = total === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = Math.min(desiredPage, maxPage);
  const offsetValue = total === 0 ? 0 : (effectivePage - 1) * pageSize;

  const baseConstraints = [...filters, ...order];

  let items = [];
  if (total > 0) {
    const paginationConstraints = [...baseConstraints];

    if (offsetValue > 0) {
      const cursorSnapshot = await getDocs(
        query(casesCollection, ...baseConstraints, limit(offsetValue))
      );
      const cursorDocs = cursorSnapshot.docs;
      if (cursorDocs.length > 0) {
        paginationConstraints.push(startAfter(cursorDocs[cursorDocs.length - 1]));
      }
    }

    paginationConstraints.push(limit(pageSize));

    const snapshot = await getDocs(query(casesCollection, ...paginationConstraints));
    items = snapshot.docs.map((docSnap) => toNormalizedCaseModel(docSnap.id, docSnap.data()));
  }

  if (total === 0 && deletedFilter) {
    try {
      const filtersWithoutDeleted = filters.filter((constraint) => constraint !== deletedFilter);
      const fallbackSnapshot = await getDocs(
        query(casesCollection, ...filtersWithoutDeleted, ...order, limit(5))
      );
      const fallbackItems = fallbackSnapshot.docs.map((docSnap) =>
        toNormalizedCaseModel(docSnap.id, docSnap.data())
      );
      const candidatesMissingDeletedFlag = fallbackItems
        .filter((item) => item._deleted !== false)
        .map((item) => item.id);

      if (fallbackItems.length > 0) {
        console.warn('[caseService] No cases returned with _deleted == false filter, but fallback query located candidates', {
          fallbackCount: fallbackItems.length,
          candidatesMissingDeletedFlag,
        });
      }
    } catch (debugError) {
      console.warn('[caseService] Failed fallback inspection after empty case query', debugError);
    }
  }

  console.log('[caseService] Returning:', { total, items });

  return {
    items,
    total,
    page: effectivePage,
    requestedPage: desiredPage,
    pageSize,
    hasNextPage: effectivePage < maxPage,
    hasPreviousPage: effectivePage > 1,
    sort: sortKey,
    search: searchTerm,
    statusFilters,
    visibilityFilters,
    auditAreaFilter,
  };
};

export const subscribeToCases = (onData, onError) => {
  const q = query(collection(db, FirestorePaths.CASES_COLLECTION()));
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => toNormalizedCaseModel(d.id, d.data()));
    onData(data);
  }, onError);
};

export const subscribeToActiveCases = (onData, onError) => {
  const q = query(collection(db, FirestorePaths.CASES_COLLECTION()), where('_deleted', '!=', true));
  return onSnapshot(q, (snap) => {
    const data = snap.docs.map((d) => toNormalizedCaseModel(d.id, d.data()));
    onData(data);
  }, onError);
};

export const subscribeToCase = (caseId, onData, onError) => {
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      onData(null);
    } else {
      onData(toNormalizedCaseModel(snap.id, snap.data()));
    }
  }, onError);
};

export const fetchCase = async (caseId) => {
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return toNormalizedCaseModel(snap.id, snap.data());
};

export const createCase = async (data) => {
  const collectionRef = collection(db, FirestorePaths.CASES_COLLECTION());
  const docRef = await addDoc(collectionRef, sanitizeCaseWriteData(data, { isCreate: true }));
  return docRef.id;
};

export const updateCase = async (caseId, data) => {
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  await setDoc(ref, sanitizeCaseWriteData(data, { isCreate: false }), { merge: true });
};

export const markCaseDeleted = async (caseId) => {
  const ref = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
  await setDoc(ref, { _deleted: true, updatedAt: serverTimestamp() }, { merge: true });
};

const toMillis = (timestamp) => {
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

const computeDisbursementAlerts = (caseData) => {
  const alerts = [];
  const disbursements = Array.isArray(caseData.disbursements) ? caseData.disbursements : [];
  if (disbursements.length === 0) return alerts;

  const caseId = caseData?.id;
  const caseName = caseData?.caseName || caseData?.title || 'Untitled case';
  const mappedPayments = new Set(
    (Array.isArray(caseData.invoiceMappings) ? caseData.invoiceMappings : [])
      .map((mapping) => mapping?.paymentId)
      .filter(Boolean)
  );

  disbursements.forEach((item) => {
    const paymentId = item?.paymentId || 'Unknown payment';
    const hasAnswerKey = item && item.answerKey && Object.keys(item.answerKey).length > 0;
    const hasSupportingDocs = Array.isArray(item?.supportingDocuments) && item.supportingDocuments.length > 0;
    const isMapped = mappedPayments.has(item?.paymentId);

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

const DEFAULT_STUDENT_STATUSES = ['assigned', 'in_progress'];

/**
 * Build a Firestore query for trainee-visible cases with pagination support.
 * @param {{ appId: string, uid: string, pageSize?: number, cursor?: { opensAt?: any, dueAt?: any, title?: string }, includeOpensAtGate?: boolean, statusFilter?: string[], sortBy?: 'due' | 'title' }} params
 */
export const buildStudentCasesQuery = ({
  appId,
  uid,
  pageSize = 20,
  cursor,
  includeOpensAtGate = false,
  statusFilter = DEFAULT_STUDENT_STATUSES,
  sortBy = 'due',
} = {}) => {
  if (!appId) throw new Error('buildStudentCasesQuery requires appId');
  if (!uid) throw new Error('buildStudentCasesQuery requires uid');

  const casesCollection = collection(db, FirestorePaths.CASES_COLLECTION());
  const now = getNow();
  let filterConstraint = and(
    where('_deleted', '!=', true),
    or(where('publicVisible', '==', true), where('visibleToUserIds', 'array-contains', uid))
  );

  if (statusFilter && statusFilter.length > 0) {
    filterConstraint = and(filterConstraint, where('status', 'in', statusFilter));
  }

  if (includeOpensAtGate) {
    filterConstraint = and(filterConstraint, where('opensAt', '<=', now.timestamp));
  }

  const constraints = [filterConstraint];

  if (sortBy === 'title') {
    constraints.push(orderBy('title', 'asc'));
    constraints.push(orderBy('dueAt', 'asc'));
  } else {
    constraints.push(orderBy('dueAt', 'asc'));
    constraints.push(orderBy('title', 'asc'));
  }

  if (cursor) {
    const cursorValues = [];
    if (sortBy === 'title') {
      cursorValues.push(cursor.title ?? '', cursor.dueAt ?? null);
    } else {
      cursorValues.push(cursor.dueAt ?? null, cursor.title ?? '');
    }
    constraints.push(startAfter(...cursorValues));
  }

  if (pageSize) {
    constraints.push(limit(pageSize));
  }

  return query(casesCollection, ...constraints);
};

/**
 * Execute the student cases query and return paginated results.
 * @param {{ appId: string, uid: string, pageSize?: number, cursor?: { opensAt?: any, dueAt?: any, title?: string }, includeOpensAtGate?: boolean, statusFilter?: string[], sortBy?: 'due' | 'title' }} params
 */
export const listStudentCases = async ({
  pageSize = 20,
  cursor,
  includeOpensAtGate = false,
  statusFilter,
  sortBy = 'due',
  appId,
  uid,
}) => {
  const q = buildStudentCasesQuery({ appId, uid, pageSize, cursor, includeOpensAtGate, statusFilter, sortBy });
  const snap = await getDocs(q);
  const items = snap.docs.map((docSnap) => toNormalizedCaseModel(docSnap.id, docSnap.data()));
  const lastDoc = snap.docs[snap.docs.length - 1];

  let nextCursor = null;
  if (lastDoc) {
    const data = lastDoc.data();
    nextCursor = {
      dueAt: data.dueAt ?? null,
      title: data.title ?? data.caseName ?? '',
    };
  }

  return { items, nextCursor };
};

const BATCH_WRITE_LIMIT = 450;

const commitUpdatesInChunks = async (updates) => {
  for (let i = 0; i < updates.length; i += BATCH_WRITE_LIMIT) {
    const batch = writeBatch(db);
    updates.slice(i, i + BATCH_WRITE_LIMIT).forEach(({ ref, data }) => {
      batch.set(ref, data, { merge: true });
    });
    await batch.commit();
  }
};

export const repairLegacyCases = async () => {
  const casesCollection = collection(db, FirestorePaths.CASES_COLLECTION());
  const snap = await getDocs(casesCollection);
  const updates = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const patch = buildCaseRepairPatch(data);

    if (Object.keys(patch).length > 0) {
      patch.updatedAt = serverTimestamp();
      updates.push({ ref: docSnap.ref, data: patch });
    }
  });

  if (updates.length === 0) {
    return { repaired: 0 };
  }

  await commitUpdatesInChunks(updates);

  return { repaired: updates.length };
};

const subscribeToActiveCaseModels = (onData, onError) =>
  subscribeToCases(
    (cases) => {
      const activeCases = cases.filter((item) => !item._deleted);
      onData(activeCases);
    },
    onError
  );

export const subscribeToAdminCaseSummary = (onData, onError) =>
  subscribeToActiveCaseModels((cases) => {
    const summary = cases.reduce(
      (acc, current) => {
        acc.activeCases += 1;
        acc.totalDisbursements += Array.isArray(current.disbursements) ? current.disbursements.length : 0;
        acc.totalMappings += Array.isArray(current.invoiceMappings) ? current.invoiceMappings.length : 0;
        if (current.publicVisible === false && Array.isArray(current.visibleToUserIds) && current.visibleToUserIds.length > 0) {
          acc.privateAudiences += 1;
        }
        const rawArea = typeof current.auditArea === 'string' ? current.auditArea.trim() : '';
        const area = rawArea || DEFAULT_AUDIT_AREA;
        acc.auditAreaCounts[area] = (acc.auditAreaCounts[area] || 0) + 1;
        return acc;
      },
      { activeCases: 0, totalDisbursements: 0, totalMappings: 0, privateAudiences: 0, auditAreaCounts: {} }
    );
    onData(summary);
  }, onError);

export const subscribeToAdminCaseAlerts = (onData, onError) =>
  subscribeToActiveCaseModels((cases) => {
    const allAlerts = cases.flatMap((caseData) => computeDisbursementAlerts(caseData));
    onData(allAlerts);
  }, onError);

export const subscribeToRecentCaseActivity = (onData, onError, { limit: limitCount = 5 } = {}) =>
  subscribeToActiveCaseModels((cases) => {
    const items = cases
      .map((caseData) => {
        const timestamp = toMillis(caseData.updatedAt) ?? toMillis(caseData.createdAt) ?? 0;
        return {
          id: `case-${caseData.id}`,
          title: caseData.caseName || 'Untitled case',
          description: `Status: ${caseData.status || 'assigned'}`,
          actionPath: `/admin/case-overview/${caseData.id}`,
          timestamp,
        };
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limitCount);
    onData(items);
  }, onError);
