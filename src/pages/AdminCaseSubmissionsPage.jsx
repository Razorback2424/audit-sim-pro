import React, { useEffect, useState } from 'react';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db, FirestorePaths, Button, useRoute, useModal } from '../AppCore';

export default function AdminCaseSubmissionsPage({ params }) {
  const { caseId } = params;
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(true);
  const [caseName, setCaseName] = useState('');

  useEffect(() => {
    if (!caseId) {
      navigate('/admin');
      return;
    }
    setLoadingSubmissions(true);

    const caseRef = doc(db, FirestorePaths.CASE_DOCUMENT(caseId));
    getDoc(caseRef).then(docSnap => {
      if (docSnap.exists()) {
        setCaseName(docSnap.data().caseName);
      }
    });

    const usersCollectionRef = collection(db, FirestorePaths.USERS_COLLECTION());
    getDocs(usersCollectionRef)
      .then(async (userDocsSnapshot) => {
        const allSubmissions = [];
        for (const userDoc of userDocsSnapshot.docs) {
          const userId = userDoc.id;
          const submissionRef = doc(db, FirestorePaths.USER_CASE_SUBMISSION(userId, caseId));
          const submissionSnap = await getDoc(submissionRef);
          if (submissionSnap.exists()) {
            allSubmissions.push({ id: submissionSnap.id, userId, ...submissionSnap.data() });
          }
        }
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
          </div>
          <Button onClick={() => navigate('/admin')} variant="secondary">
            &larr; Back to Dashboard
          </Button>
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
