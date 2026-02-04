const AUDIT_AREAS = Object.freeze({
  GENERAL: 'general',
  PAYABLES: 'payables',
  RECEIVABLES: 'receivables',
  INVENTORY: 'inventory',
  CASH: 'cash',
  PAYROLL: 'payroll',
  FIXED_ASSETS: 'fixed_assets',
});

const DEFAULT_AUDIT_AREA = AUDIT_AREAS.GENERAL;

const CASE_LEVELS = Object.freeze({
  BASIC: 'basic',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced',
});

const DEFAULT_CASE_LEVEL = CASE_LEVELS.BASIC;

const CASE_GROUP_IDS = Object.freeze({
  CORE_TRAINING: 'core-training',
  ADVANCED_SCENARIOS: 'advanced-scenarios',
  SANDBOX: 'sandbox',
});

const AUDIT_ITEM_TYPES = Object.freeze({
  TRANSACTION: 'transaction',
  INVENTORY_COUNT: 'inventory_count',
  PAYROLL_RECORD: 'payroll_record',
});

const DEFAULT_ITEM_TYPE = AUDIT_ITEM_TYPES.TRANSACTION;

const humanizeToken = (value = '') =>
  value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const AUDIT_AREA_VALUES = Object.freeze(Object.values(AUDIT_AREAS));
const CASE_GROUP_VALUES = Object.freeze(Object.values(CASE_GROUP_IDS));
const CASE_LEVEL_VALUES = Object.freeze(Object.values(CASE_LEVELS));

const AUDIT_AREA_LABELS = Object.freeze(
  Object.fromEntries(AUDIT_AREA_VALUES.map((value) => [value, humanizeToken(value) || 'General']))
);

const CASE_GROUP_LABELS = Object.freeze(
  Object.fromEntries(CASE_GROUP_VALUES.map((value) => [value, humanizeToken(value)]))
);

const CASE_LEVEL_LABELS = Object.freeze(
  Object.fromEntries(CASE_LEVEL_VALUES.map((value) => [value, humanizeToken(value)]))
);

const isAuditArea = (value) => AUDIT_AREA_VALUES.includes(value);
const isCaseGroupId = (value) => (!value ? false : CASE_GROUP_VALUES.includes(value));
const isCaseLevel = (value) => CASE_LEVEL_VALUES.includes(value);

const normalizeCaseLevel = (value) => {
  if (typeof value !== 'string') return DEFAULT_CASE_LEVEL;
  const trimmed = value.trim().toLowerCase();
  return CASE_LEVEL_VALUES.includes(trimmed) ? trimmed : DEFAULT_CASE_LEVEL;
};

const getAuditAreaLabel = (value) => {
  if (!value) return AUDIT_AREA_LABELS[DEFAULT_AUDIT_AREA];
  return AUDIT_AREA_LABELS[value] || humanizeToken(value);
};

const getCaseGroupLabel = (value) => {
  if (!value) return '—';
  return CASE_GROUP_LABELS[value] || humanizeToken(value);
};

const getCaseLevelLabel = (value) => {
  if (!value) return CASE_LEVEL_LABELS[DEFAULT_CASE_LEVEL];
  const normalized = String(value).trim().toLowerCase();
  return CASE_LEVEL_LABELS[normalized] || humanizeToken(normalized);
};

module.exports = {
  AUDIT_AREAS,
  DEFAULT_AUDIT_AREA,
  CASE_LEVELS,
  DEFAULT_CASE_LEVEL,
  CASE_GROUP_IDS,
  AUDIT_ITEM_TYPES,
  DEFAULT_ITEM_TYPE,
  AUDIT_AREA_VALUES,
  CASE_GROUP_VALUES,
  CASE_LEVEL_VALUES,
  AUDIT_AREA_LABELS,
  CASE_GROUP_LABELS,
  CASE_LEVEL_LABELS,
  isAuditArea,
  isCaseGroupId,
  isCaseLevel,
  normalizeCaseLevel,
  getAuditAreaLabel,
  getCaseGroupLabel,
  getCaseLevelLabel,
};
