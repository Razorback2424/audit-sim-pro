import React, { useEffect, useMemo, useState } from 'react';
import { Button, useRoute, useModal } from '../AppCore';
import { fetchCase } from '../services/caseService';
import { fetchSubmission } from '../services/submissionService';
import { getClassificationFields } from '../constants/classificationFields';
import { DEFAULT_AUDIT_AREA } from '../models/caseConstants';

export default function AdminSubmissionDetailPage({ params }) {
  const { caseId, userId } = params;
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const [caseName, setCaseName] = useState('');
  const [auditArea, setAuditArea] = useState(DEFAULT_AUDIT_AREA);
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const currency = useMemo(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }), []);
  const classificationFields = useMemo(() => getClassificationFields(auditArea), [auditArea]);
  const fallbackFeedback = Array.isArray(submission?.virtualSeniorFeedback) ? submission.virtualSeniorFeedback : [];

  useEffect(() => {
    if (!caseId || !userId) {
      navigate('/admin');
      return;
    }
    setLoading(true);
    fetchCase(caseId).then((c) => {
      if (c) {
        setCaseName(c.caseName);
        if (typeof c.auditArea === 'string' && c.auditArea.trim()) {
          setAuditArea(c.auditArea.trim());
        } else {
          setAuditArea(DEFAULT_AUDIT_AREA);
        }
      }
    });
    fetchSubmission(userId, caseId)
      .then((doc) => {
        setSubmission(doc);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching submission:', err);
        showModal('Error fetching submission: ' + err.message, 'Error');
        setLoading(false);
      });
  }, [caseId, userId, navigate, showModal]);

  if (loading) return <div className="p-4 text-center">Loading submission...</div>;

  if (!submission) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <p>Submission not found.</p>
          <Button onClick={() => navigate(`/admin/case-submissions/${caseId}`)} variant="secondary">
            &larr; Back
          </Button>
        </div>
      </div>
    );
  }

  const attempts = submission.attempts && submission.attempts.length > 0
    ? submission.attempts
    : [{
        selectedPaymentIds: submission.selectedPaymentIds,
        disbursementClassifications: submission.disbursementClassifications,
        submittedAt: submission.submittedAt,
        overallGrade: submission.overallGrade,
        virtualSeniorFeedback: fallbackFeedback,
      }];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 mb-1">Submission Detail</h1>
            <h2 className="text-lg text-blue-600">{caseName || caseId}</h2>
            <p className="text-sm text-gray-500">User ID: {userId}</p>
          </div>
          <Button onClick={() => navigate(`/admin/case-submissions/${caseId}`)} variant="secondary">
            &larr; Back
          </Button>
        </div>
        {attempts.map((attempt, idx) => (
          <div key={idx} className="bg-white p-6 rounded-lg shadow space-y-2">
            <h3 className="font-semibold text-gray-700">Attempt {idx + 1}</h3>
            <p className="text-sm text-gray-500">
              Submitted: {attempt.submittedAt?.toDate ? attempt.submittedAt.toDate().toLocaleString() : 'N/A'}
            </p>
            <div>
              <p className="text-sm font-medium text-gray-600">Selections &amp; Classifications:</p>
              {attempt.selectedPaymentIds && attempt.selectedPaymentIds.length > 0 ? (
                <ul className="list-disc list-inside text-sm text-gray-700">
                  {attempt.selectedPaymentIds.map((pid) => {
                    const traineeAnswer =
                      attempt.disbursementClassifications && attempt.disbursementClassifications[pid]
                        ? attempt.disbursementClassifications[pid]
                        : null;
                    const traineeMeta = traineeAnswer && typeof traineeAnswer === 'object' ? traineeAnswer : {};
                    const expectedAnswer =
                      attempt.expectedClassifications && attempt.expectedClassifications[pid]
                        ? attempt.expectedClassifications[pid]
                        : null;
                    const workspaceNote =
                      attempt.workspaceNotes && attempt.workspaceNotes[pid] && typeof attempt.workspaceNotes[pid] === 'object'
                        ? attempt.workspaceNotes[pid]
                        : null;
                    const workpaperNoteText = String(
                      workspaceNote?.workpaperNote ||
                        workspaceNote?.note ||
                        workspaceNote?.notes ||
                        traineeMeta.workpaperNote ||
                        traineeMeta.notes ||
                        traineeMeta.note ||
                        ''
                    ).trim();
                    const assertionText = String(traineeMeta.assertion || workspaceNote?.assertionSelection || '').trim();
                    const reasonText = String(traineeMeta.reason || workspaceNote?.reasonSelection || '').trim();
                    return (
                      <li key={pid} className="break-all">
                        {pid}
                        {expectedAnswer ? ` (expected: ${expectedAnswer})` : ''}
                        {traineeAnswer && typeof traineeAnswer === 'object' ? (
                          <div className="mt-2 ml-4 border border-gray-200 rounded-md overflow-hidden">
                            <table className="min-w-[280px] text-xs text-left text-gray-700">
                              <thead className="bg-gray-100">
                                <tr>
                                  {classificationFields.map(({ label }) => (
                                    <th key={label} className="px-2 py-1 font-semibold text-gray-600">
                                      {label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  {classificationFields.map(({ key, label }) => (
                                    <td key={label} className="px-2 py-1">
                                      {currency.format(Number(traineeAnswer[key] || 0))}
                                    </td>
                                  ))}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                        {workpaperNoteText ? (
                          <div className="mt-2 ml-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                              Workpaper note
                            </div>
                            {(assertionText || reasonText) && (
                              <div className="mt-1 text-xs text-gray-600">
                                {assertionText ? <span>Assertion: {assertionText}</span> : null}
                                {assertionText && reasonText ? <span> · </span> : null}
                                {reasonText ? <span>Reason: {reasonText}</span> : null}
                              </div>
                            )}
                            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{workpaperNoteText}</p>
                          </div>
                        ) : null}
                        {traineeAnswer && typeof traineeAnswer !== 'object' ? ` — ${traineeAnswer}` : ''}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">None</p>
              )}
            </div>
            {attempt.overallGrade !== undefined && (
              <p className="text-sm font-medium text-gray-700">Grade: {attempt.overallGrade}</p>
            )}
            <div>
              <p className="text-sm font-medium text-gray-600">Senior Review Notes:</p>
              {Array.isArray(attempt.virtualSeniorFeedback) && attempt.virtualSeniorFeedback.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {attempt.virtualSeniorFeedback.map((entry, noteIndex) => {
                    const notes = Array.isArray(entry?.notes) ? entry.notes : [];
                    const paymentId = typeof entry?.paymentId === 'string' && entry.paymentId.trim()
                      ? entry.paymentId.trim()
                      : 'General';
                    return (
                      <div key={`${paymentId}-${noteIndex}`} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-blue-800">
                          {paymentId}
                          {entry?.payee ? ` · ${entry.payee}` : ''}
                        </div>
                        {notes.length > 0 ? (
                          <ul className="mt-1 list-disc list-inside text-sm text-blue-900">
                            {notes.map((note, idx) => (
                              <li key={`${paymentId}-note-${idx}`}>{note}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-sm text-blue-900">Review note generated (details unavailable).</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No review notes available for this attempt.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
