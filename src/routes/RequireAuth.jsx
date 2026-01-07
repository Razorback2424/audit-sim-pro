import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../AppCore';

export default function RequireAuth() {
  const { currentUser, loadingAuth } = useAuth();
  const location = useLocation();

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  if (!currentUser || currentUser.isAnonymous) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
