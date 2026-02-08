import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ListFilter,
  List,
  Search,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  Inbox,
} from 'lucide-react';
import { Button, Input, Select, useRoute, useModal, useUser } from '../AppCore';
import {
  repairLegacyCases,
  subscribeToAdminCaseSummary,
  subscribeToAdminCaseAlerts,
  subscribeToRecentCaseActivity,
  fetchCasesPage,
  CASE_SORT_CHOICES,
  DEFAULT_CASE_SORT,
} from '../services/caseService';
import { auditOrphanedInvoices } from '../services/storageAuditService';
import { subscribeToRecentSubmissionActivity } from '../services/submissionService';
import { fetchUsersWithProfiles } from '../services/userService';
import { listCaseRecipes } from '../generation/recipeRegistry';
import { fetchRecipe } from '../services/recipeService';
import { seedCasePool } from '../services/attemptService';
import { fetchDemoConfig, setDemoCase } from '../services/demoService';
import AdvancedToolsMenu from '../components/admin/AdvancedToolsMenu';
import DashboardMetrics from '../components/admin/DashboardMetrics';
import SetupAlerts from '../components/admin/SetupAlerts';
import RecentActivity from '../components/admin/RecentActivity';
import QuickActions from '../components/admin/QuickActions';
import { AUDIT_AREA_VALUES, getCaseLevelLabel } from '../models/caseConstants';

const STATUS_OPTIONS = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'archived', label: 'Archived' },
  { value: 'draft', label: 'Draft' },
];

const VIEW_OPTIONS = [
  { id: 'grid', label: 'Card view', Icon: LayoutGrid },
  { id: 'list', label: 'List view', Icon: List },
];

const PAGE_SIZE_OPTIONS = [6, 12, 24, 48];

const TIER_LABELS = {
  foundations: 'Basics',
  core: 'Core',
  advanced: 'Advanced',
};

const humanizeToken = (value = '') =>
  value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const formatTierLabel = (tier) => TIER_LABELS[tier] || humanizeToken(tier) || 'Tier';
const formatPathLabel = (pathId) => humanizeToken(pathId) || 'Path';
const formatLevelLabel = (caseLevel, tier) =>
  caseLevel ? getCaseLevelLabel(caseLevel) : formatTierLabel(tier);

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

const isRecipeConfigured = (detail) => {
  const instruction = detail?.instruction || {};
  const gateOptions = Array.isArray(instruction?.gateCheck?.options)
    ? instruction.gateCheck.options
    : [];
  const hasGateQuestion = typeof instruction?.gateCheck?.question === 'string' && instruction.gateCheck.question.trim();
  const hasCorrectOption = gateOptions.some((opt) => opt && (opt.correct || opt.isCorrect));
  const videoValue =
    typeof instruction?.visualAsset?.source_id === 'string'
      ? instruction.visualAsset.source_id.trim()
      : typeof instruction?.visualAsset?.url === 'string'
      ? instruction.visualAsset.url.trim()
      : '';
  return Boolean(hasGateQuestion && gateOptions.length > 0 && hasCorrectOption && videoValue);
};

export default function AdminDashboardPage() {
  const { navigate, query, setQuery } = useRoute();
  const { showModal } = useModal();
  const { role, loadingRole } = useUser();
  const [refreshToken, setRefreshToken] = useState(0);
  const [repairingCases, setRepairingCases] = useState(false);
  const [auditingOrphanedInvoices, setAuditingOrphanedInvoices] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState({
    activeCases: 0,
    totalDisbursements: 0,
    totalMappings: 0,
    privateAudiences: 0,
    registeredUsers: 0,
    draftCases: 0,
    restrictedCases: 0,
    auditAreaCounts: {},
  });
  const [alerts, setAlerts] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [recipeDetails, setRecipeDetails] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [seedingRecipeIds, setSeedingRecipeIds] = useState(() => new Set());
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [casesState, setCasesState] = useState({
    loading: true,
    error: null,
    items: [],
    pageInfo: {
      firstDoc: null,
      lastDoc: null,
      hasNext: false,
      hasPrev: false,
    },
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState([]);
  const [demoConfig, setDemoConfig] = useState(null);
  const [demoCaseId, setDemoCaseId] = useState('');
  const [demoError, setDemoError] = useState('');
  const [settingDemo, setSettingDemo] = useState(false);
  const [demoBackfillPaid, setDemoBackfillPaid] = useState(true);
  const [demoQueueDocs, setDemoQueueDocs] = useState(true);
  const [searchInput, setSearchInput] = useState(() => (query?.search ?? '').trim());
  const [debouncedSearch, setDebouncedSearch] = useState(() => (query?.search ?? '').trim());
  const [viewMode, setViewMode] = useState(() => {
    try {
      const stored = window.localStorage.getItem('auditsim.adminDashboard.viewMode');
      return stored === 'list' ? 'list' : 'grid';
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
  const prevPageIndexRef = useRef(0);
  const isAdmin = role === 'admin' || role === 'owner';

  useEffect(() => {
    let active = true;
    setDemoError('');
    fetchDemoConfig()
      .then((config) => {
        if (!active) return;
        setDemoConfig(config);
        if (typeof config?.caseId === 'string' && config.caseId.trim()) {
          setDemoCaseId(config.caseId.trim());
        }
      })
      .catch((err) => {
        if (!active) return;
        setDemoError(err?.message || 'Unable to load demo configuration.');
      });
    return () => {
      active = false;
    };
  }, [refreshToken]);

  const handleSetDemoCase = useCallback(async () => {
    const trimmed = demoCaseId.trim();
    if (!trimmed) {
      showModal('Enter a demo case ID first.', 'Missing demo case');
      return;
    }
    if (settingDemo) return;
    setSettingDemo(true);
    setDemoError('');
    try {
      const result = await setDemoCase({
        caseId: trimmed,
        backfillPaid: demoBackfillPaid,
        queueDocuments: demoQueueDocs,
      });
      const config = await fetchDemoConfig();
      setDemoConfig(config);
      const updatedCount = result?.updatedCount ?? 0;
      const generationStatus = result?.generationStatus;
      const extraNote =
        generationStatus === 'missing-plan'
          ? ' (No generation plan found for demo case.)'
          : generationStatus === 'ready'
          ? ' (Artifacts already ready.)'
          : generationStatus
          ? ` (Generation: ${generationStatus})`
          : '';
      showModal(
        `Demo case set. Updated ${updatedCount} case${updatedCount === 1 ? '' : 's'}.${extraNote}`,
        'Demo updated'
      );
      setRefreshToken((value) => value + 1);
    } catch (err) {
      const message = err?.message || 'Failed to set demo case.';
      const code = err?.code ? ` (${err.code})` : '';
      const details = err?.details ? ` ${typeof err.details === 'string' ? err.details : JSON.stringify(err.details)}` : '';
      const fullMessage = `${message}${code}${details}`;
      setDemoError(fullMessage);
      showModal(fullMessage, 'Demo update failed');
    } finally {
      setSettingDemo(false);
    }
  }, [demoCaseId, demoBackfillPaid, demoQueueDocs, settingDemo, showModal]);
  const handleSeedPool = useCallback(
    async ({ moduleId, count }) => {
      if (!moduleId) return;
      if (seedingRecipeIds.has(moduleId)) return;
      setSeedingRecipeIds((prev) => {
        const next = new Set(prev);
        next.add(moduleId);
        return next;
      });
      try {
        const result = await seedCasePool({ moduleId, count });
        const createdCount = Number(result?.created || 0);
        showModal(
          `Seeded ${createdCount || count} case${createdCount === 1 ? '' : 's'} for this recipe.`,
          'Case pool seeded'
        );
      } catch (err) {
        console.error('[AdminDashboard] Failed to seed case pool', err);
        showModal(err?.message || 'Unable to seed the case pool.', 'Seeding error');
      } finally {
        setSeedingRecipeIds((prev) => {
          const next = new Set(prev);
          next.delete(moduleId);
          return next;
        });
      }
    },
    [seedingRecipeIds, showModal]
  );
  const handleNavigate = useCallback(
    (target) => {
      if (!target || typeof target !== 'string') return;

      const hashIndex = target.indexOf('#');
      if (hashIndex === -1) {
        navigate(target);
        return;
      }

      const base = target.slice(0, hashIndex) || window.location.pathname + window.location.search;
      const hash = target.slice(hashIndex + 1);

      navigate(base);
      window.setTimeout(() => {
        const elementId = decodeURIComponent(hash);
        const el = document.getElementById(elementId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        if (base) {
          window.history.replaceState(null, '', `${base}#${hash}`);
        }
      }, 0);
    },
    [navigate]
  );
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

  const auditAreaFilter = useMemo(() => {
    const raw = (query?.auditArea ?? '').trim();
    return AUDIT_AREA_VALUES.includes(raw) ? raw : '';
  }, [query?.auditArea]);

  const sortOption = useMemo(() => {
    if (!query?.sort) return DEFAULT_CASE_SORT;
    const valid = CASE_SORT_CHOICES.find((option) => option.value === query.sort);
    return valid ? valid.value : DEFAULT_CASE_SORT;
  }, [query?.sort]);


  const filterSignature = useMemo(
    () =>
      JSON.stringify({
        search: debouncedSearch,
        statusFilters,
        visibilityFilters,
        auditAreaFilter,
        sortOption,
        pageSize,
      }),
    [debouncedSearch, statusFilters, visibilityFilters, auditAreaFilter, sortOption, pageSize]
  );

  useEffect(() => {
    setPageIndex(0);
    setPageCursors([]);
    prevPageIndexRef.current = 0;
  }, [filterSignature]);

  useEffect(() => {
    let isActive = true;
    setCasesState((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }));

    const loadCases = async () => {
      try {
        const direction =
          pageIndex > prevPageIndexRef.current ? 'next' : pageIndex < prevPageIndexRef.current ? 'prev' : 'next';
        const cursor =
          direction === 'next'
            ? pageIndex > 0
              ? pageCursors[pageIndex - 1]
              : null
            : pageCursors[pageIndex + 1] || pageCursors[pageIndex] || null;
        const result = await fetchCasesPage({
          search: debouncedSearch,
          status: statusFilters,
          visibility: visibilityFilters,
          auditArea: auditAreaFilter || undefined,
          sort: sortOption,
          pageSize,
          cursor,
          direction,
        });
        if (!isActive) return;
        setCasesState({
          loading: false,
          error: null,
          items: result.items,
          pageInfo: result.pageInfo,
        });
        setPageCursors((prev) => {
          const next = [...prev];
          next[pageIndex] = {
            firstDoc: result.pageInfo?.firstDoc || null,
            lastDoc: result.pageInfo?.lastDoc || null,
          };
          return next;
        });
        prevPageIndexRef.current = pageIndex;
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
    pageIndex,
    refreshToken,
    filterSignature,
  ]);

  useEffect(() => {
    if (loadingRole || !isAdmin) {
      if (!loadingRole) {
        setLoadingSummary(false);
      }
      return;
    }

    setLoadingSummary(true);
    const unsubscribe = subscribeToAdminCaseSummary(
      (data) => {
        setDashboardSummary((prev) => ({ ...prev, ...data }));
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
  }, [showModal, role, loadingRole, isAdmin]);

  useEffect(() => {
    if (loadingRole || !isAdmin) {
      if (!loadingRole) {
        setRecipesLoading(false);
      }
      return;
    }
    let cancelled = false;
    const loadRecipeDetails = async () => {
      try {
        setRecipesLoading(true);
        const coded = listCaseRecipes();
        const entries = await Promise.all(
          coded.map(async (recipe) => {
            const detail = await fetchRecipe(recipe.id).catch(() => null);
            return {
              ...recipe,
              detail,
              isConfigured: isRecipeConfigured(detail),
              recipeVersion: detail?.recipeVersion || recipe.version || 1,
            };
          })
        );
        if (!cancelled) {
          setRecipeDetails(entries);
        }
      } catch (error) {
        console.error('Error loading recipe details:', error);
        if (!cancelled) {
          setRecipeDetails([]);
        }
      } finally {
        if (!cancelled) {
          setRecipesLoading(false);
        }
      }
    };
    loadRecipeDetails();
    return () => {
      cancelled = true;
    };
  }, [loadingRole, role, isAdmin]);

  useEffect(() => {
    if (loadingRole || !isAdmin) {
      if (!loadingRole) {
        setLoadingUsers(false);
      }
      return;
    }

    let cancelled = false;
    setLoadingUsers(true);
    fetchUsersWithProfiles()
      .then((users) => {
        if (cancelled) return;
        setDashboardSummary((prev) => ({ ...prev, registeredUsers: Array.isArray(users) ? users.length : 0 }));
        setLoadingUsers(false);
      })
      .catch((error) => {
        console.error('Error loading registered users:', error);
        showModal('Error loading registered users: ' + (error?.message || 'Please try again.'), 'Error');
        if (!cancelled) {
          setLoadingUsers(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showModal, role, loadingRole, isAdmin]);

  useEffect(() => {
    if (loadingRole || !isAdmin) {
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
  }, [showModal, role, loadingRole, isAdmin]);

  useEffect(() => {
    if (loadingRole || !isAdmin) {
      return;
    }

    setLoadingActivity(true);
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
        updateActivity();
      },
      handleError,
      { limit: 5 }
    );

    return () => {
      if (typeof unsubscribeCases === 'function') {
        unsubscribeCases();
      }
      if (typeof unsubscribeSubmissions === 'function') {
        unsubscribeSubmissions();
      }
    };
  }, [showModal, role, loadingRole, isAdmin]);

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

  const handleAuditOrphanedInvoices = async () => {
    if (auditingOrphanedInvoices) return;
    setAuditingOrphanedInvoices(true);
    try {
      const result = await auditOrphanedInvoices({ deleteFiles: false, sampleSize: 8 });
      const totalFiles = result?.totalFiles ?? 0;
      const orphanedCount = result?.orphanedCount ?? 0;
      const orphanedSample = Array.isArray(result?.orphanedSample) ? result.orphanedSample : [];

      if (orphanedCount === 0) {
        showModal(
          `No orphaned invoices found. ${totalFiles} invoice file${totalFiles === 1 ? '' : 's'} scanned.`,
          'Storage Check Complete'
        );
        return;
      }

      showModal(
        <>
          <p className="text-gray-700">
            Found {orphanedCount} orphaned invoice file{orphanedCount === 1 ? '' : 's'} out of {totalFiles}{' '}
            scanned. These are invoices not tied to an active or draft case.
          </p>
          {orphanedSample.length > 0 && (
            <ul className="mt-3 max-h-40 overflow-auto text-xs text-gray-600 space-y-1">
              {orphanedSample.map((path) => (
                <li key={path} className="truncate">
                  {path}
                </li>
              ))}
              {orphanedCount > orphanedSample.length && (
                <li>…and {orphanedCount - orphanedSample.length} more.</li>
              )}
            </ul>
          )}
          <p className="mt-3 text-sm text-gray-600">Delete these orphaned invoices now?</p>
        </>,
        'Orphaned Invoices Found',
        (hideModal) => (
          <>
            <Button onClick={hideModal} variant="secondary">
              Cancel
            </Button>
            <Button
              onClick={async () => {
                hideModal();
                setAuditingOrphanedInvoices(true);
                try {
                  const cleanup = await auditOrphanedInvoices({ deleteFiles: true, sampleSize: 0 });
                  const deletedCount = cleanup?.deletedCount ?? 0;
                  showModal(
                    `${deletedCount} orphaned invoice file${deletedCount === 1 ? '' : 's'} deleted.`,
                    'Cleanup Complete'
                  );
                } catch (error) {
                  console.error('Error deleting orphaned invoices:', error);
                  showModal(error?.message || 'Unable to delete orphaned invoices.', 'Error');
                } finally {
                  setAuditingOrphanedInvoices(false);
                }
              }}
              variant="danger"
              className="ml-2"
            >
              Delete orphaned invoices
            </Button>
          </>
        )
      );
    } catch (error) {
      console.error('Error auditing orphaned invoices:', error);
      showModal(error?.message || 'Unable to audit orphaned invoices.', 'Error');
    } finally {
      setAuditingOrphanedInvoices(false);
    }
  };

  const effectivePage = pageIndex + 1;
  const effectivePageSize = pageSize;
  const showingFrom = casesState.items.length === 0 ? 0 : pageIndex * effectivePageSize + 1;
  const showingTo = casesState.items.length === 0 ? 0 : pageIndex * effectivePageSize + casesState.items.length;
  const hasNextPage = casesState.pageInfo?.hasNext;
  const hasPreviousPage = casesState.pageInfo?.hasPrev;
  const isLoadingCases = casesState.loading;
  const filtersActive = statusFilters.length + visibilityFilters.length + (auditAreaFilter ? 1 : 0);

  const toggleStatusFilter = (value) => {
    const current = new Set(statusFilters);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    const next = Array.from(current);
    setPageIndex(0);
    setPageCursors([]);
    setQuery(
      {
        status: next.length ? next.join(',') : undefined,
        page: '1',
      },
      { replace: false }
    );
  };

  const clearFilters = () => {
    setPageIndex(0);
    setPageCursors([]);
    setQuery(
      {
        status: undefined,
        visibility: undefined,
        auditArea: undefined,
        page: '1',
      },
      { replace: false }
    );
  };

  const handleSortChange = (event) => {
    const { value } = event.target;
    setPageIndex(0);
    setPageCursors([]);
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
    setPageIndex(0);
    setPageCursors([]);
    setQuery({ page: '1' }, { replace: true });
  };

  const goToPage = (pageNumber) => {
    const clamped = Math.max(pageNumber, 1);
    if (clamped === effectivePage) return;
    setPageIndex(clamped - 1);
    setQuery({ page: String(clamped) }, { replace: true });
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
            : 'Trainee attempts will appear here once they start modules.'}
        </p>
      </div>
      <div className="flex justify-center gap-2">
        {(debouncedSearch || filtersActive) && (
          <Button onClick={clearFilters} variant="secondary">Clear filters</Button>
        )}
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
              <Button onClick={() => navigate(`/admin/case-submissions/${caseData.id}`)} variant="secondary" className="justify-center">
                <ListFilter size={16} className="mr-2" /> View submissions
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderCaseList = () => (
    <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
      <div className="grid grid-cols-[4fr_2fr_3fr_2fr_2.5fr] items-center gap-3 px-4 py-3 text-xs uppercase tracking-wide text-gray-500">
        <span>Attempt</span>
        <span>Status</span>
        <span>Audience</span>
        <span>Updated</span>
        <span className="text-right">Actions</span>
      </div>
      {casesState.items.map((caseData) => {
        const statusLabel = getStatusLabel(caseData.status);
        const audienceLabel = getAudienceLabel(caseData);
        const updatedLabel = formatDateLabel(caseData.updatedAt || caseData.createdAt);
        const caseAlerts = alertsByCaseId.get(caseData.id) || [];
        const hasAlerts = caseAlerts.length > 0;
        return (
          <div
            key={caseData.id}
            className={`grid grid-cols-[4fr_2fr_3fr_2fr_2.5fr] items-center gap-3 px-4 py-3 ${
              hasAlerts ? 'bg-amber-50' : 'bg-white'
            }`}
          >
            <div>
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
            </div>
            <div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusBadgeClass(caseData.status)}`}>
                {statusLabel}
              </span>
            </div>
            <div className="text-sm text-gray-700">{audienceLabel}</div>
            <div className="text-sm text-gray-700">{updatedLabel}</div>
            <div className="flex items-center justify-end gap-2 flex-nowrap">
              <Button onClick={() => navigate(`/admin/case-submissions/${caseData.id}`)} variant="secondary" className="px-3 py-1 text-xs">
                Submissions
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => navigate('/admin/beta')}>
              Beta dashboard
            </Button>
            <AdvancedToolsMenu
              canAccess={isAdmin}
              loadingAccess={loadingRole}
              onNavigateUserManagement={() => navigate('/admin/user-management')}
              onNavigateDataAudit={() => navigate('/admin/case-data-audit')}
              onNavigateEntitlementDebug={() => navigate('/admin/entitlement-debug')}
              onRepairCases={handleRepairCases}
              isRepairingCases={repairingCases}
              onAuditOrphanedInvoices={handleAuditOrphanedInvoices}
              isAuditingOrphanedInvoices={auditingOrphanedInvoices}
            />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <DashboardMetrics summary={dashboardSummary} loading={loadingSummary || loadingUsers} onNavigate={handleNavigate} />
          <SetupAlerts alerts={alerts} loading={loadingAlerts} onNavigate={handleNavigate} />
          <RecentActivity activity={recentActivity} loading={loadingActivity} onNavigate={handleNavigate} />
          <QuickActions onNavigate={handleNavigate} />
        </div>
        <section id="recipe-seeding" className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-800">Recipes & case pool</h2>
              <p className="text-sm text-gray-600">
                Configure instruction and seed the initial case pool for each recipe.
              </p>
            </div>
          </div>
          {recipesLoading ? (
            <div className="text-sm text-gray-500">Loading recipe details…</div>
          ) : recipeDetails.length === 0 ? (
            <div className="text-sm text-gray-500">No coded recipes found.</div>
          ) : (
            <div className="space-y-3">
              {recipeDetails.map((recipe) => (
                <div
                  key={recipe.id}
                  className={`flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${
                    recipe.isConfigured ? 'border-gray-200 bg-white' : 'border-rose-200 bg-rose-50'
                  }`}
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {recipe.moduleTitle || recipe.label || recipe.id}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatPathLabel(recipe.pathId)} · {formatLevelLabel(recipe.caseLevel, recipe.tier)} · {recipe.auditArea || 'area'}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">v{recipe.recipeVersion || 1}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => navigate(`/admin/edit-recipe/${recipe.id}`)}
                    >
                      {recipe.isConfigured ? 'Edit details' : 'Add details'}
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => handleSeedPool({ moduleId: recipe.id, count: 10 })}
                      isLoading={seedingRecipeIds.has(recipe.id)}
                    >
                      Seed 10 cases
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => handleSeedPool({ moduleId: recipe.id, count: 1 })}
                      isLoading={seedingRecipeIds.has(recipe.id)}
                    >
                      Seed 1
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section id="demo-setup" className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 space-y-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold text-gray-800">Demo setup</h2>
            <p className="text-sm text-gray-600">
              Pick exactly one public demo case. All other cases will be marked paid if backfill is enabled.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700" htmlFor="demo-case-id">
                Demo case ID
              </label>
              <Input
                id="demo-case-id"
                value={demoCaseId}
                onChange={(event) => setDemoCaseId(event.target.value)}
                placeholder="Paste a case ID"
                list="demo-case-options"
              />
              <datalist id="demo-case-options">
                {casesState.items.map((caseData) => (
                  <option key={caseData.id} value={caseData.id}>
                    {caseData.caseName || caseData.title || caseData.id}
                  </option>
                ))}
              </datalist>
              <div className="text-xs text-gray-500">
                Current demo: {demoConfig?.caseId || 'Not configured'}
                {demoConfig?.caseName ? ` · ${demoConfig.caseName}` : ''}
              </div>
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={demoBackfillPaid}
                  onChange={(event) => setDemoBackfillPaid(event.target.checked)}
                />
                Backfill all other cases to accessLevel=paid
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={demoQueueDocs}
                  onChange={(event) => setDemoQueueDocs(event.target.checked)}
                />
                Queue document generation for the demo case
              </label>
              <Button onClick={handleSetDemoCase} isLoading={settingDemo}>
                Set demo case
              </Button>
              {demoError ? (
                <p className="text-xs text-rose-600">{demoError}</p>
              ) : null}
            </div>
          </div>
        </section>
        <section id="cases" className="space-y-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-semibold text-gray-800">Attempts</h2>
              <p className="text-sm text-gray-600">Review trainee attempts generated from coded recipes.</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6 space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <form onSubmit={(event) => event.preventDefault()} className="relative w-full lg:max-w-md">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    type="search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Search attempts by name or ID"
                    className="pl-10"
                    aria-label="Search attempts"
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      Bulk actions are disabled for generated attempts.
                    </span>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
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
              </div>
              {filtersActive > 0 && (
                <div className="flex justify-end">
                  <Button onClick={clearFilters} variant="secondary" className="text-sm">
                    Clear filters
                  </Button>
                </div>
              )}
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-t border-gray-100 pt-4">
                <div className="text-sm text-gray-600">
                  {isLoadingCases
                    ? 'Loading cases…'
                    : casesState.items.length === 0
                    ? 'No cases to display'
                    : `Showing ${showingFrom}–${showingTo} cases`}
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
                    <span className="text-sm text-gray-600">Page {Math.max(1, effectivePage)}</span>
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
                : viewMode === 'list'
                ? renderCaseList()
                : renderCaseCards()}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
