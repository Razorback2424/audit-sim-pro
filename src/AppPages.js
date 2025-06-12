// ---------- React and Firebase Imports (Core) ----------
import React, { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';

// ---------- Firebase Service Imports (from AppCore, assuming they are correctly exported there) ----------
import {
    doc, setDoc, getDoc, deleteDoc,
    collection, addDoc, query, where,
    Timestamp, onSnapshot, collectionGroup
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

// ---------- Icon Imports (Lucide) ----------
import {
    PlusCircle, BookOpen, User, LogOut, Eye, Trash2, Edit3, FileText,
    Send, Briefcase, Users, FilePlus, ListChecks, UploadCloud, Users2, Paperclip,
    ListFilter, AlertTriangle, CheckCircle2, Loader2, FileQuestion, XCircle
} from 'lucide-react';

// ---------- Core App Logic Imports (from AppCore.js) ----------
import {
    Button, Input, Textarea, Select,
    useModal, useAuth, useUser, useRoute, // CHANGED: useUser added
    ModalProvider, AuthProvider, UserProvider, RouterProvider, // CHANGED: UserProvider added
    CLASSIFICATION_OPTIONS,
    db, storage, FirestorePaths, appId,
    firebaseApp
} from './AppCore'; // Path as needed

import RoleRoute from './routes/RoleRoute'; // CHANGED: RoleRoute imported

// --- Pages ---
const RoleSelectionPage = () => {
    const { setRole, userProfile, currentUser, loadingAuth } = useAuth();
    const { navigate } = useRoute();
    const [isSettingRole, setIsSettingRole] = useState(false);

    useEffect(() => {
        if (!loadingAuth && userProfile?.role) navigate('/');
    }, [userProfile, navigate, loadingAuth]);

    const handleSelectRole = async (role) => {
        setIsSettingRole(true);
        await setRole(role);
        setIsSettingRole(false);
    };

    if (loadingAuth) return <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4"><Loader2 size={48} className="animate-spin text-blue-600 mb-4" /><p className="text-gray-700">Authenticating...</p></div>;

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
            <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md text-center">
                <Users size={48} className="mx-auto text-blue-600 mb-6" />
                <h1 className="text-3xl font-bold text-gray-800 mb-6">Select Your Role</h1>
                <p className="text-gray-600 mb-8">Choose how you&apos;ll be using AuditSim Pro.</p>
                <div className="space-y-4">
                    <Button onClick={() => handleSelectRole('admin')} className="w-full py-3 text-lg" isLoading={isSettingRole} disabled={isSettingRole}><Briefcase size={20} className="inline mr-2" /> Administrator / Instructor</Button>
                    <Button onClick={() => handleSelectRole('trainee')} variant="secondary" className="w-full py-3 text-lg" isLoading={isSettingRole} disabled={isSettingRole}><User size={20} className="inline mr-2" /> Auditor Trainee</Button>
                </div>
                <p className="mt-6 text-sm text-gray-500">Your User ID: {currentUser?.uid || "Not Available"}</p>
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

// --- Main App Component ---
function App() {
    const { currentUser, loadingAuth, logout } = useAuth();
    const { role, loadingRole } = useUser();
    const { route, navigate } = useRoute();

    useEffect(() => {
        if (loadingAuth || loadingRole) return;
        if (currentUser) {
            if (!role && route !== '/select-role') navigate('/select-role');
            else if (role && route === '/select-role') navigate('/');
        }
    }, [loadingAuth, loadingRole, currentUser, role, route, navigate]);

    if (loadingAuth) return <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4 text-center"><Loader2 size={48} className="animate-spin text-blue-600 mb-4" /><h1 className="text-xl font-semibold text-gray-700">Loading AuditSim Pro...</h1><p className="text-sm text-gray-500">Initializing...</p></div>;

    let pageComponent = null;
    if (route === '/unauthorized') {
        pageComponent = <UnauthorizedPage />;
    } else if (!currentUser && route !== '/select-role') {
        pageComponent = <RoleSelectionPage />;
    } else if (currentUser && !role) {
        pageComponent = <RoleSelectionPage />;
    } else if (role === 'admin') {
        const p = route.split('/');
        if (route === '/' || route.startsWith('/admin/dashboard') || route === '/admin' || route === '') pageComponent = <RoleRoute allowed={['admin']}><AdminDashboardPage /></RoleRoute>;
        else if (route === '/admin/create-case') pageComponent = <RoleRoute allowed={['admin']}><CaseFormPage /></RoleRoute>;
        else if (p[0] === '' && p[1] === 'admin' && p[2] === 'edit-case' && p[3]) pageComponent = <RoleRoute allowed={['admin']}><CaseFormPage params={{ caseId: p[3] }} /></RoleRoute>;
        else if (route === '/admin/user-management') pageComponent = <RoleRoute allowed={['admin']}><AdminUserManagementPage /></RoleRoute>;
        else if (p[0] === '' && p[1] === 'admin' && p[2] === 'case-submissions' && p[3]) pageComponent = <RoleRoute allowed={['admin']}><AdminCaseSubmissionsPage params={{ caseId: p[3] }} /></RoleRoute>;
        else pageComponent = <RoleRoute allowed={['admin']}><AdminDashboardPage /></RoleRoute>;
    } else if (role === 'trainee') {
        const p = route.split('/');
        if (route === '/' || route.startsWith('/trainee/dashboard') || route === '/trainee' || route === '') pageComponent = <TraineeDashboardPage />;
        else if (p[0] === '' && p[1] === 'trainee' && p[2] === 'case' && p[3]) pageComponent = <TraineeCaseViewPage params={{ caseId: p[3] }} />;
        else pageComponent = <TraineeDashboardPage />;
    } else {
        pageComponent = <RoleSelectionPage />;
    }

    return (
        <div className="font-sans antialiased text-gray-900 bg-gray-100 flex flex-col min-h-screen">
            <header className="bg-blue-700 text-white shadow-md sticky top-0 z-40">
                <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                    <h1 className="text-xl sm:text-2xl font-bold cursor-pointer hover:opacity-90" onClick={() => navigate('/')}>AuditSim Pro</h1>
                    <div className="flex items-center space-x-3 sm:space-x-4">
                        {role && <span className="text-xs sm:text-sm capitalize hidden sm:inline">Role: {role}</span>}
                        {currentUser?.uid && <span className="text-xs text-blue-200 hidden md:inline" title={currentUser.uid}>UID: {currentUser.uid.substring(0,8)}...</span>}
                        {currentUser && (<Button onClick={logout} variant="secondary" className="text-xs sm:text-sm px-2 py-1 sm:px-3"><LogOut size={16} className="inline mr-1" /> Logout</Button>)}
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
    CaseFormPage,
    TraineeDashboardPage,
    TraineeCaseViewPage,
    App
};