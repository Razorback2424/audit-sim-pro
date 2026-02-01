import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, useRoute, useAuth, useModal, appId } from '../AppCore';
import { listUserSubmissions } from '../services/submissionService';
import { fetchCase } from '../services/caseService';
import { fetchProgressForCases, saveProgress } from '../services/progressService';

const formatTimestamp = (value) => {
  if (!value) return 'N/A';
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate().toLocaleString();
    } catch (e) {
      return 'N/A';
    }
  }
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  return 'N/A';
};


const formatPercent = (value) => {
  if (value === undefined || value === null || value === '') return '—';
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  // If value looks like 0-1, treat as fraction; otherwise treat as percentage already
  const pct = num <= 1 ? num * 100 : num;
  return `${Math.round(pct)}%`;
};

const toMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') {
    try {
      const result = value.toMillis();
      return Number.isFinite(result) ? result : null;
    } catch (err) {
      return null;
    }
  }
  if (typeof value.toDate === 'function') {
    try {
      const date = value.toDate();
      return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : null;
    } catch (err) {
      return null;
    }
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const getLatestAttempt = (attempts = []) => {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;

  const fieldOrder = ['submittedAt', 'updatedAt', 'createdAt'];

  const enriched = attempts.map((attempt, index) => {
    const stateValue = typeof attempt?.state === 'string' ? attempt.state.toLowerCase() : '';
    const inProgress = stateValue === 'in_progress';

    let rank = Number.POSITIVE_INFINITY;
    let timestamp = null;

    for (let i = 0; i < fieldOrder.length; i += 1) {
      const field = fieldOrder[i];
      const millis = toMillis(attempt?.[field]);
      if (Number.isFinite(millis)) {
        rank = i;
        timestamp = millis;
        break;
      }
    }

    return {
      attempt,
      index,
      rank,
      timestamp: Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY,
      inProgress,
    };
  });

  const candidates = enriched.filter((item) => !item.inProgress);
  const pool = candidates.length > 0 ? candidates : enriched;

  const best = pool.reduce((currentBest, candidate) => {
    if (!currentBest) return candidate;

    if (candidate.rank < currentBest.rank) return candidate;
    if (candidate.rank > currentBest.rank) return currentBest;

    if (candidate.timestamp > currentBest.timestamp) return candidate;
    if (candidate.timestamp < currentBest.timestamp) return currentBest;

    return candidate.index > currentBest.index ? candidate : currentBest;
  }, null);

  return best ? best.attempt : null;
};

const hasMeaningfulDraft = (progress) => {
  if (!progress || typeof progress !== 'object') return false;
  const percentComplete = Number(progress.percentComplete || 0);
  if (percentComplete > 0) return true;
  const selectedPaymentIds = Array.isArray(progress?.draft?.selectedPaymentIds) ? progress.draft.selectedPaymentIds : [];
  if (selectedPaymentIds.length > 0) return true;
  const classificationDraft = progress?.draft?.classificationDraft;
  if (classificationDraft && typeof classificationDraft === 'object' && Object.keys(classificationDraft).length > 0) {
    return true;
  }
  const step = typeof progress.step === 'string' ? progress.step.toLowerCase() : '';
  return step !== '' && step !== 'selection';
};

const extractGrade = (attempt = {}) => {
  if (!attempt || typeof attempt !== 'object') return undefined;
  const candidates = [
    attempt.overallGrade,
    attempt.grade,
    attempt.gradePercent,
    attempt.percent,
    attempt.percentCorrect,
    attempt.score,
    attempt.accuracy,
    attempt.metrics?.overallPct,
    attempt.metrics?.grade,
    attempt.results?.gradePct,
    attempt.results?.percentCorrect,
  ];
  for (const v of candidates) {
    if (v === 0) return 0; // allow 0%
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

export default function TraineeSubmissionHistoryPage() {
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { showModal } = useModal();
  const showModalRef = useRef(showModal);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    showModalRef.current = showModal;
  }, [showModal]);

  useEffect(() => {
    let isMounted = true;
    const loadHistory = async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const submissions = await listUserSubmissions({ uid: userId, appId });
        if (!isMounted) return;
        if (!Array.isArray(submissions) || submissions.length === 0) {
          setHistory([]);
          setLoading(false);
          return;
        }
        const caseIds = Array.from(new Set(submissions.map((entry) => entry.caseId).filter(Boolean)));
        const caseEntries = await Promise.all(
          caseIds.map(async (caseId) => {
            try {
              return [caseId, await fetchCase(caseId)];
            } catch (err) {
              console.error('Error loading case for history:', err);
              return [caseId, null];
            }
          })
        );
        const caseMap = new Map(caseEntries);
        setHistory(
          submissions.map((entry) => ({
            ...entry,
            caseData: caseMap.get(entry.caseId) || null,
          }))
        );
      } catch (err) {
        console.error('Error loading submission history:', err);
        if (isMounted) {
          const message = err?.message || 'Unable to load submission history.';
          setError(message);
          const modal = showModalRef.current;
          if (modal) modal(message, 'Error');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadHistory();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  const hasHistory = history.length > 0;

  const handleRetakeClick = async (caseId) => {
    if (!caseId) return;
    if (!userId) {
      navigate('/login');
      return;
    }

    try {
      const resetCaseProgress = async () => {
        await saveProgress({
          appId,
          uid: userId,
          caseId,
          patch: {
            percentComplete: 0,
            state: 'not_started',
            step: 'selection',
            draft: {
              selectedPaymentIds: [],
              classificationDraft: {},
              fixedAssetDraft: {},
              cashLinkMap: {},
              cashAdjustments: [],
              cashSummary: {},
            },
            hasSuccessfulAttempt: false,
          },
          forceOverwrite: true,
          clearActiveAttempt: true,
        });
      };

      const progressMap = await fetchProgressForCases({ appId, uid: userId, caseIds: [caseId] });
      const progress = progressMap.get(caseId);
      const percentComplete = Number(progress?.percentComplete || 0);
      const state = typeof progress?.state === 'string' ? progress.state.toLowerCase() : '';
      const meaningfulDraft = hasMeaningfulDraft(progress);

      // Only prompt when there is meaningful, in-progress draft work.
      // Progress documents can be updated after submission; don't treat "submitted/results/100%" as a draft.
      const step = typeof progress?.step === 'string' ? progress.step.toLowerCase() : '';
      const isSubmitted = state === 'submitted' || percentComplete >= 100 || step === 'results';
      const hasDraft = !isSubmitted && meaningfulDraft;

      if (!hasDraft) {
        await resetCaseProgress();
        navigate(`/trainee/case/${caseId}`);
        return;
      }

      showModal(
        'You already have a draft in progress for this case. Continue where you left off or restart the case?',
        'Draft in progress',
        (close) => (
          <>
            <Button variant="secondary" onClick={() => { close(); navigate(`/trainee/case/${caseId}`); }}>
              Return to draft
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                close();
                resetCaseProgress()
                  .then(() => navigate(`/trainee/case/${caseId}`))
                  .catch((err) => {
                    console.error('Failed to restart case:', err);
                    showModal('Could not restart this case right now. Please try again.', 'Retake unavailable');
                  });
              }}
            >
              Restart case
            </Button>
          </>
        )
      );
    } catch (err) {
      console.error('Failed to check draft status before retake:', err);
      showModal('Could not start a retake right now. Please try again.', 'Retake unavailable');
    }
  };

  const entries = useMemo(() => {
    return history.map((entry) => {
      const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
      return {
        ...entry,
        attempts: attempts.map((attempt) => ({
          ...attempt,
          submittedAt: attempt.submittedAt || entry.submittedAt || null,
          selectedPaymentIds: Array.isArray(attempt.selectedPaymentIds) ? attempt.selectedPaymentIds : [],
          retrievedDocuments: Array.isArray(attempt.retrievedDocuments) ? attempt.retrievedDocuments : [],
        })),
      };
    });
  }, [history]);

  if (loading) {
    return <div className="p-6 text-center">Loading completed cases...</div>;
  }

  if (!hasHistory) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="max-w-3xl mx-auto text-center space-y-4 bg-white border border-gray-200 rounded-lg shadow-sm p-8">
          <h1 className="text-2xl font-semibold text-gray-800">Completed Cases</h1>
          <p className="text-gray-600">You haven't completed any cases yet. Start a case to see it here.</p>
          <Button variant="primary" onClick={() => navigate('/trainee')}>
            Browse Cases
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Completed Cases</h1>
            <p className="text-sm text-gray-500">
              A quick summary of the cases you've completed.
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/trainee')}>
            &larr; Back to Dashboard
          </Button>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {entries
          .filter((entry) => Array.isArray(entry.attempts) && entry.attempts.length > 0)
          .map((entry) => {
            const latestAttempt = getLatestAttempt(entry.attempts);
            const completedDate = latestAttempt ? formatTimestamp(latestAttempt.submittedAt) : 'N/A';
            const latestGrade = latestAttempt ? formatPercent(extractGrade(latestAttempt)) : '—';
            const timesCompleted = entry.attempts.length;
            return (
              <div key={entry.caseId} className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-800">{entry.caseData?.caseName || entry.caseName || entry.caseId}</h2>
                    <p className="text-sm text-gray-500">Case ID: {entry.caseId}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      onClick={() => handleRetakeClick(entry.caseId)}
                    >
                      Retake Case
                    </Button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div className="bg-gray-50 rounded-md p-3 border border-gray-100">
                    <p className="text-gray-500">Completed Date</p>
                    <p className="font-medium text-gray-800">{completedDate}</p>
                  </div>
                  <div className="bg-gray-50 rounded-md p-3 border border-gray-100">
                    <p className="text-gray-500">Times Completed</p>
                    <p className="font-medium text-gray-800">{timesCompleted}</p>
                  </div>
                  <div className="bg-gray-50 rounded-md p-3 border border-gray-100">
                    <p className="text-gray-500">Latest Grade</p>
                    <p className="font-medium text-gray-800">{latestGrade}</p>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
