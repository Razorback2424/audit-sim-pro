import { surlSeedAlphaCutoffV1 } from './surlSeedAlphaCutoffV1';

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

describe('surlSeedAlphaCutoffV1 recipe validator', () => {
  test('generates coherent disbursements, invoices, and AP aging', () => {
    const result = surlSeedAlphaCutoffV1.build();
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

    const invoiceDocs = referenceDocs.filter((doc) => {
      const templateId = typeof doc.generationSpec?.templateId === 'string'
        ? doc.generationSpec.templateId.toLowerCase()
        : '';
      return templateId.startsWith('invoice.');
    });
    const agingDoc = referenceDocs.find(
      (doc) => doc.generationSpec?.templateId === 'refdoc.ap-aging.v1'
    );
    expect(invoiceDocs.length).toBeGreaterThan(0);
    expect(agingDoc).toBeDefined();

    const templateByVendor = new Map();
    invoiceDocs.forEach((doc) => {
      const vendorKey = String(doc.generationSpec?.data?.brandName || '').toLowerCase();
      if (!vendorKey) return;
      const templateId = doc.generationSpec?.templateId || '';
      if (!templateByVendor.has(vendorKey)) {
        templateByVendor.set(vendorKey, templateId);
        return;
      }
      expect(templateByVendor.get(vendorKey)).toBe(templateId);
    });

    const descriptionToVendor = new Map();
    const priceByVendorAndDesc = new Map();
    invoiceDocs.forEach((doc) => {
      const vendorKey = String(doc.generationSpec?.data?.brandName || '').toLowerCase();
      const items = Array.isArray(doc.generationSpec?.data?.items)
        ? doc.generationSpec.data.items
        : [];
      const taxRate = Number(doc.generationSpec?.data?.taxRate ?? 0);
      const shipping = Number(doc.generationSpec?.data?.shipping ?? 0);
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.length).toBeLessThanOrEqual(5);
      const descriptionSet = new Set(items.map((item) => item.description));
      expect(descriptionSet.size).toBe(items.length);
      expect(taxRate).toBeGreaterThan(0);
      expect(shipping).toBeGreaterThan(0);
      const subtotal = items.reduce(
        (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
        0
      );
      const computedTotal = subtotal + subtotal * taxRate + shipping;
      const invoiceTotal = Number(doc.generationSpec?.invoiceTotal ?? 0);
      expect(Math.abs(computedTotal - invoiceTotal)).toBeLessThanOrEqual(0.01);
      items.forEach((item) => {
        if (!item?.description || !vendorKey) return;
        const existingVendor = descriptionToVendor.get(item.description);
        if (!existingVendor) {
          descriptionToVendor.set(item.description, vendorKey);
        } else {
          expect(existingVendor).toBe(vendorKey);
        }
        const priceKey = `${vendorKey}|${item.description}`;
        const existingPrice = priceByVendorAndDesc.get(priceKey);
        if (existingPrice === undefined) {
          priceByVendorAndDesc.set(priceKey, item.unitPrice);
        } else {
          expect(existingPrice).toBe(item.unitPrice);
        }
      });
    });

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
