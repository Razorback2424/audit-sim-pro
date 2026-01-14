import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { LayoutGrid, LogOut, UserCircle2 } from 'lucide-react';
import { Button, useAuth, useRoute, useUser, appId, ROLES } from '../../AppCore';

export default function AppLayout() {
  const { currentUser, logout } = useAuth();
  const { role, loadingRole } = useUser();
  const { navigate } = useRoute();
  const location = useLocation();
  const [moduleTitle, setModuleTitle] = useState('');
  const [moduleSubtitle, setModuleSubtitle] = useState('');

  useEffect(() => {
    const onModuleRoute = location.pathname.includes('/trainee/case') || location.pathname.includes('/cases/');
    const updateHeader = () => {
      if (!onModuleRoute) {
        setModuleTitle('');
        setModuleSubtitle('');
        return;
      }
      setModuleTitle(sessionStorage.getItem('auditsim:moduleTitle') || '');
      setModuleSubtitle(sessionStorage.getItem('auditsim:moduleSubtitle') || '');
    };
    updateHeader();
    const handleUpdate = () => updateHeader();
    window.addEventListener('auditsim:moduleHeader', handleUpdate);
    return () => {
      window.removeEventListener('auditsim:moduleHeader', handleUpdate);
    };
  }, [location.pathname]);

  return (
    <div className="font-sans antialiased text-slate-900 bg-white flex flex-col min-h-screen">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="mx-auto w-full px-4 sm:px-6 lg:px-10 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4 min-w-0">
            <h1
              className="text-xl sm:text-2xl font-bold tracking-tight cursor-pointer shrink-0"
              onClick={() => navigate('/')}
            >
              AuditSim<span className="text-blue-600">Pro</span>
            </h1>
            {moduleTitle ? (
              <div className="border-l border-slate-200 pl-4 min-w-0 max-w-[520px]">
                <p className="text-2xl font-semibold text-slate-900 truncate">{moduleTitle}</p>
                {moduleSubtitle ? (
                  <p className="text-xs text-slate-500 truncate">{moduleSubtitle}</p>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex items-center space-x-3 sm:space-x-4">
            <Button
              variant="secondary"
              className="text-xs sm:text-sm px-2 py-1 sm:px-3"
              onClick={() => {
                if (loadingRole) return;
                if (role === ROLES.ADMIN) {
                  navigate('/admin');
                  return;
                }
                if (role === ROLES.INSTRUCTOR) {
                  navigate('/instructor');
                  return;
                }
                navigate('/trainee');
              }}
            >
              <LayoutGrid size={16} className="inline mr-1" /> Dashboard
            </Button>
            <button
              type="button"
              className="rounded-full text-slate-500 hover:text-slate-700 transition-colors"
              aria-label="Profile"
            >
              <UserCircle2 size={26} />
            </button>
            {currentUser && (
              <Button onClick={logout} variant="secondary" className="text-xs sm:text-sm px-2 py-1 sm:px-3">
                <LogOut size={16} className="inline mr-1" /> Logout
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-grow mx-auto w-full px-3 sm:px-6 lg:px-10 py-4 sm:py-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white text-slate-600 text-center p-4 text-xs sm:text-sm">
        <p>&copy; {new Date().getFullYear()} AuditSim Pro. For training purposes.</p>
        {appId && <p className="text-xs text-slate-400 mt-1">App ID: {appId}</p>}
      </footer>
    </div>
  );
}
