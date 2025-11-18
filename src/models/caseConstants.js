export const AUDIT_AREAS = Object.freeze({
  GENERAL: 'general',
  PAYABLES: 'payables',
  RECEIVABLES: 'receivables',
  INVENTORY: 'inventory',
  CASH: 'cash',
  PAYROLL: 'payroll',
});

export const DEFAULT_AUDIT_AREA = AUDIT_AREAS.GENERAL;

export const CASE_GROUP_IDS = Object.freeze({
  CORE_TRAINING: 'core-training',
  ADVANCED_SCENARIOS: 'advanced-scenarios',
  SANDBOX: 'sandbox',
});

const humanizeToken = (value = '') =>
  value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

export const AUDIT_AREA_VALUES = Object.freeze(Object.values(AUDIT_AREAS));
export const CASE_GROUP_VALUES = Object.freeze(Object.values(CASE_GROUP_IDS));

export const AUDIT_AREA_LABELS = Object.freeze(
  Object.fromEntries(AUDIT_AREA_VALUES.map((value) => [value, humanizeToken(value) || 'General']))
);

export const CASE_GROUP_LABELS = Object.freeze(
  Object.fromEntries(CASE_GROUP_VALUES.map((value) => [value, humanizeToken(value)]))
);

export const isAuditArea = (value) => AUDIT_AREA_VALUES.includes(value);
export const isCaseGroupId = (value) =>
  !value ? false : CASE_GROUP_VALUES.includes(value);

export const getAuditAreaLabel = (value) => {
  if (!value) return AUDIT_AREA_LABELS[DEFAULT_AUDIT_AREA];
  return AUDIT_AREA_LABELS[value] || humanizeToken(value);
};

export const getCaseGroupLabel = (value) => {
  if (!value) return '—';
  return CASE_GROUP_LABELS[value] || humanizeToken(value);
};

export const AUDIT_ITEM_TYPES = Object.freeze({
  TRANSACTION: 'transaction',
  INVENTORY_COUNT: 'inventory_count',
  PAYROLL_RECORD: 'payroll_record',
});

export const DEFAULT_ITEM_TYPE = AUDIT_ITEM_TYPES.TRANSACTION;
