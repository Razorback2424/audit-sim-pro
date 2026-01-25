import templateIds from '../../../shared/pdfTemplateIds.json';
import { apAgingSummaryV1 } from './apAging/apAgingSummaryV1.js';
import { seedBetaInvoiceV1 } from './seedBeta/seedBetaInvoiceV1.js';
import { seedGammaInvoiceV1 } from './seedGamma/seedGammaInvoiceV1.js';
import { seedAlphaInvoiceV1 } from './seedAlpha/seedAlphaInvoiceV1.js';
import { apLeadSheetV1 } from './leadsheet/apLeadSheetV1.js';
import { disbursementListingV1 } from './refdocs/disbursementListingV1.js';
import { bankStatementV1 } from './refdocs/bankStatementV1.js';
import { payrollRegisterV1 } from './refdocs/payrollRegisterV1.js';
import { remittanceBundleV1 } from './refdocs/remittanceBundleV1.js';
import { accrualEstimateV1 } from './refdocs/accrualEstimateV1.js';
import { checkCopyV1 } from './refdocs/checkCopyV1.js';

export const templates = {
  'invoice.seed.alpha.v1': seedAlphaInvoiceV1,
  'invoice.seed.beta.v1': seedBetaInvoiceV1,
  'invoice.seed.gamma.v1': seedGammaInvoiceV1,
  'refdoc.ap-aging.v1': apAgingSummaryV1,
  'refdoc.ap-leadsheet.v1': apLeadSheetV1,
  'refdoc.disbursement-listing.v1': disbursementListingV1,
  'refdoc.bank-statement.v1': bankStatementV1,
  'refdoc.payroll-register.v1': payrollRegisterV1,
  'refdoc.remittance-bundle.v1': remittanceBundleV1,
  'refdoc.accrual-estimate.v1': accrualEstimateV1,
  'refdoc.check-copy.v1': checkCopyV1,
};

const registeredIds = Object.keys(templates);
const missing = templateIds.filter((id) => !templates[id]);
const extras = registeredIds.filter((id) => !templateIds.includes(id));
if (missing.length || extras.length) {
  throw new Error(
    `Template registry mismatch. Missing: ${missing.join(', ') || 'none'}; Extra: ${
      extras.join(', ') || 'none'
    }.`
  );
}

export function getTemplate(templateId) {
  const tpl = templates[templateId];
  if (!tpl) {
    throw new Error(`Unknown templateId: ${templateId}`);
  }
  return tpl;
}
