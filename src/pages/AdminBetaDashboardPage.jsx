import React, { useEffect, useMemo, useState } from 'react';
import { Button, useRoute } from '../AppCore';
import { fetchBetaDashboard } from '../services/analyticsService';

const formatTimestamp = (value) => {
  if (!value) return '—';
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  return '—';
};

const toSortedCounts = (counts) =>
  Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([eventName, count]) => ({ eventName, count }));

export default function AdminBetaDashboardPage() {
  const { navigate } = useRoute();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const result = await fetchBetaDashboard({ days: 7 });
        if (active) setData(result);
      } catch (err) {
        if (active) setError(err?.message || 'Unable to load beta dashboard.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => toSortedCounts(data?.counts), [data]);
  const reports = Array.isArray(data?.reports) ? data.reports : [];
  const recentEvents = Array.isArray(data?.recentEvents) ? data.recentEvents : [];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Beta Dashboard</h1>
            <p className="text-sm text-gray-600">
              Funnel counts and recent support reports (last {data?.windowDays || 7} days).
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/admin')}>
            &larr; Back to admin
          </Button>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm p-6 text-sm text-gray-600">Loading beta dashboard…</div>
        ) : error ? (
          <div className="bg-white rounded-lg shadow-sm p-6 text-sm text-red-600">{error}</div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="bg-white rounded-lg shadow-sm p-5">
                <h2 className="text-lg font-semibold text-gray-800 mb-3">Funnel counts</h2>
                {counts.length === 0 ? (
                  <p className="text-sm text-gray-500">No events recorded yet.</p>
                ) : (
                  <div className="space-y-2 text-sm text-gray-700">
                    {counts.map((entry) => (
                      <div key={entry.eventName} className="flex items-center justify-between">
                        <span className="font-mono text-xs">{entry.eventName}</span>
                        <span className="font-semibold">{entry.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-white rounded-lg shadow-sm p-5">
                <h2 className="text-lg font-semibold text-gray-800 mb-3">Recent events</h2>
                {recentEvents.length === 0 ? (
                  <p className="text-sm text-gray-500">No recent events.</p>
                ) : (
                  <div className="space-y-3 text-sm">
                    {recentEvents.map((event) => (
                      <div key={event.id} className="border-b border-gray-100 pb-2 last:border-b-0 last:pb-0">
                        <div className="text-xs uppercase tracking-wide text-gray-500">{event.eventName}</div>
                        <div className="text-gray-700">
                          {event.caseId ? `Case: ${event.caseId} · ` : ''}
                          {event.uid ? `User: ${event.uid}` : 'User: unknown'}
                        </div>
                        <div className="text-xs text-gray-500">{formatTimestamp(event.ts)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-5">
              <h2 className="text-lg font-semibold text-gray-800 mb-3">Problem reports</h2>
              {reports.length === 0 ? (
                <p className="text-sm text-gray-500">No problem reports yet.</p>
              ) : (
                <div className="space-y-4">
                  {reports.map((report) => (
                    <div key={report.id} className="border border-gray-200 rounded-md p-4 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="text-xs uppercase tracking-wide text-gray-500">
                          {report.caseId ? `Case ${report.caseId}` : 'General report'}
                        </div>
                        <div className="text-xs text-gray-500">{formatTimestamp(report.createdAt)}</div>
                      </div>
                      <p className="text-gray-700 whitespace-pre-wrap">{report.message}</p>
                      <div className="mt-2 text-xs text-gray-500">
                        User: {report.uid || 'unknown'} · Role: {report.role || 'unknown'} · Route: {report.route || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
