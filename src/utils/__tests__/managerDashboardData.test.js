import { buildDashboardData, pickBaselineAttempt, pickLatestAttempt } from '../managerDashboardData';

const makeAttempt = (overrides = {}) => ({
  attemptIndex: 1,
  attemptType: 'baseline',
  attemptSummary: {
    score: 60,
    totalConsidered: 4,
    missedExceptionsCount: 1,
    falsePositivesCount: 0,
    wrongClassificationCount: 0,
    criticalIssuesCount: 1,
    requiredDocsOpened: true,
    timeToCompleteSeconds: 240,
  },
  submittedAt: { toMillis: () => 1000 },
  ...overrides,
});

describe('managerDashboardData selectors', () => {
  test('pickBaselineAttempt prefers attemptType baseline', () => {
    const attempts = [
      makeAttempt({ attemptIndex: 2, attemptType: 'practice' }),
      makeAttempt({ attemptIndex: 1, attemptType: 'baseline', attemptSummary: { score: 50 } }),
    ];
    const baseline = pickBaselineAttempt(attempts);
    expect(baseline.attemptIndex).toBe(1);
    expect(baseline.attemptType).toBe('baseline');
  });

  test('pickLatestAttempt selects max attemptIndex', () => {
    const attempts = [
      makeAttempt({ attemptIndex: 1 }),
      makeAttempt({ attemptIndex: 3, attemptType: 'practice', attemptSummary: { score: 80 } }),
      makeAttempt({ attemptIndex: 2, attemptType: 'practice' }),
    ];
    const latest = pickLatestAttempt(attempts);
    expect(latest.attemptIndex).toBe(3);
  });
});

describe('buildDashboardData', () => {
  test('computes cohort summary and learner deltas', () => {
    const learners = [
      {
        userId: 'u1',
        displayName: 'Ava',
        attempts: [
          makeAttempt({ attemptIndex: 1, attemptSummary: { score: 50, criticalIssuesCount: 2, missedExceptionsCount: 2, falsePositivesCount: 0 } }),
          makeAttempt({ attemptIndex: 2, attemptType: 'practice', attemptSummary: { score: 70, criticalIssuesCount: 0, missedExceptionsCount: 0, falsePositivesCount: 1, requiredDocsOpened: true, timeToCompleteSeconds: 120 } }),
        ],
      },
      {
        userId: 'u2',
        displayName: 'Kai',
        attempts: [],
        inProgress: false,
      },
    ];

    const data = buildDashboardData({
      learners,
      improvementThreshold: 5,
      readinessBar: { minScore: 80, maxCriticalIssues: 1 },
      rushedSeconds: 180,
    });

    expect(data.cohortSummary.assigned).toBe(2);
    expect(data.cohortSummary.started).toBe(1);
    expect(data.cohortSummary.completed).toBe(0);
    expect(data.cohortSummary.improvedCount).toBe(1);
    expect(data.cohortSummary.avgDeltaScore).toBe(20);
    expect(data.cohortSummary.rushedCount).toBe(1);
    expect(data.learners[0].deltaScore).toBe(20);
    expect(data.learners[0].deltaCritical).toBe(2);
    expect(data.learners[0].deltaMissed).toBe(2);
    expect(data.learners[0].baselineDeltaAttemptIndex).toBe(1);
    expect(data.learners[0].latestDeltaAttemptIndex).toBe(2);
    expect(data.learners[1].status).toBe('not_started');
    expect(data.cohortSummary.baselineCriticalAvg).toBe(2);
    expect(data.cohortSummary.latestCriticalAvg).toBe(0);
    expect(data.cohortSummary.needsAttentionCount).toBe(1);
  });
});
