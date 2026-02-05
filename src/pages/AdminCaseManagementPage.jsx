import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, useModal, useRoute } from '../AppCore';
import { fetchCasesPage, CASE_SORT_OPTIONS, markCaseDeleted } from '../services/caseService';
import { getAuditAreaLabel, getCaseGroupLabel, getCaseLevelLabel } from '../models/caseConstants';

const PAGE_SIZE = 25;

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
  const [selectedCaseIds, setSelectedCaseIds] = useState(() => new Set());
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState({});
  const [pageInfo, setPageInfo] = useState({ hasNext: false, hasPrev: false, firstDoc: null, lastDoc: null });

  const loadCases = useCallback(async ({ direction = 'next', cursor = null, nextIndex } = {}) => {
    setLoading(true);
    try {
      const result = await fetchCasesPage({
        search,
        sort: CASE_SORT_OPTIONS.UPDATED_DESC,
        pageSize: PAGE_SIZE,
        cursor,
        direction,
      });
      setCases(result.items || []);
      setPageInfo(result.pageInfo || { hasNext: false, hasPrev: false, firstDoc: null, lastDoc: null });
      setPageCursors((prev) => ({
        ...prev,
        [nextIndex ?? pageIndex]: {
          firstDoc: result.pageInfo?.firstDoc ?? null,
          lastDoc: result.pageInfo?.lastDoc ?? null,
        },
      }));
    } catch (error) {
      console.error('Error loading cases:', error);
      showModal('Unable to load cases: ' + error.message, 'Error');
    } finally {
      setLoading(false);
    }
  }, [pageIndex, search, showModal]);

  useEffect(() => {
    setPageIndex(0);
    setPageCursors({});
    loadCases({ direction: 'next', cursor: null, nextIndex: 0 });
  }, [loadCases, search]);

  const filteredCases = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return cases;
    return cases.filter((caseData) => {
      const title = (caseData.title || caseData.caseName || '').toLowerCase();
      return title.includes(term);
    });
  }, [cases, search]);

  const sortedCases = useMemo(() => filteredCases, [filteredCases]);

  const displayedCaseIds = useMemo(() => sortedCases.map((entry) => entry.id), [sortedCases]);
  const allDisplayedSelected =
    displayedCaseIds.length > 0 && displayedCaseIds.every((id) => selectedCaseIds.has(id));
  const selectedCount = selectedCaseIds.size;

  useEffect(() => {
    setSelectedCaseIds(new Set());
  }, [pageIndex, search, cases]);

  const handleNextPage = () => {
    if (!pageInfo.hasNext || loading) return;
    const nextIndex = pageIndex + 1;
    loadCases({
      direction: 'next',
      cursor: { lastDoc: pageInfo.lastDoc },
      nextIndex,
    });
    setPageIndex(nextIndex);
  };

  const handlePrevPage = () => {
    if (!pageInfo.hasPrev || loading) return;
    const nextIndex = Math.max(0, pageIndex - 1);
    loadCases({
      direction: 'prev',
      cursor: { firstDoc: pageInfo.firstDoc },
      nextIndex,
    });
    setPageIndex(nextIndex);
  };

  const toggleSelectAll = () => {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      if (allDisplayedSelected) {
        displayedCaseIds.forEach((id) => next.delete(id));
      } else {
        displayedCaseIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleSelectCase = (caseId) => {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) {
        next.delete(caseId);
      } else {
        next.add(caseId);
      }
      return next;
    });
  };

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

  const handleBulkDelete = async () => {
    if (selectedCaseIds.size === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedCaseIds.size} selected case${selectedCaseIds.size === 1 ? '' : 's'}? This removes the cases for trainees and requires new attempts to be generated.`
    );
    if (!confirmed) return;
    try {
      const results = await Promise.allSettled(
        Array.from(selectedCaseIds).map((caseId) => markCaseDeleted(caseId))
      );
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length > 0) {
        console.error('Error deleting cases:', failed);
        showModal(
          `${failed.length} case${failed.length === 1 ? '' : 's'} failed to delete. Check logs for details.`,
          'Bulk Delete Incomplete'
        );
      } else {
        showModal(
          `Deleted ${selectedCaseIds.size} case${selectedCaseIds.size === 1 ? '' : 's'}. Generate new attempts as needed.`,
          'Cases Deleted'
        );
      }
      setSelectedCaseIds(new Set());
    } catch (error) {
      console.error('Error deleting cases:', error);
      showModal(error?.message || 'Unable to delete cases.', 'Error');
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
              Cases shown: <span className="font-semibold text-gray-800">{filteredCases.length}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleBulkDelete}
                variant="danger"
                className="text-sm"
                disabled={selectedCount === 0}
              >
                Delete Selected ({selectedCount})
              </Button>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by case name"
                className="w-full md:w-80 border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
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
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 text-sm text-gray-600">
              <div>
                Page <span className="font-semibold text-gray-800">{pageIndex + 1}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handlePrevPage} variant="secondary" className="text-sm" disabled={!pageInfo.hasPrev || loading}>
                  Prev
                </Button>
                <Button onClick={handleNextPage} variant="secondary" className="text-sm" disabled={!pageInfo.hasNext || loading}>
                  Next
                </Button>
              </div>
            </div>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-100 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      className="h-4 w-4 text-blue-600"
                      checked={allDisplayedSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all cases"
                    />
                  </th>
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
                  const isSelected = selectedCaseIds.has(caseData.id);
                  return (
                    <tr key={caseData.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 text-blue-600"
                          checked={isSelected}
                          onChange={() => toggleSelectCase(caseData.id)}
                          aria-label={`Select ${caseTitle}`}
                        />
                      </td>
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
