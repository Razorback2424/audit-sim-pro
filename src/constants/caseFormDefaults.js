import getUUID from '../utils/getUUID';
import {
  DEFAULT_ANSWER_KEY_CLASSIFICATION,
  buildSingleAnswerKey,
} from '../utils/caseFormHelpers';

export const initialHighlightedDocument = () => ({
  fileName: '',
  storagePath: '',
  downloadURL: '',
  clientSideFile: null,
  uploadProgress: undefined,
  uploadError: null,
  contentType: '',
});

export const initialDisbursement = () => ({
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

export const initialOutstandingItem = () => ({
  _tempId: getUUID(),
  reference: '',
  payee: '',
  issueDate: '',
  amount: '',
});

export const initialCutoffItem = () => ({
  _tempId: getUUID(),
  reference: '',
  clearDate: '',
  amount: '',
});

export const initialCashRegisterItem = () => ({
  _tempId: getUUID(),
  checkNo: '',
  writtenDate: '',
  amount: '',
  payee: '',
});

export const initialReconciliationMap = () => ({
  _tempId: getUUID(),
  outstandingTempId: '',
  cutoffTempId: '',
  scenarioType: '',
});

export const initialInstruction = () => ({
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

export const initialMapping = () => ({
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

export const initialReferenceDocument = () => ({
  _tempId: getUUID(),
  fileName: '',
  storagePath: '',
  downloadURL: '',
  clientSideFile: null,
  uploadProgress: undefined,
  uploadError: null,
  contentType: '',
});

export const initialFaClass = () => ({
  _tempId: getUUID(),
  className: '',
  beginningBalance: '',
  additions: '',
  disposals: '',
  endingBalance: '',
});

export const initialFaAddition = () => ({
  _tempId: getUUID(),
  vendor: '',
  description: '',
  amount: '',
  inServiceDate: '',
  glAccount: '',
  natureOfExpenditure: '',
  properPeriod: '',
});

export const initialFaDisposal = () => ({
  _tempId: getUUID(),
  assetId: '',
  description: '',
  proceeds: '',
  nbv: '',
});

export const initialCashContext = () => ({
  moduleType: 'bank_reconciliation',
  bookBalance: '',
  bankBalance: '',
  reconciliationDate: '',
  simulateMathError: false,
  confirmedBalance: '',
  testingThreshold: '',
  cutoffWindowDays: '',
});
