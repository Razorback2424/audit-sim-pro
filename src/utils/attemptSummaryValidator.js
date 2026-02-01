const ALLOWED_ATTEMPT_TYPES = new Set(['baseline', 'practice', 'final']);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export const validateAttemptSummary = (summary) => {
  const errors = [];
  if (!summary || typeof summary !== 'object') {
    return ['attemptSummary must be an object.'];
  }

  const numericFields = [
    'totalConsidered',
    'missedExceptionsCount',
    'falsePositivesCount',
    'wrongClassificationCount',
    'criticalIssuesCount',
  ];

  numericFields.forEach((field) => {
    const value = summary[field];
    if (!isFiniteNumber(value)) {
      errors.push(`${field} must be a number.`);
      return;
    }
    if (value < 0) {
      errors.push(`${field} must be >= 0.`);
    }
  });

  if (summary.score !== null && summary.score !== undefined) {
    if (!isFiniteNumber(summary.score)) {
      errors.push('score must be a number or null.');
    } else if (summary.score < 0 || summary.score > 100) {
      errors.push('score must be between 0 and 100.');
    }
  }

  if (summary.requiredDocsOpened !== null && summary.requiredDocsOpened !== undefined) {
    if (typeof summary.requiredDocsOpened !== 'boolean') {
      errors.push('requiredDocsOpened must be a boolean or null.');
    }
  }

  if (summary.timeToCompleteSeconds !== null && summary.timeToCompleteSeconds !== undefined) {
    if (!isFiniteNumber(summary.timeToCompleteSeconds)) {
      errors.push('timeToCompleteSeconds must be a number or null.');
    } else if (summary.timeToCompleteSeconds < 0) {
      errors.push('timeToCompleteSeconds must be >= 0.');
    }
  }

  if (!Number.isInteger(summary.attemptIndex) || summary.attemptIndex <= 0) {
    errors.push('attemptIndex must be a positive integer.');
  }

  if (summary.attemptType) {
    if (!ALLOWED_ATTEMPT_TYPES.has(summary.attemptType)) {
      errors.push('attemptType must be baseline, practice, or final.');
    }
  } else {
    errors.push('attemptType is required.');
  }

  if (
    isFiniteNumber(summary.totalConsidered) &&
    isFiniteNumber(summary.criticalIssuesCount) &&
    summary.criticalIssuesCount > summary.totalConsidered
  ) {
    errors.push('criticalIssuesCount must be <= totalConsidered.');
  }
  if (
    isFiniteNumber(summary.totalConsidered) &&
    isFiniteNumber(summary.missedExceptionsCount) &&
    summary.missedExceptionsCount > summary.totalConsidered
  ) {
    errors.push('missedExceptionsCount must be <= totalConsidered.');
  }
  if (
    isFiniteNumber(summary.totalConsidered) &&
    isFiniteNumber(summary.falsePositivesCount) &&
    summary.falsePositivesCount > summary.totalConsidered
  ) {
    errors.push('falsePositivesCount must be <= totalConsidered.');
  }

  return errors;
};
