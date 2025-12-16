import React from 'react';
import { Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button, useAuth, useUser, useRoute, appId } from '../../AppCore';

export default function AppLayout() {
  const { currentUser, logout } = useAuth();
  const { role } = useUser();
  const { navigate } = useRoute();

  return (
    <div className="font-sans antialiased text-gray-900 bg-gray-100 flex flex-col min-h-screen">
      <header className="bg-blue-700 text-white shadow-md sticky top-0 z-40">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <h1
            className="text-xl sm:text-2xl font-bold cursor-pointer hover:opacity-90"
            onClick={() => navigate('/')}
          >
            AuditSim Pro
          </h1>
          <div className="flex items-center space-x-3 sm:space-x-4">
            {role && <span className="text-xs sm:text-sm capitalize hidden sm:inline">Role: {role}</span>}
            {currentUser && (
              <Button onClick={logout} variant="secondary" className="text-xs sm:text-sm px-2 py-1 sm:px-3">
                <LogOut size={16} className="inline mr-1" /> Logout
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-grow container mx-auto px-2 sm:px-4 py-4 sm:py-6">
        <Outlet />
      </main>
      <footer className="bg-gray-800 text-white text-center p-4 text-xs sm:text-sm">
        <p>&copy; {new Date().getFullYear()} AuditSim Pro. For training purposes.</p>
        {appId && <p className="text-xs text-gray-400 mt-1">App ID: {appId}</p>}
      </footer>
    </div>
  );
}
