import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, useRoute, useAuth, useModal, appId } from '../AppCore';
import { listUserSubmissions } from '../services/submissionService';
import { fetchCase } from '../services/caseService';

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

const getLatestAttempt = (attempts = []) => {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  // Prefer the attempt with the latest submittedAt timestamp
  const withDates = attempts
    .map((a) => ({ a, t: (typeof a.submittedAt?.toDate === 'function' ? a.submittedAt.toDate() : a.submittedAt) || null }))
    .map(({ a, t }) => ({ a, ts: t instanceof Date ? t.getTime() : (t ? new Date(t).getTime() : 0) }));
  const latest = withDates.reduce((best, cur) => (cur.ts > best.ts ? cur : best), withDates[0]);
  return latest.a || attempts[attempts.length - 1];
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
                    <Button variant="primary" onClick={() => navigate(`/trainee/case/${entry.caseId}?retake=true`)}>
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
