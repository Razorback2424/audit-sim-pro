import templateIds from '../../../shared/pdfTemplateIds.json';
import { apAgingSummaryV1 } from './apAging/apAgingSummaryV1.js';
import { endeavorrInvoiceV1 } from './endeavorr/endeavorrInvoiceV1.js';
import { glamitInvoiceV1 } from './glamit/glamitInvoiceV1.js';
import { promotadorInvoiceV1 } from './promotador/promotadorInvoiceV1.js';

export const templates = {
  'invoice.endeavorr.v1': endeavorrInvoiceV1,
  'invoice.glamit.v1': glamitInvoiceV1,
  'invoice.promotador.v1': promotadorInvoiceV1,
  'refdoc.ap-aging.v1': apAgingSummaryV1,
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
