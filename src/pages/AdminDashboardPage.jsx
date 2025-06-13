import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, doc, setDoc, Timestamp } from 'firebase/firestore';
import { FilePlus, Users2, Edit3, ListFilter, Trash2 } from 'lucide-react';
import { db, FirestorePaths, Button, useRoute, useModal } from '../AppCore';

export default function AdminDashboardPage() {
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const [cases, setCases] = useState([]);
  const [loadingCases, setLoadingCases] = useState(true);

  useEffect(() => {
    const casesCollectionRef = collection(db, FirestorePaths.CASES_COLLECTION());
    const q = query(casesCollectionRef);
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const casesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCases(casesData);
      setLoadingCases(false);
    }, (error) => {
      console.error('Error fetching cases: ', error);
      showModal('Error fetching cases: ' + error.message, 'Error');
      setLoadingCases(false);
    });
    return () => unsubscribe();
  }, [showModal]);

  const deleteCase = async (caseId) => {
    showModal(
      <> 
        <p className="text-gray-700">Are you sure you want to delete this case? This action marks it as deleted but does not permanently remove data immediately.</p>
      </>,
      'Confirm Deletion',
      (hideModal) => (
        <>
          <Button onClick={hideModal} variant="secondary">Cancel</Button>
          <Button
            onClick={async () => {
              hideModal();
              try {
                await setDoc(doc(db, FirestorePaths.CASE_DOCUMENT(caseId)), { _deleted: true, updatedAt: Timestamp.now() }, { merge: true });
                showModal('Case marked for deletion.', 'Success');
              } catch (error) {
                console.error('Error deleting case:', error);
                showModal('Error deleting case: ' + error.message, 'Error');
              }
            }}
            variant="danger"
            className="ml-2"
          >
            Confirm Delete
          </Button>
        </>
      )
    );
  };

  if (loadingCases) return <div className="p-4 text-center">Loading cases...</div>;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
          <div className="space-x-2">
            <Button onClick={() => navigate('/admin/user-management')}>
              <Users2 size={20} className="inline mr-2" /> User Management
            </Button>
            <Button onClick={() => navigate('/admin/create-case')}>
              <FilePlus size={20} className="inline mr-2" /> Create New Case
            </Button>
          </div>
        </div>
        {cases.filter(c => !c._deleted).length === 0 ? (
          <div className="text-center py-10 bg-white rounded-lg shadow">
            <ListFilter size={48} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 text-xl">No active cases found.</p>
            <p className="text-gray-500 mt-2">Get started by creating a new audit case.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {cases.filter(c => !c._deleted).map(caseData => (
              <div key={caseData.id} className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-xl font-semibold text-blue-700">{caseData.caseName}</h2>
                    <p className="text-sm text-gray-500">ID: {caseData.id}</p>
                    <p className="text-sm text-gray-500">Disbursements: {caseData.disbursements?.length || 0}</p>
                    <p className="text-sm text-gray-500">Mappings: {caseData.invoiceMappings?.length || 0}</p>
                    <p className="text-sm text-gray-500">Visible to: {caseData.visibleToUserIds && caseData.visibleToUserIds.length > 0 ? `${caseData.visibleToUserIds.length} user(s)` : 'All Users'}</p>
                  </div>
                  <div className="flex flex-col space-y-2 items-end">
                    <Button onClick={() => navigate(`/admin/case-submissions/${caseData.id}`)} variant="secondary" className="px-3 py-1 text-sm w-full">
                      <ListFilter size={16} className="inline mr-1" /> View Submissions
                    </Button>
                    <Button onClick={() => navigate(`/admin/edit-case/${caseData.id}`)} variant="secondary" className="px-3 py-1 text-sm w-full">
                      <Edit3 size={16} className="inline mr-1" /> Edit Case
                    </Button>
                    <Button onClick={() => deleteCase(caseData.id)} variant="danger" className="px-3 py-1 text-sm w-full">
                      <Trash2 size={16} className="inline mr-1" /> Delete Case
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
