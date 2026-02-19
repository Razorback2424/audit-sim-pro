import React, { useEffect, useState } from 'react';
import { Button, useRoute, useModal } from '../AppCore';
import { fetchCase } from '../services/caseService';
import { fetchSubmissionsForCase } from '../services/submissionService';
import { DEFAULT_AUDIT_AREA, getAuditAreaLabel, getCaseGroupLabel } from '../models/caseConstants';

const getReviewNotesCount = (submission) => {
  if (!submission || typeof submission !== 'object') return 0;
  const attemptNotesCount = Array.isArray(submission.attempts)
    ? submission.attempts.reduce((sum, attempt) => {
        if (!Array.isArray(attempt?.virtualSeniorFeedback)) return sum;
        return sum + attempt.virtualSeniorFeedback.length;
      }, 0)
    : 0;
  if (attemptNotesCount > 0) return attemptNotesCount;
  return Array.isArray(submission.virtualSeniorFeedback) ? submission.virtualSeniorFeedback.length : 0;
};

export default function AdminCaseSubmissionsPage({ params }) {
  const { caseId } = params;
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(true);
  const [caseName, setCaseName] = useState('');
  const [auditArea, setAuditArea] = useState(DEFAULT_AUDIT_AREA);
  const [caseGroupId, setCaseGroupId] = useState('');

  useEffect(() => {
    if (!caseId) {
      navigate('/admin');
      return;
    }
    setLoadingSubmissions(true);

    fetchCase(caseId)
      .then((caseDoc) => {
        if (caseDoc) {
          setCaseName(caseDoc.caseName);
          setAuditArea(
            typeof caseDoc.auditArea === 'string' && caseDoc.auditArea.trim()
              ? caseDoc.auditArea.trim()
              : DEFAULT_AUDIT_AREA
          );
          setCaseGroupId(typeof caseDoc.caseGroupId === 'string' ? caseDoc.caseGroupId.trim() : '');
        }
      })
      .catch((error) => {
        console.error('Error fetching case for submissions:', error);
      });

    fetchSubmissionsForCase(caseId)
      .then((allSubmissions) => {
        setSubmissions(allSubmissions);
        setLoadingSubmissions(false);
      })
      .catch((error) => {
        console.error('Error fetching submissions:', error);
        showModal('Error fetching submissions: ' + error.message, 'Error');
        setLoadingSubmissions(false);
      });
  }, [caseId, navigate, showModal]);

  if (loadingSubmissions) return <div className="p-4 text-center">Loading submissions...</div>;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Submissions for:</h1>
            <h2 className="text-xl text-blue-600">{caseName || caseId}</h2>
            <p className="text-sm text-gray-500 mt-1">
              Audit Area: {getAuditAreaLabel(auditArea)}
              {caseGroupId ? ` • Group: ${getCaseGroupLabel(caseGroupId)}` : ''}
            </p>
          </div>
          <div className="flex space-x-2">
            <Button onClick={() => navigate(`/admin/case-progress/${caseId}`)} variant="secondary" className="text-sm">
              View Progress
            </Button>
            <Button onClick={() => navigate('/admin')} variant="secondary">
              &larr; Back to Dashboard
            </Button>
          </div>
        </div>
        {submissions.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-lg shadow">
            <p className="text-gray-600 text-xl">No submissions found for this case.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map((submission) => (
              <div key={submission.userId} className="bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-lg font-semibold text-gray-700">
                  User ID: <span className="font-normal text-sm break-all">{submission.userId}</span>
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Review Notes:{' '}
                  {getReviewNotesCount(submission) > 0 ? (
                    <span className="font-medium text-emerald-700">{getReviewNotesCount(submission)} available</span>
                  ) : (
                    <span>None</span>
                  )}
                </p>
                <p className="text-sm text-gray-500">Submitted At: {submission.submittedAt?.toDate ? submission.submittedAt.toDate().toLocaleString() : 'N/A'}</p>
                <div className="mt-3">
                  <p className="text-sm font-medium text-gray-600">Selected Payment IDs:</p>
                  {submission.selectedPaymentIds && submission.selectedPaymentIds.length > 0 ? (
                    <ul className="list-disc list-inside pl-4 text-sm text-gray-500">
                      {submission.selectedPaymentIds.map((pid) => (
                        <li key={pid}>{pid}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500">None</p>
                  )}
                </div>
                <div className="mt-2">
                  <p className="text-sm font-medium text-gray-600">Retrieved Documents (Filenames):</p>
                  {submission.retrievedDocuments && submission.retrievedDocuments.length > 0 ? (
                    <ul className="list-disc list-inside pl-4 text-sm text-gray-500">
                      {submission.retrievedDocuments.map((doc) => (
                        <li key={doc.fileName}>{doc.fileName}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500">None</p>
                  )}
                </div>
                {submission.attempts && submission.attempts.length > 1 && (
                  <p className="text-sm text-gray-500 mt-1">Attempts: {submission.attempts.length}</p>
                )}
                {submission.overallGrade !== undefined && (
                  <p className="text-sm text-gray-700 mt-1">Grade: {submission.overallGrade}</p>
                )}
                <Button
                  onClick={() => navigate(`/admin/submission-detail/${caseId}/${submission.userId}`)}
                  variant="secondary"
                  className="mt-4 text-sm"
                >
                  View Details
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
