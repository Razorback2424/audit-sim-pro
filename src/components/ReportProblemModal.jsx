import React, { useEffect, useMemo, useState } from 'react';
import { Button, useAuth, useModal, useUser } from '../AppCore';
import { ANALYTICS_EVENTS, submitProblemReport, trackAnalyticsEvent } from '../services/analyticsService';

const resolveCaseIdFromPath = (path) => {
  if (!path) return '';
  const match = path.match(/\/case\/([^/]+)|\/cases\/([^/]+)/);
  if (!match) return '';
  return match[1] || match[2] || '';
};

export default function ReportProblemModal() {
  const { currentUser } = useAuth();
  const { role } = useUser();
  const { hideModal, showModal } = useModal();
  const routePath = typeof window !== 'undefined' ? window.location.pathname : '';
  const inferredCaseId = useMemo(() => resolveCaseIdFromPath(routePath), [routePath]);
  const [caseId, setCaseId] = useState(inferredCaseId);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    trackAnalyticsEvent({
      eventType: ANALYTICS_EVENTS.REPORT_PROBLEM_OPENED,
      metadata: { route: routePath, caseId: inferredCaseId, role: role || null },
    });
  }, [routePath, inferredCaseId, role]);

  const handleSubmit = async () => {
    if (!message.trim()) {
      setError('Please describe the issue so we can reproduce it.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await submitProblemReport({ message, caseId: caseId.trim(), route: routePath });
      trackAnalyticsEvent({
        eventType: ANALYTICS_EVENTS.REPORT_PROBLEM_SUBMITTED,
        metadata: { route: routePath, caseId: caseId.trim() || null, role: role || null },
      });
      hideModal();
      showModal('Thanks! Your report was sent to support.', 'Report sent');
    } catch (err) {
      const errorMessage = err?.message || 'Unable to send report. Please try again.';
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Tell us what broke. Please avoid sharing sensitive data or answer keys.
      </p>
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-gray-500" htmlFor="report-case-id">
          Case ID (optional)
        </label>
        <input
          id="report-case-id"
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Auto-filled when available"
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-gray-500" htmlFor="report-message">
          What happened?
        </label>
        <textarea
          id="report-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm h-28 resize-none"
          placeholder="Steps, what you expected, and what you saw."
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-gray-500">
          User: {currentUser?.uid || 'unknown'} · Role: {role || 'unknown'}
        </p>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Sending…' : 'Send report'}
        </Button>
      </div>
    </div>
  );
}
