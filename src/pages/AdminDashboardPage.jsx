import React, { useEffect, useMemo, useState } from 'react';
import {
  FilePlus,
  Edit3,
  ListFilter,
  Trash2,
  Search,
  LayoutGrid,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  Inbox,
} from 'lucide-react';
import { Button, Input, Select, useRoute, useModal, useUser } from '../AppCore';
import {
  markCaseDeleted,
  repairLegacyCases,
  subscribeToAdminCaseSummary,
  subscribeToAdminCaseAlerts,
  subscribeToRecentCaseActivity,
  fetchCasesPage,
  CASE_SORT_CHOICES,
  DEFAULT_CASE_SORT,
} from '../services/caseService';
import { subscribeToRecentSubmissionActivity } from '../services/submissionService';
import AdvancedToolsMenu from '../components/admin/AdvancedToolsMenu';
import DashboardMetrics from '../components/admin/DashboardMetrics';
import SetupAlerts from '../components/admin/SetupAlerts';
import RecentActivity from '../components/admin/RecentActivity';
import QuickActions from '../components/admin/QuickActions';

const STATUS_OPTIONS = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'archived', label: 'Archived' },
  { value: 'draft', label: 'Draft' },
];

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Visible to all trainees' },
  { value: 'private', label: 'Rostered only' },
];

const VIEW_OPTIONS = [
  { id: 'grid', label: 'Card view', Icon: LayoutGrid },
  { id: 'table', label: 'Table view', Icon: TableIcon },
];

const PAGE_SIZE_OPTIONS = [6, 12, 24, 48];

const STATUS_BADGE_VARIANTS = {
  submitted: 'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  archived: 'bg-gray-200 text-gray-600',
  draft: 'bg-yellow-100 text-yellow-700',
  assigned: 'bg-indigo-100 text-indigo-700',
};

const getStatusBadgeClass = (status) => STATUS_BADGE_VARIANTS[status] || STATUS_BADGE_VARIANTS.assigned;

const formatTimestamp = (value) => {
  if (!value) return null;
  try {
    if (typeof value.toDate === 'function') {
      return value.toDate();
    }
    if (value instanceof Date) {
      return value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch (err) {
    console.warn('[AdminDashboard] Failed to normalize timestamp', err);
    return null;
  }
};

const formatDateLabel = (value) => {
  const date = formatTimestamp(value);
  if (!date) return '—';
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const getStatusLabel = (status) => {
  const match = STATUS_OPTIONS.find((option) => option.value === status);
  return match ? match.label : 'Assigned';
};

const getAudienceLabel = (caseData) => {
  if (caseData.publicVisible === false && Array.isArray(caseData.visibleToUserIds) && caseData.visibleToUserIds.length > 0) {
    return `${caseData.visibleToUserIds.length} rostered user${caseData.visibleToUserIds.length === 1 ? '' : 's'}`;
  }
  if (caseData.publicVisible === false) {
    return 'Restricted audience';
  }
  return 'All signed-in trainees';
};

export default function AdminDashboardPage() {
  const { navigate, query, setQuery } = useRoute();
  const { showModal } = useModal();
  const { role, loadingRole } = useUser();
  const [refreshToken, setRefreshToken] = useState(0);
  const [repairingCases, setRepairingCases] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState({
    activeCases: 0,
    totalDisbursements: 0,
    totalMappings: 0,
    privateAudiences: 0,
  });
  const [alerts, setAlerts] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [casesState, setCasesState] = useState({
    loading: true,
    error: null,
    items: [],
    total: 0,
    page: 1,
    pageSize: 12,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [searchInput, setSearchInput] = useState(() => (query?.search ?? '').trim());
  const [debouncedSearch, setDebouncedSearch] = useState(() => (query?.search ?? '').trim());
  const [viewMode, setViewMode] = useState(() => {
    try {
      const stored = window.localStorage.getItem('auditsim.adminDashboard.viewMode');
      return stored === 'table' ? 'table' : 'grid';
    } catch (err) {
      console.warn('[AdminDashboard] Failed to read stored view mode:', err);
      return 'grid';
    }
  });
  const [pageSize, setPageSize] = useState(() => {
    try {
      const stored = window.localStorage.getItem('auditsim.adminDashboard.pageSize');
      const parsed = Number.parseInt(stored ?? '', 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
    } catch (err) {
      console.warn('[AdminDashboard] Failed to read stored page size:', err);
      return 12;
    }
  });
  const isAdmin = role === 'admin';
  const alertsByCaseId = useMemo(() => {
    const map = new Map();
    alerts.forEach((alert) => {
      if (!alert?.caseId) return;
      if (!map.has(alert.caseId)) {
        map.set(alert.caseId, []);
      }
      map.get(alert.caseId).push(alert);
    });
    return map;
  }, [alerts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setSearchInput((query?.search ?? '').trim());
  }, [query?.search]);

  useEffect(() => {
    const normalized = debouncedSearch ? debouncedSearch : undefined;
    const current = (query?.search ?? '').trim() || undefined;
    if (normalized === current) {
      return;
    }
    setQuery({ search: normalized, page: '1' }, { replace: true });
  }, [debouncedSearch, query?.search, setQuery]);

  useEffect(() => {
    try {
      window.localStorage.setItem('auditsim.adminDashboard.viewMode', viewMode);
    } catch (err) {
      console.warn('[AdminDashboard] Failed to persist view mode:', err);
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem('auditsim.adminDashboard.pageSize', String(pageSize));
    } catch (err) {
      console.warn('[AdminDashboard] Failed to persist page size:', err);
    }
  }, [pageSize]);

  const statusFilters = useMemo(() => {
    if (!query?.status) return [];
    return query.status
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }, [query?.status]);

  const visibilityFilters = useMemo(() => {
    if (!query?.visibility) return [];
    return query.visibility
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }, [query?.visibility]);

  const sortOption = useMemo(() => {
    if (!query?.sort) return DEFAULT_CASE_SORT;
    const valid = CASE_SORT_CHOICES.find((option) => option.value === query.sort);
    return valid ? valid.value : DEFAULT_CASE_SORT;
  }, [query?.sort]);

  const currentPage = useMemo(() => {
    const parsed = Number.parseInt(query?.page ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [query?.page]);

  useEffect(() => {
    let isActive = true;
    setCasesState((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }));

    const loadCases = async () => {
      try {
        const result = await fetchCasesPage({
          search: debouncedSearch,
          status: statusFilters,
          visibility: visibilityFilters,
          sort: sortOption,
          page: currentPage,
          limit: pageSize,
        });
        if (!isActive) return;
        setCasesState({
          loading: false,
          error: null,
          items: result.items,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          hasNextPage: result.hasNextPage,
          hasPreviousPage: result.hasPreviousPage,
        });
        if (result.page !== currentPage) {
          setQuery({ page: String(result.page) }, { replace: true });
        }
      } catch (error) {
        console.error('Error loading cases:', error);
        if (!isActive) return;
        setCasesState((prev) => ({
          ...prev,
          loading: false,
          error,
        }));
      }
    };

    loadCases();

    return () => {
      isActive = false;
    };
  }, [
    debouncedSearch,
    statusFilters,
    visibilityFilters,
    sortOption,
    currentPage,
    pageSize,
    setQuery,
    refreshToken,
  ]);

  useEffect(() => {
    if (loadingRole || role !== 'admin') {
      if (!loadingRole) {
        setLoadingSummary(false);
      }
      return;
    }

    setLoadingSummary(true);
    const unsubscribe = subscribeToAdminCaseSummary(
      (data) => {
        setDashboardSummary(data);
        setLoadingSummary(false);
      },
      (error) => {
        console.error('Error loading dashboard metrics:', error);
        showModal('Error loading dashboard metrics: ' + (error?.message || 'Please try again.'), 'Error');
        setLoadingSummary(false);
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [showModal, role, loadingRole]);

  useEffect(() => {
    if (loadingRole || role !== 'admin') {
      if (!loadingRole) {
        setLoadingAlerts(false);
      }
      return;
    }

    setLoadingAlerts(true);
    const unsubscribe = subscribeToAdminCaseAlerts(
      (data) => {
        setAlerts(data);
        setLoadingAlerts(false);
      },
      (error) => {
        console.error('Error loading alerts:', error);
        showModal('Error loading alerts: ' + (error?.message || 'Please try again.'), 'Error');
        setLoadingAlerts(false);
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [showModal, role, loadingRole]);

  useEffect(() => {
    if (loadingRole || role !== 'admin') {
      return;
    }

    setLoadingActivity(true);
    console.info('[AdminDashboard] Loading recent activity');
    let caseActivity = [];
    let submissionActivity = [];

    const updateActivity = () => {
      const combined = [...caseActivity, ...submissionActivity]
        .sort((a, b) => {
          const aTime = typeof a.timestamp === 'number' ? a.timestamp : 0;
          const bTime = typeof b.timestamp === 'number' ? b.timestamp : 0;
          return bTime - aTime;
        })
        .slice(0, 10);
      console.debug('[AdminDashboard] Combined activity updated', {
        caseActivityCount: caseActivity.length,
        submissionActivityCount: submissionActivity.length,
        combinedCount: combined.length,
      });
      setRecentActivity(combined);
      setLoadingActivity(false);
    };

    const handleError = (error) => {
      console.error('[AdminDashboard] Error loading recent activity', {
        code: error?.code,
        message: error?.message,
      });
      showModal('Error loading recent activity: ' + (error?.message || 'Please try again.'), 'Error');
      setLoadingActivity(false);
    };

    const unsubscribeCases = subscribeToRecentCaseActivity(
      (data) => {
        caseActivity = data.map((item) => ({
          ...item,
          timestamp:
            typeof item.timestamp === 'number'
              ? item.timestamp
              : item.timestamp?.toMillis?.() ?? item.timestamp ?? null,
        }));
        console.debug('[AdminDashboard] Received case activity snapshot', {
          count: caseActivity.length,
        });
        updateActivity();
      },
      handleError,
      { limit: 5 }
    );

    const unsubscribeSubmissions = subscribeToRecentSubmissionActivity(
      (data) => {
        submissionActivity = data.map((item) => ({
          id: `submission-${item.userId || 'unknown'}-${item.caseId}`,
          title: item.caseName || 'Submission update',
          description: item.userId ? `Submission from ${item.userId}` : 'Submission received',
          actionPath: `/admin/case-submissions/${item.caseId}`,
          timestamp:
            item.submittedAt?.toMillis?.() ??
            (item.submittedAt instanceof Date ? item.submittedAt.getTime() : null),
        }));
        console.debug('[AdminDashboard] Received submission activity snapshot', {
          count: submissionActivity.length,
        });
        updateActivity();
      },
      handleError,
      { limit: 5 }
    );

    return () => {
      console.info('[AdminDashboard] Cleaning up recent activity subscriptions');
      if (typeof unsubscribeCases === 'function') {
        unsubscribeCases();
      }
      if (typeof unsubscribeSubmissions === 'function') {
        unsubscribeSubmissions();
      }
    };
  }, [showModal, role, loadingRole]);

  const handleRepairCases = async () => {
    if (repairingCases) return;
    try {
      setRepairingCases(true);
      const { repaired } = await repairLegacyCases();
      const message = repaired > 0 ? `${repaired} case${repaired === 1 ? '' : 's'} repaired.` : 'All cases already meet the required defaults.';
      showModal(message, 'Repair Complete');
      if (repaired > 0) {
        setRefreshToken((value) => value + 1);
      }
    } catch (error) {
      console.error('Error repairing cases:', error);
      showModal(error?.message || 'Unable to repair cases. Please try again.', 'Error');
    } finally {
      setRepairingCases(false);
    }
  };

  const deleteCase = async (caseId) => {
    showModal(
      <>
        <p className="text-gray-700">Are you sure you want to delete this case? This action marks it as deleted but does not permanently remove data immediately.</p>
      </>,
      'Confirm Deletion',
      (hideModal) => (
        <>
          <Button onClick={hideModal} variant="secondary">Cancel</Button>
          <Button
            onClick={async () => {
              hideModal();
              try {
                await markCaseDeleted(caseId);
                showModal('Case marked for deletion.', 'Success');
                setRefreshToken((value) => value + 1);
              } catch (error) {
                console.error('Error deleting case:', error);
                showModal('Error deleting case: ' + error.message, 'Error');
              }
            }}
            variant="danger"
            className="ml-2"
          >
            Confirm Delete
          </Button>
        </>
      )
    );
  };

  const totalCases = casesState.total;
  const effectivePage = casesState.page;
  const effectivePageSize = casesState.pageSize || pageSize;
  const showingFrom = totalCases === 0 ? 0 : (effectivePage - 1) * effectivePageSize + 1;
  const showingTo = totalCases === 0 ? 0 : Math.min(effectivePage * effectivePageSize, totalCases);
  const maxPage = totalCases === 0 ? 1 : Math.max(1, Math.ceil(totalCases / effectivePageSize));
  const hasNextPage = casesState.hasNextPage;
  const hasPreviousPage = casesState.hasPreviousPage;
  const isLoadingCases = casesState.loading;
  const filtersActive = statusFilters.length + visibilityFilters.length;

  const toggleStatusFilter = (value) => {
    const current = new Set(statusFilters);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    const next = Array.from(current);
    setQuery(
      {
        status: next.length ? next.join(',') : undefined,
        page: '1',
      },
      { replace: false }
    );
  };

  const toggleVisibilityFilter = (value) => {
    const current = new Set(visibilityFilters);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    const next = Array.from(current);
    setQuery(
      {
        visibility: next.length ? next.join(',') : undefined,
        page: '1',
      },
      { replace: false }
    );
  };

  const clearFilters = () => {
    setQuery(
      {
        status: undefined,
        visibility: undefined,
        page: '1',
      },
      { replace: false }
    );
  };

  const handleSortChange = (event) => {
    const { value } = event.target;
    setQuery(
      {
        sort: value === DEFAULT_CASE_SORT ? undefined : value,
        page: '1',
      },
      { replace: false }
    );
  };

  const handlePageSizeChange = (event) => {
    const next = Number.parseInt(event.target.value, 10);
    if (!Number.isFinite(next) || next <= 0) {
      return;
    }
    setPageSize(next);
    setQuery({ page: '1' }, { replace: true });
  };

  const goToPage = (pageNumber) => {
    const clamped = Math.min(Math.max(pageNumber, 1), Math.max(1, maxPage));
    if (clamped === effectivePage) return;
    setQuery({ page: String(clamped) });
  };

  const handlePrevPage = () => {
    if (!hasPreviousPage) return;
    goToPage(effectivePage - 1);
  };

  const handleNextPage = () => {
    if (!hasNextPage) return;
    goToPage(effectivePage + 1);
  };

  const renderSkeletons = () => {
    if (viewMode === 'table') {
      return (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="divide-y divide-gray-100 animate-pulse">
            {Array.from({ length: Math.min(6, effectivePageSize) }).map((_, index) => (
              <div key={index} className="p-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 bg-gray-200 rounded" />
                  <div className="h-3 w-1/3 bg-gray-100 rounded" />
                </div>
                <div className="h-4 w-16 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: Math.min(6, effectivePageSize) }).map((_, index) => (
          <div key={index} className="bg-white rounded-lg shadow p-5 animate-pulse space-y-4">
            <div className="h-6 w-3/4 bg-gray-200 rounded" />
            <div className="space-y-2">
              <div className="h-4 w-2/3 bg-gray-100 rounded" />
              <div className="h-4 w-1/2 bg-gray-100 rounded" />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <div className="h-4 bg-gray-100 rounded" />
              <div className="h-4 bg-gray-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderEmptyState = () => (
    <div className="bg-white rounded-lg shadow p-10 text-center space-y-4">
      <Inbox size={48} className="mx-auto text-gray-300" />
      <div>
        <h3 className="text-lg font-semibold text-gray-800">No cases match your current filters</h3>
        <p className="text-sm text-gray-600">
          {debouncedSearch || filtersActive
            ? 'Adjust your search or filters to see more results.'
            : 'Get started by creating a new audit case for trainees.'}
        </p>
      </div>
      <div className="flex justify-center gap-2">
        {(debouncedSearch || filtersActive) && (
          <Button onClick={clearFilters} variant="secondary">Clear filters</Button>
        )}
        <Button onClick={() => navigate('/admin/create-case')} variant="primary">Create case</Button>
      </div>
    </div>
  );

  const renderErrorState = () => (
    <div className="bg-white rounded-lg shadow p-8 text-center space-y-4">
      <AlertCircle size={48} className="mx-auto text-red-500" />
      <div>
        <h3 className="text-lg font-semibold text-gray-800">We couldn&apos;t load the cases</h3>
        <p className="text-sm text-gray-600">
          {casesState.error?.message || 'Please refresh or try again in a moment.'}
        </p>
      </div>
      <div className="flex justify-center">
        <Button onClick={() => setRefreshToken((value) => value + 1)} variant="secondary">Try again</Button>
      </div>
    </div>
  );

  const renderCaseCards = () => (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {casesState.items.map((caseData) => {
        const statusLabel = getStatusLabel(caseData.status);
        const updatedLabel = formatDateLabel(caseData.updatedAt || caseData.createdAt);
        const createdLabel = formatDateLabel(caseData.createdAt);
        const audienceLabel = getAudienceLabel(caseData);
        const visibilityBadgeClass =
          caseData.publicVisible === false ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700';
        const caseAlerts = alertsByCaseId.get(caseData.id) || [];
        const hasAlerts = caseAlerts.length > 0;

        return (
          <div
            key={caseData.id}
            className={`rounded-lg border p-5 flex flex-col h-full transition-shadow ${
              hasAlerts ? 'border-amber-300 bg-amber-50 shadow-md' : 'border-gray-100 bg-white shadow'
            }`}
          >
            <div className="flex-1 space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-blue-700">
                    {caseData.caseName || 'Untitled case'}
                  </h3>
                  {hasAlerts && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      <AlertTriangle size={12} />
                      {caseAlerts.length}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1 break-all">ID: {caseData.id}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-medium">
                <span className={`inline-flex items-center px-3 py-1 rounded-full ${getStatusBadgeClass(caseData.status)}`}>
                  {statusLabel}
                </span>
                <span className={`inline-flex items-center px-3 py-1 rounded-full ${visibilityBadgeClass}`}>
                  {caseData.publicVisible === false ? 'Private' : 'Public'} audience
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-4 text-sm text-gray-700">
                <div>
                  <dt className="text-gray-500">Disbursements</dt>
                  <dd className="font-semibold text-gray-800">{Array.isArray(caseData.disbursements) ? caseData.disbursements.length : 0}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Mappings</dt>
                  <dd className="font-semibold text-gray-800">{Array.isArray(caseData.invoiceMappings) ? caseData.invoiceMappings.length : 0}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Audience</dt>
                  <dd className="font-semibold text-gray-800">{audienceLabel}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Updated</dt>
                  <dd className="font-semibold text-gray-800">{updatedLabel}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Created</dt>
                  <dd className="font-semibold text-gray-800">{createdLabel}</dd>
                </div>
              </dl>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button onClick={() => navigate(`/admin/case-overview/${caseData.id}`)} variant="secondary" className="justify-center">
                <Edit3 size={16} className="mr-2" /> View case
              </Button>
              <Button onClick={() => navigate(`/admin/case-submissions/${caseData.id}`)} variant="secondary" className="justify-center">
                <ListFilter size={16} className="mr-2" /> View submissions
              </Button>
              <Button onClick={() => navigate(`/admin/edit-case/${caseData.id}`)} variant="secondary" className="justify-center">
                <Edit3 size={16} className="mr-2" /> Edit case
              </Button>
              <Button onClick={() => deleteCase(caseData.id)} variant="danger" className="justify-center">
                <Trash2 size={16} className="mr-2" /> Delete case
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderCaseTable = () => (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-gray-600 uppercase tracking-wide text-xs">
          <tr>
            <th className="px-4 py-3 text-left">Case</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-left">Audience</th>
            <th className="px-4 py-3 text-left">Updated</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {casesState.items.map((caseData) => {
            const statusLabel = getStatusLabel(caseData.status);
            const audienceLabel = getAudienceLabel(caseData);
            const updatedLabel = formatDateLabel(caseData.updatedAt || caseData.createdAt);
            const caseAlerts = alertsByCaseId.get(caseData.id) || [];
            const hasAlerts = caseAlerts.length > 0;
            return (
              <tr
                key={caseData.id}
                className={`transition-colors ${hasAlerts ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'}`}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 font-semibold text-gray-900">
                    <span>{caseData.caseName || 'Untitled case'}</span>
                    {hasAlerts && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        <AlertTriangle size={12} />
                        {caseAlerts.length}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 break-all">ID: {caseData.id}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusBadgeClass(caseData.status)}`}>
                    {statusLabel}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-700">{audienceLabel}</td>
                <td className="px-4 py-3 text-gray-700">{updatedLabel}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end flex-wrap gap-2">
                    <Button onClick={() => navigate(`/admin/case-overview/${caseData.id}`)} variant="secondary" className="px-3 py-1 text-xs">
                      View
                    </Button>
                    <Button onClick={() => navigate(`/admin/case-submissions/${caseData.id}`)} variant="secondary" className="px-3 py-1 text-xs">
                      Submissions
                    </Button>
                    <Button onClick={() => navigate(`/admin/edit-case/${caseData.id}`)} variant="secondary" className="px-3 py-1 text-xs">
                      Edit
                    </Button>
                    <Button onClick={() => deleteCase(caseData.id)} variant="danger" className="px-3 py-1 text-xs">
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => navigate('/admin/create-case')}
              variant="primary"
              className="px-6 py-3 text-base shadow-lg"
            >
              <FilePlus size={20} className="mr-2" />
              Create case
            </Button>
            <AdvancedToolsMenu
              canAccess={isAdmin}
              loadingAccess={loadingRole}
              onNavigateUserManagement={() => navigate('/admin/user-management')}
              onNavigateDataAudit={() => navigate('/admin/case-data-audit')}
              onRepairCases={handleRepairCases}
              isRepairingCases={repairingCases}
            />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <DashboardMetrics summary={dashboardSummary} loading={loadingSummary} onNavigate={navigate} />
          <SetupAlerts alerts={alerts} loading={loadingAlerts} onNavigate={navigate} />
          <RecentActivity activity={recentActivity} loading={loadingActivity} onNavigate={navigate} />
          <QuickActions onNavigate={navigate} />
        </div>
        <section id="cases" className="space-y-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-semibold text-gray-800">Cases</h2>
              <p className="text-sm text-gray-600">Search, filter, and organize cases for your trainees.</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6 space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <form onSubmit={(event) => event.preventDefault()} className="relative w-full lg:max-w-md">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    type="search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Search cases by name or ID"
                    className="pl-10"
                    aria-label="Search cases"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={() => setSearchInput('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-blue-600 hover:text-blue-700"
                    >
                      Clear
                    </button>
                  )}
                </form>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label htmlFor="case-sort" className="text-sm font-medium text-gray-600">
                      Sort by
                    </label>
                    <Select id="case-sort" value={sortOption} onChange={handleSortChange} className="w-48">
                      {CASE_SORT_CHOICES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="inline-flex items-center overflow-hidden rounded-lg border border-gray-200">
                    {VIEW_OPTIONS.map(({ id, label, Icon }) => {
                      const isActive = viewMode === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setViewMode(id)}
                          className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition ${
                            isActive ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                          }`}
                          aria-pressed={isActive}
                          title={label}
                        >
                          <Icon size={16} />
                          <span className="hidden sm:inline">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    <ListFilter size={16} /> Status
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((option) => {
                      const isActive = statusFilters.includes(option.value);
                      return (
                        <button
                          type="button"
                          key={option.value}
                          onClick={() => toggleStatusFilter(option.value)}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    <ListFilter size={16} /> Audience visibility
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {VISIBILITY_OPTIONS.map((option) => {
                      const isActive = visibilityFilters.includes(option.value);
                      return (
                        <button
                          type="button"
                          key={option.value}
                          onClick={() => toggleVisibilityFilter(option.value)}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              {filtersActive > 0 && (
                <div className="flex justify-end">
                  <Button onClick={clearFilters} variant="secondary" className="text-sm">
                    Clear status & visibility filters
                  </Button>
                </div>
              )}
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-t border-gray-100 pt-4">
                <div className="text-sm text-gray-600">
                  {isLoadingCases
                    ? 'Loading cases…'
                    : totalCases === 0
                    ? 'No cases to display'
                    : `Showing ${showingFrom}–${showingTo} of ${totalCases} cases`}
                  {!isLoadingCases && filtersActive > 0 && (
                    <span className="ml-2 text-gray-500">
                      • {filtersActive} filter{filtersActive === 1 ? '' : 's'} active
                    </span>
                  )}
                  {!isLoadingCases && debouncedSearch && (
                    <span className="ml-2 text-gray-500">• Search for “{debouncedSearch}”</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>Page size</span>
                    <Select value={String(pageSize)} onChange={handlePageSizeChange} className="w-24">
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handlePrevPage}
                      variant="secondary"
                      className="px-3 py-2"
                      disabled={!hasPreviousPage || isLoadingCases}
                    >
                      <ChevronLeft size={18} className="mr-1" /> Prev
                    </Button>
                    <span className="text-sm text-gray-600">
                      Page {Math.max(1, effectivePage)} of {Math.max(1, maxPage)}
                    </span>
                    <Button
                      onClick={handleNextPage}
                      variant="secondary"
                      className="px-3 py-2"
                      disabled={!hasNextPage || isLoadingCases}
                    >
                      Next <ChevronRight size={18} className="ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              {isLoadingCases
                ? renderSkeletons()
                : casesState.error
                ? renderErrorState()
                : casesState.items.length === 0
                ? renderEmptyState()
                : viewMode === 'table'
                ? renderCaseTable()
                : renderCaseCards()}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
