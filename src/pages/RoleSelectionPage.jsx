import React, { useEffect, useState } from 'react';
import { Users, Briefcase, User, Crown, Loader2 } from 'lucide-react';
import { Button, useAuth, useUser, useRoute } from '../AppCore';

export default function RoleSelectionPage() {
  const { currentUser, loadingAuth } = useAuth();
  const { setRole, role } = useUser();
  const { navigate } = useRoute();
  const [isSettingRole, setIsSettingRole] = useState(false);

  useEffect(() => {
    if (loadingAuth) return;
    if (!currentUser || currentUser.isAnonymous) {
      navigate('/register?next=/select-role');
      return;
    }
    if (role) navigate('/');
  }, [currentUser, role, navigate, loadingAuth]);

  const handleSelectRole = async (nextRole) => {
    setIsSettingRole(true);
    const user = currentUser;
    if (!user || user.isAnonymous) {
      setIsSettingRole(false);
      navigate('/register?next=/select-role');
      return;
    }
    await setRole(nextRole, user);
    setIsSettingRole(false);
  };

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
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Select Your Role</h1>
        <p className="text-gray-600 mb-8">Choose how you&apos;ll be using AuditSim Pro.</p>
        <div className="space-y-4">
          <Button onClick={() => handleSelectRole('owner')} className="w-full py-3 text-lg" isLoading={isSettingRole} disabled={isSettingRole}>
            <Crown size={20} className="inline mr-2" /> Owner
          </Button>
          <Button onClick={() => handleSelectRole('admin')} className="w-full py-3 text-lg" isLoading={isSettingRole} disabled={isSettingRole}>
            <Briefcase size={20} className="inline mr-2" /> Administrator / Instructor
          </Button>
          <Button onClick={() => handleSelectRole('trainee')} variant="secondary" className="w-full py-3 text-lg" isLoading={isSettingRole} disabled={isSettingRole}>
            <User size={20} className="inline mr-2" /> Auditor Trainee
          </Button>
        </div>
        <p className="mt-6 text-sm text-gray-500">Your User ID: {currentUser?.uid || 'Not signed in'}</p>
      </div>
    </div>
  );
}
