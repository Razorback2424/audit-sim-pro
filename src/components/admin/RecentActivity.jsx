import React from 'react';

const ActivitySkeleton = () => (
  <div className="animate-pulse space-y-2">
    <div className="h-3 w-24 bg-gray-200 rounded" />
    <div className="h-4 w-3/4 bg-gray-200 rounded" />
  </div>
);

const formatTimestamp = (timestamp) => {
  if (!timestamp) return '—';
  if (typeof timestamp === 'number') {
    return new Date(timestamp).toLocaleString();
  }
  if (typeof timestamp?.toDate === 'function') {
    return timestamp.toDate().toLocaleString();
  }
  if (typeof timestamp === 'string') {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
  }
  return '—';
};

const RecentActivity = ({ activity = [], loading, onNavigate }) => {
  const hasMore = activity.length >= 5;

  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">Recent activity</h2>
        {hasMore && (
          <button
            type="button"
            onClick={() => onNavigate?.('/admin/case-data-audit?tab=activity')}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            See all
          </button>
        )}
      </div>
      <div className="space-y-3">
        {loading ? (
          <>
            <ActivitySkeleton />
            <ActivitySkeleton />
            <ActivitySkeleton />
          </>
        ) : activity.length === 0 ? (
          <p className="text-sm text-gray-500">No recent updates.</p>
        ) : (
          activity.slice(0, 5).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate?.(item.actionPath)}
              className="w-full text-left bg-gray-50 hover:bg-gray-100 transition-colors rounded-md p-3"
            >
              <p className="text-sm font-medium text-gray-700">{item.title}</p>
              {item.description && <p className="text-sm text-gray-500">{item.description}</p>}
              <p className="text-xs text-gray-400 mt-2">{formatTimestamp(item.timestamp)}</p>
            </button>
          ))
        )}
        {!loading && hasMore && (
          <button
            type="button"
            onClick={() => onNavigate?.('/admin/case-data-audit?tab=activity')}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            See all activity
          </button>
        )}
      </div>
    </section>
  );
};

export default RecentActivity;
