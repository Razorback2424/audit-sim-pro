import React from 'react';
import { getAuditAreaLabel } from '../../models/caseConstants';

const formatNumber = (value) => {
  if (value === null || value === undefined) return '0';
  if (typeof value === 'number') return value.toLocaleString();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : String(value);
};

const MetricSkeleton = () => (
  <div className="animate-pulse space-y-2">
    <div className="h-3 w-24 bg-gray-200 rounded" />
    <div className="h-7 w-20 bg-gray-200 rounded" />
    <div className="h-3 w-16 bg-gray-200 rounded" />
  </div>
);

const DashboardMetrics = ({ summary, loading, onNavigate }) => {
  const metrics = [
    {
      key: 'activeCases',
      label: 'Active cases',
      value: summary?.activeCases ?? 0,
      actionLabel: 'See all cases',
      actionPath: '/admin#cases',
    },
    {
      key: 'registeredUsers',
      label: 'Registered users',
      value: summary?.registeredUsers ?? 0,
      actionLabel: 'Manage users',
      actionPath: '/admin/user-management',
    },
    {
      key: 'draftCases',
      label: 'Draft cases',
      value: summary?.draftCases ?? 0,
      actionLabel: 'Review drafts',
      actionPath: '/admin?status=draft#cases',
    },
    {
      key: 'restrictedCases',
      label: 'Restricted cases',
      value: summary?.restrictedCases ?? 0,
      actionLabel: 'Manage visibility',
      actionPath: '/admin?visibility=private#cases',
    },
  ];
  const auditAreaCounts = summary?.auditAreaCounts || {};
  const auditAreaEntries = Object.entries(auditAreaCounts)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0));
  const maxAuditAreasToShow = 4;
  const displayedAuditAreas = auditAreaEntries.slice(0, maxAuditAreasToShow);

  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">Dashboard metrics</h2>
        <button
          type="button"
          onClick={() => onNavigate?.('/admin#cases')}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          See all
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {metrics.map((metric) => (
          <div key={metric.key} className="rounded-md bg-gray-50 p-4 space-y-2">
            {loading ? (
              <MetricSkeleton />
            ) : (
              <>
                <p className="text-sm text-gray-600">{metric.label}</p>
                <p className="text-2xl font-semibold text-gray-900">{formatNumber(metric.value)}</p>
                <button
                  type="button"
                  onClick={() => onNavigate?.(metric.actionPath)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  {metric.actionLabel}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {displayedAuditAreas.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-700">Audit areas</h3>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {displayedAuditAreas.map(([area, count]) => (
              <div
                key={area}
                className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-700">{getAuditAreaLabel(area)}</span>
                <span className="text-gray-900 font-semibold">{formatNumber(count)}</span>
              </div>
            ))}
          </div>
          {auditAreaEntries.length > displayedAuditAreas.length && (
            <p className="mt-2 text-xs text-gray-500">
              Showing top {displayedAuditAreas.length} of {auditAreaEntries.length} audit areas.
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default DashboardMetrics;
