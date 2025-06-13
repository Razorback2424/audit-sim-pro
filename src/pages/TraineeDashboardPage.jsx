import React, { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { firebaseApp, Button, useRoute } from '../AppCore';

export default function TraineeDashboardPage() {
  const { navigate } = useRoute();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fn = httpsCallable(getFunctions(firebaseApp), 'getMyVisibleCases');
    fn().then(res => {
      setCases(res.data.cases || []);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load cases', err);
      setLoading(false);
    });
  }, []);

  if (loading) return <div>Loading cases...</div>;

  return (
    <div className="space-y-4">
      {cases.length === 0 && <p>No available cases.</p>}
      <ul className="space-y-2">
        {cases.map(c => (
          <li key={c.id} className="border rounded p-2 flex justify-between">
            <span>{c.caseName}</span>
            <Button variant="secondary" onClick={() => navigate(`/trainee/case/${c.id}`)}>Open</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
