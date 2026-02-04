// AUTO-GENERATED from functions/generation/shared. Do not edit directly.
const ANSWER_KEY_FIELDS = ['properlyIncluded', 'properlyExcluded', 'improperlyIncluded', 'improperlyExcluded'];
const ANSWER_KEY_TOLERANCE = 0.01;
const ANSWER_KEY_LABELS = {
  properlyIncluded: 'Properly Included',
  properlyExcluded: 'Properly Excluded',
  improperlyIncluded: 'Improperly Included',
  improperlyExcluded: 'Improperly Excluded',
};
const ANSWER_KEY_PLACEHOLDER = '__choose';
const DEFAULT_ANSWER_KEY_CLASSIFICATION = ANSWER_KEY_PLACEHOLDER;
const DEFAULT_ANSWER_KEY_META = { assertion: '', reason: '' };

const extractAnswerKeyMeta = (answerKey = {}) => ({
  assertion: answerKey.assertion || '',
  reason: answerKey.reason || '',
});

const buildSingleAnswerKey = (
  classification,
  amountValue,
  explanation = '',
  meta = DEFAULT_ANSWER_KEY_META
) => {
  const sanitizedAmount = Number(amountValue) || 0;
  const next = {
    properlyIncluded: 0,
    properlyExcluded: 0,
    improperlyIncluded: 0,
    improperlyExcluded: 0,
    explanation,
    assertion: meta.assertion || '',
    reason: meta.reason || '',
  };
  if (classification && ANSWER_KEY_FIELDS.includes(classification)) {
    next[classification] = sanitizedAmount;
  }
  return next;
};

const detectAnswerKeyMode = (disbursement) => {
  const answerKey = disbursement.answerKey || {};
  const amountNumber = Number(disbursement.amount || 0);
  let nonZeroCount = 0;
  let lastClassification = DEFAULT_ANSWER_KEY_CLASSIFICATION;
  ANSWER_KEY_FIELDS.forEach((field) => {
    const value = Number(answerKey[field] || 0);
    if (!Number.isNaN(value) && value > 0) {
      nonZeroCount += 1;
      lastClassification = field;
    }
  });
  const total = ANSWER_KEY_FIELDS.reduce((sum, field) => {
    const value = Number(answerKey[field] || 0);
    if (Number.isNaN(value)) return sum;
    return sum + value;
  }, 0);
  if (nonZeroCount <= 1) {
    const classificationCandidate =
      nonZeroCount === 1 && Math.abs(total - amountNumber) <= ANSWER_KEY_TOLERANCE
        ? lastClassification
        : ANSWER_KEY_PLACEHOLDER;
    const normalized = buildSingleAnswerKey(
      classificationCandidate === ANSWER_KEY_PLACEHOLDER ? null : classificationCandidate,
      classificationCandidate === ANSWER_KEY_PLACEHOLDER ? 0 : amountNumber,
      answerKey.explanation || '',
      extractAnswerKeyMeta(answerKey)
    );
    return {
      mode: 'single',
      classification: classificationCandidate,
      answerKey: normalized,
    };
  }
  return {
    mode: 'split',
    classification: lastClassification,
    answerKey,
  };
};

const isAnswerKeyReady = (disbursement) => {
  const amountNumber = Number(disbursement.amount || 0);
  const answerKey = disbursement.answerKey || {};
  const explanationOk = String(answerKey.explanation || '').trim().length > 0;

  if (disbursement.answerKeyMode === 'split') {
    const totals = ANSWER_KEY_FIELDS.reduce((sum, field) => {
      const value = Number(answerKey[field] || 0);
      if (!Number.isNaN(value)) return sum + value;
      return sum;
    }, 0);
    const hasValues = ANSWER_KEY_FIELDS.some((field) => Number(answerKey[field] || 0) > 0);
    return explanationOk && hasValues && Math.abs(totals - amountNumber) <= ANSWER_KEY_TOLERANCE;
  }

  const classification = disbursement.answerKeySingleClassification;
  if (!classification || classification === ANSWER_KEY_PLACEHOLDER) return false;
  const assignedAmount = Number(answerKey[classification] || 0);
  return explanationOk && Math.abs(assignedAmount - amountNumber) <= ANSWER_KEY_TOLERANCE;
};

const formatAnswerKeyLabel = (key, classificationFields = []) =>
  (classificationFields.find((field) => field.key === key)?.label || ANSWER_KEY_LABELS[key] || key || '').trim();

export {
  ANSWER_KEY_FIELDS,
  ANSWER_KEY_TOLERANCE,
  ANSWER_KEY_LABELS,
  ANSWER_KEY_PLACEHOLDER,
  DEFAULT_ANSWER_KEY_CLASSIFICATION,
  DEFAULT_ANSWER_KEY_META,
  extractAnswerKeyMeta,
  buildSingleAnswerKey,
  detectAnswerKeyMode,
  isAnswerKeyReady,
  formatAnswerKeyLabel,
};
