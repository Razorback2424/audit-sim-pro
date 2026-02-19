import React, { useEffect, useMemo, useState } from 'react';
import { Button, useRoute, useModal, appId } from '../AppCore';
import { fetchCase } from '../services/caseService';
import { fetchProgressRosterForCase } from '../services/progressService';
import { fetchSubmissionsForCase } from '../services/submissionService';

const DEFAULT_SORT = { key: 'percentComplete', direction: 'desc' };

const formatPercent = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0%';
  return `${Math.round(value)}%`;
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return '—';
  if (typeof timestamp.toDate === 'function') {
    const date = timestamp.toDate();
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  const date = new Date(timestamp);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleString();
  }
  return '—';
};

const getLatestAttempt = (attempts = []) => {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const getMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  };
  return [...attempts].sort((a, b) => getMillis(b?.submittedAt) - getMillis(a?.submittedAt))[0];
};

const getReadinessStatus = (submission) => {
  const attempts = Array.isArray(submission?.attempts) ? submission.attempts : [];
  const latestAttempt = getLatestAttempt(attempts);
  const criticalIssues = Number(latestAttempt?.attemptSummary?.criticalIssuesCount);
  if (Number.isFinite(criticalIssues)) {
    return criticalIssues === 0 ? 'Pass' : 'Needs review';
  }
  const latestGrade = Number(latestAttempt?.overallGrade ?? submission?.overallGrade);
  if (Number.isFinite(latestGrade)) {
    return latestGrade >= 80 ? 'Pass' : 'Needs review';
  }
  return 'In progress';
};

const getFeedbackCategory = (note) => {
  if (typeof note !== 'string' || !note.trim()) return '';
  const text = note.trim();
  const idx = text.indexOf(':');
  if (idx > 0) return text.slice(0, idx).trim();
  const words = text.split(/\s+/).slice(0, 4).join(' ');
  return words.trim();
};

export default function AdminCaseProgressPage({ params }) {
  const { caseId } = params;
  const { navigate } = useRoute();
  const { showModal } = useModal();

  const [loading, setLoading] = useState(true);
  const [caseName, setCaseName] = useState('');
  const [roster, setRoster] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);

  useEffect(() => {
    if (!caseId) {
      navigate('/admin');
    }
  }, [caseId, navigate]);

  useEffect(() => {
    if (!caseId) return;
    fetchCase(caseId)
      .then((caseDoc) => {
        if (caseDoc?.caseName) {
          setCaseName(caseDoc.caseName);
        } else if (caseDoc?.title) {
          setCaseName(caseDoc.title);
        } else {
          setCaseName(caseId);
        }
      })
      .catch((error) => {
        console.error('Error fetching case metadata:', error);
        showModal('Unable to load case details. Please try again later.', 'Error');
      });
  }, [caseId, showModal]);

  useEffect(() => {
    if (!caseId) return;
    let isMounted = true;

    setLoading(true);
    fetchProgressRosterForCase({ appId, caseId })
      .then((entries) => {
        if (!isMounted) return;
        setRoster(entries);
      })
      .catch((error) => {
        console.error('Error fetching case progress roster:', error);
        if (isMounted) {
          showModal('Could not load progress roster. Please try again later.', 'Error');
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [caseId, showModal]);

  useEffect(() => {
    if (!caseId) return;
    let isMounted = true;
    fetchSubmissionsForCase(caseId)
      .then((entries) => {
        if (!isMounted) return;
        setSubmissions(Array.isArray(entries) ? entries : []);
      })
      .catch((error) => {
        console.error('Error fetching case submissions for readiness:', error);
        if (isMounted) {
          showModal('Could not load readiness data. Please try again later.', 'Error');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [caseId, showModal]);

  const submissionSummaryByUser = useMemo(() => {
    const map = new Map();
    submissions.forEach((submission) => {
      const userId = submission?.userId;
      if (!userId) return;
      const attempts = Array.isArray(submission?.attempts) ? submission.attempts : [];
      map.set(userId, {
        attemptCount: attempts.length > 0 ? attempts.length : 1,
        readiness: getReadinessStatus(submission),
      });
    });
    return map;
  }, [submissions]);

  const topFeedbackCategories = useMemo(() => {
    const counts = new Map();
    submissions.forEach((submission) => {
      const attempts = Array.isArray(submission?.attempts) ? submission.attempts : [];
      attempts.forEach((attempt) => {
        const feedback = Array.isArray(attempt?.virtualSeniorFeedback)
          ? attempt.virtualSeniorFeedback
          : [];
        feedback.forEach((entry) => {
          const notes = Array.isArray(entry?.notes) ? entry.notes : [];
          notes.forEach((note) => {
            const category = getFeedbackCategory(note);
            if (!category) return;
            counts.set(category, (counts.get(category) || 0) + 1);
          });
        });
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [submissions]);

  const sortedRoster = useMemo(() => {
    const { key, direction } = sortConfig;
    const modifier = direction === 'asc' ? 1 : -1;

    return [...roster].sort((a, b) => {
      const aProgress = a.progress;
      const bProgress = b.progress;

      switch (key) {
        case 'userId':
          return a.userId.localeCompare(b.userId) * modifier;
        case 'step':
          return (aProgress.step || '').localeCompare(bProgress.step || '') * modifier;
        case 'updatedAt': {
          const aMillis = typeof aProgress.updatedAt?.toMillis === 'function' ? aProgress.updatedAt.toMillis() : 0;
          const bMillis = typeof bProgress.updatedAt?.toMillis === 'function' ? bProgress.updatedAt.toMillis() : 0;
          if (aMillis === bMillis) return a.userId.localeCompare(b.userId) * modifier;
          return (aMillis - bMillis) * modifier;
        }
        case 'percentComplete':
        default: {
          const diff = (aProgress.percentComplete || 0) - (bProgress.percentComplete || 0);
          if (diff === 0) {
            return a.userId.localeCompare(b.userId) * modifier;
          }
          return diff * modifier;
        }
      }
    });
  }, [roster, sortConfig]);

  const handleSort = (key) => {
    setSortConfig((current) => {
      if (current.key === key) {
        const nextDirection = current.direction === 'asc' ? 'desc' : 'asc';
        return { key, direction: nextDirection };
      }
      return { key, direction: key === 'userId' || key === 'step' ? 'asc' : 'desc' };
    });
  };

  if (!caseId) {
    return null;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Case Progress</h1>
            <p className="text-sm text-gray-500 break-all">Case: {caseName || caseId}</p>
          </div>
          <div className="flex space-x-2">
            <Button onClick={() => navigate(`/admin/case-submissions/${caseId}`)} variant="secondary" className="text-sm">
              View Submissions
            </Button>
            <Button onClick={() => navigate('/admin')} variant="secondary" className="text-sm">
              &larr; Back
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="bg-white p-6 rounded-lg shadow text-center text-gray-600">Loading progress...</div>
        ) : roster.length === 0 ? (
          <div className="bg-white p-10 rounded-lg shadow text-center">
            <h2 className="text-xl font-semibold text-gray-700 mb-2">No progress recorded yet</h2>
            <p className="text-gray-500">Trainees have not started this case or the progress data has not been captured.</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Top Review Note Categories</h2>
              {topFeedbackCategories.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No review note categories recorded yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-gray-700">
                  {topFeedbackCategories.map(([category, count]) => (
                    <li key={category}>
                      <span className="font-medium">{category}</span>: {count}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button type="button" className="flex items-center space-x-1" onClick={() => handleSort('userId')}>
                      <span>User ID</span>
                      {sortConfig.key === 'userId' ? <SortIndicator direction={sortConfig.direction} /> : null}
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button type="button" className="flex items-center space-x-1" onClick={() => handleSort('percentComplete')}>
                      <span>Progress</span>
                      {sortConfig.key === 'percentComplete' ? <SortIndicator direction={sortConfig.direction} /> : null}
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button type="button" className="flex items-center space-x-1" onClick={() => handleSort('step')}>
                      <span>Step</span>
                      {sortConfig.key === 'step' ? <SortIndicator direction={sortConfig.direction} /> : null}
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Attempts
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Readiness
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <button type="button" className="flex items-center space-x-1" onClick={() => handleSort('updatedAt')}>
                      <span>Last Updated</span>
                      {sortConfig.key === 'updatedAt' ? <SortIndicator direction={sortConfig.direction} /> : null}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 text-sm">
                {sortedRoster.map(({ userId, progress }) => (
                  <tr key={userId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 break-all">{userId}</td>
                    <td className="px-4 py-3 text-gray-700">{formatPercent(progress.percentComplete)}</td>
                    <td className="px-4 py-3 text-gray-700 capitalize">{progress.step || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{submissionSummaryByUser.get(userId)?.attemptCount || 0}</td>
                    <td className="px-4 py-3 text-gray-700">{submissionSummaryByUser.get(userId)?.readiness || 'In progress'}</td>
                    <td className="px-4 py-3 text-gray-500">{formatTimestamp(progress.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SortIndicator({ direction }) {
  return (
    <span className="text-gray-400 text-xs">
      {direction === 'asc' ? '^' : 'v'}
    </span>
  );
}
