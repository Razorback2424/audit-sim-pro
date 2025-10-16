// ---------- React and Firebase Imports (Core) ----------
import React, { useState, useEffect } from 'react';

// ---------- Firebase Service Imports (from AppCore, assuming they are correctly exported there) ----------
// Firebase utilities are used within dedicated page components

// ---------- Icon Imports (Lucide) ----------
import { Users, Briefcase, User, LogOut, Loader2, XCircle } from 'lucide-react';

// ---------- Core App Logic Imports (from AppCore.js) ----------
import {
  Button,
  useAuth,
  useUser,
  useRoute,
  ModalProvider,
  AuthProvider,
  UserProvider,
  RouterProvider,
  appId,
} from './AppCore';

import RoleRoute from './routes/RoleRoute';

// Import dedicated page components
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminUserManagementPage from './pages/AdminUserManagementPage';
import AdminCaseSubmissionsPage from './pages/AdminCaseSubmissionsPage';
import AdminSubmissionDetailPage from './pages/AdminSubmissionDetailPage';
import AdminCaseOverviewPage from './pages/AdminCaseOverviewPage';
import AdminCaseDataAuditPage from './pages/AdminCaseDataAuditPage';
import CaseFormPage from './pages/CaseFormPage';
import TraineeDashboardPage from './pages/TraineeDashboardPage';
import TraineeCaseViewPage from './pages/TraineeCaseViewPage';
import LoginPage from './pages/LoginPage';
import RegistrationPage from './pages/RegistrationPage';

// --- Pages ---
const RoleSelectionPage = () => {
  const { currentUser, loadingAuth } = useAuth();
  const { setRole, userProfile } = useUser();
  const { navigate } = useRoute();
  const [isSettingRole, setIsSettingRole] = useState(false);

  useEffect(() => {
    if (loadingAuth) return;
    if (!currentUser || currentUser.isAnonymous) {
      navigate('/register?next=/select-role');
      return;
    }
    if (userProfile?.role) navigate('/');
  }, [currentUser, userProfile, navigate, loadingAuth]);

  const handleSelectRole = async (role) => {
    setIsSettingRole(true);
    const user = currentUser;
    if (!user || user.isAnonymous) {
      setIsSettingRole(false);
      navigate('/register?next=/select-role');
      return;
    }
    await setRole(role, user);
    setIsSettingRole(false);
  };

  if (loadingAuth)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
        <Loader2 size={48} className="animate-spin text-blue-600 mb-4" />
        <p className="text-gray-700">Authenticating...</p>
      </div>
    );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md text-center">
        <Users size={48} className="mx-auto text-blue-600 mb-6" />
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Select Your Role</h1>
        <p className="text-gray-600 mb-8">Choose how you&apos;ll be using AuditSim Pro.</p>
        <div className="space-y-4">
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
};

// --- New Unauthorized Page ---
const UnauthorizedPage = () => (
  <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
    <XCircle size={48} className="text-red-500 mb-4" />
    <h1 className="text-2xl font-bold mb-2">Unauthorized</h1>
    <p>You do not have permission to view this page.</p>
  </div>
);

// --- routes configuration ---
const adminRoutes = {
  '/': <AdminDashboardPage />,
  '/admin/dashboard': <AdminDashboardPage />,
  '/admin': <AdminDashboardPage />,
  '': <AdminDashboardPage />,
  '/admin/create-case': <CaseFormPage />,
  '/admin/edit-case/:caseId': (params) => <CaseFormPage params={params} />,
  '/admin/case-overview/:caseId': (params) => <AdminCaseOverviewPage params={params} />,
  '/admin/case-data-audit': <AdminCaseDataAuditPage />,
  '/admin/user-management': <AdminUserManagementPage />,
  '/admin/case-submissions/:caseId': (params) => <AdminCaseSubmissionsPage params={params} />,
  '/admin/submission-detail/:caseId/:userId': (params) => <AdminSubmissionDetailPage params={params} />,
};

const traineeRoutes = {
  '/': <TraineeDashboardPage />,
  '/trainee/dashboard': <TraineeDashboardPage />,
  '/trainee': <TraineeDashboardPage />,
  '': <TraineeDashboardPage />,
  '/trainee/case/:caseId': (params) => <TraineeCaseViewPage params={params} />,
};

// --- Main App Component ---
function App() {
  const { currentUser, loadingAuth, logout } = useAuth();
  const { role, loadingRole } = useUser();
  const { route, navigate } = useRoute();

  useEffect(() => {
    if (loadingAuth || loadingRole) return;
    const isOnLogin = typeof route === 'string' && route.startsWith('/login');
    const isOnRegister = typeof route === 'string' && route.startsWith('/register');

    if (!currentUser || currentUser.isAnonymous) {
      if (!isOnLogin && !isOnRegister) navigate('/register');
      return;
    }
    if (isOnLogin || isOnRegister) {
      navigate('/');
      return;
    }
    if (!role && route !== '/select-role') navigate('/select-role');
    else if (role && route === '/select-role') navigate('/');
  }, [loadingAuth, loadingRole, currentUser, role, route, navigate]);

  if (loadingAuth || loadingRole) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4 text-center">
        <Loader2 size={48} className="animate-spin text-blue-600 mb-4" />
        <h1 className="text-xl font-semibold text-gray-700">Loading AuditSim Pro...</h1>
        <p className="text-sm text-gray-500">Initializing...</p>
      </div>
    );
  }

  if (route === '/unauthorized') {
    return <UnauthorizedPage />;
  }

  if (!currentUser || currentUser.isAnonymous) {
    if (typeof route === 'string' && route.startsWith('/register')) return <RegistrationPage />;
    return <LoginPage />;
  }

  if (!role) {
    return <RoleSelectionPage />;
  }

  const renderRoute = (routes) => {
    for (const path in routes) {
      const pathSegments = path.split('/');
      const routeSegments = route.split('/');

      if (pathSegments.length === routeSegments.length) {
        const params = {};
        const match = pathSegments.every((segment, i) => {
          if (segment.startsWith(':')) {
            params[segment.substring(1)] = routeSegments[i];
            return true;
          }
          return segment === routeSegments[i];
        });

        if (match) {
          const component = routes[path];
          return typeof component === 'function' ? component(params) : component;
        }
      }
    }
    return null;
  };

  let pageComponent;
  if (role === 'admin') {
    pageComponent = renderRoute(adminRoutes) || <AdminDashboardPage />;
    pageComponent = <RoleRoute allowed={['admin']}>{pageComponent}</RoleRoute>;
  } else if (role === 'trainee') {
    pageComponent = renderRoute(traineeRoutes) || <TraineeDashboardPage />;
    pageComponent = <RoleRoute allowed={['trainee']}>{pageComponent}</RoleRoute>;
  } else {
    pageComponent = <RoleSelectionPage />;
  }

  return (
    <div className="font-sans antialiased text-gray-900 bg-gray-100 flex flex-col min-h-screen">
      <header className="bg-blue-700 text-white shadow-md sticky top-0 z-40">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl sm:text-2xl font-bold cursor-pointer hover:opacity-90" onClick={() => navigate('/')}>
            AuditSim Pro
          </h1>
          <div className="flex items-center space-x-3 sm:space-x-4">
            {role && <span className="text-xs sm:text-sm capitalize hidden sm:inline">Role: {role}</span>}
            {currentUser?.uid && (
              <span className="text-xs text-blue-200 hidden md:inline" title={currentUser.uid}>
                UID: {currentUser.uid.substring(0, 8)}...
              </span>
            )}
            {currentUser && (
              <Button onClick={logout} variant="secondary" className="text-xs sm:text-sm px-2 py-1 sm:px-3">
                <LogOut size={16} className="inline mr-1" /> Logout
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-grow container mx-auto px-2 sm:px-4 py-4 sm:py-6">{pageComponent}</main>
      <footer className="bg-gray-800 text-white text-center p-4 text-xs sm:text-sm">
        <p>&copy; {new Date().getFullYear()} AuditSim Pro. For training purposes.</p>
        {appId && <p className="text-xs text-gray-400 mt-1">App ID: {appId}</p>}
      </footer>
    </div>
  );
}

// Main export with all providers
export default function AuditSimProAppWithProviders() {
  return (
    <ModalProvider>
      <AuthProvider>
        <UserProvider>
          <RouterProvider>
            <App />
          </RouterProvider>
        </UserProvider>
      </AuthProvider>
    </ModalProvider>
  );
}

// Export individual pages if needed
export {
  RoleSelectionPage,
  UnauthorizedPage,
  AdminDashboardPage,
  AdminUserManagementPage,
  AdminCaseSubmissionsPage,
  AdminSubmissionDetailPage,
  AdminCaseOverviewPage,
  CaseFormPage,
  TraineeDashboardPage,
  TraineeCaseViewPage,
  App,
};
