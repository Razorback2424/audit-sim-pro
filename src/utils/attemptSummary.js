const normalizeText = (val) => (typeof val === 'string' ? val.trim().toLowerCase() : '');

const CLASSIFICATION_KEYS = Object.freeze([
  'properlyIncluded',
  'properlyExcluded',
  'improperlyIncluded',
  'improperlyExcluded',
]);

const parseNumber = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeExpectedClassificationKey = (raw) => {
  if (!raw) return '';
  const text = normalizeText(raw);
  if (text.includes('missing') || text.includes('unrecorded')) return 'improperlyExcluded';
  if (text.includes('improperly') && text.includes('excluded')) return 'improperlyExcluded';
  if (text.includes('improperly') && text.includes('included')) return 'improperlyIncluded';
  if (text.includes('properly') && text.includes('excluded')) return 'properlyExcluded';
  if (text.includes('properly') && text.includes('included')) return 'properlyIncluded';
  if (CLASSIFICATION_KEYS.includes(text)) return text;
  return '';
};

const extractBreakdown = (source) =>
  CLASSIFICATION_KEYS.map((key) => ({ key, amount: parseNumber(source?.[key]) }))
    .filter(({ amount }) => Math.abs(amount) > 0.0001)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

const extractDecisionFromAllocation = (allocation) => {
  if (!allocation || typeof allocation !== 'object') {
    return { primaryKey: '' };
  }

  const explicitKey = typeof allocation.singleClassification === 'string' ? allocation.singleClassification : '';
  if (CLASSIFICATION_KEYS.includes(explicitKey)) {
    return { primaryKey: explicitKey };
  }

  const breakdown = extractBreakdown(allocation?.splitValues && typeof allocation.splitValues === 'object'
    ? allocation.splitValues
    : allocation);
  if (breakdown.length > 0) {
    return { primaryKey: breakdown[0].key };
  }

  if (allocation.isException === true) return { primaryKey: 'improperlyIncluded' };
  if (allocation.isException === false) return { primaryKey: 'properlyIncluded' };
  return { primaryKey: '' };
};

const extractCorrectDecision = (item) => {
  const explicitKey = typeof item?.answerKeySingleClassification === 'string' ? item.answerKeySingleClassification : '';
  if (CLASSIFICATION_KEYS.includes(explicitKey)) {
    return { primaryKey: explicitKey };
  }

  const answerKey = item?.answerKey && typeof item.answerKey === 'object' ? item.answerKey : null;
  const breakdown = answerKey ? extractBreakdown(answerKey) : [];
  if (breakdown.length > 0) {
    return { primaryKey: breakdown[0].key };
  }

  const expectedKey = normalizeExpectedClassificationKey(item?.expectedClassification);
  if (expectedKey) {
    return { primaryKey: expectedKey };
  }

  return { primaryKey: '' };
};

export const computeDisbursementAttemptSummary = ({ disbursements = [], studentAnswers = {} }) => {
  const selectedIds = new Set(
    studentAnswers && typeof studentAnswers === 'object' ? Object.keys(studentAnswers) : []
  );

  let missedExceptionsCount = 0;
  let falsePositivesCount = 0;
  let wrongClassificationCount = 0;
  let wrongRoutineClassificationCount = 0;
  let routineCorrectCount = 0;
  let caughtTrapsCount = 0;

  (disbursements || []).forEach((item) => {
    if (!item || !item.paymentId) return;
    const isTrap = !!item.shouldFlag;
    const answer = studentAnswers[item.paymentId] || null;
    const hasAnswer = selectedIds.has(item.paymentId);
    const studentDecision = extractDecisionFromAllocation(answer);
    const correctDecision = extractCorrectDecision(item);

    if (isTrap) {
      if (!answer?.isException) {
        missedExceptionsCount += 1;
        return;
      }

      const expectedKey = correctDecision.primaryKey;
      if (expectedKey) {
        const matches = normalizeText(studentDecision.primaryKey) === normalizeText(expectedKey);
        if (!matches) {
          wrongClassificationCount += 1;
        } else {
          caughtTrapsCount += 1;
        }
      } else {
        caughtTrapsCount += 1;
      }
      return;
    }

    if (!hasAnswer) return;
    if (answer?.isException === true) {
      falsePositivesCount += 1;
      return;
    }

    if (
      correctDecision.primaryKey &&
      normalizeText(studentDecision.primaryKey) === normalizeText(correctDecision.primaryKey)
    ) {
      routineCorrectCount += 1;
      return;
    }

    if (correctDecision.primaryKey) {
      wrongRoutineClassificationCount += 1;
    }
  });

  const criticalIssuesCount = missedExceptionsCount + wrongClassificationCount;
  const totalConsidered =
    caughtTrapsCount +
    missedExceptionsCount +
    wrongClassificationCount +
    routineCorrectCount +
    falsePositivesCount +
    wrongRoutineClassificationCount;
  const score =
    totalConsidered > 0 ? Math.round(((totalConsidered - criticalIssuesCount - falsePositivesCount - wrongRoutineClassificationCount) / totalConsidered) * 100) : null;

  return {
    score,
    totalConsidered,
    trapsCount: caughtTrapsCount + missedExceptionsCount + wrongClassificationCount,
    routineCount: routineCorrectCount + falsePositivesCount + wrongRoutineClassificationCount,
    missedExceptionsCount,
    falsePositivesCount,
    wrongClassificationCount,
    wrongRoutineClassificationCount,
    criticalIssuesCount,
  };
};
