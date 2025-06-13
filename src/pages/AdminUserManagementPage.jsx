import React, { useEffect, useState } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, FirestorePaths, Button, useRoute, useModal } from '../AppCore';

export default function AdminUserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const { navigate } = useRoute();
  const { showModal } = useModal();

  useEffect(() => {
    setLoadingUsers(true);
    const usersCollectionRef = collection(db, FirestorePaths.USERS_COLLECTION());
    getDocs(usersCollectionRef)
      .then(async (userDocsSnapshot) => {
        const usersData = [];
        for (const userDoc of userDocsSnapshot.docs) {
          const userId = userDoc.id;
          const profileRef = doc(db, FirestorePaths.USER_PROFILE(userId));
          const profileSnap = await getDoc(profileRef);
          if (profileSnap.exists()) {
            usersData.push({ id: userId, ...profileSnap.data() });
          } else {
            usersData.push({ id: userId, role: 'N/A (No profile data)' });
          }
        }
        setUsers(usersData);
        setLoadingUsers(false);
      })
      .catch((error) => {
        console.error('Error fetching users:', error);
        showModal('Error fetching users: ' + error.message, 'Error');
        setLoadingUsers(false);
      });
  }, [showModal]);

  if (loadingUsers) return <div className="p-4 text-center">Loading users...</div>;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">User Management</h1>
          <Button onClick={() => navigate('/admin')} variant="secondary">
            &larr; Back to Dashboard
          </Button>
        </div>
        {users.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-lg shadow">
            <p className="text-gray-600 text-xl">No users found.</p>
          </div>
        ) : (
          <div className="bg-white shadow-md rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User ID
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Profile Created At
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 break-all">{user.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 capitalize">{user.role}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.createdAt?.toDate ? user.createdAt.toDate().toLocaleString() : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
