import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ListChecks, BookOpen } from 'lucide-react';
import { Button, useRoute, useModal, useAuth, appId } from '../AppCore';
import { listStudentCases } from '../services/caseService';
import { subscribeProgressForCases } from '../services/progressService';
import { nullSafeDate, getNow } from '../utils/dates';
import { toProgressModel } from '../models/progress';

/** @typedef {import('../models/case').CaseModel} CaseModel */
/** @typedef {import('../models/progress').ProgressModel} ProgressModel */

const PAGE_SIZE = 9;

const ProgressRing = ({ percent, size = 40 }) => {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        className="text-gray-200"
        strokeWidth={stroke}
        stroke="currentColor"
        fill="transparent"
        r={radius}
        cx={size / 2}
        cy={size / 2}
      />
      <circle
        className="text-blue-600"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        stroke="currentColor"
        fill="transparent"
        r={radius}
        cx={size / 2}
        cy={size / 2}
      />
    </svg>
  );
};

const SkeletonRing = ({ size = 40 }) => (
  <div style={{ width: size, height: size }} className="bg-gray-200 rounded-full animate-pulse" />
);

export default function TraineeDashboardPage() {
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { showModal } = useModal();

  /** @type {[CaseModel[], React.Dispatch<React.SetStateAction<CaseModel[]>>]} */
  const [cases, setCases] = useState([]);
  /** @type {[Map<string, ProgressModel>, React.Dispatch<React.SetStateAction<Map<string, ProgressModel>>>]} */
  const [progress, setProgress] = useState(new Map());
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('due');

  useEffect(() => {
    setError('');
  }, [sortBy]);

  const fetchCases = useCallback(
    async ({ append = false, cursor = null } = {}) => {
      if (!userId) return;
      try {
        setLoading(true);
        if (!append) {
          setCases([]);
          setNextCursor(null);
          setInitialLoad(true);
        }

        if (process.env.NODE_ENV !== 'production') {
          console.info('[dashboard] fetch start', {
            uid: userId,
            sortBy,
            append,
            hasCursor: Boolean(append && cursor),
          });
        }

        const result = await listStudentCases({
          appId,
          uid: userId,
          pageSize: PAGE_SIZE,
          cursor: append ? cursor : undefined,
          sortBy,
          includeOpensAtGate: false,
        });

        if (process.env.NODE_ENV !== 'production') {
          console.info('[dashboard] fetch success', { count: result.items.length });
        }

        setCases((prev) => (append ? [...prev, ...result.items] : result.items));
        setNextCursor(result.nextCursor || null);
        setError('');
      } catch (err) {
        console.error('Error fetching cases for trainee:', err);
        const message = err?.message || 'Unable to load cases.';
        setError(message);
        if (!append) {
          setCases([]);
          setNextCursor(null);
        }
        showModal(message, 'Error');
      } finally {
        setLoading(false);
        setInitialLoad(false);
      }
    },
    [userId, sortBy, showModal]
  );

  useEffect(() => {
    if (!userId) {
      setInitialLoad(false);
      return;
    }
    fetchCases({ append: false });
  }, [userId, sortBy, fetchCases]);

  const caseIds = useMemo(() => cases.map((c) => c.id), [cases]);

  useEffect(() => {
    if (!userId || caseIds.length === 0) {
      setProgress(new Map());
      return;
    }

    const unsubscribe = subscribeProgressForCases(
      { appId, uid: userId, caseIds },
      (progressMap) => {
        setProgress(progressMap);
      },
      (err) => {
        console.error('Error subscribing to progress:', err);
      }
    );

    return () => unsubscribe();
  }, [userId, caseIds]);

  const casesWithProgress = useMemo(() => {
    return cases.map((caseData) => ({
      ...caseData,
      progress: progress.get(caseData.id) || toProgressModel(null, caseData.id),
    }));
  }, [cases, progress]);

  const now = useMemo(() => getNow().date, []);
  if (!userId && initialLoad) {
    return <div className="p-4 text-center">Authenticating user, please wait...</div>;
  }

  const formatDueDate = (caseData) => {
    const dueDate = nullSafeDate(caseData.dueAt);
    if (!dueDate) return 'No due date set';
    const diffMs = dueDate.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Due today';
    if (diffDays === 1) return 'Due tomorrow';
    if (diffDays < 0) return `Overdue by ${Math.abs(diffDays)} day(s)`;
    return `Due in ${diffDays} day(s)`;
  };

  const getOpenState = (caseData) => {
    const opensDate = nullSafeDate(caseData.opensAt);
    if (!opensDate) return { isOpen: true, message: '' };
    const diffMs = opensDate.getTime() - now.getTime();
    if (diffMs <= 0) return { isOpen: true, message: '' };
    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
    const message =
      diffHours >= 24 ? `Opens in ${Math.ceil(diffHours / 24)} day(s)` : `Opens in ${diffHours} hour(s)`;
    return { isOpen: false, message };
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-3">
          <h1 className="text-3xl font-bold text-gray-800">Available Audit Cases</h1>
          <div className="flex items-center space-x-2">
            <label htmlFor="sortBy" className="text-sm text-gray-600">
              Sort by
            </label>
            <select
              id="sortBy"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1 text-sm"
            >
              <option value="due">Soonest due</option>
              <option value="title">Title A–Z</option>
            </select>
          </div>
        </div>

        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-4 mb-6">
            {error}
          </div>
        ) : null}

        {initialLoad && loading ? (
          <div className="text-center py-10 bg-white rounded-lg shadow">
            <Loader2 size={32} className="animate-spin text-gray-500 mx-auto mb-3" />
            <p className="text-gray-600">Loading available cases…</p>
          </div>
        ) : cases.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-lg shadow">
            <ListChecks size={48} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 text-xl">No cases currently assigned or available to you.</p>
            <p className="text-gray-500 mt-2">Please check back later or contact an administrator.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {casesWithProgress.map((caseData) => {
              const { isOpen, message } = getOpenState(caseData);
              return (
                <div key={caseData.id} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <h2 className="text-xl font-semibold text-blue-700 flex-1 pr-2">{caseData.title || caseData.caseName}</h2>
                      {caseData.progress ? (
                        <div className="text-center">
                          <ProgressRing percent={caseData.progress.percentComplete} />
                          <span className="text-xs text-gray-500">{caseData.progress.percentComplete}%</span>
                        </div>
                      ) : (
                        <SkeletonRing />
                      )}
                    </div>
                    {caseData.progress ? (
                      <span className="inline-block text-xs font-semibold uppercase tracking-wide text-gray-600 bg-gray-100 px-2 py-1 rounded">
                        {caseData.progress.state.replace('_', ' ')}
                      </span>
                    ) : null}
                    <p className="text-sm text-gray-600">{formatDueDate(caseData)}</p>
                    {!isOpen && message ? (
                      <p className="text-sm text-amber-600 font-medium">{message}</p>
                    ) : null}
                  </div>
                  <Button
                    onClick={() => navigate(`/cases/${caseData.id}`)}
                    className="w-full mt-auto"
                    disabled={!isOpen}
                    variant={isOpen ? 'primary' : 'secondary'}
                  >
                    <BookOpen size={18} className="inline mr-2" /> Continue
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex justify-center">
          {nextCursor ? (
            <Button onClick={() => fetchCases({ append: true, cursor: nextCursor })} disabled={loading} className="px-4 py-2">
              {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              Load more
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
