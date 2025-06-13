import React, { useEffect, useState } from 'react';
import { collectionGroup, query, where, onSnapshot } from 'firebase/firestore';
import { db, Button, useRoute, FirestorePaths } from '../AppCore';

export default function AdminCaseSubmissionsPage({ params }) {
  const { navigate } = useRoute();
  const caseId = params?.caseId;
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collectionGroup(db, 'caseSubmissions'), where('caseId', '==', caseId));
    const unsub = onSnapshot(q, snap => {
      setSubmissions(snap.docs.map(d => d.data()));
      setLoading(false);
    }, err => {
      console.error('Failed to fetch submissions', err);
      setLoading(false);
    });
    return unsub;
  }, [caseId]);

  if (loading) return <div>Loading submissions...</div>;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Submissions for Case {caseId}</h2>
      {submissions.length === 0 && <p>No submissions yet.</p>}
      <ul className="space-y-2">
        {submissions.map((s, idx) => (
          <li key={idx} className="border rounded p-2">
            <div className="text-sm">User: {s.userId}</div>
            <div className="text-sm">Submitted: {s.submittedAt?.toDate?.().toLocaleString?.() ?? ''}</div>
          </li>
        ))}
      </ul>
      <Button className="mt-4" variant="secondary" onClick={() => navigate('/admin/dashboard')}>Back</Button>
    </div>
  );
}
