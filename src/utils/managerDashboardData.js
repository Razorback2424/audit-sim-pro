const DEFAULT_IMPROVEMENT_THRESHOLD = 5;
const DEFAULT_RUSHED_SECONDS = 180;

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  return null;
};

const getAttemptIndex = (attempt) => {
  const direct = toNumber(attempt?.attemptIndex);
  if (direct !== null && direct > 0) return direct;
  const summaryIndex = toNumber(attempt?.attemptSummary?.attemptIndex);
  return summaryIndex !== null && summaryIndex > 0 ? summaryIndex : null;
};

const getAttemptType = (attempt) => {
  const direct = typeof attempt?.attemptType === 'string' ? attempt.attemptType.trim() : '';
  if (direct) return direct;
  const fromSummary =
    typeof attempt?.attemptSummary?.attemptType === 'string' ? attempt.attemptSummary.attemptType.trim() : '';
  return fromSummary || '';
};

const sortByAttemptIndex = (attempts) => {
  return [...attempts].sort((a, b) => {
    const aIdx = getAttemptIndex(a) ?? 0;
    const bIdx = getAttemptIndex(b) ?? 0;
    if (aIdx !== bIdx) return aIdx - bIdx;
    const aTime = typeof a?.submittedAt?.toMillis === 'function' ? a.submittedAt.toMillis() : 0;
    const bTime = typeof b?.submittedAt?.toMillis === 'function' ? b.submittedAt.toMillis() : 0;
    return aTime - bTime;
  });
};

export const pickBaselineAttempt = (attempts = []) => {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const baseline = attempts.find((attempt) => getAttemptType(attempt) === 'baseline');
  if (baseline) return baseline;
  const ordered = sortByAttemptIndex(attempts);
  return ordered[0] || null;
};

export const pickLatestAttempt = (attempts = []) => {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const ordered = sortByAttemptIndex(attempts);
  return ordered[ordered.length - 1] || null;
};

const pickFirstScorableAttempt = (attempts = []) => {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const ordered = sortByAttemptIndex(attempts);
  return ordered.find((attempt) => toNumber(getSummary(attempt)?.score) !== null) || null;
};

const getSummary = (attempt) =>
  attempt?.attemptSummary && typeof attempt.attemptSummary === 'object' ? attempt.attemptSummary : null;

const computeDeltaScore = (baselineSummary, latestSummary) => {
  const baselineScore = toNumber(baselineSummary?.score);
  const latestScore = toNumber(latestSummary?.score);
  if (baselineScore === null || latestScore === null) return null;
  return latestScore - baselineScore;
};

const computeDeltaCritical = (baselineSummary, latestSummary) => {
  const baselineCritical = toNumber(baselineSummary?.criticalIssuesCount);
  const latestCritical = toNumber(latestSummary?.criticalIssuesCount);
  if (baselineCritical === null || latestCritical === null) return null;
  return baselineCritical - latestCritical;
};

const computeDeltaMissed = (baselineSummary, latestSummary) => {
  const baselineMissed = toNumber(baselineSummary?.missedExceptionsCount);
  const latestMissed = toNumber(latestSummary?.missedExceptionsCount);
  if (baselineMissed === null || latestMissed === null) return null;
  return baselineMissed - latestMissed;
};

const computeStatus = ({ hasAttempts, hasInProgress, hasCompleted }) => {
  if (!hasAttempts) return hasInProgress ? 'in_progress' : 'not_started';
  if (hasCompleted) return 'completed';
  return hasInProgress ? 'in_progress' : 'attempted';
};

const pickPrimaryGap = (summary) => {
  if (!summary) return '';
  const missed = toNumber(summary?.missedExceptionsCount) ?? 0;
  const falsePositives = toNumber(summary?.falsePositivesCount) ?? 0;
  const wrongClassification = toNumber(summary?.wrongClassificationCount) ?? 0;
  if (missed > 0) return 'Missed exceptions';
  if (falsePositives > 0) return 'False positives';
  if (wrongClassification > 0) return 'Wrong classification';
  return '';
};

const pickRecommendedAction = ({ status, meetsReadiness, criticalIssues, flagsCount }) => {
  if (status === 'not_started' || status === 'in_progress') return 'Nudge';
  if (!meetsReadiness) return criticalIssues > 0 ? 'Retake' : 'Coach';
  if (flagsCount > 0) return 'Review';
  return 'No action';
};

export const buildDashboardData = ({
  learners = [],
  improvementThreshold = DEFAULT_IMPROVEMENT_THRESHOLD,
  readinessBar = { minScore: 80, maxCriticalIssues: 1 },
  rushedSeconds = DEFAULT_RUSHED_SECONDS,
} = {}) => {
  const cohortSummary = {
    assigned: 0,
    started: 0,
    completed: 0,
    improvedCount: 0,
    avgDeltaScore: 0,
    needsAttentionCount: 0,
    rushedCount: 0,
    docsComplianceRate: 0,
    baselineCriticalAvg: 0,
    latestCriticalAvg: 0,
    baselineMissedAvg: 0,
    latestMissedAvg: 0,
  };

  const learnersOutput = [];
  let deltaSum = 0;
  let deltaCount = 0;
  let baselineCriticalSum = 0;
  let baselineCriticalCount = 0;
  let latestCriticalSum = 0;
  let latestCriticalCount = 0;
  let baselineMissedSum = 0;
  let baselineMissedCount = 0;
  let latestMissedSum = 0;
  let latestMissedCount = 0;
  let docsComplianceYes = 0;
  let docsComplianceTotal = 0;

  learners.forEach((learner) => {
    cohortSummary.assigned += 1;
    const attempts = Array.isArray(learner?.attempts) ? learner.attempts : [];
    const hasAttempts = attempts.length > 0;
    const hasInProgress = Boolean(learner?.inProgress);
    const latestAttempt = pickLatestAttempt(attempts);
    const hasCompleted =
      Boolean(learner?.completed) || getAttemptType(latestAttempt) === 'final';
    const status = computeStatus({ hasAttempts, hasInProgress, hasCompleted });
    if (hasAttempts || hasInProgress) cohortSummary.started += 1;
    if (hasCompleted) cohortSummary.completed += 1;

    const baselineAttempt = pickBaselineAttempt(attempts);
    const baselineAttemptForDelta = pickFirstScorableAttempt(attempts) || baselineAttempt;
    const latestAttemptForDelta = pickLatestAttempt(attempts);
    const baselineSummary = getSummary(baselineAttempt);
    const latestSummary = getSummary(latestAttempt);
    const baselineDeltaSummary = getSummary(baselineAttemptForDelta);
    const latestDeltaSummary = getSummary(latestAttemptForDelta);
    const deltaScore = computeDeltaScore(baselineDeltaSummary, latestDeltaSummary);
    const deltaCritical = computeDeltaCritical(baselineDeltaSummary, latestDeltaSummary);
    const deltaMissed = computeDeltaMissed(baselineDeltaSummary, latestDeltaSummary);
    const latestScore = toNumber(latestSummary?.score);
    const criticalIssues = toNumber(latestSummary?.criticalIssuesCount) ?? 0;
    const latestSeconds = toNumber(latestSummary?.timeToCompleteSeconds);
    const rushed = latestSeconds !== null && latestSeconds < rushedSeconds;
    const docsNotOpened = latestSummary?.requiredDocsOpened === false;
    const suspicious = rushed && latestScore !== null && latestScore >= readinessBar.minScore;
    const meetsReadiness =
      latestScore !== null &&
      latestScore >= readinessBar.minScore &&
      criticalIssues <= readinessBar.maxCriticalIssues;

    const improved =
      (deltaScore !== null && deltaScore >= improvementThreshold) ||
      (deltaCritical !== null && deltaCritical >= 1) ||
      (deltaMissed !== null && deltaMissed >= 1);
    if (improved) cohortSummary.improvedCount += 1;

    if (deltaScore !== null) {
      deltaSum += deltaScore;
      deltaCount += 1;
    }

    const baselineCritical = toNumber(baselineSummary?.criticalIssuesCount);
    if (baselineCritical !== null) {
      baselineCriticalSum += baselineCritical;
      baselineCriticalCount += 1;
    }
    if (criticalIssues !== null) {
      latestCriticalSum += criticalIssues;
      latestCriticalCount += 1;
    }

    const baselineMissed = toNumber(baselineSummary?.missedExceptionsCount);
    if (baselineMissed !== null) {
      baselineMissedSum += baselineMissed;
      baselineMissedCount += 1;
    }
    const latestMissed = toNumber(latestSummary?.missedExceptionsCount);
    if (latestMissed !== null) {
      latestMissedSum += latestMissed;
      latestMissedCount += 1;
    }

    if (rushed) cohortSummary.rushedCount += 1;
    if (latestSummary?.requiredDocsOpened !== null && latestSummary?.requiredDocsOpened !== undefined) {
      docsComplianceTotal += 1;
      if (latestSummary.requiredDocsOpened === true) docsComplianceYes += 1;
    }

    const needsAttention =
      status !== 'completed' || criticalIssues > readinessBar.maxCriticalIssues || rushed;
    if (needsAttention) cohortSummary.needsAttentionCount += 1;
    const flags = [
      ...(rushed ? ['rushed'] : []),
      ...(docsNotOpened ? ['docs_not_opened'] : []),
      ...(suspicious ? ['suspicious'] : []),
    ];

    learnersOutput.push({
      userId: learner?.userId || '',
      displayName: learner?.displayName || '',
      status,
      baselineSummary,
      latestSummary,
      baselineAttemptIndex: getAttemptIndex(baselineAttempt),
      latestAttemptIndex: getAttemptIndex(latestAttempt),
      baselineDeltaAttemptIndex: getAttemptIndex(baselineAttemptForDelta),
      latestDeltaAttemptIndex: getAttemptIndex(latestAttemptForDelta),
      deltaScore,
      deltaCritical,
      deltaMissed,
      attemptsCount: attempts.length,
      lastActivityAt: latestAttempt?.submittedAt || null,
      primaryGap: pickPrimaryGap(latestSummary),
      flags,
      recommendedAction: pickRecommendedAction({
        status,
        meetsReadiness,
        criticalIssues,
        flagsCount: flags.length,
      }),
    });
  });

  cohortSummary.avgDeltaScore = deltaCount > 0 ? Math.round((deltaSum / deltaCount) * 10) / 10 : 0;
  cohortSummary.docsComplianceRate =
    docsComplianceTotal > 0 ? Math.round((docsComplianceYes / docsComplianceTotal) * 100) : 0;
  cohortSummary.baselineCriticalAvg =
    baselineCriticalCount > 0 ? Math.round((baselineCriticalSum / baselineCriticalCount) * 10) / 10 : 0;
  cohortSummary.latestCriticalAvg =
    latestCriticalCount > 0 ? Math.round((latestCriticalSum / latestCriticalCount) * 10) / 10 : 0;
  cohortSummary.baselineMissedAvg =
    baselineMissedCount > 0 ? Math.round((baselineMissedSum / baselineMissedCount) * 10) / 10 : 0;
  cohortSummary.latestMissedAvg =
    latestMissedCount > 0 ? Math.round((latestMissedSum / latestMissedCount) * 10) / 10 : 0;

  return {
    cohortSummary,
    learners: learnersOutput,
  };
};

const sortAttemptsBySubmittedAt = (attempts = []) => {
  return [...attempts].sort((a, b) => {
    const aTime = toMillis(a?.submittedAt) ?? 0;
    const bTime = toMillis(b?.submittedAt) ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    const aIdx = getAttemptIndex(a) ?? 0;
    const bIdx = getAttemptIndex(b) ?? 0;
    return aIdx - bIdx;
  });
};

const attemptWithinRange = (attempt, startMillis, endMillis) => {
  const submittedAtMillis = toMillis(attempt?.submittedAt);
  if (submittedAtMillis === null) return false;
  if (startMillis !== null && submittedAtMillis < startMillis) return false;
  if (endMillis !== null && submittedAtMillis > endMillis) return false;
  return true;
};

export const buildValueMetrics = ({
  learners = [],
  startDate = null,
  endDate = null,
  rushedSeconds = DEFAULT_RUSHED_SECONDS,
} = {}) => {
  const startMillis = toMillis(startDate);
  const endMillis = toMillis(endDate);
  const activeLearnerIds = new Set();
  let attemptsCount = 0;
  let criticalIssuesSum = 0;
  let rushedAttemptsCount = 0;
  let improvementSum = 0;
  let improvementCount = 0;

  learners.forEach((learner, index) => {
    const attempts = Array.isArray(learner?.attempts) ? learner.attempts : [];
    const attemptsInRange = attempts.filter((attempt) => attemptWithinRange(attempt, startMillis, endMillis));
    if (attemptsInRange.length === 0) return;

    const learnerId = learner?.userId || learner?.id || learner?.uid || `learner-${index + 1}`;
    activeLearnerIds.add(learnerId);

    attemptsInRange.forEach((attempt) => {
      attemptsCount += 1;
      const summary = getSummary(attempt);
      const criticalIssues = toNumber(summary?.criticalIssuesCount);
      if (criticalIssues !== null) {
        criticalIssuesSum += criticalIssues;
      }
      const timeSeconds = toNumber(summary?.timeToCompleteSeconds);
      if (timeSeconds !== null && timeSeconds < rushedSeconds) {
        rushedAttemptsCount += 1;
      }
    });

    if (attemptsInRange.length >= 2) {
      const ordered = sortAttemptsBySubmittedAt(attemptsInRange);
      const baselineAttempt =
        ordered.find((attempt) => getAttemptType(attempt) === 'baseline') || ordered[0];
      const latestAttempt = ordered[ordered.length - 1];
      const baselineScore = toNumber(getSummary(baselineAttempt)?.score);
      const latestScore = toNumber(getSummary(latestAttempt)?.score);
      if (baselineScore !== null && latestScore !== null) {
        improvementSum += latestScore - baselineScore;
        improvementCount += 1;
      }
    }
  });

  return {
    activeLearners: activeLearnerIds.size,
    attemptsCount,
    avgImprovement: improvementCount > 0 ? improvementSum / improvementCount : null,
    criticalIssuesRate: attemptsCount > 0 ? criticalIssuesSum / attemptsCount : null,
    rushedAttemptsRate: attemptsCount > 0 ? rushedAttemptsCount / attemptsCount : null,
  };
};
