import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, FirestorePaths, Button, useRoute, useModal, useAuth } from '../AppCore';
import { ListChecks, BookOpen } from 'lucide-react';

export default function TraineeDashboardPage() {
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { showModal } = useModal();
  const [cases, setCases] = useState([]);
  const [loadingCases, setLoadingCases] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoadingCases(false);
      return;
    }
    const casesCollectionRef = collection(db, FirestorePaths.CASES_COLLECTION());
    const q = query(casesCollectionRef, where('_deleted', '!=', true));

    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const casesData = querySnapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((caseDoc) => {
            return !caseDoc.visibleToUserIds || caseDoc.visibleToUserIds.length === 0 || caseDoc.visibleToUserIds.includes(userId);
          });
        setCases(casesData);
        setLoadingCases(false);
      },
      (error) => {
        console.error('Error fetching cases for trainee: ', error);
        showModal('Error fetching cases: ' + error.message, 'Error');
        setLoadingCases(false);
      }
    );
    return () => unsubscribe();
  }, [userId, showModal]);

  if (loadingCases) return <div className="p-4 text-center">Loading available cases...</div>;
  if (!userId && !loadingCases) return <div className="p-4 text-center">Authenticating user, please wait...</div>;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">Available Audit Cases</h1>
        {cases.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-lg shadow">
            <ListChecks size={48} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 text-xl">No cases currently assigned or available to you.</p>
            <p className="text-gray-500 mt-2">Please check back later or contact an administrator.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cases.map((caseData) => (
              <div key={caseData.id} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow flex flex-col justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-blue-700 mb-2">{caseData.caseName}</h2>
                  <p className="text-sm text-gray-600 mb-1">Disbursements: {caseData.disbursements?.length || 0}</p>
                  <p className="text-sm text-gray-500 mb-4">Created: {caseData.createdAt?.toDate().toLocaleDateString()}</p>
                </div>
                <Button onClick={() => navigate(`/trainee/case/${caseData.id}`)} className="w-full mt-auto">
                  <BookOpen size={18} className="inline mr-2" /> View Case
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
