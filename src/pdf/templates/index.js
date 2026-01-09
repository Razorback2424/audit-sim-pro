import { apAgingSummaryV1 } from './apAging/apAgingSummaryV1.js';
import { promotadorInvoiceV1 } from './promotador/promotadorInvoiceV1.js';

export const templates = {
  'invoice.promotador.v1': promotadorInvoiceV1,
  'refdoc.ap-aging.v1': apAgingSummaryV1,
};

export function getTemplate(templateId) {
  const tpl = templates[templateId];
  if (!tpl) {
    throw new Error(`Unknown templateId: ${templateId}`);
  }
  return tpl;
}
