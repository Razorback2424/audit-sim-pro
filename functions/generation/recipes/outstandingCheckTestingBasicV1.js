const { getUUID } = require('../getUUID');
const { AUDIT_AREAS } = require('../shared/caseConstants');
const { buildSingleAnswerKey } = require('../shared/caseFormHelpers');
const {
  initialCashRegisterItem,
  initialCutoffItem,
  initialDisbursement,
  initialInstruction,
  initialOutstandingItem,
  initialReferenceDocument,
} = require('../shared/caseFormDefaults');

const buildCashArtifact = ({ type, fileName }) => ({
  _tempId: getUUID(),
  type,
  fileName,
  storagePath: '',
  downloadURL: '',
  clientSideFile: null,
  uploadProgress: undefined,
  uploadError: null,
  contentType: '',
  confirmedBalance: '',
});

const buildDisbursement = ({ paymentId, payee, amount, paymentDate, transactionType, explanation }) => {
  const base = initialDisbursement();
  return {
    ...base,
    paymentId,
    payee,
    amount: String(amount),
    paymentDate,
    transactionType,
    answerKeyMode: 'single',
    answerKeySingleClassification: 'properlyIncluded',
    answerKey: buildSingleAnswerKey('properlyIncluded', Number(amount), explanation),
  };
};

const buildOutstandingItem = ({ reference, payee, issueDate, amount }) => {
  const base = initialOutstandingItem();
  return {
    ...base,
    reference: String(reference),
    payee,
    issueDate,
    amount: String(amount),
  };
};

const buildCutoffItem = ({ reference, clearDate, amount }) => {
  const base = initialCutoffItem();
  return {
    ...base,
    reference: String(reference),
    clearDate,
    amount: String(amount),
  };
};

const buildRegisterItem = ({ checkNo, writtenDate, amount, payee }) => {
  const base = initialCashRegisterItem();
  return {
    ...base,
    checkNo: String(checkNo),
    writtenDate,
    amount: String(amount),
    payee,
  };
};

const outstandingCheckTestingBasicV1 = {
  id: 'case.cash.outstanding-check.basic.v1',
  version: 1,
  label: 'Outstanding Check Testing (Generated)',
  description: 'Reverse-direction cutoff testing with December-written checks clearing in January.',
  moduleTitle: 'Cash',
  pathId: 'foundations',
  pathTitle: 'Foundations',
  tier: 'foundations',
  caseLevel: 'basic',
  auditArea: AUDIT_AREAS.CASH,
  primarySkill: 'Outstanding Check Testing',
  build: () => {
    const instruction = {
      ...initialInstruction(),
      title: 'Outstanding Check Testing',
      moduleCode: 'CASH-OTC-101',
      hook: {
        headline: 'January clearings can hide December obligations.',
        risk: 'Missing outstanding checks overstate cash and hide period-end activity.',
        body: 'Select January-clearing checks, confirm the written date, then trace to the 12/31 outstanding list.',
      },
      heuristic: {
        rule_text: 'If it was written in December, it belongs on the 12/31 outstanding list.',
        reminder: 'January-written checks are out of scope even if they clear in January.',
      },
      gateCheck: {
        question:
          'A check written Dec 27 clears Jan 11 but is missing from the 12/31 outstanding list. What is the right conclusion?',
        success_message: 'Correct. It should be on the 12/31 list and is an exception.',
        failure_message: 'Use the written date and the 12/31 list, not the clearing date.',
        options: [
          {
            id: 'opt1',
            text: 'Exception: it should appear on the 12/31 outstanding list.',
            correct: true,
            feedback: 'Written before year-end means it belongs on the list.',
          },
          {
            id: 'opt2',
            text: 'No exception because it cleared in January.',
            correct: false,
            feedback: 'Clearing date does not remove it from the 12/31 list.',
          },
        ],
      },
    };

    const yearEnd = '20X2-12-31';

    const checks = [
      {
        checkNo: '1023',
        payee: 'BrightLine Logistics',
        amount: 1850,
        writtenDate: '20X2-12-15',
        clearDate: '20X3-01-05',
        outstanding: true,
      },
      {
        checkNo: '1028',
        payee: 'Harbor Office Supply',
        amount: 920,
        writtenDate: '20X2-12-20',
        clearDate: '20X3-01-07',
        outstanding: true,
      },
      {
        checkNo: '1031',
        payee: 'MetroNet Business Internet',
        amount: 3100,
        writtenDate: '20X2-12-22',
        clearDate: '20X3-01-10',
        outstanding: true,
      },
      {
        checkNo: '1034',
        payee: 'ArrowShip Logistics',
        amount: 2750,
        writtenDate: '20X2-12-27',
        clearDate: '20X3-01-12',
        outstanding: false,
      },
      {
        checkNo: '1038',
        payee: 'Pinnacle Penworks',
        amount: 640,
        writtenDate: '20X2-12-29',
        clearDate: '20X3-01-18',
        outstanding: true,
      },
      {
        checkNo: '1041',
        payee: 'Evergreen Paper & Packaging',
        amount: 1560,
        writtenDate: '20X3-01-03',
        clearDate: '20X3-01-20',
        outstanding: false,
      },
      {
        checkNo: '1045',
        payee: 'SummitDrinkware Supply',
        amount: 870,
        writtenDate: '20X3-01-06',
        clearDate: '20X3-01-22',
        outstanding: false,
      },
      {
        checkNo: '1049',
        payee: 'BadgeCraft Awards',
        amount: 2210,
        writtenDate: '20X3-01-09',
        clearDate: '20X3-01-25',
        outstanding: false,
      },
      {
        checkNo: '1052',
        payee: 'Northgate Cleaning',
        amount: 1440,
        writtenDate: '20X2-12-24',
        clearDate: '20X3-01-08',
        outstanding: true,
      },
      {
        checkNo: '1056',
        payee: 'Summit Freight',
        amount: 3180,
        writtenDate: '20X3-01-05',
        clearDate: '20X3-01-14',
        outstanding: false,
      },
      {
        checkNo: '1058',
        payee: 'Redwood Safety',
        amount: 980,
        writtenDate: '20X2-12-18',
        clearDate: '20X3-01-09',
        outstanding: false,
      },
      {
        checkNo: '1060',
        payee: 'Cedar Office Park',
        amount: 760,
        writtenDate: '20X2-12-30',
        clearDate: '20X3-01-16',
        outstanding: true,
      },
      {
        checkNo: '1064',
        payee: 'Bluebird Utilities',
        amount: 420,
        writtenDate: '20X3-01-11',
        clearDate: '20X3-01-26',
        outstanding: false,
      },
      {
        checkNo: '1069',
        payee: 'Harbor Marketing',
        amount: 1290,
        writtenDate: '20X2-12-10',
        clearDate: '20X3-01-03',
        outstanding: true,
      },
      {
        checkNo: '1072',
        payee: 'Kite Ridge Supplies',
        amount: 560,
        writtenDate: '20X3-01-12',
        clearDate: '20X3-01-28',
        outstanding: false,
      },
    ];

    const extraOutstanding = [
      {
        reference: '0992',
        payee: 'Valley Office Rent',
        issueDate: '20X2-12-05',
        amount: 5120,
      },
      {
        reference: '1009',
        payee: 'Pioneer Security',
        issueDate: '20X2-12-12',
        amount: 680,
      },
      {
        reference: '1015',
        payee: 'Emerald Printing',
        issueDate: '20X2-12-21',
        amount: 1340,
      },
    ];

    const cashOutstandingItems = checks
      .filter((item) => item.outstanding)
      .map((item) =>
        buildOutstandingItem({
          reference: item.checkNo,
          payee: item.payee,
          issueDate: item.writtenDate,
          amount: item.amount,
        })
      )
      .concat(extraOutstanding.map((item) => buildOutstandingItem(item)));

    const cashCutoffItems = checks.map((item) =>
      buildCutoffItem({
        reference: item.checkNo,
        clearDate: item.clearDate,
        amount: item.amount,
      })
    );

    const cashRegisterItems = checks.map((item) =>
      buildRegisterItem({
        checkNo: item.checkNo,
        writtenDate: item.writtenDate,
        amount: item.amount,
        payee: item.payee,
      })
    );

    const cashArtifacts = [
      buildCashArtifact({
        type: 'cash_cutoff_statement',
        fileName: 'January Bank Statement (Cutoff).pdf',
      }),
    ];

    const disbursements = [
      buildDisbursement({
        paymentId: 'CHK-1001',
        payee: 'Eastvale Maintenance',
        amount: 500,
        paymentDate: '20X2-12-28',
        transactionType: 'check',
        explanation: 'Baseline cash disbursement to satisfy case validation.',
      }),
    ];

    const numberToWords = (value) => {
      const num = Number(value || 0);
      if (!Number.isFinite(num)) return String(value || '');
      const ones = [
        '',
        'One',
        'Two',
        'Three',
        'Four',
        'Five',
        'Six',
        'Seven',
        'Eight',
        'Nine',
        'Ten',
        'Eleven',
        'Twelve',
        'Thirteen',
        'Fourteen',
        'Fifteen',
        'Sixteen',
        'Seventeen',
        'Eighteen',
        'Nineteen',
      ];
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      const toWordsUnderThousand = (n) => {
        if (n === 0) return '';
        if (n < 20) return ones[n];
        if (n < 100) {
          const whole = tens[Math.floor(n / 10)];
          const rest = ones[n % 10];
          return rest ? `${whole} ${rest}` : whole;
        }
        const hundreds = ones[Math.floor(n / 100)];
        const remainder = n % 100;
        const tail = toWordsUnderThousand(remainder);
        return tail ? `${hundreds} Hundred ${tail}` : `${hundreds} Hundred`;
      };

      const absValue = Math.floor(Math.abs(num));
      if (absValue > 999999999) return String(absValue);

      const millions = Math.floor(absValue / 1000000);
      const thousands = Math.floor((absValue % 1000000) / 1000);
      const remainder = absValue % 1000;
      const parts = [];
      if (millions) parts.push(`${toWordsUnderThousand(millions)} Million`);
      if (thousands) parts.push(`${toWordsUnderThousand(thousands)} Thousand`);
      if (remainder) parts.push(toWordsUnderThousand(remainder));
      return parts.join(' ');
    };

    const formatCheckAmountWords = (value) => {
      const abs = Math.abs(Number(value || 0));
      const dollars = Math.floor(abs);
      const cents = Math.round((abs - dollars) * 100);
      const centsLabel = String(cents).padStart(2, '0');
      const words = numberToWords(dollars) || 'Zero';
      return `${words} and ${centsLabel}/100`;
    };

    const bankName = 'Summit Community Bank';
    const accountName = 'Clearwater Outfitters, Inc.';
    const accountNumber = '102500184';
    const buildCheckCopyData = ({ checkNumber, date, payee, amount, memo }) => ({
      payer: {
        name: accountName,
        addressLine: '2150 Riverfront Ave, Denver, CO 80202',
      },
      checkNumber,
      date,
      payee,
      amountNumeric: Number(amount || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      amountWords: formatCheckAmountWords(amount),
      bank: {
        name: bankName,
        subName: 'Member FDIC',
      },
      memo: memo || 'A/P Disbursement',
      signatureName: 'K. Ramirez',
      micr: {
        routingSymbol: 'T',
        routingNumber: '102000021',
        accountSymbol: 'A',
        accountNumber: '0004812001',
        checkNumber,
      },
    });
    const buildStatementRows = (entries, dateKey) =>
      entries.map((item) => ({
        date: item[dateKey],
        amount: -Number(item.amount || 0),
        description: `Check ${item.checkNo} ${item.payee}`,
        checkNumber: item.checkNo,
        payee: item.payee,
      }));
    const januaryChecks = checks.filter((item) => String(item.clearDate || '').startsWith('20X3-01'));

    const cutoffStatementData = {
      bankName,
      accountName,
      accountNumber,
      periodLabel: 'Statement Period: Jan 1, 20X3 — Jan 31, 20X3',
      openingBalance: 246980,
      rows: [
        { date: '20X3-01-02', amount: -8650, description: 'ACH payroll batch' },
        { date: '20X3-01-04', amount: 56320, description: 'ACH receipts' },
        { date: '20X3-01-15', amount: -1420, description: 'Wire transfer - insurance' },
        ...buildStatementRows(januaryChecks, 'clearDate'),
      ],
      layout: { txLayout: 'stacked' },
    };

    const referenceDocumentSpecs = [
      ...checks.map((item) => ({
        id: getUUID(),
        fileName: `Check Copy ${item.checkNo}.pdf`,
        generationSpec: {
          templateId: 'refdoc.check-copy.v1',
          data: buildCheckCopyData({
            checkNumber: item.checkNo,
            date: item.writtenDate,
            payee: item.payee,
            amount: item.amount,
          }),
        },
      })),
      {
        id: getUUID(),
        fileName: 'January Bank Statement (Cutoff).pdf',
        generationSpec: {
          templateId: 'refdoc.bank-statement.v1',
          data: cutoffStatementData,
        },
      },
    ];

    return {
      caseName: 'Outstanding Check Testing - January Cutoff',
      auditArea: AUDIT_AREAS.CASH,
      layoutType: 'cash_recon',
      instruction,
      disbursements,
      referenceDocuments: checks.map((item) => ({
        ...initialReferenceDocument(),
        _tempId: getUUID(),
        fileName: `Check Copy ${item.checkNo}.pdf`,
        generationSpecId: null,
        generationSpec: {
          templateId: 'refdoc.check-copy.v1',
          data: buildCheckCopyData({
            checkNumber: item.checkNo,
            date: item.writtenDate,
            payee: item.payee,
            amount: item.amount,
          }),
        },
      })),
      cashContext: {
        moduleType: 'outstanding_check_testing',
        bookBalance: '245670',
        bankBalance: '246980',
        reconciliationDate: yearEnd,
        simulateMathError: false,
        confirmedBalance: '246980',
        testingThreshold: '',
        cutoffWindowDays: '',
      },
      cashOutstandingItems,
      cashCutoffItems,
      cashRegisterItems,
      cashArtifacts,
      generationPlan: {
        seed: getUUID(),
        yearEnd,
        caseLevel: 'basic',
        notes:
          'Reference documents are generated from templates; run the PDF generator to populate storagePath/downloadURL.',
        referenceDocumentSpecs,
      },
    };
  },
};

module.exports = { outstandingCheckTestingBasicV1 };
