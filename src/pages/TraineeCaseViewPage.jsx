import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, FirestorePaths, Button, useRoute } from '../AppCore';

export default function TraineeCaseViewPage({ params }) {
  const caseId = params?.caseId;
  const { navigate } = useRoute();
  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, FirestorePaths.CASE_DOCUMENT(caseId)));
        if (snap.exists()) setCaseData(snap.data());
      } catch (err) {
        console.error('Failed to load case', err);
      }
      setLoading(false);
    }
    load();
  }, [caseId]);

  if (loading) return <div>Loading...</div>;
  if (!caseData) return <div>Case not found.</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{caseData.caseName}</h2>
      <Button variant="secondary" onClick={() => navigate('/trainee/dashboard')}>Back</Button>
    </div>
  );
}
