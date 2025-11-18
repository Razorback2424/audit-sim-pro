import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth, useUser } from '../AppCore';

export default function RoleRoute({ allowed = [] }) {
  const { role, loadingRole } = useUser();
  const { loadingAuth } = useAuth();
  const location = useLocation();

  if (loadingAuth || loadingRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  if (!role) {
    return <Navigate to="/select-role" state={{ from: location }} replace />;
  }

  if (!allowed.includes(role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
