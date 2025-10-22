import React, { useEffect, useState } from 'react';
import { FilePlus, Edit3, ListFilter, Trash2 } from 'lucide-react';
import { Button, useRoute, useModal, useUser } from '../AppCore';
import {
  subscribeToCases,
  markCaseDeleted,
  repairLegacyCases,
  subscribeToAdminCaseSummary,
  subscribeToAdminCaseAlerts,
  subscribeToRecentCaseActivity,
} from '../services/caseService';
import { subscribeToRecentSubmissionActivity } from '../services/submissionService';
import AdvancedToolsMenu from '../components/admin/AdvancedToolsMenu';
import DashboardMetrics from '../components/admin/DashboardMetrics';
import SetupAlerts from '../components/admin/SetupAlerts';
import RecentActivity from '../components/admin/RecentActivity';
import QuickActions from '../components/admin/QuickActions';

export default function AdminDashboardPage() {
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const { role, loadingRole } = useUser();
  const [cases, setCases] = useState([]);
  const [loadingCases, setLoadingCases] = useState(true);
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
  const [showAllCases, setShowAllCases] = useState(false);
  const isAdmin = role === 'admin';

  useEffect(() => {
    const unsubscribe = subscribeToCases(
      (data) => {
        setCases(data);
        setLoadingCases(false);
      },
      (error) => {
        console.error('Error fetching cases: ', error);
        showModal('Error fetching cases: ' + error.message, 'Error');
        setLoadingCases(false);
      }
    );
    return () => unsubscribe();
  }, [showModal]);

  useEffect(() => {
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
  }, [showModal]);

  useEffect(() => {
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
  }, [showModal]);

  useEffect(() => {
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
      console.error('Error loading recent activity:', error);
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
  }, [showModal]);

  const handleRepairCases = async () => {
    if (repairingCases) return;
    try {
      setRepairingCases(true);
      const { repaired } = await repairLegacyCases();
      const message = repaired > 0 ? `${repaired} case${repaired === 1 ? '' : 's'} repaired.` : 'All cases already meet the required defaults.';
      showModal(message, 'Repair Complete');
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

  const activeCases = cases.filter((c) => !c._deleted);
  const displayedCases = showAllCases ? activeCases : activeCases.slice(0, 3);
  const hasMoreCases = activeCases.length > displayedCases.length;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
          <div className="flex items-center gap-3">
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
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          <DashboardMetrics summary={dashboardSummary} loading={loadingSummary} onNavigate={navigate} />
          <SetupAlerts alerts={alerts} loading={loadingAlerts} onNavigate={navigate} />
          <RecentActivity activity={recentActivity} loading={loadingActivity} onNavigate={navigate} />
          <QuickActions onNavigate={navigate} />
        </div>
        <section id="cases" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-gray-800">Cases</h2>
            {hasMoreCases && !showAllCases && (
              <button
                type="button"
                onClick={() => setShowAllCases(true)}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                See all cases
              </button>
            )}
          </div>
          {loadingCases ? (
            <div className="bg-white p-6 rounded-lg shadow animate-pulse space-y-3">
              <div className="h-6 w-1/3 bg-gray-200 rounded" />
              <div className="h-4 w-1/2 bg-gray-200 rounded" />
              <div className="h-4 w-2/3 bg-gray-200 rounded" />
            </div>
          ) : activeCases.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-lg shadow">
              <ListFilter size={48} className="mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600 text-xl">No active cases found.</p>
              <p className="text-gray-500 mt-2">Get started by creating a new audit case.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {displayedCases.map((caseData) => (
                <div key={caseData.id} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <h3 className="text-xl font-semibold text-blue-700">{caseData.caseName}</h3>
                      <p className="text-sm text-gray-500">ID: {caseData.id}</p>
                      <p className="text-sm text-gray-500">Disbursements: {caseData.disbursements?.length || 0}</p>
                      <p className="text-sm text-gray-500">Mappings: {caseData.invoiceMappings?.length || 0}</p>
                      <p className="text-sm text-gray-500">
                        Audience{' '}
                        {caseData.publicVisible === false && Array.isArray(caseData.visibleToUserIds) && caseData.visibleToUserIds.length > 0
                          ? `${caseData.visibleToUserIds.length} rostered user(s)`
                          : 'All signed-in trainees'}
                      </p>
                      <p className="text-sm text-gray-500">Status: {caseData.status || 'assigned'}</p>
                    </div>
                    <div className="flex flex-col space-y-2 items-end">
                      <Button onClick={() => navigate(`/admin/case-overview/${caseData.id}`)} variant="secondary" className="px-3 py-1 text-sm w-full">
                        <Edit3 size={16} className="inline mr-1" /> View Case
                      </Button>
                      <Button onClick={() => navigate(`/admin/case-submissions/${caseData.id}`)} variant="secondary" className="px-3 py-1 text-sm w-full">
                        <ListFilter size={16} className="inline mr-1" /> View Submissions
                      </Button>
                      <Button onClick={() => navigate(`/admin/edit-case/${caseData.id}`)} variant="secondary" className="px-3 py-1 text-sm w-full">
                        <Edit3 size={16} className="inline mr-1" /> Edit Case
                      </Button>
                      <Button onClick={() => deleteCase(caseData.id)} variant="danger" className="px-3 py-1 text-sm w-full">
                        <Trash2 size={16} className="inline mr-1" /> Delete Case
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {!showAllCases && hasMoreCases && (
                <button
                  type="button"
                  onClick={() => setShowAllCases(true)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  See all {activeCases.length} cases
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
