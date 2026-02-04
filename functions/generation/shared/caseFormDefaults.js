const { getUUID } = require('../getUUID');
const { DEFAULT_ANSWER_KEY_CLASSIFICATION, buildSingleAnswerKey } = require('./caseFormHelpers');

const initialHighlightedDocument = () => ({
  fileName: '',
  storagePath: '',
  downloadURL: '',
  clientSideFile: null,
  uploadProgress: undefined,
  uploadError: null,
  contentType: '',
});

const initialDisbursement = () => ({
  _tempId: getUUID(),
  paymentId: '',
  payee: '',
  amount: '',
  paymentDate: '',
  transactionType: '',
  answerKeyMode: 'single',
  answerKeySingleClassification: DEFAULT_ANSWER_KEY_CLASSIFICATION,
  answerKey: buildSingleAnswerKey(null, 0, ''),
  mappings: [],
  trapType: [],
  correctAssertions: [],
  requiredAssertions: [],
  errorReasons: [],
  highlightedDocument: initialHighlightedDocument(),
  shouldFlag: false,
  validator: { type: '', config: {} },
});

const initialOutstandingItem = () => ({
  _tempId: getUUID(),
  reference: '',
  payee: '',
  issueDate: '',
  amount: '',
});

const initialCutoffItem = () => ({
  _tempId: getUUID(),
  reference: '',
  clearDate: '',
  amount: '',
});

const initialCashRegisterItem = () => ({
  _tempId: getUUID(),
  checkNo: '',
  writtenDate: '',
  amount: '',
  payee: '',
});

const initialReconciliationMap = () => ({
  _tempId: getUUID(),
  outstandingTempId: '',
  cutoffTempId: '',
  scenarioType: '',
});

const initialInstruction = () => ({
  title: '',
  moduleCode: '',
  version: 1,
  hook: { headline: '', risk: '', body: '' },
  visualAsset: { type: 'VIDEO', source_id: '', alt: '' },
  heuristic: { rule_text: '', reminder: '' },
  gateCheck: {
    question: '',
    success_message: '',
    failure_message: '',
    options: [
      { id: 'opt1', text: '', correct: false, feedback: '' },
      { id: 'opt2', text: '', correct: true, feedback: '' },
    ],
  },
});

const initialCompletenessGate = () => ({
  enabled: false,
  stepTitle: '',
  description: '',
  evidenceTitle: '',
  evidenceDescription: '',
  assessmentQuestion: '',
  assessmentOptions: [
    {
      id: 'assess_yes',
      text: '',
      correct: false,
      outcome: 'match',
      feedback: '',
    },
    {
      id: 'assess_no',
      text: '',
      correct: true,
      outcome: 'mismatch',
      feedback: '',
    },
  ],
  actionMode: 'mismatch',
  actionQuestion: '',
  actionOptions: [
    { id: 'opt1', text: '', correct: false, feedback: '' },
    { id: 'opt2', text: '', correct: true, feedback: '' },
  ],
  successMessage: '',
  failureMessage: '',
  passedMessage: '',
  skillTag: '',
  requireOpenedDocs: false,
  includeAllReferenceDocs: false,
  referenceDocNames: [],
  correctedReferenceDocNames: [],
});

const initialMapping = () => ({
  _tempId: getUUID(),
  disbursementTempId: '',
  fileName: '',
  storagePath: '',
  clientSideFile: null,
  uploadProgress: undefined,
  uploadError: null,
  downloadURL: '',
  contentType: '',
});

const initialReferenceDocument = () => ({
  _tempId: getUUID(),
  fileName: '',
  storagePath: '',
  downloadURL: '',
  clientSideFile: null,
  uploadProgress: undefined,
  uploadError: null,
  contentType: '',
});

const initialFaClass = () => ({
  _tempId: getUUID(),
  className: '',
  beginningBalance: '',
  additions: '',
  disposals: '',
  endingBalance: '',
});

const initialFaAddition = () => ({
  _tempId: getUUID(),
  vendor: '',
  description: '',
  amount: '',
  inServiceDate: '',
  glAccount: '',
  natureOfExpenditure: '',
  properPeriod: '',
  amountThreshold: '',
  usefulLife: '',
});

const initialFaDisposal = () => ({
  _tempId: getUUID(),
  assetId: '',
  description: '',
  proceeds: '',
  nbv: '',
  vendor: '',
  gainLossPerBooks: '',
  expectedGainLoss: '',
});

const initialCashContext = () => ({
  moduleType: 'bank_reconciliation',
  bookBalance: '',
  bankBalance: '',
  reconciliationDate: '',
  simulateMathError: false,
  confirmedBalance: '',
  testingThreshold: '',
  cutoffWindowDays: '',
});

module.exports = {
  initialHighlightedDocument,
  initialDisbursement,
  initialOutstandingItem,
  initialCutoffItem,
  initialCashRegisterItem,
  initialReconciliationMap,
  initialInstruction,
  initialCompletenessGate,
  initialMapping,
  initialReferenceDocument,
  initialFaClass,
  initialFaAddition,
  initialFaDisposal,
  initialCashContext,
};
