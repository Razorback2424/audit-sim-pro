import React, { useEffect, useMemo, useState } from 'react';
import { Button, useRoute, useModal } from '../AppCore';
import { subscribeToCases } from '../services/caseService';
import { analyzeCase, buildBackfillPlan } from '../dev/caseBackfill';

export default function AdminCaseDataAuditPage() {
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToCases(
      (list) => {
        setCases(list);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading cases for audit:', error);
        showModal('Unable to load case data: ' + error.message, 'Error');
        setLoading(false);
      }
    );
    return () => unsubscribe?.();
  }, [showModal]);

  const analyses = useMemo(() => cases.map(analyzeCase), [cases]);
  const issues = analyses.filter((entry) => entry.issues.length > 0);
  const backfillPlan = useMemo(() => buildBackfillPlan(cases), [cases]);

  if (loading) {
    return <div className="p-6">Running case data audit…</div>;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-800">Case Data Audit</h1>
          <Button onClick={() => navigate('/admin')} variant="secondary" className="text-sm">
            &larr; Back to Dashboard
          </Button>
        </div>

        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Summary</h2>
          <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
            <li>Total cases: {cases.length}</li>
            <li>Cases with issues: {issues.length}</li>
            <li>Backfill updates suggested: {backfillPlan.length}</li>
          </ul>
        </section>

        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Cases Requiring Attention</h2>
          {issues.length === 0 ? (
            <p className="text-sm text-gray-500">All case documents include required fields.</p>
          ) : (
            <div className="space-y-4">
              {issues.map((entry) => {
                const plan = backfillPlan.find((candidate) => candidate.id === entry.id);
                return (
                  <div key={entry.id} className="border border-amber-200 bg-amber-50 rounded-md p-4">
                    <p className="text-sm font-semibold text-amber-800">Case ID: {entry.id}</p>
                    <ul className="mt-2 text-sm text-amber-700 list-disc list-inside">
                      {entry.issues.map((issue, idx) => (
                        <li key={idx}>{issue}</li>
                      ))}
                    </ul>
                    {plan ? (
                      <div className="mt-3 text-xs text-gray-600">
                        <p className="font-semibold">Suggested updates:</p>
                        <pre className="bg-gray-100 rounded p-3 overflow-x-auto">{JSON.stringify(plan.updates, null, 2)}</pre>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Backfill Plan (dry-run)</h2>
          <p className="text-sm text-gray-600 mb-3">
            Use this output to perform manual updates via the Firebase console or a controlled script. Changes are not applied automatically.
          </p>
          <pre className="bg-gray-100 rounded p-4 text-xs overflow-x-auto">{JSON.stringify(backfillPlan, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}
