import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { Button, useRoute, useAuth, useModal, appId, storage } from '../AppCore';
import { listUserSubmissions } from '../services/submissionService';
import { fetchCase } from '../services/caseService';
import SubmissionSummary from '../components/SubmissionSummary';

const formatTimestamp = (value) => {
  if (!value) return 'N/A';
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate().toLocaleString();
    } catch (e) {
      return 'N/A';
    }
  }
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  return 'N/A';
};

const buildSummaryItems = (attempt, caseData) => {
  const disbursementMap = new Map(
    (caseData?.disbursements || []).map((disbursement) => [disbursement.paymentId, disbursement])
  );
  const selectedIds = Array.isArray(attempt.selectedPaymentIds) ? attempt.selectedPaymentIds : [];
  const docs = Array.isArray(attempt.retrievedDocuments) ? attempt.retrievedDocuments : [];

  const items = selectedIds.map((paymentId) => {
    const metadata = disbursementMap.get(paymentId) || { paymentId };
    const classification =
      (attempt.disbursementClassifications && attempt.disbursementClassifications[paymentId]) || {};
    const documents = docs.filter((doc) => doc.paymentId === paymentId);
    return { paymentId, metadata, classification, documents };
  });

  return {
    items,
    generalDocuments: docs.filter((doc) => !doc.paymentId),
  };
};

export default function TraineeSubmissionHistoryPage() {
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { showModal } = useModal();
  const showModalRef = useRef(showModal);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    showModalRef.current = showModal;
  }, [showModal]);

  useEffect(() => {
    let isMounted = true;
    const loadHistory = async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const submissions = await listUserSubmissions({ uid: userId, appId });
        if (!isMounted) return;
        if (!Array.isArray(submissions) || submissions.length === 0) {
          setHistory([]);
          setLoading(false);
          return;
        }
        const caseIds = Array.from(new Set(submissions.map((entry) => entry.caseId).filter(Boolean)));
        const caseEntries = await Promise.all(
          caseIds.map(async (caseId) => {
            try {
              return [caseId, await fetchCase(caseId)];
            } catch (err) {
              console.error('Error loading case for history:', err);
              return [caseId, null];
            }
          })
        );
        const caseMap = new Map(caseEntries);
        setHistory(
          submissions.map((entry) => ({
            ...entry,
            caseData: caseMap.get(entry.caseId) || null,
          }))
        );
      } catch (err) {
        console.error('Error loading submission history:', err);
        if (isMounted) {
          const message = err?.message || 'Unable to load submission history.';
          setError(message);
          const modal = showModalRef.current;
          if (modal) modal(message, 'Error');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadHistory();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  const hasHistory = history.length > 0;

  const entries = useMemo(() => {
    return history.map((entry) => {
      const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
      return {
        ...entry,
        attempts: attempts.map((attempt) => ({
          ...attempt,
          submittedAt: attempt.submittedAt || entry.submittedAt || null,
          selectedPaymentIds: Array.isArray(attempt.selectedPaymentIds) ? attempt.selectedPaymentIds : [],
          retrievedDocuments: Array.isArray(attempt.retrievedDocuments) ? attempt.retrievedDocuments : [],
        })),
      };
    });
  }, [history]);

  if (loading) {
    return <div className="p-6 text-center">Loading submission history...</div>;
  }

  if (!hasHistory) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="max-w-3xl mx-auto text-center space-y-4 bg-white border border-gray-200 rounded-lg shadow-sm p-8">
          <h1 className="text-2xl font-semibold text-gray-800">Submission History</h1>
          <p className="text-gray-600">You have not submitted any cases yet. Start a case to view your history here.</p>
          <Button variant="primary" onClick={() => navigate('/trainee')}>
            Browse Cases
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Submission History</h1>
            <p className="text-sm text-gray-500">
              Review your previous attempts, including supporting documents and classification amounts.
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/trainee')}>
            &larr; Back to Dashboard
          </Button>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {entries.map((entry) => (
          <div key={entry.caseId} className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">{entry.caseData?.caseName || entry.caseName || entry.caseId}</h2>
                <p className="text-sm text-gray-500">Case ID: {entry.caseId}</p>
              </div>
              <Button variant="secondary" onClick={() => navigate(`/trainee/case/${entry.caseId}`)}>
                View Case
              </Button>
            </div>

            {entry.attempts.map((attempt, index) => {
              const { items, generalDocuments } = buildSummaryItems(attempt, entry.caseData);
              return (
                <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <h3 className="font-semibold text-gray-700">Attempt {index + 1}</h3>
                    <p className="text-sm text-gray-500">
                      Submitted: {formatTimestamp(attempt.submittedAt)}
                    </p>
                  </div>
                  {attempt.overallGrade !== undefined ? (
                    <p className="text-sm text-gray-600">Grade: {attempt.overallGrade}</p>
                  ) : null}
                  <SubmissionSummary
                    items={items}
                    extraDocuments={generalDocuments}
                    onViewDocument={async (doc) => {
                      if (!doc || (!doc.storagePath && !doc.downloadURL)) {
                        const modal = showModalRef.current;
                        if (modal) modal('Document path or URL is missing. Cannot view.', 'Error');
                        return;
                      }
                      if (doc.downloadURL) {
                        window.open(doc.downloadURL, '_blank');
                        return;
                      }
                      try {
                        const fileRef = storageRef(storage, doc.storagePath);
                        const url = await getDownloadURL(fileRef);
                        window.open(url, '_blank');
                      } catch (err) {
                        console.error('Error loading document URL:', err);
                        const modal = showModalRef.current;
                        if (modal) modal('Could not retrieve the document URL.', 'Error');
                      }
                    }}
                    emptyMessage="No disbursements were recorded in this attempt."
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
