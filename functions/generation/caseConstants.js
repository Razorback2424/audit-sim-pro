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

const CASE_LEVEL_VALUES = Object.freeze(Object.values(CASE_LEVELS));

const humanizeToken = (value = '') =>
  value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const CASE_LEVEL_LABELS = Object.freeze(
  Object.fromEntries(CASE_LEVEL_VALUES.map((value) => [value, humanizeToken(value)]))
);

const normalizeCaseLevel = (value) => {
  if (typeof value !== 'string') return DEFAULT_CASE_LEVEL;
  const trimmed = value.trim().toLowerCase();
  return CASE_LEVEL_VALUES.includes(trimmed) ? trimmed : DEFAULT_CASE_LEVEL;
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
  normalizeCaseLevel,
  getCaseLevelLabel,
};
