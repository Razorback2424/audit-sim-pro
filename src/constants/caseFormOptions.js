export const STATUS_OPTIONS = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'archived', label: 'Archived' },
];

export const CASH_RECON_SCENARIOS = [
  { value: 'clean', label: 'Properly Outstanding / Matched' },
  { value: 'unrecorded', label: 'Unrecorded (Evidence only)' },
  { value: 'fictitious', label: 'Fictitious (Client only)' },
];

export const CASH_ARTIFACT_TYPES = [
  { value: 'cash_year_end_statement', label: 'Year-End Bank Statement' },
  { value: 'cash_bank_confirmation', label: 'Bank Confirmation' },
  { value: 'cash_cutoff_statement', label: 'Cutoff Statement' },
];

export const WORKPAPER_LAYOUT_OPTIONS = [
  { value: 'two_pane', label: 'Two Pane (evidence + grid)' },
  { value: 'cash_recon', label: 'Cash Reconciliation (bank vs ledger)' },
  { value: 'fixed_assets', label: 'Fixed Assets (rollforward + testing)' },
  { value: 'inventory_two_pane', label: 'Inventory (two-pane preset)' },
];

export const STANDARD_ASSERTIONS = [
  'Existence',
  'Occurrence',
  'Completeness',
  'Rights & Obligations',
  'Valuation / Accuracy',
  'Classification',
  'Cutoff',
];
