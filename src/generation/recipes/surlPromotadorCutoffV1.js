import getUUID from '../../utils/getUUID';
import { AUDIT_AREAS } from '../../models/caseConstants';
import { buildSingleAnswerKey, DEFAULT_ANSWER_KEY_CLASSIFICATION } from '../../utils/caseFormHelpers';
import {
  initialDisbursement,
  initialInstruction,
  initialReferenceDocument,
} from '../../constants/caseFormDefaults';

const toMoney = (value) => Number(value || 0);

const buildDisbursement = ({ paymentId, payee, amount, paymentDate, answerKeyClassification, explanation }) => {
  const base = initialDisbursement();
  return {
    ...base,
    _tempId: getUUID(),
    paymentId,
    payee,
    amount: String(amount),
    paymentDate,
    answerKeyMode: 'single',
    answerKeySingleClassification: answerKeyClassification || DEFAULT_ANSWER_KEY_CLASSIFICATION,
    answerKey: buildSingleAnswerKey(answerKeyClassification, toMoney(amount), explanation),
    shouldFlag: ['improperlyExcluded', 'improperlyIncluded'].includes(answerKeyClassification),
  };
};

export const surlPromotadorCutoffV1 = {
  id: 'case.surl.promotador.v1',
  label: 'SURL Cutoff (Generated)',
  description: 'Unrecorded liability trap with post-close disbursements and service-date cutoff.',
  build: () => {
    const instruction = {
      ...initialInstruction(),
      title: 'Search for Unrecorded Liabilities',
      moduleCode: 'SURL-101',
      hook: {
        headline: 'Year-end expenses can hide in January invoices.',
        risk: 'Cutoff errors can overstate income and understate liabilities.',
        body: 'Scan supporting invoices and compare service dates to the period end.',
      },
      heuristic: {
        rule_text: 'Expenses follow the work, not the paper.',
        reminder: 'If the service happened in December, it belongs in December.',
      },
      gateCheck: {
        question:
          'An invoice is dated Jan 6 for services performed Dec 28. Which period should record the expense?',
        success_message: 'Correct. The expense belongs in December.',
        failure_message: 'Check the service date. The work happened in December.',
        options: [
          { id: 'opt1', text: 'December', correct: true, feedback: 'Match the expense to the service date.' },
          { id: 'opt2', text: 'January', correct: false, feedback: 'Invoice date does not control cutoff.' },
        ],
      },
    };

    const yearEnd = '20X2-12-31';

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

    const formatPseudoDate = (date) => {
      const year = String(date.getFullYear());
      const yearToken = `20X${year.slice(-1)}`;
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${yearToken}-${month}-${day}`;
    };

    const addDaysPseudo = (value, days) => {
      const parsed = parsePseudoDate(value);
      if (!parsed) return value;
      const next = new Date(parsed);
      next.setDate(next.getDate() + days);
      return formatPseudoDate(next);
    };

    const formatHumanDate = (value) => {
      const parsed = parsePseudoDate(value);
      if (!parsed) return String(value);
      const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      const yearToken = `20X${String(parsed.getFullYear()).slice(-1)}`;
      return `${monthNames[parsed.getMonth()]} ${parsed.getDate()} ${yearToken}`;
    };

    const yearEndDate = parseCutoffDate(yearEnd);

    const disbursementTargets = [
      { paymentId: 'P-101', payee: 'Redwood Printing', paymentDate: '20X3-01-08', amount: 1850, invoiceCount: 1, serviceTiming: 'pre', trap: false },
      { paymentId: 'P-102', payee: 'Blue Harbor Logistics', paymentDate: '20X3-01-12', amount: 2450, invoiceCount: 1, serviceTiming: 'pre', trap: true },
      { paymentId: 'P-103', payee: 'Brightline Media', paymentDate: '20X3-01-16', amount: 1320, invoiceCount: 1, serviceTiming: 'pre', trap: false },
      { paymentId: 'P-104', payee: 'Northwind Office Furniture', paymentDate: '20X3-01-20', amount: 2100, invoiceCount: 1, serviceTiming: 'post', trap: false },
      { paymentId: 'P-105', payee: 'Summit Electrical', paymentDate: '20X3-01-25', amount: 980, invoiceCount: 1, serviceTiming: 'pre', trap: false },
      { paymentId: 'P-106', payee: 'Kiteway Security', paymentDate: '20X3-01-29', amount: 1560, invoiceCount: 1, serviceTiming: 'post', trap: false },
      { paymentId: 'P-107', payee: 'Atlas IT Services', paymentDate: '20X3-02-02', amount: 3750, invoiceCount: 1, serviceTiming: 'pre', trap: false },
      { paymentId: 'P-108', payee: 'Stonebridge Catering', paymentDate: '20X3-02-05', amount: 890, invoiceCount: 1, serviceTiming: 'post', trap: false },
      { paymentId: 'P-109', payee: 'Lumen Fabricators', paymentDate: '20X3-02-10', amount: 2000, invoiceCount: 2, serviceTiming: 'pre', trap: false },
      { paymentId: 'P-110', payee: 'Apex Facilities', paymentDate: '20X3-02-14', amount: 1550, invoiceCount: 2, serviceTiming: 'post', trap: false },
      { paymentId: 'P-111', payee: 'Metro Office Supply', paymentDate: '20X3-02-18', amount: 1125, invoiceCount: 1, serviceTiming: 'pre', trap: false },
      { paymentId: 'P-112', payee: 'Coastal Freight', paymentDate: '20X3-02-22', amount: 1640, invoiceCount: 1, serviceTiming: 'pre', trap: false },
    ];

    const normalizeTargets = (targets, issues) => {
      let nextTargets = [...targets];
      if (issues.some((issue) => issue.code === 'disbursement-count-low')) {
        const needed = 10 - nextTargets.length;
        for (let i = 0; i < needed; i += 1) {
          const base = nextTargets[nextTargets.length - 1];
          const nextId = 120 + i;
          nextTargets.push({
            ...base,
            paymentId: `P-${nextId}`,
            payee: `${base.payee} Co. ${i + 1}`,
            paymentDate: addDaysPseudo(base.paymentDate, 2 + i),
            amount: base.amount + 75 * (i + 1),
            trap: false,
          });
        }
      }
      if (issues.some((issue) => issue.code === 'disbursement-count-high')) {
        nextTargets = nextTargets.slice(0, 15);
      }
      if (issues.some((issue) => issue.code === 'payment-date-window')) {
        nextTargets = nextTargets.map((target, index) => ({
          ...target,
          paymentDate: addDaysPseudo(yearEnd, 35 + index),
        }));
      }
      if (issues.some((issue) => issue.code === 'payment-date-variation')) {
        nextTargets = nextTargets.map((target, index) => ({
          ...target,
          paymentDate: addDaysPseudo(target.paymentDate, index),
        }));
      }
      if (issues.some((issue) => issue.code === 'payee-variation')) {
        const seen = new Map();
        nextTargets = nextTargets.map((target) => {
          const key = target.payee.toLowerCase();
          const count = (seen.get(key) || 0) + 1;
          seen.set(key, count);
          if (count === 1) return target;
          return { ...target, payee: `${target.payee} ${count}` };
        });
      }
      if (issues.some((issue) => issue.code === 'amount-variation')) {
        nextTargets = nextTargets.map((target, index) => ({
          ...target,
          amount: target.amount + index * 5,
        }));
      }
      if (issues.some((issue) => issue.code === 'no-trap')) {
        nextTargets = nextTargets.map((target, index) =>
          index === 0 ? { ...target, serviceTiming: 'pre', trap: true } : target
        );
      }
      return nextTargets;
    };

    const shouldBeInAging = (serviceDate, shippingDate) => {
      if (!yearEndDate) return false;
      const parsedService = parseCutoffDate(serviceDate);
      const parsedShipping = parseCutoffDate(shippingDate);
      if (!parsedService && !parsedShipping) return false;
      if (parsedService && parsedService.getTime() > yearEndDate.getTime()) return false;
      if (parsedShipping && parsedShipping.getTime() > yearEndDate.getTime()) return false;
      return true;
    };

    const buildInvoicesForTarget = (target, invoiceIndexStart) => {
      const count = Math.max(1, Number(target.invoiceCount || 1));
      const amounts = [];
      if (count === 1) {
        amounts.push(target.amount);
      } else {
        const primary = Math.round(target.amount * 0.6);
        const secondary = target.amount - primary;
        amounts.push(primary, secondary);
      }
      return amounts.map((amount, idx) => {
        const serviceDate =
          target.serviceTiming === 'pre'
            ? addDaysPseudo(yearEnd, -(12 + idx * 3))
            : addDaysPseudo(yearEnd, 7 + idx * 5);
        const invoiceDate = formatHumanDate(addDaysPseudo(target.paymentDate, -(4 + idx)));
        const shippingDate = formatHumanDate(addDaysPseudo(serviceDate, 2));
        const dueDate = formatHumanDate(addDaysPseudo(target.paymentDate, 26 + idx));
        const shouldInclude = shouldBeInAging(serviceDate, shippingDate);
        const isRecorded = target.trap && idx === 0 && shouldInclude ? false : shouldInclude;
        return {
          paymentId: target.paymentId,
          vendor: target.payee,
          invoiceNumber: `INV-${invoiceIndexStart + idx + 1}`,
          invoiceDate,
          serviceDate,
          shippingDate,
          dueDate,
          amount,
          isRecorded,
        };
      });
    };

    const buildCaseData = (targets) => {
      let invoiceIndex = 1000;
      const invoiceCatalog = [];
      targets.forEach((target) => {
        const invoices = buildInvoicesForTarget(target, invoiceIndex);
        invoiceIndex += invoices.length;
        invoiceCatalog.push(...invoices);
      });

      const apAgingRows = invoiceCatalog
        .filter((invoice) => invoice.isRecorded)
        .map((invoice) => ({
          vendor: invoice.vendor,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          amount: invoice.amount,
          buckets: { current: invoice.amount, days30: 0, days60: 0, days90: 0, days90Plus: 0 },
        }));

      const classifyDisbursement = (invoices) => {
        const hasPriorPeriod = invoices.some((inv) =>
          shouldBeInAging(inv.serviceDate, inv.shippingDate)
        );
        const hasUnrecordedPrior = invoices.some(
          (inv) => shouldBeInAging(inv.serviceDate, inv.shippingDate) && !inv.isRecorded
        );
        const hasImproperInclusion = invoices.some(
          (inv) => !shouldBeInAging(inv.serviceDate, inv.shippingDate) && inv.isRecorded
        );
        if (hasUnrecordedPrior) return 'improperlyExcluded';
        if (hasImproperInclusion) return 'improperlyIncluded';
        if (hasPriorPeriod) return 'properlyIncluded';
        return 'properlyExcluded';
      };

      const buildDisbursementExplanation = (classification) => {
        if (classification === 'improperlyExcluded') {
          return 'Services or shipping occurred before year-end but missing from AP aging.';
        }
        if (classification === 'improperlyIncluded') {
          return 'Services or shipping occurred after year-end but were included in AP aging.';
        }
        if (classification === 'properlyIncluded') {
          return 'Services or shipping occurred before year-end and are included in AP aging.';
        }
        return 'Services and shipping occurred after year-end and are correctly excluded.';
      };

      const disbursements = targets.map((target) => {
        const invoices = invoiceCatalog.filter((invoice) => invoice.paymentId === target.paymentId);
        const total = invoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
        const classification = classifyDisbursement(invoices);
        return buildDisbursement({
          paymentId: target.paymentId,
          payee: target.payee,
          amount: total,
          paymentDate: target.paymentDate,
          answerKeyClassification: classification,
          explanation: buildDisbursementExplanation(classification),
        });
      });

      return { invoiceCatalog, apAgingRows, disbursements };
    };

    const validateCaseData = ({ targets, invoiceCatalog, apAgingRows, disbursements }) => {
      const issues = [];
      if (disbursements.length < 10) {
        issues.push({ code: 'disbursement-count-low', message: 'Fewer than 10 disbursements generated.' });
      }
      if (disbursements.length > 15) {
        issues.push({ code: 'disbursement-count-high', message: 'More than 15 disbursements generated.' });
      }

      const paymentDates = targets.map((target) => target.paymentDate);
      const payeeSet = new Set(targets.map((target) => target.payee));
      const amountSet = new Set(targets.map((target) => target.amount));
      if (payeeSet.size < Math.min(targets.length, 8)) {
        issues.push({ code: 'payee-variation', message: 'Insufficient payee variation.' });
      }
      if (amountSet.size < Math.min(targets.length, 8)) {
        issues.push({ code: 'amount-variation', message: 'Insufficient amount variation.' });
      }

      const windowIssues = targets.some((target) => {
        const parsed = parsePseudoDate(target.paymentDate);
        if (!parsed || !yearEndDate) return true;
        const daysAfter = Math.round((parsed - yearEndDate) / (1000 * 60 * 60 * 24));
        return daysAfter <= 0 || daysAfter < 30 || daysAfter > 60;
      });
      if (windowIssues) {
        issues.push({
          code: 'payment-date-window',
          message: 'Payment dates must be 1-2 months after year-end.',
        });
      }

      disbursements.forEach((disbursement) => {
        const invoices = invoiceCatalog.filter((inv) => inv.paymentId === disbursement.paymentId);
        if (invoices.length === 0) {
          issues.push({
            code: 'missing-invoices',
            message: `No invoices mapped to ${disbursement.paymentId}.`,
          });
          return;
        }
        const total = invoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
        if (Math.abs(total - Number(disbursement.amount || 0)) > 0.01) {
          issues.push({
            code: 'invoice-total-mismatch',
            message: `Invoice totals do not match disbursement ${disbursement.paymentId}.`,
          });
        }
      });

      const apMap = new Map(apAgingRows.map((row) => [row.invoiceNumber, row]));
      let trapCount = 0;
      invoiceCatalog.forEach((invoice) => {
        const shouldInclude = shouldBeInAging(invoice.serviceDate, invoice.shippingDate);
        const agingEntry = apMap.get(invoice.invoiceNumber);
        if (shouldInclude && invoice.isRecorded) {
          if (!agingEntry) {
            issues.push({
              code: 'aging-missing',
              message: `Invoice ${invoice.invoiceNumber} should appear in AP aging.`,
            });
          } else if (Math.abs(Number(agingEntry.amount || 0) - Number(invoice.amount || 0)) > 0.01) {
            issues.push({
              code: 'aging-amount-mismatch',
              message: `AP aging amount mismatch for ${invoice.invoiceNumber}.`,
            });
          }
        } else if (shouldInclude && !invoice.isRecorded && !agingEntry) {
          trapCount += 1;
        } else if (!shouldInclude && agingEntry) {
          issues.push({
            code: 'aging-should-not-appear',
            message: `Invoice ${invoice.invoiceNumber} should not appear in AP aging.`,
          });
        }
      });
      if (trapCount === 0) {
        issues.push({ code: 'no-trap', message: 'No unrecorded prior-period invoices found.' });
      }

      if (!invoiceCatalog.every((invoice) => invoice.invoiceNumber && invoice.vendor)) {
        issues.push({ code: 'invoice-data', message: 'Invoice data missing identifiers.' });
      }

      if (paymentDates.length !== new Set(paymentDates).size) {
        issues.push({ code: 'payment-date-variation', message: 'Payment dates are not varied.' });
      }

      return issues;
    };

    let validatedTargets = disbursementTargets;
    let invoiceCatalog = [];
    let apAgingRows = [];
    let disbursements = [];
    let lastIssues = [];

    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const built = buildCaseData(validatedTargets);
      invoiceCatalog = built.invoiceCatalog;
      apAgingRows = built.apAgingRows;
      disbursements = built.disbursements;
      lastIssues = validateCaseData({
        targets: validatedTargets,
        invoiceCatalog,
        apAgingRows,
        disbursements,
      });
      if (lastIssues.length === 0) break;
      validatedTargets = normalizeTargets(validatedTargets, lastIssues);
    }

    if (lastIssues.length > 0) {
      throw new Error(
        `Case generation failed validation after ${maxAttempts} attempts: ${lastIssues
          .map((i) => i.message)
          .join(' ')}`
      );
    }

    const buildInvoiceData = (invoice) => {
      const data = {
        brandName: invoice.vendor.toUpperCase(),
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        issuedTo: {
          name: 'Team Up Promotional Products, LLC',
          line1: '123 Anywhere St.',
          line2: 'Fake City, WA 97650',
        },
        shippingInfo: { dateShipped: invoice.shippingDate, terms: 'FOB Shipping Point' },
        items: [{ description: `Services for ${invoice.vendor}`, qty: 1, unitPrice: invoice.amount }],
        taxRate: 0,
        shipping: 0,
        showThankYou: true,
        thankYouText: 'THANK\nYOU',
      };
      data.invoiceTotal = computeInvoiceTotal(data);
      return data;
    };

    const computeInvoiceTotal = (data) => {
      const items = Array.isArray(data?.items) ? data.items : [];
      const subtotal = items.reduce(
        (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
        0
      );
      const tax = subtotal * Number(data?.taxRate || 0);
      const shipping = Number(data?.shipping || 0);
      return subtotal + tax + shipping;
    };

    const apAgingData = {
      companyName: 'Team Up Promotional Products, LLC',
      asOfDate: 'December 31 20X2',
      rows: apAgingRows,
    };

    const referenceDocuments = [
      ...invoiceCatalog.map((invoice) => {
        const data = buildInvoiceData(invoice);
        return {
          ...initialReferenceDocument(),
          _tempId: getUUID(),
          fileName: `${invoice.vendor} Invoice ${invoice.invoiceNumber}.pdf`,
          generationSpecId: null,
          generationSpec: {
            templateId: 'invoice.promotador.v1',
            data,
            invoiceTotal: data.invoiceTotal,
            serviceDate: invoice.serviceDate,
            shippingDate: invoice.shippingDate,
            linkToPaymentId: invoice.paymentId,
            isRecorded: invoice.isRecorded,
          },
        };
      }),
      {
        ...initialReferenceDocument(),
        _tempId: getUUID(),
        fileName: 'AP Aging Summary.pdf',
        generationSpecId: null,
        generationSpec: {
          templateId: 'refdoc.ap-aging.v1',
          data: apAgingData,
        },
      },
    ];

    referenceDocuments.forEach((doc) => {
      doc.generationSpecId = doc._tempId;
    });

    return {
      caseName: 'SURL Cutoff: January Disbursements',
      auditArea: AUDIT_AREAS.PAYABLES,
      layoutType: 'two_pane',
      instruction,
      disbursements,
      referenceDocuments,
      generationPlan: {
        yearEnd,
        notes:
          'Reference documents are generated from templates; run the PDF generator to populate storagePath/downloadURL.',
        referenceDocumentSpecs: referenceDocuments.map((doc) => ({
          id: doc.generationSpecId || doc._tempId,
          fileName: doc.fileName,
          generationSpec: doc.generationSpec,
          linkToPaymentId: doc.generationSpec?.linkToPaymentId || null,
        })),
      },
    };
  },
};
