import React from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useUser } from './AppCore';
import RequireAuth from './routes/RequireAuth';
import RoleRoute from './routes/RoleRoute';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';
import RegistrationPage from './pages/RegistrationPage';
import RoleSelectionPage from './pages/RoleSelectionPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminUserManagementPage from './pages/AdminUserManagementPage';
import AdminCaseSubmissionsPage from './pages/AdminCaseSubmissionsPage';
import AdminSubmissionDetailPage from './pages/AdminSubmissionDetailPage';
import AdminCaseOverviewPage from './pages/AdminCaseOverviewPage';
import AdminCaseManagementPage from './pages/AdminCaseManagementPage';
import AdminCaseDataAuditPage from './pages/AdminCaseDataAuditPage';
import AdminCaseProgressPage from './pages/AdminCaseProgressPage';
import AdminDebugDocsPage from './pages/AdminDebugDocsPage';
import AdminBetaDashboardPage from './pages/AdminBetaDashboardPage';
import RecipeFormPage from './pages/RecipeFormPage';
import LandingPage from './pages/LandingPage';
import DemoSurlEntryPage from './pages/DemoSurlEntryPage';
import CheckoutPage from './pages/CheckoutPage';
import CheckoutSuccessPage from './pages/CheckoutSuccessPage';
import CheckoutCancelPage from './pages/CheckoutCancelPage';
import TraineeDashboardPage from './pages/TraineeDashboardPage';
import TraineeCaseViewPage from './pages/TraineeCaseViewPage';
import TraineeSubmissionHistoryPage from './pages/TraineeSubmissionHistoryPage';
import InstructorDashboardPage from './pages/InstructorDashboardPage';
import { ROLES } from './constants/roles';

const WithParams = (Component) =>
  function Wrapper() {
    const params = useParams();
    return <Component params={params} />;
  };

const AdminCaseOverviewRoute = WithParams(AdminCaseOverviewPage);
const AdminCaseSubmissionsRoute = WithParams(AdminCaseSubmissionsPage);
const AdminCaseProgressRoute = WithParams(AdminCaseProgressPage);
const AdminSubmissionDetailRoute = WithParams(AdminSubmissionDetailPage);
const RecipeFormRoute = WithParams(RecipeFormPage);
const TraineeCaseRoute = WithParams(TraineeCaseViewPage);

const HomeRedirect = () => {
  const { role, loadingRole } = useUser();
  if (loadingRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }
  if (role === ROLES.ADMIN || role === ROLES.OWNER) return <Navigate to="/admin" replace />;
  if (role === ROLES.INSTRUCTOR) return <Navigate to="/instructor" replace />;
  if (role === ROLES.TRAINEE) return <Navigate to="/trainee" replace />;
  return <Navigate to="/select-role" replace />;
};

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegistrationPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route path="/" element={<LandingPage />} />
      <Route path="/demo/surl" element={<DemoSurlEntryPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/checkout/success" element={<CheckoutSuccessPage />} />
      <Route path="/checkout/cancel" element={<CheckoutCancelPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/select-role" element={<RoleSelectionPage />} />

        <Route element={<AppLayout />}>
          <Route element={<RoleRoute allowed={[ROLES.ADMIN, ROLES.OWNER]} />}>
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
            <Route path="/admin/edit-recipe/:recipeId" element={<RecipeFormRoute />} />
            <Route path="/admin/case-overview/:caseId" element={<AdminCaseOverviewRoute />} />
            <Route path="/admin/cases" element={<AdminCaseManagementPage />} />
            <Route path="/admin/case-data-audit" element={<AdminCaseDataAuditPage />} />
            <Route path="/admin/debug-docs" element={<AdminDebugDocsPage />} />
            <Route path="/admin/user-management" element={<AdminUserManagementPage />} />
            <Route path="/admin/beta" element={<AdminBetaDashboardPage />} />
            <Route path="/admin/case-submissions/:caseId" element={<AdminCaseSubmissionsRoute />} />
            <Route path="/admin/case-progress/:caseId" element={<AdminCaseProgressRoute />} />
            <Route path="/admin/submission-detail/:caseId/:userId" element={<AdminSubmissionDetailRoute />} />
          </Route>

          <Route element={<RoleRoute allowed={[ROLES.INSTRUCTOR, ROLES.OWNER]} />}>
            <Route path="/instructor" element={<InstructorDashboardPage />} />
          </Route>

          <Route element={<RoleRoute allowed={[ROLES.TRAINEE]} />}>
            <Route path="/trainee" element={<TraineeDashboardPage />} />
            <Route path="/trainee/dashboard" element={<TraineeDashboardPage />} />
            <Route path="/trainee/case/:caseId" element={<TraineeCaseRoute />} />
            <Route path="/cases/:caseId" element={<TraineeCaseRoute />} />
            <Route path="/trainee/submission-history" element={<TraineeSubmissionHistoryPage />} />
            <Route path="/trainee/history" element={<TraineeSubmissionHistoryPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="/home" element={<HomeRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
