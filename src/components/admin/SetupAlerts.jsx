import React, { useMemo } from 'react';

const AlertSkeleton = () => (
  <div className="animate-pulse space-y-2">
    <div className="h-3 w-20 bg-gray-200 rounded" />
    <div className="h-4 w-full bg-gray-200 rounded" />
  </div>
);

const SetupAlerts = ({ alerts = [], loading, onNavigate }) => {
  const displayedAlerts = useMemo(() => alerts.slice(0, 3), [alerts]);
  const hasMore = alerts.length > displayedAlerts.length;

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
        ) : displayedAlerts.length === 0 ? (
          <p className="text-sm text-gray-500">All caught up—no alerts right now.</p>
        ) : (
          displayedAlerts.map((alert) => (
            <button
              key={alert.id}
              type="button"
              onClick={() => onNavigate?.(alert.actionPath)}
              className="w-full text-left bg-gray-50 hover:bg-gray-100 transition-colors rounded-md p-3 space-y-1"
            >
              <p className="text-xs uppercase tracking-wide text-red-500">{alert.type}</p>
              <p className="text-sm text-gray-700">{alert.message}</p>
              {alert.context && <p className="text-xs text-gray-500">{alert.context}</p>}
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
