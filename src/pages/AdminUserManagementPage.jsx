import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, FirestorePaths } from '../AppCore';

export default function AdminUserManagementPage() {
  const [userIds, setUserIds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(collection(db, FirestorePaths.USERS_COLLECTION()));
        setUserIds(snap.docs.map(d => d.id));
      } catch (err) {
        console.error('Failed to list users', err);
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return <div>Loading users...</div>;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">User IDs</h2>
      <ul className="list-disc pl-5 space-y-1">
        {userIds.map(id => <li key={id}>{id}</li>)}
      </ul>
    </div>
  );
}
