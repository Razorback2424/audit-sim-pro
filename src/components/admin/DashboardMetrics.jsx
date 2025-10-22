import React from 'react';

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
      key: 'totalDisbursements',
      label: 'Total disbursements',
      value: summary?.totalDisbursements ?? 0,
      actionLabel: 'Review disbursements',
      actionPath: '/admin/case-data-audit',
    },
    {
      key: 'totalMappings',
      label: 'Invoice mappings',
      value: summary?.totalMappings ?? 0,
      actionLabel: 'Mapping overview',
      actionPath: '/admin/case-data-audit?tab=mappings',
    },
    {
      key: 'privateAudiences',
      label: 'Private audiences',
      value: summary?.privateAudiences ?? 0,
      actionLabel: 'Manage visibility',
      actionPath: '/admin/case-overview',
    },
  ];

  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">Dashboard metrics</h2>
        <button
          type="button"
          onClick={() => onNavigate?.('/admin/case-data-audit')}
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
    </section>
  );
};

export default DashboardMetrics;
