import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, Timestamp } from 'firebase/firestore';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { db, storage, FirestorePaths, Button, useRoute, useAuth, useModal } from '../AppCore';
import { Send, FileText, Eye } from 'lucide-react';

export default function TraineeCaseViewPage({ params }) {
  const { caseId } = params;
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { showModal, hideModal } = useModal();

  const [caseData, setCaseData] = useState(null);
  const [selectedDisbursements, setSelectedDisbursements] = useState({});
  const [submittedDocuments, setSubmittedDocuments] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!caseId || !userId) {
      if (!caseId) navigate('/trainee');
      setLoading(false);
      return;
    }
    setLoading(true);
    const caseRef = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
    const unsubscribe = onSnapshot(
      caseRef,
      (docSnap) => {
        if (docSnap.exists() && !docSnap.data()._deleted) {
          const data = docSnap.data();
          if (data.visibleToUserIds && data.visibleToUserIds.length > 0 && !data.visibleToUserIds.includes(userId)) {
            showModal('You do not have permission to view this case.', 'Access Denied');
            navigate('/trainee');
            return;
          }
          setCaseData({ id: docSnap.id, ...data });
        } else {
          showModal('Case not found or has been removed.', 'Error');
          navigate('/trainee');
        }
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching case: ', error);
        showModal('Error fetching case: ' + error.message, 'Error');
        setLoading(false);
        navigate('/trainee');
      }
    );
    return () => unsubscribe();
  }, [caseId, navigate, userId, showModal]);

  const handleSelectionChange = (paymentId) => {
    setSelectedDisbursements((prev) => ({
      ...prev,
      [paymentId]: !prev[paymentId],
    }));
  };

  const handleSubmitSelections = async () => {
    if (!caseData || !userId) return;
    const selectedIds = Object.entries(selectedDisbursements)
      .filter(([_, isSelected]) => isSelected)
      .map(([paymentId]) => paymentId);

    if (selectedIds.length === 0) {
      showModal('Please select at least one disbursement to test.', 'No Selection');
      return;
    }

    const documents = [];
    selectedIds.forEach((pid) => {
      (caseData.invoiceMappings || []).forEach((mapping) => {
        if (mapping.paymentId === pid) {
          documents.push({ fileName: mapping.fileName, storagePath: mapping.storagePath, downloadURL: mapping.downloadURL });
        }
      });
    });
    setSubmittedDocuments(documents);

    try {
      const submissionRef = doc(db, FirestorePaths.USER_CASE_SUBMISSION(userId, caseId));
      await setDoc(
        submissionRef,
        {
          caseId,
          caseName: caseData.caseName,
          selectedPaymentIds: selectedIds,
          retrievedDocuments: documents,
          submittedAt: Timestamp.now(),
        },
        { merge: true }
      );
      showModal('Selections submitted. Review your documents below.', 'Submission Successful');
    } catch (error) {
      console.error('Error saving submission:', error);
      showModal('Error saving submission: ' + error.message, 'Error');
    }
  };

  const handleViewDocument = async (docInfo) => {
    if (!docInfo || (!docInfo.storagePath && !docInfo.downloadURL)) {
      showModal('Document path or URL is missing. Cannot view.', 'Error');
      return;
    }
    if (docInfo.storagePath && docInfo.storagePath.includes('PENDING_CASE_ID')) {
      showModal('Document is still pending processing by admin (Case ID not finalized for path). Cannot view yet.', 'Error');
      return;
    }

    if (docInfo.downloadURL) {
      window.open(docInfo.downloadURL, '_blank');
      return;
    }

    if (docInfo.storagePath) {
      showModal(`Attempting to get download URL for: ${docInfo.fileName}\nPath: ${docInfo.storagePath}\n\nPlease wait...`, 'Fetching Document', () => null);
      try {
        const fileRef = storageRef(storage, docInfo.storagePath);
        const url = await getDownloadURL(fileRef);
        hideModal();
        window.open(url, '_blank');
      } catch (error) {
        console.error('Error getting download URL:', error);
        hideModal();
        let errorMessage = `Could not retrieve document: ${docInfo.fileName}.\nError: ${error.code}\n\n`;
        errorMessage += 'This usually means the file was not actually uploaded to Firebase Storage at the expected path by an administrator, or you don\'t have permission to access it.\n\n';
        errorMessage += `Expected path: ${docInfo.storagePath}\n\n`;
        errorMessage += 'Please ensure the admin has uploaded the file and that Firebase Storage rules are correctly configured.';
        showModal(errorMessage, 'Error Viewing Document');
      }
    } else {
      showModal('No valid way to access the document.', 'Error');
    }
  };

  const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  if (loading) return <div className="p-4 text-center">Loading case details...</div>;
  if (!caseData) return <div className="p-4 text-center">Case not found or you may not have access. Redirecting...</div>;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <Button onClick={() => navigate('/trainee')} variant="secondary" className="mb-4 text-sm">
          &larr; Back to Cases
        </Button>
        <div className="bg-white p-8 rounded-lg shadow-xl">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">{caseData.caseName}</h1>
          <p className="text-gray-600 mb-6">Select the disbursements you wish to test by checking the boxes below.</p>

          {caseData.disbursements && caseData.disbursements.length > 0 ? (
            <div className="space-y-3 mb-8">
              {caseData.disbursements.map((d) => (
                <div key={d.paymentId} className="flex items-center p-4 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
                  <input type="checkbox" id={`cb-${d.paymentId}`} checked={!!selectedDisbursements[d.paymentId]} onChange={() => handleSelectionChange(d.paymentId)} className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-4 cursor-pointer" />
                  <label htmlFor={`cb-${d.paymentId}`} className="flex-grow grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 cursor-pointer">
                    <span className="text-sm text-gray-700">
                      <strong className="font-medium">ID:</strong> {d.paymentId}
                    </span>
                    <span className="text-sm text-gray-700">
                      <strong className="font-medium">Payee:</strong> {d.payee}
                    </span>
                    <span className="text-sm text-gray-700">
                      <strong className="font-medium">Amount:</strong> {currencyFormatter.format(parseFloat(d.amount || 0))}
                    </span>
                    <span className="text-sm text-gray-700">
                      <strong className="font-medium">Date:</strong> {d.paymentDate}
                    </span>
                  </label>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No disbursements available in this case.</p>
          )}

          <Button onClick={handleSubmitSelections} disabled={Object.values(selectedDisbursements).every((v) => !v)}>
            <Send size={18} className="inline mr-2" /> Submit Selections
          </Button>

          {submittedDocuments !== null && (
            <div className="mt-10 pt-6 border-t border-gray-200">
              <h2 className="text-2xl font-semibold text-gray-700 mb-4">Your Selected Documents</h2>
              {submittedDocuments.length > 0 ? (
                <ul className="space-y-3">
                  {submittedDocuments.map((docInfo, index) => (
                    <li key={index} className="text-gray-700 flex items-center justify-between p-3 bg-gray-50 rounded-md">
                      <span className="flex items-center">
                        <FileText size={18} className="text-blue-500 mr-2 flex-shrink-0" /> {docInfo.fileName}
                      </span>
                      <Button onClick={() => handleViewDocument(docInfo)} variant="secondary" className="text-xs px-2 py-1">
                        <Eye size={14} className="inline mr-1" /> View Document
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500">No documents correspond to your selections based on the current mappings.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
