import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
  and,
  or,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, FirestorePaths, functions } from '../../AppCore';
import { getNow } from '../../utils/dates';
import { AUDIT_AREA_VALUES, CASE_LEVEL_VALUES } from '../../models/caseConstants';
import { DEBUG_LOGS } from './caseDebug';
import {
  VALID_CASE_STATUSES,
  toTrimmedString,
  normalizeCaseTemporalFields,
  toNormalizedCaseModel,
} from './caseTransforms';

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

const normalizeCaseLevelFilter = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return CASE_LEVEL_VALUES.includes(trimmed) ? trimmed : null;
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

const buildAdminCasesQueryParts = ({
  searchTerm,
  statusFilters,
  visibilityFilters,
  auditAreaFilter,
  caseLevelFilter,
  sortKey,
}) => {
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

  if (caseLevelFilter) {
    filters.push(where('caseLevel', '==', caseLevelFilter));
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

export const fetchCasesPage = async ({
  search = '',
  status = [],
  visibility = [],
  auditArea = '',
  caseLevel = '',
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
  const caseLevelFilter = normalizeCaseLevelFilter(caseLevel);
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
    caseLevelFilter,
    sortKey,
  });

  if (orgId) {
    filters.push(where('orgId', '==', orgId));
  }

  if (DEBUG_LOGS) {
    console.log('[caseService] Query parts:', { filters, order });
  }

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
        if (DEBUG_LOGS) {
          console.warn('[caseService] No cases returned with _deleted == false filter, but fallback query located candidates', {
            fallbackCount: fallbackItems.length,
            candidatesMissingDeletedFlag,
          });
        }
      }
    } catch (debugError) {
      if (DEBUG_LOGS) {
        console.warn('[caseService] Failed fallback inspection after empty case query', debugError);
      }
    }
  }

  if (DEBUG_LOGS) {
    console.log('[caseService] Returning:', { total, items });
  }

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
    caseLevelFilter,
  };
};

const DEFAULT_STUDENT_STATUSES = ['assigned', 'in_progress', 'submitted', 'draft'];

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
    where('_deleted', '==', false),
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
} = {}) => {
  if (DEBUG_LOGS) {
    console.info('[caseService] listStudentCases (callable)', {
      appId,
      uid,
      pageSize,
      cursor,
      includeOpensAtGate,
      sortBy,
      statusFilter,
    });
  }

  const listStudentCasesCallable = httpsCallable(functions, 'listStudentCases');
  const result = await listStudentCasesCallable({
    appId,
    uid,
    pageSize,
    cursor,
    includeOpensAtGate,
    statusFilter,
    sortBy,
  });

  const payload = result?.data || {};
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      if (entry.data && typeof entry.data === 'object' && entry.id) {
        const normalized = normalizeCaseTemporalFields(entry.data);
        return toNormalizedCaseModel(entry.id, normalized);
      }
      if (entry.id) {
        const { id, ...rest } = entry;
        const normalized = normalizeCaseTemporalFields(rest);
        return toNormalizedCaseModel(id, normalized);
      }
      return null;
    })
    .filter(Boolean);

  const rawCursor = payload?.nextCursor;
  const nextCursor =
    rawCursor && typeof rawCursor === 'object'
      ? {
          dueAt: rawCursor.dueAt ?? null,
          title: toTrimmedString(rawCursor.title ?? ''),
        }
      : null;

  return { items, nextCursor };
};
