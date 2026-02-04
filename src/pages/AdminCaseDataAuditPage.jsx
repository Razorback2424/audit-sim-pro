import React from 'react';
import { Button, useRoute } from '../AppCore';

export default function AdminCaseDataAuditPage() {
  const { navigate } = useRoute();

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-800">Case Data Audit</h1>
          <Button onClick={() => navigate('/admin')} variant="secondary" className="text-sm">
            &larr; Back to Dashboard
          </Button>
        </div>

        <section className="bg-white rounded-lg shadow p-6 space-y-3">
          <h2 className="text-xl font-semibold text-gray-800">Audit tooling moved</h2>
          <p className="text-sm text-gray-700">
            Case audit and backfill helpers were removed from the app bundle. Use the scripts in
            <span className="font-mono"> scripts/caseBackfill.js</span> and
            <span className="font-mono"> scripts/skillBackfill.js</span> when needed.
          </p>
          <p className="text-sm text-gray-600">
            This page is intentionally disabled in production to keep dev-only tooling out of the client.
          </p>
        </section>
      </div>
    </div>
  );
}
