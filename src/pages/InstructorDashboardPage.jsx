import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, useUser } from '../AppCore';
import { fetchCasesPage } from '../services/caseService';
import { ROLES } from '../constants/roles';

export default function InstructorDashboardPage() {
  const navigate = useNavigate();
  const { userProfile, role } = useUser();
  const [myCases, setMyCases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (role !== ROLES.INSTRUCTOR || !userProfile?.orgId) {
        setLoading(false);
        return;
      }
      try {
        const results = await fetchCasesPage({ orgId: userProfile.orgId, limit: 25 });
        if (active) {
          setMyCases(Array.isArray(results?.items) ? results.items : []);
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[InstructorDashboard] Failed to load cases', err);
        }
        if (active) {
          setMyCases([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [role, userProfile]);

  if (role !== ROLES.INSTRUCTOR) {
    return (
      <div className="p-6">
        <p>You do not have access to this dashboard.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Instructor Dashboard</h1>
          <p className="text-sm text-gray-600">Manage cases and progress for your organization.</p>
        </div>
        <Button onClick={() => navigate('/instructor/create-case')}>Create New Case</Button>
      </div>

      <div className="bg-white p-6 rounded shadow">
        <h2 className="text-lg font-semibold mb-4">My Org Cases</h2>
        {loading ? (
          <p>Loading cases...</p>
        ) : myCases.length === 0 ? (
          <p>No cases found for your organization.</p>
        ) : (
          <ul className="divide-y">
            {myCases.map((caseItem) => (
              <li key={caseItem.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{caseItem.caseName || caseItem.title}</p>
                  <p className="text-sm text-gray-500">
                    Status: {caseItem.status || 'unknown'} · Audit Area:{' '}
                    {caseItem.auditArea || 'general'}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => navigate(`/instructor/case/${caseItem.id}`)}>
                  Manage
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
