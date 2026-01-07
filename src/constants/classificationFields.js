import { AUDIT_AREAS, DEFAULT_AUDIT_AREA } from '../models/caseConstants';

const DEFAULT_CLASSIFICATION_FIELDS = [
  { key: 'properlyIncluded', label: 'Properly Included' },
  { key: 'properlyExcluded', label: 'Properly Excluded' },
  { key: 'improperlyIncluded', label: 'Improperly Included' },
  { key: 'improperlyExcluded', label: 'Improperly Excluded' },
];

const DEFAULT_FLOW_COPY = {
  stepLabels: {
    selection: 'Select Disbursements',
    testing: 'Classify Results',
    results: 'Review Outcome',
  },
  stepDescriptions: {
    selection: 'Choose which disbursements you will test.',
    testing: 'Allocate the amounts across each classification and review documents.',
    results: 'See a recap of your responses.',
  },
  testingIntro:
    'Review the supporting documents and allocate the disbursement amount across each classification category.',
  splitAllocationHint: 'Enter the amount allocated to each classification. Totals must equal the disbursement amount.',
  singleAllocationHint: 'Select a classification to assign the full amount.',
};

const CASH_CLASSIFICATION_FIELDS = [
  { key: 'properlyIncluded', label: 'Cash Count Matches' },
  { key: 'properlyExcluded', label: 'Timing Difference (Excluded)' },
  { key: 'improperlyIncluded', label: 'Cash Over' },
  { key: 'improperlyExcluded', label: 'Cash Short' },
];

const CASH_FLOW_COPY = {
  stepLabels: {
    selection: 'Select Cash Counts',
    testing: 'Reconcile Variances',
    results: 'Review Outcome',
  },
  stepDescriptions: {
    selection: 'Pick the drawer or deposit samples you will reconcile.',
    testing: 'Analyze the variance and allocate amounts to the appropriate cash buckets.',
    results: 'Review how your reconciliation compares to the expected results.',
  },
  testingIntro:
    'Review the cash count support and reconcile the variance across the available cash classifications.',
  splitAllocationHint: 'Allocate the variance across each cash classification. Totals must equal the cash variance amount.',
  singleAllocationHint: 'Choose the cash classification that best explains the full variance.',
};

const BASE_CONFIG = {
  fields: DEFAULT_CLASSIFICATION_FIELDS,
  flowCopy: DEFAULT_FLOW_COPY,
};

const CLASSIFICATION_CONFIG_BY_AUDIT_AREA = {
  [AUDIT_AREAS.GENERAL]: BASE_CONFIG,
  [AUDIT_AREAS.PAYABLES]: BASE_CONFIG,
  [AUDIT_AREAS.RECEIVABLES]: BASE_CONFIG,
  [AUDIT_AREAS.INVENTORY]: BASE_CONFIG,
  [AUDIT_AREAS.CASH]: {
    fields: CASH_CLASSIFICATION_FIELDS,
    flowCopy: CASH_FLOW_COPY,
  },
  [AUDIT_AREAS.PAYROLL]: BASE_CONFIG,
};

const DEFAULT_CONFIG = CLASSIFICATION_CONFIG_BY_AUDIT_AREA[DEFAULT_AUDIT_AREA] || BASE_CONFIG;

export const getClassificationConfig = (auditArea) =>
  CLASSIFICATION_CONFIG_BY_AUDIT_AREA[auditArea] || DEFAULT_CONFIG;

export const getClassificationFields = (auditArea) => getClassificationConfig(auditArea).fields;

export const createEmptyClassification = (auditArea) => {
  const template = {};
  getClassificationFields(auditArea).forEach(({ key }) => {
    template[key] = '';
  });
  return template;
};

export const getFlowCopy = (auditArea) => getClassificationConfig(auditArea).flowCopy;
