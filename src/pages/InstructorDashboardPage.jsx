import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, useModal, useUser } from '../AppCore';
import { ROLES } from '../constants/roles';
import { buildRosterData } from '../utils/rosterAggregator';
import { buildValueMetrics } from '../utils/managerDashboardData';
import { fetchBillingSummary, openBillingPortal } from '../services/billingService';
import InviteSeatsModal from '../components/instructor/InviteSeatsModal';

const TABS = [
  { id: 'people', label: 'People' },
  { id: 'value', label: 'Value' },
  { id: 'billing', label: 'Billing' },
];

const formatTimestamp = (value) => {
  if (!value) return '-';
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  return '-';
};

const formatDateInput = (value) => {
  if (!(value instanceof Date)) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildStartDate = (value) => {
  if (!value) return null;
  return new Date(`${value}T00:00:00`);
};

const buildEndDate = (value) => {
  if (!value) return null;
  return new Date(`${value}T23:59:59.999`);
};

const toMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
};

const formatScore = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${Math.round(value)}`;
};

const formatDelta = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
};

const STATUS_LABELS = {
  not_started: 'Not started',
  attempted: 'Attempted',
  completed: 'Completed',
};

export default function InstructorDashboardPage() {
  const navigate = useNavigate();
  const { showModal } = useModal();
  const { userProfile, role } = useUser();
  const [roster, setRoster] = useState([]);
  const [learners, setLearners] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [activeTab, setActiveTab] = useState('people');
  const [billingSummary, setBillingSummary] = useState(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return formatDateInput(start);
  });
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()));
  const canViewValueBilling = role === ROLES.OWNER || role === ROLES.ADMIN;
  const visibleTabs = useMemo(
    () => (canViewValueBilling ? TABS : TABS.filter((tab) => tab.id === 'people')),
    [canViewValueBilling]
  );

  useEffect(() => {
    let active = true;
    const loadRoster = async () => {
      if ((role !== ROLES.INSTRUCTOR && role !== ROLES.OWNER) || !userProfile?.orgId) {
        if (active) {
          setRoster([]);
          setLearners([]);
          setRosterLoading(false);
        }
        return;
      }
      setRosterLoading(true);
      setRosterError('');
      try {
        const { rosterRows, learners: learnerRows } = await buildRosterData({ orgId: userProfile.orgId });
        if (active) {
          setRoster(rosterRows);
          setLearners(learnerRows);
          setSelectedUserId((prev) => prev || rosterRows[0]?.userId || '');
        }
      } catch (err) {
        console.error('[InstructorDashboard] Failed to load roster', err);
        if (active) {
          setRoster([]);
          setLearners([]);
          setRosterError('Unable to load roster data. Please try again.');
        }
      } finally {
        if (active) setRosterLoading(false);
      }
    };

    loadRoster();
    return () => {
      active = false;
    };
  }, [role, userProfile]);

  useEffect(() => {
    let active = true;
    const loadBilling = async () => {
      if ((role !== ROLES.INSTRUCTOR && role !== ROLES.OWNER) || !userProfile?.orgId) {
        if (active) {
          setBillingSummary(null);
          setBillingLoading(false);
        }
        return;
      }
      setBillingLoading(true);
      setBillingError('');
      try {
        const summary = await fetchBillingSummary({ orgId: userProfile.orgId });
        if (active) {
          setBillingSummary(summary);
        }
      } catch (err) {
        console.error('[InstructorDashboard] Failed to load billing summary', err);
        if (active) {
          setBillingSummary(null);
          setBillingError('Unable to load billing summary. Please try again.');
        }
      } finally {
        if (active) setBillingLoading(false);
      }
    };

    loadBilling();
    return () => {
      active = false;
    };
  }, [role, userProfile]);

  const sortedRoster = useMemo(() => {
    return [...roster].sort((a, b) => {
      const aTime = toMillis(a.lastActiveAt) ?? 0;
      const bTime = toMillis(b.lastActiveAt) ?? 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.name.localeCompare(b.name);
    });
  }, [roster]);

  const selectedUser = useMemo(
    () => sortedRoster.find((row) => row.userId === selectedUserId) || null,
    [sortedRoster, selectedUserId]
  );

  useEffect(() => {
    if (!sortedRoster.length) return;
    if (!sortedRoster.find((row) => row.userId === selectedUserId)) {
      setSelectedUserId(sortedRoster[0].userId);
    }
  }, [sortedRoster, selectedUserId]);

  useEffect(() => {
    if (!canViewValueBilling && activeTab !== 'people') {
      setActiveTab('people');
    }
  }, [canViewValueBilling, activeTab]);

  const startDateValue = useMemo(() => buildStartDate(startDate), [startDate]);
  const endDateValue = useMemo(() => buildEndDate(endDate), [endDate]);
  const valueMetrics = useMemo(
    () => buildValueMetrics({ learners, startDate: startDateValue, endDate: endDateValue }),
    [learners, startDateValue, endDateValue]
  );

  const handleAddSeats = () => {
    showModal(<InviteSeatsModal />, 'Add seats', () => null);
  };

  const handleManageBilling = async () => {
    try {
      await openBillingPortal({ orgId: userProfile?.orgId });
    } catch (error) {
      showModal(error?.message || 'Billing portal unavailable.', 'Billing');
    }
  };

  if (role !== ROLES.INSTRUCTOR && role !== ROLES.OWNER) {
    return (
      <div className="p-6">
        <p>You do not have access to this dashboard.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Instructor Dashboard</h1>
          <p className="text-sm text-gray-600">People, value proof, and billing at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium border ${
                  isActive
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
          <Button onClick={() => navigate('/admin')} variant="secondary">
            Admin
          </Button>
        </div>
      </div>

      {activeTab === 'people' ? (
        <div className="bg-white p-6 rounded shadow">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">People</h2>
              <p className="text-sm text-gray-600">Roster and recent attempts.</p>
            </div>
          </div>
          {rosterLoading ? (
            <p>Loading roster...</p>
          ) : rosterError ? (
            <p className="text-sm text-red-600">{rosterError}</p>
          ) : sortedRoster.length === 0 ? (
            <p className="text-sm text-gray-600">No learners found for your organization.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
              <div className="overflow-x-auto border border-gray-200 rounded">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Learner
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Last Active
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Latest Module
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Score
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Delta Baseline
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedRoster.map((row) => {
                      const isSelected = row.userId === selectedUserId;
                      const delta = formatDelta(row.deltaFromBaseline);
                      return (
                        <tr
                          key={row.userId}
                          className={`cursor-pointer ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                          onClick={() => setSelectedUserId(row.userId)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{row.name}</div>
                            <div className="text-xs text-gray-500">{row.email}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{STATUS_LABELS[row.status] || row.status}</td>
                          <td className="px-4 py-3 text-gray-500">{formatTimestamp(row.lastActiveAt)}</td>
                          <td className="px-4 py-3 text-gray-700">{row.latestModule}</td>
                          <td className="px-4 py-3 text-gray-700">{formatScore(row.latestScore)}</td>
                          <td className="px-4 py-3 text-gray-700">{delta}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="border border-gray-200 rounded p-4 space-y-4">
                {selectedUser ? (
                  <>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wider">Selected Learner</p>
                      <p className="text-lg font-semibold text-gray-900">{selectedUser.name}</p>
                      <p className="text-sm text-gray-500">{selectedUser.email}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Status</p>
                        <p className="text-gray-900">{STATUS_LABELS[selectedUser.status] || selectedUser.status}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Last Active</p>
                        <p className="text-gray-900">{formatTimestamp(selectedUser.lastActiveAt)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Latest Module</p>
                        <p className="text-gray-900">{selectedUser.latestModule}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Latest Score</p>
                        <p className="text-gray-900">{formatScore(selectedUser.latestScore)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Delta Baseline</p>
                        <p className="text-gray-900">{formatDelta(selectedUser.deltaFromBaseline)}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Recent Attempts</p>
                      {selectedUser.recentAttempts.length === 0 ? (
                        <p className="text-sm text-gray-500">No attempts yet.</p>
                      ) : (
                        <ul className="space-y-2 text-sm">
                          {selectedUser.recentAttempts.map((attempt, index) => (
                            <li key={`${attempt.caseName}-${index}`} className="flex items-center justify-between">
                              <div>
                                <p className="font-medium text-gray-900">{attempt.caseName}</p>
                                <p className="text-xs text-gray-500">{formatTimestamp(attempt.date)}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-gray-900">{formatScore(attempt.score)}</p>
                                <p className="text-xs text-gray-500">{formatDelta(attempt.delta)}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Select a learner to see details.</p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === 'value' ? (
        <div className="bg-white p-6 rounded shadow">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Value proof</h2>
              <p className="text-sm text-gray-600">Usage and score movement.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <label htmlFor="value-start-date">From</label>
                <input
                  id="value-start-date"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="border border-gray-200 rounded px-2 py-1 text-sm"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <label htmlFor="value-end-date">To</label>
                <input
                  id="value-end-date"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="border border-gray-200 rounded px-2 py-1 text-sm"
                />
              </div>
            </div>
          </div>
          {rosterLoading ? (
            <p>Loading value proof...</p>
          ) : rosterError ? (
            <p className="text-sm text-red-600">{rosterError}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="border border-gray-200 rounded p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Active learners</p>
                <p className="text-2xl font-semibold text-gray-900">{valueMetrics.activeLearners}</p>
              </div>
              <div className="border border-gray-200 rounded p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Attempts</p>
                <p className="text-2xl font-semibold text-gray-900">{valueMetrics.attemptsCount}</p>
              </div>
              <div className="border border-gray-200 rounded p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Avg improvement</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {formatDelta(valueMetrics.avgImprovement)}
                </p>
              </div>
              <div className="border border-gray-200 rounded p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Critical issues rate</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {valueMetrics.criticalIssuesRate === null ? '-' : `${Math.round(valueMetrics.criticalIssuesRate * 100)}%`}
                </p>
              </div>
              <div className="border border-gray-200 rounded p-4 sm:col-span-2 lg:col-span-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Rushed attempts rate</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {valueMetrics.rushedAttemptsRate === null ? '-' : `${Math.round(valueMetrics.rushedAttemptsRate * 100)}%`}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === 'billing' ? (
        <div className="bg-white p-6 rounded shadow">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Billing</h2>
              <p className="text-sm text-gray-600">Plan, seats, and renewal status.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={handleManageBilling}>
                Manage billing
              </Button>
              <Button onClick={handleAddSeats}>Add seats</Button>
            </div>
          </div>
          {billingLoading ? (
            <p>Loading billing summary...</p>
          ) : billingError ? (
            <p className="text-sm text-red-600">{billingError}</p>
          ) : billingSummary ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="border border-gray-200 rounded p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Plan</p>
                  <p className="text-2xl font-semibold text-gray-900">{billingSummary.planName}</p>
                </div>
                <div className="border border-gray-200 rounded p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Seat count</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {billingSummary.seatCount ?? '-'}
                  </p>
                </div>
                <div className="border border-gray-200 rounded p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Renewal date</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {formatTimestamp(billingSummary.renewalDate)}
                  </p>
                </div>
                <div className="border border-gray-200 rounded p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Status</p>
                  <p className="text-2xl font-semibold text-gray-900">{billingSummary.status}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Billing summary not available.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
