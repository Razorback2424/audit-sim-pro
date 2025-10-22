import React, { useEffect, useMemo, useState } from 'react';
import { Button, useRoute, useModal } from '../AppCore';
import { fetchCase } from '../services/caseService';
import { fetchSubmission } from '../services/submissionService';
import { CLASSIFICATION_FIELDS } from '../constants/classificationFields';

export default function AdminSubmissionDetailPage({ params }) {
  const { caseId, userId } = params;
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const [caseName, setCaseName] = useState('');
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const currency = useMemo(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }), []);

  useEffect(() => {
    if (!caseId || !userId) {
      navigate('/admin');
      return;
    }
    setLoading(true);
    fetchCase(caseId).then((c) => {
      if (c) setCaseName(c.caseName);
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
                    const expectedAnswer =
                      attempt.expectedClassifications && attempt.expectedClassifications[pid]
                        ? attempt.expectedClassifications[pid]
                        : null;
                    return (
                      <li key={pid} className="break-all">
                        {pid}
                        {expectedAnswer ? ` (expected: ${expectedAnswer})` : ''}
                        {traineeAnswer && typeof traineeAnswer === 'object' ? (
                          <div className="mt-2 ml-4 border border-gray-200 rounded-md overflow-hidden">
                            <table className="min-w-[280px] text-xs text-left text-gray-700">
                              <thead className="bg-gray-100">
                                <tr>
                                  {CLASSIFICATION_FIELDS.map(({ label }) => (
                                    <th key={label} className="px-2 py-1 font-semibold text-gray-600">
                                      {label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  {CLASSIFICATION_FIELDS.map(({ key, label }) => (
                                    <td key={label} className="px-2 py-1">
                                      {currency.format(Number(traineeAnswer[key] || 0))}
                                    </td>
                                  ))}
                                </tr>
                              </tbody>
                            </table>
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
          </div>
        ))}
      </div>
    </div>
  );
}
