import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { Eye, Edit3, PlusCircle } from 'lucide-react';
import { db, FirestorePaths, Button, useRoute } from '../AppCore';

export default function AdminDashboardPage() {
  const { navigate } = useRoute();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, FirestorePaths.CASES_COLLECTION()));
    const unsub = onSnapshot(q, snap => {
      setCases(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, err => {
      console.error('Failed to fetch cases', err);
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) {
    return <div>Loading cases...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => navigate('/admin/create-case')}> <PlusCircle className="inline mr-1" size={16}/> New Case</Button>
      </div>
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-sm font-semibold">Case Name</th>
            <th className="px-2 py-1" colSpan="2">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {cases.map(c => (
            <tr key={c.id}>
              <td className="px-2 py-1">{c.caseName}</td>
              <td className="px-2 py-1 text-right space-x-2">
                <Button onClick={() => navigate(`/admin/edit-case/${c.id}`)} variant="secondary"><Edit3 size={16} className="inline mr-1"/>Edit</Button>
                <Button onClick={() => navigate(`/admin/case-submissions/${c.id}`)} variant="secondary"><Eye size={16} className="inline mr-1"/>Submissions</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
