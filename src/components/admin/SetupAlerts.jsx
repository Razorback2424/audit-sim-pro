import React, { useMemo } from 'react';

const AlertSkeleton = () => (
  <div className="animate-pulse space-y-2">
    <div className="h-3 w-20 bg-gray-200 rounded" />
    <div className="h-4 w-full bg-gray-200 rounded" />
  </div>
);

const SetupAlerts = ({ alerts = [], loading, onNavigate }) => {
  const groupedAlerts = useMemo(() => {
    const groups = new Map();
    const fallback = [];

    alerts.forEach((alert) => {
      const caseId = alert.caseId;
      if (caseId) {
        const existing = groups.get(caseId) || {
          caseId,
          caseName: alert.caseName || alert.context || 'Untitled case',
          count: 0,
          targetPath: `/admin/edit-case/${caseId}`,
        };
        existing.count += 1;
        groups.set(caseId, existing);
      } else {
        fallback.push(alert);
      }
    });

    const sortedGroups = Array.from(groups.values()).sort((a, b) => b.count - a.count);

    if (fallback.length > 0) {
      sortedGroups.push({
        caseId: 'other-alerts',
        caseName: 'Other alerts',
        count: fallback.length,
        targetPath: fallback[0]?.actionPath || '/admin/case-data-audit?tab=alerts',
      });
    }

    return sortedGroups;
  }, [alerts]);

  const displayedCases = useMemo(() => groupedAlerts.slice(0, 3), [groupedAlerts]);
  const hasMore = groupedAlerts.length > displayedCases.length;

  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">Setup alerts</h2>
        {hasMore && (
          <button
            type="button"
            onClick={() => onNavigate?.('/admin/case-data-audit?tab=alerts')}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            See all
          </button>
        )}
      </div>
      <div className="space-y-3">
        {loading ? (
          <>
            <AlertSkeleton />
            <AlertSkeleton />
            <AlertSkeleton />
          </>
        ) : displayedCases.length === 0 ? (
          <p className="text-sm text-gray-500">All caught up—no alerts right now.</p>
        ) : (
          displayedCases.map((group) => (
            <button
              key={group.caseId}
              type="button"
              onClick={() => onNavigate?.(group.targetPath)}
              className="w-full text-left bg-gray-50 hover:bg-gray-100 transition-colors rounded-md p-3 space-y-1"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-800">{group.caseName}</p>
                <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                  {group.count} alert{group.count === 1 ? '' : 's'}
                </span>
              </div>
              <p className="text-xs text-gray-500">Tap to review outstanding setup items.</p>
            </button>
          ))
        )}
        {!loading && hasMore && (
          <button
            type="button"
            onClick={() => onNavigate?.('/admin/case-data-audit?tab=alerts')}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            See all alerts
          </button>
        )}
      </div>
    </section>
  );
};

export default SetupAlerts;
