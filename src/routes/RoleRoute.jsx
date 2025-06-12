

import React, { useEffect } from 'react';
import { useUser, useRoute } from '../AppCore';

export default function RoleRoute({ allowed = [], children }) {
  const { role, loadingRole } = useUser();
  const { navigate } = useRoute();

  useEffect(() => {
    if (!loadingRole && role && !allowed.includes(role)) {
      navigate('/unauthorized');
    }
  }, [loadingRole, role, allowed, navigate]);

  if (loadingRole) return <div>Loading...</div>;
  if (!role || !allowed.includes(role)) return null;
  return <>{children}</>;
}