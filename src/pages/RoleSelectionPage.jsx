import React, { useEffect } from 'react';
import { Users, Loader2 } from 'lucide-react';
import { Button, useAuth, useRoute, useUser } from '../AppCore';

export default function RoleSelectionPage() {
  const { currentUser, loadingAuth } = useAuth();
  const { role } = useUser();
  const { navigate } = useRoute();
  const isSettingRole = false;

  useEffect(() => {
    if (loadingAuth) return;
    if (!currentUser || currentUser.isAnonymous) {
      navigate('/register?next=/select-role');
      return;
    }
    if (role) navigate('/');
  }, [currentUser, role, navigate, loadingAuth]);

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
        <Loader2 size={48} className="animate-spin text-blue-600 mb-4" />
        <p className="text-gray-700">Authenticating...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md text-center">
        <Users size={48} className="mx-auto text-blue-600 mb-6" />
        <h1 className="text-3xl font-bold text-gray-800 mb-4">Role assignment</h1>
        <p className="text-gray-600 mb-6">
          Roles are now assigned by an administrator. If you need a role change, contact support.
        </p>
        <Button onClick={() => navigate('/home')} className="w-full py-3 text-lg" disabled={isSettingRole}>
          Back to app
        </Button>
        <p className="mt-6 text-sm text-gray-500">Your User ID: {currentUser?.uid || 'Not signed in'}</p>
      </div>
    </div>
  );
}
