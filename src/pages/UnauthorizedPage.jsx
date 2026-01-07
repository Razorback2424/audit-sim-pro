import React from 'react';
import { XCircle } from 'lucide-react';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <XCircle size={48} className="text-red-500 mb-4" />
      <h1 className="text-2xl font-bold mb-2">Unauthorized</h1>
      <p>You do not have permission to view this page.</p>
    </div>
  );
}
