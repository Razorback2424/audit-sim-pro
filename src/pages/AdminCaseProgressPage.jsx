import React, { useEffect, useMemo, useState } from 'react';
import { Button, useRoute, useModal, appId } from '../AppCore';
import { fetchCase } from '../services/caseService';
import { fetchProgressRosterForCase } from '../services/progressService';

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

export default function AdminCaseProgressPage({ params }) {
  const { caseId } = params;
  const { navigate } = useRoute();
  const { showModal } = useModal();

  const [loading, setLoading] = useState(true);
  const [caseName, setCaseName] = useState('');
  const [roster, setRoster] = useState([]);
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
                    <td className="px-4 py-3 text-gray-500">{formatTimestamp(progress.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
