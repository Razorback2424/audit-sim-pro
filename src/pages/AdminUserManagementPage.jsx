import React, { useEffect, useState } from 'react';
import { Button, Select, useRoute, useModal, useAuth } from '../AppCore';
import { fetchUsersWithProfiles, adminUpdateUserRole } from '../services/userService';

export default function AdminUserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [pendingRoles, setPendingRoles] = useState({});
  const [updatingUserId, setUpdatingUserId] = useState(null);
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const { currentUser } = useAuth();

  useEffect(() => {
    setLoadingUsers(true);
    fetchUsersWithProfiles()
      .then((data) => {
        setUsers(data);
        setLoadingUsers(false);
      })
      .catch((error) => {
        console.error('Error fetching users:', error);
        showModal('Error fetching users: ' + error.message, 'Error');
        setLoadingUsers(false);
      });
  }, [showModal]);

  const handleRoleSelection = (userId, newRole) => {
    setPendingRoles((prev) => ({ ...prev, [userId]: newRole }));
  };

  const handleRoleUpdate = async (user) => {
    const desiredRole = pendingRoles[user.id];
    const currentRole = user.role ?? '';

    if (!desiredRole || desiredRole === currentRole) {
      showModal('Select a different role before saving changes.', 'No Changes Detected');
      return;
    }

    if (currentUser?.uid === user.id) {
      showModal('You cannot change your own role from this screen. Please ask another admin to adjust your role if needed.', 'Action Not Allowed');
      return;
    }

    setUpdatingUserId(user.id);
    try {
      await adminUpdateUserRole(user.id, desiredRole);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, role: desiredRole } : u))
      );
      setPendingRoles((prev) => {
        const next = { ...prev };
        delete next[user.id];
        return next;
      });
      showModal(`Role updated to "${desiredRole}" for user ${user.id}.`, 'Success');
    } catch (error) {
      console.error('Error updating user role:', error);
      showModal('Error updating user role: ' + error.message, 'Error');
    } finally {
      setUpdatingUserId(null);
    }
  };

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
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Update Role
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 break-all">{user.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 capitalize">
                      {user.role ?? 'Unassigned'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.createdAt?.toDate ? user.createdAt.toDate().toLocaleString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-3 space-y-2 sm:space-y-0">
                        <Select
                          value={
                            pendingRoles[user.id] ??
                            (user.role ?? '')
                          }
                          onChange={(event) => handleRoleSelection(user.id, event.target.value)}
                          options={[
                            { value: '', label: 'Select role…', disabled: true },
                            { value: 'admin', label: 'Administrator' },
                            { value: 'trainee', label: 'Trainee' },
                          ]}
                          className="sm:w-40"
                        />
                        <Button
                          onClick={() => handleRoleUpdate(user)}
                          disabled={
                            updatingUserId !== null ||
                            !pendingRoles[user.id] ||
                            pendingRoles[user.id] === (user.role ?? '') ||
                            currentUser?.uid === user.id
                          }
                          isLoading={updatingUserId === user.id}
                        >
                          Save
                        </Button>
                      </div>
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
