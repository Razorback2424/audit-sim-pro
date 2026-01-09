import { surlPromotadorCutoffV1 } from './surlPromotadorCutoffV1';

const parsePseudoDate = (value) => {
  if (!value) return null;
  const normalized = String(value).replace(/^20X/, '200');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const parseHumanDate = (value) => {
  if (!value) return null;
  const normalized = String(value).replace(/20X(\d)/g, '200$1');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const parseCutoffDate = (value) => parsePseudoDate(value) || parseHumanDate(value);

const daysBetween = (a, b) => {
  const diffMs = b.getTime() - a.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
};

const buildLookup = (list, keyFn) => {
  const map = new Map();
  list.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    map.set(key, item);
  });
  return map;
};

describe('surlPromotadorCutoffV1 recipe validator', () => {
  test('generates coherent disbursements, invoices, and AP aging', () => {
    const result = surlPromotadorCutoffV1.build();
    const disbursements = Array.isArray(result.disbursements) ? result.disbursements : [];
    const referenceDocs = Array.isArray(result.referenceDocuments) ? result.referenceDocuments : [];

    expect(disbursements.length).toBeGreaterThanOrEqual(10);
    expect(disbursements.length).toBeLessThanOrEqual(15);

    const yearEnd = parsePseudoDate('20X2-12-31');
    expect(yearEnd).not.toBeNull();

    disbursements.forEach((disbursement) => {
      const paymentDate = parsePseudoDate(disbursement.paymentDate);
      expect(paymentDate).not.toBeNull();
      const daysAfter = daysBetween(yearEnd, paymentDate);
      expect(daysAfter).toBeGreaterThanOrEqual(30);
      expect(daysAfter).toBeLessThanOrEqual(60);
    });

    const invoiceDocs = referenceDocs.filter(
      (doc) => doc.generationSpec?.templateId === 'invoice.promotador.v1'
    );
    const agingDoc = referenceDocs.find(
      (doc) => doc.generationSpec?.templateId === 'refdoc.ap-aging.v1'
    );
    expect(invoiceDocs.length).toBeGreaterThan(0);
    expect(agingDoc).toBeDefined();

    const invoicesByPayment = new Map();
    invoiceDocs.forEach((doc) => {
      const paymentId = doc.generationSpec?.linkToPaymentId;
      if (!paymentId) return;
      const list = invoicesByPayment.get(paymentId) || [];
      list.push(doc);
      invoicesByPayment.set(paymentId, list);
    });

    disbursements.forEach((disbursement) => {
      const invoices = invoicesByPayment.get(disbursement.paymentId) || [];
      expect(invoices.length).toBeGreaterThan(0);
      const total = invoices.reduce(
        (sum, doc) => sum + Number(doc.generationSpec?.invoiceTotal ?? 0),
        0
      );
      expect(Math.abs(total - Number(disbursement.amount || 0))).toBeLessThanOrEqual(0.01);
    });

    const agingRows = agingDoc?.generationSpec?.data?.rows || [];
    const agingByInvoice = buildLookup(agingRows, (row) => row.invoiceNumber);

    invoiceDocs.forEach((doc) => {
      const serviceDate = doc.generationSpec?.serviceDate;
      const shippingDate = doc.generationSpec?.shippingDate;
      const isRecorded = Boolean(doc.generationSpec?.isRecorded);
      const invoiceNumber = doc.generationSpec?.data?.invoiceNumber;
      const amount = Number(doc.generationSpec?.invoiceTotal ?? 0);
      const shouldBeInAging = (() => {
        if (!yearEnd) return false;
        const parsedService = parseCutoffDate(serviceDate);
        const parsedShipping = parseCutoffDate(shippingDate);
        if (!parsedService && !parsedShipping) return false;
        if (parsedService && parsedService.getTime() > yearEnd.getTime()) return false;
        if (parsedShipping && parsedShipping.getTime() > yearEnd.getTime()) return false;
        return true;
      })();

      const agingRow = invoiceNumber ? agingByInvoice.get(invoiceNumber) : null;

      if (shouldBeInAging && isRecorded) {
        expect(agingRow).toBeDefined();
        expect(Math.abs(Number(agingRow.amount || 0) - amount)).toBeLessThanOrEqual(0.01);
      }

      if (shouldBeInAging && !isRecorded) {
        expect(agingRow).toBeUndefined();
      }

      if (!shouldBeInAging) {
        expect(agingRow).toBeUndefined();
      }
    });
  });
});
