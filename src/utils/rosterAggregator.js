import { fetchUsersWithProfiles } from '../services/userService';
import { listUserSubmissions } from '../services/submissionService';
import { fetchCase } from '../services/caseService';
import { getAuditAreaLabel, getCaseLevelLabel } from '../models/caseConstants';
import { pickBaselineAttempt } from './managerDashboardData';

/**
 * @typedef {Object} RosterRecentAttempt
 * @property {import('firebase/firestore').Timestamp|null} date
 * @property {string} caseName
 * @property {number|null} score
 * @property {number|null} delta
 */

/**
 * @typedef {Object} RosterRow
 * @property {string} userId
 * @property {string} name
 * @property {string} email
 * @property {'not_started'|'attempted'|'completed'} status
 * @property {import('firebase/firestore').Timestamp|null} lastActiveAt
 * @property {string} latestModule
 * @property {number|null} latestScore
 * @property {number|null} deltaFromBaseline
 * @property {RosterRecentAttempt[]} recentAttempts
 */

const toNumberOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
};

const formatModuleLabel = (caseDoc, fallbackCaseName = '') => {
  if (!caseDoc && !fallbackCaseName) return 'N/A';
  const auditAreaLabel = getAuditAreaLabel(caseDoc?.auditArea);
  const moduleLabel =
    caseDoc?.moduleTitle ||
    caseDoc?.moduleId ||
    caseDoc?.module ||
    caseDoc?.pathTitle ||
    caseDoc?.pathId ||
    '';
  const levelLabel = caseDoc?.caseLevel ? getCaseLevelLabel(caseDoc.caseLevel) : null;
  const trackLabel = [moduleLabel, levelLabel].filter(Boolean).join(' · ');
  const combined = [auditAreaLabel, trackLabel || fallbackCaseName].filter(Boolean).join(' · ');
  return combined || 'N/A';
};

const resolveUserName = (user) => {
  const name = typeof user?.displayName === 'string' ? user.displayName.trim() : '';
  if (name) return name;
  const label = typeof user?.displayLabel === 'string' ? user.displayLabel.trim() : '';
  if (label) return label;
  const email = typeof user?.email === 'string' ? user.email.trim() : '';
  if (email) return email;
  return user?.id || 'Unknown';
};

const resolveUserEmail = (user) => {
  const email = typeof user?.email === 'string' ? user.email.trim() : '';
  return email || 'N/A';
};

const normalizeRole = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const fetchCaseMetadata = async (caseIds) => {
  const entries = await Promise.all(
    [...caseIds].map(async (caseId) => {
      try {
        const caseDoc = await fetchCase(caseId);
        return [caseId, caseDoc];
      } catch (error) {
        console.warn('[rosterAggregator] Failed to fetch case metadata', { caseId, error });
        return [caseId, null];
      }
    })
  );
  return new Map(entries);
};

const buildAttemptEntries = ({ submissions, caseMap }) => {
  const entries = [];
  const baselineScoreByCase = new Map();

  submissions.forEach((submission) => {
    const attempts = Array.isArray(submission?.attempts) ? submission.attempts : [];
    const caseId = submission?.caseId || '';
    const caseDoc = caseMap.get(caseId);
    const fallbackCaseName =
      submission?.caseName || caseDoc?.caseName || caseDoc?.title || caseId || 'Untitled case';
    const baselineAttempt = pickBaselineAttempt(attempts);
    const baselineScore = toNumberOrNull(baselineAttempt?.attemptSummary?.score);
    if (baselineScore !== null) {
      baselineScoreByCase.set(caseId, baselineScore);
    }

    attempts.forEach((attempt) => {
      const attemptScore = toNumberOrNull(attempt?.attemptSummary?.score);
      entries.push({
        caseId,
        caseName: fallbackCaseName,
        score: attemptScore,
        attemptType: attempt?.attemptType || '',
        attemptIndex: attempt?.attemptIndex || null,
        submittedAt: attempt?.submittedAt || submission?.submittedAt || null,
        caseDoc,
      });
    });
  });

  return { entries, baselineScoreByCase };
};

const sortAttemptsByRecency = (a, b) => {
  const aTime = toMillis(a.submittedAt) ?? 0;
  const bTime = toMillis(b.submittedAt) ?? 0;
  if (aTime !== bTime) return bTime - aTime;
  const aIndex = Number(a.attemptIndex) || 0;
  const bIndex = Number(b.attemptIndex) || 0;
  return bIndex - aIndex;
};

const buildLearnerAttempts = (submissions = []) =>
  submissions.flatMap((submission) => {
    const attempts = Array.isArray(submission?.attempts) ? submission.attempts : [];
    return attempts.map((attempt) => ({
      ...attempt,
      caseId: submission?.caseId || '',
      submittedAt: attempt?.submittedAt || submission?.submittedAt || null,
    }));
  });

export const buildRosterData = async ({ orgId } = {}) => {
  const users = await fetchUsersWithProfiles();
  const rosterUsers = orgId ? users.filter((user) => user?.orgId === orgId) : users;
  const trainees = rosterUsers.filter((user) => {
    const role = normalizeRole(user?.role);
    return role !== 'admin' && role !== 'owner' && role !== 'instructor';
  });

  const submissionsByUser = await Promise.all(
    trainees.map(async (user) => {
      try {
        const submissions = await listUserSubmissions({ uid: user.id });
        return { user, submissions };
      } catch (error) {
        console.warn('[rosterAggregator] Failed to load submissions for user', {
          userId: user?.id,
          error,
        });
        return { user, submissions: [] };
      }
    })
  );

  const caseIds = new Set();
  submissionsByUser.forEach(({ submissions }) => {
    submissions.forEach((submission) => {
      if (submission?.caseId) caseIds.add(submission.caseId);
    });
  });

  const caseMap = await fetchCaseMetadata(caseIds);

  const rosterRows = submissionsByUser.map(({ user, submissions }) => {
    const { entries, baselineScoreByCase } = buildAttemptEntries({ submissions, caseMap });
    entries.sort(sortAttemptsByRecency);
    const latestAttempt = entries[0] || null;
    const latestScore = toNumberOrNull(latestAttempt?.score);
    const latestCaseId = latestAttempt?.caseId || '';
    const baselineScore = baselineScoreByCase.get(latestCaseId) ?? null;
    const deltaFromBaseline =
      latestScore !== null && baselineScore !== null ? latestScore - baselineScore : null;

    const recentAttempts = entries.slice(0, 3).map((entry) => {
      const caseBaselineScore = baselineScoreByCase.get(entry.caseId);
      return {
        date: entry.submittedAt || null,
        caseName: entry.caseName,
        score: toNumberOrNull(entry.score),
        delta:
          toNumberOrNull(entry.score) !== null && caseBaselineScore !== null && caseBaselineScore !== undefined
            ? toNumberOrNull(entry.score) - caseBaselineScore
            : null,
      };
    });

    const status = entries.length === 0 ? 'not_started' : latestAttempt?.attemptType === 'final' ? 'completed' : 'attempted';

    return {
      userId: user?.id || '',
      name: resolveUserName(user),
      email: resolveUserEmail(user),
      status,
      lastActiveAt: latestAttempt?.submittedAt || null,
      latestModule: latestAttempt
        ? formatModuleLabel(latestAttempt.caseDoc, latestAttempt.caseName)
        : 'N/A',
      latestScore,
      deltaFromBaseline,
      recentAttempts,
    };
  });

  const learners = submissionsByUser.map(({ user, submissions }) => ({
    userId: user?.id || '',
    displayName: resolveUserName(user),
    attempts: buildLearnerAttempts(submissions),
  }));

  return { rosterRows, learners };
};

export const buildRosterRows = async ({ orgId } = {}) => {
  const data = await buildRosterData({ orgId });
  return data.rosterRows;
};
