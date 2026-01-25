import { computeDisbursementAttemptSummary } from '../attemptSummary';
import { validateAttemptSummary } from '../attemptSummaryValidator';

const buildSummary = (summary) => ({
  score: summary.score,
  totalConsidered: summary.totalConsidered,
  missedExceptionsCount: summary.missedExceptionsCount,
  falsePositivesCount: summary.falsePositivesCount,
  wrongClassificationCount: summary.wrongClassificationCount,
  criticalIssuesCount: summary.criticalIssuesCount,
  requiredDocsOpened: null,
  timeToCompleteSeconds: 120,
  attemptIndex: 1,
  attemptType: 'baseline',
});

describe('computeDisbursementAttemptSummary fixtures', () => {
  test('perfect run', () => {
    const disbursements = [
      { paymentId: 't1', shouldFlag: true, expectedClassification: 'Improperly Excluded' },
      { paymentId: 'r1', shouldFlag: false, expectedClassification: 'Properly Included' },
    ];
    const studentAnswers = {
      t1: { isException: true, singleClassification: 'improperlyExcluded' },
      r1: { isException: false, singleClassification: 'properlyIncluded' },
    };
    const summary = computeDisbursementAttemptSummary({ disbursements, studentAnswers });

    expect(summary.missedExceptionsCount).toBe(0);
    expect(summary.falsePositivesCount).toBe(0);
    expect(summary.wrongClassificationCount).toBe(0);
    expect(summary.criticalIssuesCount).toBe(0);
    expect(summary.totalConsidered).toBe(2);
    expect(summary.score).toBe(100);
  });

  test('miss all traps', () => {
    const disbursements = [
      { paymentId: 't1', shouldFlag: true, expectedClassification: 'Improperly Excluded' },
      { paymentId: 't2', shouldFlag: true, expectedClassification: 'Improperly Included' },
    ];
    const studentAnswers = {};
    const summary = computeDisbursementAttemptSummary({ disbursements, studentAnswers });

    expect(summary.missedExceptionsCount).toBe(2);
    expect(summary.falsePositivesCount).toBe(0);
    expect(summary.wrongClassificationCount).toBe(0);
    expect(summary.criticalIssuesCount).toBe(2);
    expect(summary.totalConsidered).toBe(2);
    expect(summary.score).toBe(0);
  });

  test('mark everything exception', () => {
    const disbursements = [
      { paymentId: 't1', shouldFlag: true, expectedClassification: 'Improperly Included' },
      { paymentId: 'r1', shouldFlag: false, expectedClassification: 'Properly Included' },
      { paymentId: 'r2', shouldFlag: false, expectedClassification: 'Properly Included' },
    ];
    const studentAnswers = {
      t1: { isException: true, singleClassification: 'improperlyIncluded' },
      r1: { isException: true, singleClassification: 'improperlyIncluded' },
      r2: { isException: true, singleClassification: 'improperlyIncluded' },
    };
    const summary = computeDisbursementAttemptSummary({ disbursements, studentAnswers });

    expect(summary.missedExceptionsCount).toBe(0);
    expect(summary.falsePositivesCount).toBe(2);
    expect(summary.wrongClassificationCount).toBe(0);
    expect(summary.criticalIssuesCount).toBe(0);
    expect(summary.totalConsidered).toBe(3);
    expect(summary.score).toBe(33);
  });

  test('mixed run', () => {
    const disbursements = [
      { paymentId: 't1', shouldFlag: true, expectedClassification: 'Improperly Excluded' },
      { paymentId: 't2', shouldFlag: true, expectedClassification: 'Improperly Included' },
      { paymentId: 'r1', shouldFlag: false, expectedClassification: 'Properly Included' },
      { paymentId: 'r2', shouldFlag: false, expectedClassification: 'Properly Included' },
    ];
    const studentAnswers = {
      t1: { isException: true, singleClassification: 'improperlyIncluded' },
      r1: { isException: false, singleClassification: 'properlyIncluded' },
      r2: { isException: true, singleClassification: 'improperlyIncluded' },
    };
    const summary = computeDisbursementAttemptSummary({ disbursements, studentAnswers });

    expect(summary.missedExceptionsCount).toBe(1);
    expect(summary.falsePositivesCount).toBe(1);
    expect(summary.wrongClassificationCount).toBe(1);
    expect(summary.criticalIssuesCount).toBe(2);
    expect(summary.totalConsidered).toBe(4);
    expect(summary.score).toBe(25);
  });

  test('empty inputs', () => {
    const summary = computeDisbursementAttemptSummary({ disbursements: [], studentAnswers: {} });
    expect(summary.totalConsidered).toBe(0);
    expect(summary.score).toBeNull();
  });
});

describe('attemptSummary contract validator', () => {
  test('accepts valid summary', () => {
    const summary = buildSummary({
      score: 80,
      totalConsidered: 5,
      missedExceptionsCount: 1,
      falsePositivesCount: 0,
      wrongClassificationCount: 1,
      criticalIssuesCount: 2,
    });
    expect(validateAttemptSummary(summary)).toEqual([]);
  });

  test('flags invalid summary', () => {
    const summary = buildSummary({
      score: 140,
      totalConsidered: -1,
      missedExceptionsCount: 2,
      falsePositivesCount: 3,
      wrongClassificationCount: 0,
      criticalIssuesCount: 5,
    });
    summary.attemptIndex = 0;
    summary.attemptType = 'oops';
    expect(validateAttemptSummary(summary)).not.toEqual([]);
  });
});
