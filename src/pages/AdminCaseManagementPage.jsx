import React, { useEffect, useMemo, useState } from 'react';
import { Button, useModal, useRoute } from '../AppCore';
import { subscribeToActiveCases, markCaseDeleted } from '../services/caseService';
import { getAuditAreaLabel, getCaseGroupLabel, getCaseLevelLabel } from '../models/caseConstants';

const formatTimestamp = (value) => {
  if (!value) return '—';
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const getVisibilityLabel = (caseData) => {
  if (caseData?.publicVisible === false) return 'Rostered';
  const rosterCount = Array.isArray(caseData?.visibleToUserIds) ? caseData.visibleToUserIds.length : 0;
  return rosterCount > 0 ? 'Rostered' : 'All trainees';
};

export default function AdminCaseManagementPage() {
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeToActiveCases(
      (list) => {
        setCases(list);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading cases:', error);
        showModal('Unable to load cases: ' + error.message, 'Error');
        setLoading(false);
      }
    );
    return () => unsubscribe?.();
  }, [showModal]);

  const filteredCases = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return cases;
    return cases.filter((caseData) => {
      const title = (caseData.title || caseData.caseName || '').toLowerCase();
      const id = (caseData.id || '').toLowerCase();
      const module = (caseData.moduleTitle || '').toLowerCase();
      return title.includes(term) || id.includes(term) || module.includes(term);
    });
  }, [cases, search]);

  const sortedCases = useMemo(() => {
    return [...filteredCases].sort((a, b) => {
      const aMillis = typeof a.updatedAt?.toMillis === 'function' ? a.updatedAt.toMillis() : 0;
      const bMillis = typeof b.updatedAt?.toMillis === 'function' ? b.updatedAt.toMillis() : 0;
      if (aMillis === bMillis) {
        return (a.title || a.caseName || '').localeCompare(b.title || b.caseName || '');
      }
      return bMillis - aMillis;
    });
  }, [filteredCases]);

  const handleDelete = async (caseId, caseTitle) => {
    const confirmed = window.confirm(
      `Delete "${caseTitle || caseId}"? This removes the case for trainees and requires a new attempt to be generated.`
    );
    if (!confirmed) return;
    try {
      await markCaseDeleted(caseId);
      showModal('Case deleted. Generate a new attempt from the recipe if needed.', 'Case Deleted');
    } catch (error) {
      console.error('Error deleting case:', error);
      showModal(error?.message || 'Unable to delete case.', 'Error');
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Case Management</h1>
            <p className="text-sm text-gray-500">Review all active cases and remove stale drafts.</p>
          </div>
          <Button onClick={() => navigate('/admin')} variant="secondary" className="text-sm">
            &larr; Back to Dashboard
          </Button>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-gray-600">
              Active cases: <span className="font-semibold text-gray-800">{filteredCases.length}</span>
            </div>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by case name, module, or ID"
              className="w-full md:w-80 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow p-6 text-center text-gray-600">Loading cases…</div>
        ) : sortedCases.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-10 text-center">
            <p className="text-gray-600">No active cases found.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-100 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">Case</th>
                  <th scope="col" className="px-4 py-3 text-left">Level</th>
                  <th scope="col" className="px-4 py-3 text-left">Audit Area</th>
                  <th scope="col" className="px-4 py-3 text-left">Group</th>
                  <th scope="col" className="px-4 py-3 text-left">Status</th>
                  <th scope="col" className="px-4 py-3 text-left">Updated</th>
                  <th scope="col" className="px-4 py-3 text-left">Visibility</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-700">
                {sortedCases.map((caseData) => {
                  const caseTitle = caseData.title || caseData.caseName || 'Untitled Case';
                  return (
                    <tr key={caseData.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{caseTitle}</div>
                        <div className="text-xs text-gray-500 break-all">{caseData.id}</div>
                      </td>
                      <td className="px-4 py-3">{getCaseLevelLabel(caseData.caseLevel)}</td>
                      <td className="px-4 py-3">{getAuditAreaLabel(caseData.auditArea)}</td>
                      <td className="px-4 py-3">{getCaseGroupLabel(caseData.caseGroupId)}</td>
                      <td className="px-4 py-3 capitalize">{caseData.status || 'assigned'}</td>
                      <td className="px-4 py-3">{formatTimestamp(caseData.updatedAt || caseData.createdAt)}</td>
                      <td className="px-4 py-3">{getVisibilityLabel(caseData)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            onClick={() => navigate(`/admin/case-overview/${caseData.id}`)}
                            variant="secondary"
                            className="text-xs"
                          >
                            Open
                          </Button>
                          <Button
                            onClick={() => navigate(`/admin/case-progress/${caseData.id}`)}
                            variant="secondary"
                            className="text-xs"
                          >
                            Progress
                          </Button>
                          <Button
                            onClick={() => navigate(`/admin/case-submissions/${caseData.id}`)}
                            variant="secondary"
                            className="text-xs"
                          >
                            Submissions
                          </Button>
                          <Button
                            onClick={() => handleDelete(caseData.id, caseTitle)}
                            variant="danger"
                            className="text-xs"
                          >
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
        )}
      </div>
    </div>
  );
}
