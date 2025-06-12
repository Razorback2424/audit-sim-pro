/* global __firebase_config, __app_id, __initial_auth_token */
/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
// ---------- React and Firebase Imports (Core) ----------
import React, { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';

// ---------- Firebase Service Imports (from AppCore, assuming they are correctly exported there) ----------
// These are typically initialized in AppCore and exported.
// For AppPages, we'll import the ready-to-use instances.
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
// These hooks, providers, and constants are defined in AppCore.js
// Ensure AppCore.js correctly exports all of these.
import {
    Button, Input, Textarea, Select,
    useModal, useAuth, useRoute, // Core hooks
    ModalProvider, AuthProvider, RouterProvider, // Core providers
    CLASSIFICATION_OPTIONS, // Constants
    db, storage, FirestorePaths, appId,
    firebaseApp
} from './AppCore'; // Assuming AppCore.js is in the same directory or path is adjusted

// --- Pages ---
const RoleSelectionPage = () => {
    const { setRole, userProfile, currentUser, loadingAuth } = useAuth(); // Changed: userId to currentUser
    const { navigate } = useRoute();
    const [isSettingRole, setIsSettingRole] = useState(false);

    useEffect(() => {
        if (!loadingAuth && userProfile?.role) navigate('/');
    }, [userProfile, navigate, loadingAuth]);

    const handleSelectRole = async (role) => {
        setIsSettingRole(true);
        await setRole(role);
        setIsSettingRole(false);
        // Navigation will be handled by the App component or the useEffect above based on userProfile update
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
                <p className="mt-6 text-sm text-gray-500">Your User ID: {currentUser?.uid || "Not Available"}</p> {/* Changed: userId to currentUser?.uid */}
            </div>
        </div>
    );
};

const AdminDashboardPage = () => {
    const { navigate } = useRoute();
    const [cases, setCases] = useState([]);
    const [loadingCases, setLoadingCases] = useState(true);
    const { showModal } = useModal();
    const { currentUser, userProfile, loadingAuth } = useAuth(); // currentUser is already used here, no direct userId

    useEffect(() => {
        if (loadingAuth || !currentUser || !userProfile || userProfile.role !== 'admin') {
            if (!loadingAuth && currentUser && !userProfile) {
                // Waiting for profile creation / role selection
            } else if (!loadingAuth && userProfile && userProfile.role !== 'admin') {
                navigate('/');
            }
            setLoadingCases(false);
            return;
        }

        setLoadingCases(true);
        const casesCollectionRef = collection(db, FirestorePaths.CASES_COLLECTION());
        const q = query(casesCollectionRef); // Consider adding orderBy here if needed
        const unsubscribe = onSnapshot(
            q,
            snap => {
                setCases(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setLoadingCases(false);
            },
            err => {
                showModal(
                    `Error fetching cases: ${err.message} (Code: ${err.code || 'N/A'})`,
                    'Error'
                );
                setLoadingCases(false);
            }
        );

        return () => unsubscribe();
    }, [
        loadingAuth,
        currentUser,
        userProfile,
        navigate,
        showModal
    ]);

    const deleteCase = async (caseId) => {
        showModal(<> <p className="text-gray-700 mb-2">Are you sure?</p><p className="text-sm text-red-600">This marks it deleted. Files in Storage NOT auto-deleted.</p></>, "Confirm Deletion",
            (hideModalFn) => (<><Button onClick={hideModalFn} variant="secondary">Cancel</Button><Button onClick={async () => { hideModalFn(); try { await setDoc(doc(db, FirestorePaths.CASE_DOCUMENT(caseId)), { _deleted: true, updatedAt: Timestamp.now() }, { merge: true }); showModal("Case marked for deletion.", "Success");} catch (e) { showModal("Error deleting case: " + e.message, "Error");}}} variant="danger" className="ml-2">Confirm Delete</Button></>)
        );
    };

    if (loadingCases) return <div className="p-6 text-center"><Loader2 size={32} className="animate-spin text-blue-600 mx-auto mb-3" />Loading cases...</div>;
    const activeCases = cases.filter(c => !c._deleted);

    return (
        <div className="p-4 sm:p-6 bg-gray-50 min-h-screen">
            <div className="max-w-5xl mx-auto">
                <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4"><h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Admin Dashboard</h1><div className="flex space-x-2"><Button onClick={() => navigate('/admin/user-management')} size="sm"><Users2 size={18} className="inline mr-1 sm:mr-2" /> User Management</Button><Button onClick={() => navigate('/admin/create-case')} size="sm"><FilePlus size={18} className="inline mr-1 sm:mr-2" /> Create New Case</Button></div></div>
                {activeCases.length === 0 ? (<div className="text-center py-12 bg-white rounded-lg shadow-md"><ListChecks size={56} className="mx-auto text-gray-400 mb-5" /><p className="text-gray-700 text-xl font-semibold">No active cases.</p><p className="text-gray-500 mt-2">Create a new audit case.</p></div>) :
                    (<div className="space-y-5">{activeCases.map(caseData => (<div key={caseData.id} className="bg-white p-5 rounded-lg shadow-md hover:shadow-lg transition-shadow"><div className="flex flex-col sm:flex-row justify-between items-start gap-4"><div className="flex-grow"><h2 className="text-xl font-semibold text-blue-700 mb-1">{caseData.caseName}</h2><p className="text-xs text-gray-400 mb-2">ID: {caseData.id}</p><div className="text-sm text-gray-600 space-y-1"><p>Disbursements: <span className="font-medium">{caseData.disbursements?.length || 0}</span></p><p>Inv. Mappings: <span className="font-medium">{caseData.invoiceMappings?.length || 0}</span></p><p>Visible to: <span className="font-medium">{caseData.visibleToUserIds?.length > 0 ? `${caseData.visibleToUserIds.length} user(s)` : 'All Trainees'}</span></p><p className="text-xs text-gray-500">Updated: {caseData.updatedAt?.toDate().toLocaleString() || 'N/A'}</p></div></div><div className="flex flex-col space-y-2 items-stretch w-full sm:w-auto sm:items-end shrink-0"><Button onClick={() => navigate(`/admin/case-submissions/${caseData.id}`)} variant="secondary" className="w-full text-sm"><ListFilter size={16} className="inline mr-1" /> View Submissions</Button><Button onClick={() => navigate(`/admin/edit-case/${caseData.id}`)} variant="secondary" className="w-full text-sm"><Edit3 size={16} className="inline mr-1" /> Edit</Button><Button onClick={() => deleteCase(caseData.id)} variant="danger" className="w-full text-sm"><Trash2 size={16} className="inline mr-1" /> Delete</Button></div></div></div>))}</div>)}
            </div>
        </div>
    );
};

const AdminUserManagementPage = () => {
    const [users, setUsers] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const { navigate } = useRoute();
    const { showModal } = useModal();
    const { userProfile } = useAuth();

    useEffect(() => {
      if (userProfile?.role !== 'admin') { navigate('/'); return; }

      setLoadingUsers(true);
      const q = query(
        collectionGroup(db, 'userProfileData'),
        where('role', 'in', ['admin', 'trainee'])
      );
      const unsubscribe = onSnapshot(q, snap => {
        setUsers(
          snap.docs.map(d => ({
            id: d.ref.path.split('/')[1],
            ...d.data()
          }))
        );
        setLoadingUsers(false);
      }, err => {
        showModal('Error fetching users: ' + err.message, 'Error');
        setLoadingUsers(false);
      });
      return () => unsubscribe();
    }, [showModal, navigate, userProfile]);

    if (loadingUsers) return <div className="p-6 text-center"><Loader2 size={32} className="animate-spin text-blue-600 mx-auto mb-3" />Loading users...</div>;

    return (
        <div className="p-4 sm:p-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4"><h1 className="text-2xl sm:text-3xl font-bold text-gray-800">User Management</h1><Button onClick={() => navigate('/admin')} variant="secondary" size="sm">&larr; Back to Dashboard</Button></div>
                {users.length === 0 ? (<div className="text-center py-12 bg-white rounded-lg shadow-md"><Users2 size={56} className="mx-auto text-gray-400 mb-5" /><p className="text-gray-700 text-xl font-semibold">No users found.</p><p className="text-gray-500 mt-2">Users appear here after role selection.</p></div>) :
                    (<div className="bg-white shadow-md rounded-lg overflow-x-auto"><table className="min-w-full divide-y divide-gray-200"><thead className="bg-gray-100"><tr><th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">User ID</th><th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Role</th><th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Email</th><th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Profile Created</th></tr></thead><tbody className="bg-white divide-y divide-gray-200">{users.map(user => (<tr key={user.id} className="hover:bg-gray-50"><td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 break-all" title={user.id}>{user.id.substring(0,15)}...</td><td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 capitalize">{user.role}</td><td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.email || 'N/A'}</td><td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.createdAt?.toDate().toLocaleString() || 'N/A'}</td></tr>))}</tbody></table></div>)}
            </div>
        </div>
    );
};

const AdminCaseSubmissionsPage = ({ params }) => {
    const { caseId } = params;
    const [submissions, setSubmissions] = useState([]);
    const [loadingSubmissions, setLoadingSubmissions] = useState(true);
    const [caseName, setCaseName] = useState('');
    const { navigate } = useRoute();
    const { showModal } = useModal();
    const { userProfile } = useAuth();

    useEffect(() => {
      if (userProfile?.role !== 'admin') { navigate('/'); return; }
      if (!caseId) { showModal('No Case ID provided.', 'Error'); navigate('/admin'); return; }

      setLoadingSubmissions(true);

      getDoc(doc(db, FirestorePaths.CASE_DOCUMENT(caseId)))
        .then(ds => setCaseName(ds.exists() ? ds.data().caseName : 'Unknown Case'))
        .catch(e => showModal('Error fetching case details: ' + e.message, 'Error'));

      const submissionsQ = query(
        collectionGroup(db, 'caseSubmissions'),
        where('caseId', '==', caseId)
      );
      const unsubscribe = onSnapshot(submissionsQ, snap => {
        setSubmissions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoadingSubmissions(false);
      }, e => {
        showModal('Error fetching submissions: ' + e.message, 'Error');
        setLoadingSubmissions(false);
      });
      return () => unsubscribe();
    }, [caseId, navigate, showModal, userProfile]);

    if (loadingSubmissions) return <div className="p-6 text-center"><Loader2 size={32} className="animate-spin text-blue-600 mx-auto mb-3" />Loading submissions for {caseName || `Case ID: ${caseId}`}...</div>;

    return (
        <div className="p-4 sm:p-6 bg-gray-50 min-h-screen"><div className="max-w-4xl mx-auto"><div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-3"><div className="text-center sm:text-left"><h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Submissions for:</h1><h2 className="text-lg sm:text-xl text-blue-600 font-semibold">{caseName || `Case ID: ${caseId}`}</h2></div><Button onClick={() => navigate('/admin')} variant="secondary" size="sm">&larr; Back to Dashboard</Button></div>
            {submissions.length === 0 ? (<div className="text-center py-12 bg-white rounded-lg shadow-md"><ListFilter size={56} className="mx-auto text-gray-400 mb-5" /><p className="text-gray-700 text-xl font-semibold">No submissions yet for this case.</p></div>) :
                (<div className="space-y-5">{submissions.map(s => (<div key={s.userId} className="bg-white p-5 rounded-lg shadow-md"><h3 className="text-lg font-semibold text-gray-700 mb-1">User ID: <span className="font-normal text-sm text-gray-500 break-all">{s.userId}</span></h3><p className="text-xs text-gray-500 mb-3">Submitted: {(s.classificationsSubmittedAt || s.submittedAt)?.toDate().toLocaleString() || 'N/A'}</p><div className="mb-2"><p className="text-sm font-medium text-gray-600">Selected IDs ({s.selectedPaymentIds?.length || 0}):</p>{s.selectedPaymentIds?.length > 0 ? (<ul className="list-disc list-inside pl-5 text-sm text-gray-500 max-h-24 overflow-y-auto">{s.selectedPaymentIds.map(pid => <li key={pid}>{pid}</li>)}</ul>) : <p className="text-sm text-gray-500 italic">None</p>}</div><div><p className="text-sm font-medium text-gray-600">Retrieved Docs ({s.retrievedDocuments?.length || 0}):</p>{s.retrievedDocuments?.length > 0 ? (<ul className="list-disc list-inside pl-5 text-sm text-gray-500 max-h-24 overflow-y-auto">{s.retrievedDocuments.map((d, i) => <li key={i} title={d.storagePath}>{d.fileName}</li>)}</ul>) : <p className="text-sm text-gray-500 italic">None</p>}</div>{s.classifications && s.classifications.length > 0 && (<div className="mt-3 pt-3 border-t"><p className="text-sm font-medium text-gray-600 mb-1">Classifications ({s.classifications.length}):</p><ul className="list-disc list-inside pl-5 text-sm text-gray-500 max-h-32 overflow-y-auto">{s.classifications.map((c,i) => (<li key={i}>{c.paymentId}: {c.traineeClassification}</li>))}</ul></div>)}</div>))}</div>)}
        </div></div>
    );
};

// --- Components for CaseFormPage ---
const DisbursementItem = ({ item, index, onChange, onRemove }) => {
    const handleChange = (e) => {
        const { name, value } = e.target;
        onChange(index, { ...item, [name]: value });
    };

    return (
        <div className="p-4 border border-gray-300 rounded-lg bg-gray-50 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                <div className="md:col-span-1">
                    <label htmlFor={`disbursement-paymentId-${item._tempId}`} className="block text-xs font-medium text-gray-700 mb-1">Payment ID <span className="text-red-500">*</span></label>
                    <Input id={`disbursement-paymentId-${item._tempId}`} name="paymentId" value={item.paymentId || ''} onChange={handleChange} placeholder="PYMT-001" required />
                </div>
                <div className="md:col-span-1">
                    <label htmlFor={`disbursement-payee-${item._tempId}`} className="block text-xs font-medium text-gray-700 mb-1">Payee <span className="text-red-500">*</span></label>
                    <Input id={`disbursement-payee-${item._tempId}`} name="payee" value={item.payee || ''} onChange={handleChange} placeholder="Vendor Name" required />
                </div>
                <div className="md:col-span-1">
                    <label htmlFor={`disbursement-amount-${item._tempId}`} className="block text-xs font-medium text-gray-700 mb-1">Amount <span className="text-red-500">*</span></label>
                    <Input id={`disbursement-amount-${item._tempId}`} name="amount" type="number" value={item.amount || ''} onChange={handleChange} placeholder="123.45" step="0.01" required />
                </div>
                <div className="md:col-span-1">
                    <label htmlFor={`disbursement-paymentDate-${item._tempId}`} className="block text-xs font-medium text-gray-700 mb-1">Payment Date <span className="text-red-500">*</span></label>
                    <Input id={`disbursement-paymentDate-${item._tempId}`} name="paymentDate" type="date" value={item.paymentDate || ''} onChange={handleChange} required />
                </div>
                <Button onClick={() => onRemove(index)} variant="danger" className="h-10 w-full md:w-auto">
                    <Trash2 size={18} /> <span className="sr-only">Remove Disbursement</span>
                </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-gray-200 mt-3">
                <div>
                    <label htmlFor={`disbursement-correctClassification-${item._tempId}`} className="block text-xs font-medium text-gray-700 mb-1">Correct Classification <span className="text-red-500">*</span></label>
                    <Select
                        id={`disbursement-correctClassification-${item._tempId}`}
                        name="correctClassification"
                        value={item.correctClassification || ''}
                        onChange={handleChange}
                        options={CLASSIFICATION_OPTIONS}
                        required
                    />
                </div>
                <div>
                    <label htmlFor={`disbursement-explanation-${item._tempId}`} className="block text-xs font-medium text-gray-700 mb-1">Explanation for Classification <span className="text-red-500">*</span></label>
                    <Textarea
                        id={`disbursement-explanation-${item._tempId}`}
                        name="explanation"
                        value={item.explanation || ''}
                        onChange={handleChange}
                        placeholder="Explain why this classification is correct..."
                        rows={3}
                        required
                    />
                </div>
            </div>
        </div>
    );
};

const InvoiceMappingItem = ({ item, index, onChange, onRemove, availablePaymentIds, onFileSelect }) => {
    const fileInputId = `pdfFile-${item._tempId || index}`;
    const handleFileChange = (event) => { if (event.target.files[0]) onFileSelect(index, event.target.files[0]); };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start p-3 border border-gray-200 rounded-md bg-gray-50/50">
            <div>
                <label htmlFor={`mapping-paymentId-${item._tempId}`} className="block text-xs font-medium text-gray-700 mb-1">Link to Payment ID <span className="text-red-500">*</span></label>
                <Select id={`mapping-paymentId-${item._tempId}`} name="paymentId" value={item.paymentId || ''} onChange={(e) => onChange(index, { ...item, paymentId: e.target.value })} options={[{value: "", label: "Select Payment ID"}, ...availablePaymentIds.map(pid => ({value: pid, label: pid}))]} required />
            </div>
            <div className="flex flex-col">
                <label htmlFor={fileInputId} className="block text-xs font-medium text-gray-700 mb-1">Invoice PDF <span className="text-red-500">*</span></label>
                <Input id={fileInputId} type="file" accept=".pdf,application/pdf" onChange={handleFileChange} className="mt-1 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border file:border-gray-300 file:text-sm file:font-medium file:bg-gray-50 hover:file:bg-gray-100" />
                {item.fileName && (<div className="mt-2 text-xs text-gray-600 flex items-center" title={item.fileName}><Paperclip size={14} className="mr-1 shrink-0 text-gray-500" /> <span className="truncate max-w-[150px] sm:max-w-[200px]">{item.fileName}</span>{item.downloadURL && <a href={item.downloadURL} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-500 hover:underline"><Eye size={14}/></a>}</div>)}
                {item.uploadProgress >= 0 && item.uploadProgress < 100 && !item.uploadError && (<div className="w-full bg-gray-200 rounded-full h-1.5 mt-2"><div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${item.uploadProgress}%` }}></div></div>)}
                {item.uploadProgress === 100 && !item.uploadError && item.clientSideFile && (<p className="text-xs text-green-600 mt-1 flex items-center"><CheckCircle2 size={14} className="mr-1"/>File ready</p>)}
                {item.uploadProgress === 100 && !item.uploadError && !item.clientSideFile && item.storagePath && (<p className="text-xs text-green-600 mt-1 flex items-center"><CheckCircle2 size={14} className="mr-1"/>Uploaded</p>)}
                {item.uploadError && <p className="text-xs text-red-500 mt-1 flex items-center"><AlertTriangle size={14} className="mr-1"/>{item.uploadError}</p>}
            </div>
            <Button onClick={() => onRemove(index)} variant="danger" className="h-10 w-full md:w-auto self-end"><Trash2 size={18} /> <span className="sr-only">Remove Mapping</span></Button>
        </div>
    );
};

// --- Main Case Form Page ---
const CaseFormPage = ({ params }) => {
    const { caseId: editingCaseId } = params || {};
    const isEditing = !!editingCaseId;
    const { navigate } = useRoute();
    const { currentUser, userProfile } = useAuth(); // Changed: userId to currentUser
    const { showModal } = useModal();

    const [apAgingReportFile, setApAgingReportFile] = useState(null);
    const [apAgingReportFileName, setApAgingReportFileName] = useState('');
    const [apAgingReportStoragePath, setApAgingReportStoragePath] = useState('');
    const [apAgingReportDownloadURL, setApAgingReportDownloadURL] = useState('');
    const [apAgingReportUploadProgress, setApAgingReportUploadProgress] = useState(undefined);
    const [apAgingReportUploadError, setApAgingReportUploadError] = useState(null);
    const apAgingReportInputRef = React.useRef(null);

    const initialDisbursement = () => ({
        _tempId: crypto.randomUUID(),
        paymentId: '', payee: '', amount: '', paymentDate: '',
        correctClassification: '',
        explanation: ''
    });
    const initialMapping = () => ({ _tempId: crypto.randomUUID(), paymentId: '', fileName: '', storagePath: '', clientSideFile: null, uploadProgress: undefined, uploadError: null, downloadURL: '' });

    const [caseName, setCaseName] = useState('');
    const [visibleToUserIdsStr, setVisibleToUserIdsStr] = useState('');
    const [disbursements, setDisbursements] = useState([initialDisbursement()]);
    const [invoiceMappings, setInvoiceMappings] = useState([initialMapping()]);
    const [formLoading, setFormLoading] = useState(false);
    const [originalCaseData, setOriginalCaseData] = useState(null);
    const disbursementCsvInputRef = React.useRef(null);

    useEffect(() => {
        if (userProfile?.role !== 'admin') { showModal("Not authorized.", "Unauthorized"); navigate('/admin'); return; }
        if (isEditing && editingCaseId) {
            setFormLoading(true);
            getDoc(doc(db, FirestorePaths.CASE_DOCUMENT(editingCaseId))).then(docSnap => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data._deleted) { showModal("Case deleted.", "Error"); navigate('/admin'); return; }
                    setOriginalCaseData(data);
                    setCaseName(data.caseName || '');
                    setVisibleToUserIdsStr((data.visibleToUserIds || []).join(', '));
                    setApAgingReportFileName(data.apAgingReportFileName || '');
                    setApAgingReportStoragePath(data.apAgingReportStoragePath || '');
                    setApAgingReportDownloadURL(data.apAgingReportDownloadURL || '');
                    setDisbursements(data.disbursements?.map(d => ({ ...d, _tempId: d._tempId || crypto.randomUUID(), correctClassification: d.correctClassification || '', explanation: d.explanation || '' })) || [initialDisbursement()]);
                    setInvoiceMappings(data.invoiceMappings?.map(m => ({ ...m, _tempId: m._tempId || crypto.randomUUID(), clientSideFile: null, uploadProgress: m.storagePath ? 100 : undefined, uploadError: null })) || [initialMapping()]);
                } else { showModal("Case not found.", "Error"); navigate('/admin'); }
                setFormLoading(false);
            }).catch(error => { showModal("Error fetching case: " + error.message, "Error"); setFormLoading(false); navigate('/admin'); });
        } else {
            setCaseName(''); setVisibleToUserIdsStr('');
            setApAgingReportFile(null); setApAgingReportFileName(''); setApAgingReportStoragePath(''); setApAgingReportDownloadURL(''); setApAgingReportUploadProgress(undefined); setApAgingReportUploadError(null);
            setDisbursements([initialDisbursement()]); setInvoiceMappings([initialMapping()]);
            setOriginalCaseData(null); setFormLoading(false);
        }
    }, [isEditing, editingCaseId, navigate, showModal, userProfile]);

    const handleDisbursementChange = (index, updatedItem) => {
        const newDisbursements = [...disbursements];
        newDisbursements[index] = updatedItem;
        setDisbursements(newDisbursements);
    };
    const addDisbursement = () => setDisbursements([...disbursements, initialDisbursement()]);
    const removeDisbursement = (index) => {
        const removedPaymentId = disbursements[index]?.paymentId;
        setDisbursements(disbursements.filter((_, i) => i !== index));
        if(removedPaymentId) setInvoiceMappings(prevMappings => prevMappings.filter(m => m.paymentId !== removedPaymentId));
    };

    const handleMappingChange = (index, updatedItem) => { const newMappings = [...invoiceMappings]; newMappings[index] = updatedItem; setInvoiceMappings(newMappings); };
    const handleMappingFileSelect = (index, file) => setInvoiceMappings(prev => prev.map((m, i) => i === index ? { ...m, clientSideFile: file, fileName: file.name, storagePath: '', uploadProgress: 0, uploadError: null, downloadURL: '' } : m));
    const addMapping = () => setInvoiceMappings([...invoiceMappings, initialMapping()]);
    const removeMapping = (index) => setInvoiceMappings(invoiceMappings.filter((_, i) => i !== index));
    const availablePaymentIdsForMapping = disbursements.map(d => d.paymentId).filter(id => id && id.trim() !== "");

    const handleApAgingReportFileSelect = (event) => {
        const file = event.target.files[0];
        if (file) {
            setApAgingReportFile(file);
            setApAgingReportFileName(file.name);
            setApAgingReportStoragePath('');
            setApAgingReportDownloadURL('');
            setApAgingReportUploadProgress(0);
            setApAgingReportUploadError(null);
        }
    };

    const uploadApAgingReport = async (caseIdForUpload) => {
        if (!apAgingReportFile) {
            if (apAgingReportStoragePath) {
                return { fileName: apAgingReportFileName, storagePath: apAgingReportStoragePath, downloadURL: apAgingReportDownloadURL, uploadError: null };
            }
            return null;
        }
        const file = apAgingReportFile;
        if (!caseIdForUpload) {
            const errorMsg = "Critical: Case ID is missing for AP Aging Report upload.";
            setApAgingReportUploadError(errorMsg); setApAgingReportUploadProgress(undefined);
            throw new Error(errorMsg);
        }
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const finalStoragePath = `artifacts/${appId}/case_ap_aging/${caseIdForUpload}/ap_aging_report_${sanitizedFileName}`;
        setApAgingReportStoragePath(finalStoragePath);
        setApAgingReportUploadProgress(0);
        setApAgingReportUploadError(null);
        const fileRef = storageRef(storage, finalStoragePath);
        const uploadTask = uploadBytesResumable(fileRef, file, { contentType: file.type });
        return new Promise((resolve) => {
            uploadTask.on('state_changed',
                (snapshot) => setApAgingReportUploadProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
                (error) => {
                    setApAgingReportUploadError(error.message); setApAgingReportUploadProgress(undefined);
                    resolve({ fileName: sanitizedFileName, storagePath: finalStoragePath, uploadError: error.message, downloadURL: '' });
                },
                async () => {
                    try {
                        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                        setApAgingReportDownloadURL(downloadURL); setApAgingReportUploadProgress(100);
                        resolve({ fileName: sanitizedFileName, storagePath: finalStoragePath, downloadURL, uploadError: null });
                    } catch (error) {
                        setApAgingReportUploadError("Failed to get Download URL."); setApAgingReportDownloadURL('');
                        resolve({ fileName: sanitizedFileName, storagePath: finalStoragePath, uploadError: "Upload Succeeded, but failed to get download URL.", downloadURL: '' });
                    }
                }
            );
        });
    };

    const handleCsvImport = (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result; if (!text?.trim()) { showModal("CSV empty.", "CSV Error"); return; }
            try {
                const lines = text.split(/\r\n|\n/).filter(l => l.trim() !== ''); if (lines.length <= 1) { showModal("CSV needs header + data.", "CSV Error"); if(disbursementCsvInputRef.current) disbursementCsvInputRef.current.value = ""; return; }
                const imported = lines.slice(1).map((line, idx) => {
                    const parts = line.split(',').map(p => p.trim()); if (parts.length < 4) { console.warn(`Skipping CSV line ${idx + 2}: insufficient columns.`); return null; }
                    const [paymentId, payee, amountStr, paymentDate] = parts;
                    if (!paymentId || !payee || !amountStr || !paymentDate) { console.warn(`Skipping CSV line ${idx + 2}: missing data.`); return null; }
                    const amount = parseFloat(amountStr); if (isNaN(amount)) { console.warn(`Skipping CSV line ${idx + 2}: invalid amount '${amountStr}'.`); return null; }
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) { console.warn(`Skipping CSV line ${idx + 2}: invalid date '${paymentDate}'.`); return null; }
                    return { _tempId: crypto.randomUUID(), paymentId, payee, amount: amount.toFixed(2), paymentDate, correctClassification: '', explanation: '' };
                }).filter(d => d !== null);
                if (imported.length > 0) { setDisbursements(imported); showModal(`${imported.length} disbursements imported. Review entries.`, "CSV Success"); }
                else { showModal("No valid disbursements in CSV.", "CSV Error"); }
            } catch (err) { showModal("Error parsing CSV: " + err.message, "CSV Error"); }
            if(disbursementCsvInputRef.current) disbursementCsvInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const uploadInvoiceFileAndGetMetadata = async (mappingItem, caseIdForUpload) => {
        if (mappingItem.storagePath && !mappingItem.clientSideFile) {
            const { clientSideFile, uploadProgress, uploadError, _tempId, ...rest } = mappingItem;
            return rest;
        }
        if (!mappingItem.clientSideFile) return null;
        const file = mappingItem.clientSideFile;
        if (!caseIdForUpload) {
            const msg = "Critical: Case ID missing for invoice upload.";
            setInvoiceMappings(prevMappings => prevMappings.map(m => m._tempId === mappingItem._tempId ? {...m, uploadError: msg} : m));
            throw new Error(msg);
        }
        const sFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const fPath = `artifacts/${appId}/case_documents/${caseIdForUpload}/${sFileName}`;
        setInvoiceMappings(prevMappings => prevMappings.map(m =>
            m._tempId === mappingItem._tempId ? {...m, storagePath: fPath, uploadProgress: 0, uploadError: null, fileName: sFileName} : m
        ));
        const fRef = storageRef(storage, fPath);
        const task = uploadBytesResumable(fRef, file, { contentType: file.type });
        return new Promise((resolve) => {
            task.on('state_changed',
                (snapshot) => setInvoiceMappings(prevMappings => prevMappings.map(m =>
                    m._tempId === mappingItem._tempId ? {...m, uploadProgress: (snapshot.bytesTransferred / snapshot.totalBytes) * 100} : m
                )),
                (error) => {
                    setInvoiceMappings(prevMappings => prevMappings.map(m =>
                        m._tempId === mappingItem._tempId ? {...m, uploadError: error.message} : m
                    ));
                    resolve({ paymentId: mappingItem.paymentId, fileName: sFileName, storagePath: fPath, uploadError: error.message, downloadURL: '' });
                },
                async () => {
                    try {
                        const url = await getDownloadURL(task.snapshot.ref);
                        setInvoiceMappings(prevMappings => prevMappings.map(m =>
                            m._tempId === mappingItem._tempId ? {...m, uploadProgress: 100, downloadURL: url} : m
                        ));
                        resolve({ paymentId: mappingItem.paymentId, fileName: sFileName, storagePath: fPath, downloadURL: url, uploadError: null });
                    } catch (error) {
                        setInvoiceMappings(prevMappings => prevMappings.map(m =>
                            m._tempId === mappingItem._tempId ? {...m, uploadError: "Failed to get Download URL."} : m
                        ));
                        resolve({ paymentId: mappingItem.paymentId, fileName: sFileName, storagePath: fPath, uploadError: "Upload OK, URL fetch failed.", downloadURL: '' });
                    }
                }
            );
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!currentUser?.uid) { showModal("Not logged in.", "Auth Error"); return; }

        if (!caseName.trim()) { showModal("Case name required.", "Validation Error"); return; }
        if (disbursements.length === 0 || disbursements.every(d => !d.paymentId && !d.payee && !d.amount && !d.paymentDate)) { showModal("At least one disbursement required.", "Validation Error"); return; }
        for (const [index, d] of disbursements.entries()) {
            if (!d.paymentId?.trim() || !d.payee?.trim() || !d.amount?.toString().trim() || !d.paymentDate?.trim() || !d.correctClassification?.trim() || !d.explanation?.trim()) {
                showModal(`All fields (ID, Payee, Amount, Date, Classification, Explanation) required for disbursement #${index + 1}.`, "Validation Error"); return;
            }
            if (isNaN(parseFloat(d.amount))) { showModal(`Amount for disbursement #${index + 1} invalid.`, "Validation Error"); return; }
        }
        const dPayIds = disbursements.map(d => d.paymentId.trim()).filter(Boolean);
        if (new Set(dPayIds).size !== dPayIds.length) { showModal("Disbursement Payment IDs must be unique.", "Validation Error"); return; }

        const activeMappings = invoiceMappings.filter(m => m.paymentId?.trim() || m.clientSideFile || m.fileName?.trim());
        for (const [index, m] of activeMappings.entries()) {
            if (!m.paymentId?.trim()) { showModal(`Payment ID required for invoice mapping #${index + 1}.`, "Validation Error"); return; }
            if (!m.fileName?.trim() && !m.clientSideFile) { showModal(`PDF file required for invoice mapping #${index + 1} (Payment ID ${m.paymentId}).`, "Validation Error"); return; }
            if (m.paymentId && !dPayIds.includes(m.paymentId.trim())) { showModal(`Mapping #${index + 1} uses invalid Payment ID '${m.paymentId}'.`, "Validation Error"); return; }
        }
        if (!apAgingReportFile && !apAgingReportStoragePath && !isEditing) {
            showModal("AP Aging Report PDF is required for a new case.", "Validation Error"); return;
        }

        setFormLoading(true);
        const visibleToUserIdsArray = visibleToUserIdsStr.split(',').map(id => id.trim()).filter(id => id);
        let currentCaseIdForOps = editingCaseId;
        let isNewCaseBeingCreated = !isEditing;

        try {
            if (isNewCaseBeingCreated) {
                const tempCaseData = {
                    caseName: caseName.trim(), disbursements: [], invoiceMappings: [], visibleToUserIds: visibleToUserIdsArray,
                    createdBy: currentUser?.uid, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), _deleted: false,
                    apAgingReportFileName: '', apAgingReportStoragePath: '', apAgingReportDownloadURL: ''
                };
                const newCaseRef = await addDoc(collection(db, FirestorePaths.CASES_COLLECTION()), tempCaseData);
                currentCaseIdForOps = newCaseRef.id;
                showModal(`Case structure created (ID: ${currentCaseIdForOps}). Processing files...`, "Processing", null);
            } else if (editingCaseId) {
                showModal(`Updating case (ID: ${currentCaseIdForOps}). Processing files...`, "Processing", null);
            }
            if (!currentCaseIdForOps) throw new Error("Case ID missing.");

            let apAgingReportMetadata = null;
            if (apAgingReportFile || apAgingReportStoragePath) {
                apAgingReportMetadata = await uploadApAgingReport(currentCaseIdForOps);
                if (apAgingReportMetadata?.uploadError) {
                    showModal(`Failed to upload AP Aging Report: ${apAgingReportMetadata.uploadError}. Case save aborted. Please try again.`, "File Upload Error");
                    if (isNewCaseBeingCreated && currentCaseIdForOps) {
                        await deleteDoc(doc(db, FirestorePaths.CASE_DOCUMENT(currentCaseIdForOps)));
                    }
                    setFormLoading(false);
                    return;
                }
            }

            const validMappingsToProcess = invoiceMappings.filter(m => m.paymentId?.trim() && (m.clientSideFile || m.storagePath));
            const uploadResults = await Promise.all(validMappingsToProcess.map(mapping => uploadInvoiceFileAndGetMetadata(mapping, currentCaseIdForOps)));
            const successfulUploadsMetadata = uploadResults.filter(r => r && !r.uploadError);
            const failedUploads = uploadResults.filter(r => r && r.uploadError);

            if (failedUploads.length > 0) {
                const errorMessages = failedUploads.map(f => `- ${f.fileName || 'A file'} (ID ${f.paymentId}): ${f.uploadError}`).join("\n");
                showModal(`Invoice PDF uploads failed:\n${errorMessages}\nCorrect issues and save again. Case NOT fully saved.`, "Upload Errors", (hide) => <Button onClick={hide}>OK</Button>);
                if (isNewCaseBeingCreated && currentCaseIdForOps) {
                    await deleteDoc(doc(db, FirestorePaths.CASE_DOCUMENT(currentCaseIdForOps)));
                }
                setFormLoading(false); return;
            }

            const finalCaseDataPayload = {
                caseName: caseName.trim(),
                disbursements: disbursements.map(({ _tempId, ...rest }) => ({...rest, amount: parseFloat(rest.amount).toFixed(2) })),
                invoiceMappings: successfulUploadsMetadata.map(({ clientSideFile, uploadProgress, _tempId, ...rest }) => rest),
                visibleToUserIds: visibleToUserIdsArray,
                updatedAt: Timestamp.now(),
                createdBy: isNewCaseBeingCreated ? currentUser?.uid : (originalCaseData?.createdBy || currentUser?.uid),
                createdAt: isNewCaseBeingCreated ? Timestamp.now() : (originalCaseData?.createdAt || Timestamp.now()),
                _deleted: false,
                apAgingReportFileName: apAgingReportMetadata?.fileName || originalCaseData?.apAgingReportFileName || '',
                apAgingReportStoragePath: apAgingReportMetadata?.storagePath || originalCaseData?.apAgingReportStoragePath || '',
                apAgingReportDownloadURL: apAgingReportMetadata?.downloadURL || originalCaseData?.apAgingReportDownloadURL || '',
            };

            await setDoc(doc(db, FirestorePaths.CASE_DOCUMENT(currentCaseIdForOps)), finalCaseDataPayload, { merge: isEditing });
            showModal(`Case ${isNewCaseBeingCreated ? 'created' : 'updated'} successfully!`, "Success");
            navigate('/admin');
        } catch (error) {
            showModal("Error saving case: " + error.message, "Save Error");
        } finally {
            setFormLoading(false);
        }
    };

    if (formLoading && isEditing) return <div className="p-6 text-center"><Loader2 size={32} className="animate-spin text-blue-600 mx-auto mb-3" />Loading...</div>;

    return (
        <div className="p-4 sm:p-6 bg-gray-100 min-h-screen">
            <div className="max-w-4xl mx-auto bg-white p-6 sm:p-8 rounded-lg shadow-xl">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-8 text-center">{isEditing ? 'Edit Audit Case' : 'Create New Audit Case'}</h1>
                <form onSubmit={handleSubmit} className="space-y-8">
                    <section className="space-y-6 p-4 border border-gray-200 rounded-lg">
                        <h2 className="text-xl font-semibold text-gray-700 border-b pb-2 mb-4">Case Setup</h2>
                        <div>
                            <label htmlFor="caseName" className="block text-sm font-semibold text-gray-700 mb-1">Case Name <span className="text-red-500">*</span></label>
                            <Input id="caseName" value={caseName} onChange={(e) => setCaseName(e.target.value)} placeholder="e.g., Q1 Unrecorded Liabilities Review" required />
                        </div>
                        <div>
                            <label htmlFor="apAgingReportFile" className="block text-sm font-semibold text-gray-700 mb-1">AP Aging Report PDF <span className="text-red-500">*</span></label>
                            <Input id="apAgingReportFile" type="file" accept=".pdf,application/pdf" onChange={handleApAgingReportFileSelect} ref={apAgingReportInputRef} className="file:mr-2 file:py-1 file:px-2 file:rounded-md file:border file:border-gray-300 file:text-sm file:font-medium file:bg-gray-50 hover:file:bg-gray-100" />
                            {apAgingReportFileName && (
                                <div className="mt-2 text-xs text-gray-600 flex items-center" title={apAgingReportFileName}>
                                    <Paperclip size={14} className="mr-1 shrink-0 text-gray-500" />
                                    <span className="truncate max-w-[200px] sm:max-w-[300px]">{apAgingReportFileName}</span>
                                    {apAgingReportDownloadURL && <a href={apAgingReportDownloadURL} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-500 hover:underline"><Eye size={14}/> View Current</a>}
                                </div>
                            )}
                            {apAgingReportUploadProgress >= 0 && apAgingReportUploadProgress < 100 && !apAgingReportUploadError && (<div className="w-full bg-gray-200 rounded-full h-1.5 mt-1"><div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${apAgingReportUploadProgress}%` }}></div></div>)}
                            {apAgingReportUploadProgress === 100 && !apAgingReportUploadError && apAgingReportFile && (<p className="text-xs text-green-600 mt-1 flex items-center"><CheckCircle2 size={14} className="mr-1"/>New file ready</p>)}
                            {apAgingReportUploadError && <p className="text-xs text-red-500 mt-1 flex items-center"><AlertTriangle size={14} className="mr-1"/>{apAgingReportUploadError}</p>}
                            <p className="text-xs text-gray-500 mt-1">This PDF will be used by trainees for comparison.</p>
                        </div>
                        <div>
                            <label htmlFor="visibleToUserIds" className="block text-sm font-semibold text-gray-700 mb-1">Visible to Specific Trainee User IDs (Optional)</label>
                            <Textarea id="visibleToUserIds" value={visibleToUserIdsStr} onChange={(e) => setVisibleToUserIdsStr(e.target.value)} placeholder="Comma-separated User IDs. Blank for all." rows={2}/>
                            <p className="text-xs text-gray-500 mt-1">If blank, case visible to all trainees.</p>
                        </div>
                    </section>

                    <section className="space-y-4 p-4 border border-gray-200 rounded-lg">
                        <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-3"><h2 className="text-xl font-semibold text-gray-700">Disbursements & Correct Answers <span className="text-red-500">*</span></h2><div><label htmlFor="csvImportDisbursements" className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-semibold cursor-pointer inline-flex items-center transition-colors"><UploadCloud size={18} className="inline mr-2" /> Import (CSV)</label><Input id="csvImportDisbursements" type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" ref={disbursementCsvInputRef} /></div></div>
                        <p className="text-xs text-gray-500 mb-3 -mt-2">CSV: <code className="bg-gray-100 p-1 rounded text-xs">PaymentID,Payee,Amount,PaymentDate</code> (header required). Dates <code className="bg-gray-100 p-1 rounded text-xs">YYYY-MM-DD</code>.</p>
                        {disbursements.length > 0 && <div className="space-y-4">{disbursements.map((item, index) => (<DisbursementItem key={item._tempId} item={item} index={index} onChange={handleDisbursementChange} onRemove={removeDisbursement} />))}</div>}
                        <Button onClick={addDisbursement} variant="secondary" className="mt-3 text-sm" type="button"><PlusCircle size={18} className="inline mr-1" /> Add Disbursement</Button>
                    </section>

                    <section className="space-y-4 p-4 border border-gray-200 rounded-lg">
                        <h2 className="text-xl font-semibold text-gray-700 mb-2">Invoice PDF Mappings to Disbursements</h2>
                        <p className="text-sm text-gray-500 mb-4">Link Payment IDs to their invoice PDFs. Files uploaded on save.</p>
                        {invoiceMappings.length > 0 && <div className="space-y-3">{invoiceMappings.map((item, index) => (<InvoiceMappingItem key={item._tempId} item={item} index={index} onChange={handleMappingChange} onRemove={removeMapping} availablePaymentIds={availablePaymentIdsForMapping} onFileSelect={handleMappingFileSelect}/>))}</div>}
                        <Button onClick={addMapping} variant="secondary" className="mt-3 text-sm" type="button"><PlusCircle size={18} className="inline mr-1" /> Add PDF Mapping</Button>
                    </section>

                    <div className="flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-3 pt-6 border-t border-gray-200 mt-10">
                        <Button onClick={() => navigate('/admin')} variant="secondary" type="button" disabled={formLoading}>Cancel</Button>
                        <Button type="submit" variant="primary" disabled={formLoading} isLoading={formLoading}>{formLoading ? (isEditing ? 'Saving...' : 'Creating...') : (isEditing ? 'Save Changes' : 'Create Case')}</Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const TraineeDashboardPage = () => {
    const { navigate } = useRoute();
    const { currentUser, userProfile, loadingAuth } = useAuth();
    const [cases, setCases] = useState([]);
    const [loadingCases, setLoadingCases] = useState(true);
    const { showModal } = useModal();

    const functions = getFunctions(firebaseApp, 'us-central1');
    const getMyVisibleCases = httpsCallable(functions, 'getMyVisibleCases');

    useEffect(() => {
      if (loadingAuth || !currentUser || !userProfile || userProfile.role !== 'trainee') {
        if (!loadingAuth && userProfile && userProfile.role !== 'trainee') navigate('/');
        setLoadingCases(false);
        return;
      }

      setLoadingCases(true);
      (async () => {
        try {
          const { data } = await getMyVisibleCases();
          setCases(data);
        } catch (err) {
          showModal(`Error fetching cases: ${err.message}`, 'Error');
        } finally {
          setLoadingCases(false);
        }
      })();
    }, [loadingAuth, currentUser, userProfile, navigate, showModal]);

    if (loadingCases) return <div className="p-6 text-center"><Loader2 size={32} className="animate-spin text-blue-600 mx-auto mb-3" />Loading cases...</div>;
    if (!currentUser?.uid && !loadingCases) return <div className="p-6 text-center"><AlertTriangle size={32} className="text-orange-500 mx-auto mb-3" />User ID not available. Refresh or login.</div>;

    return (
        <div className="p-4 sm:p-6 bg-gray-50 min-h-screen"><div className="max-w-5xl mx-auto"><h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-8">Available Audit Cases</h1>
            {cases.length === 0 ? (<div className="text-center py-12 bg-white rounded-lg shadow-md"><ListChecks size={56} className="mx-auto text-gray-400 mb-5" /><p className="text-gray-700 text-xl font-semibold">No cases available.</p><p className="text-gray-500 mt-2">Check back later or contact your instructor.</p></div>) :
                (<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">{cases.map(caseData => (<div key={caseData.id} className="bg-white p-6 rounded-lg shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col justify-between"><div><h2 className="text-xl font-semibold text-blue-700 mb-2 truncate" title={caseData.caseName}>{caseData.caseName}</h2><p className="text-sm text-gray-600 mb-1">Disbursements: <span className="font-medium">{caseData.disbursements?.length || 0}</span></p><p className="text-xs text-gray-500 mb-4">ID: {caseData.id.substring(0,10)}...</p></div><Button onClick={() => navigate(`/trainee/case/${caseData.id}`)} className="w-full mt-4"><BookOpen size={18} className="inline mr-2" /> View & Start Case</Button></div>))}</div>)}
        </div></div>
    );
};

const TraineeCaseViewPage = ({ params }) => {
    const { caseId } = params;
    const { navigate } = useRoute();
    const { currentUser, userProfile } = useAuth(); // Changed: userId to currentUser
    const { showModal, hideModal } = useModal();
    const [caseData, setCaseData] = useState(null);
    const [selectedDisbursements, setSelectedDisbursements] = useState({});
    const [submittedDocuments, setSubmittedDocuments] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loadingCase, setLoadingCase] = useState(true);
    const [previousSubmission, setPreviousSubmission] = useState(null);
    const [stage, setStage] = useState('selection');
    const [classifications, setClassifications] = useState({});
    const [selectedPaymentIds, setSelectedPaymentIds] = useState([]);
    const [feedbackResults, setFeedbackResults] = useState(null);

    useEffect(() => {
        if (!caseId) { showModal("No Case ID provided.", "Error"); navigate('/trainee'); return; }
        if (!currentUser?.uid) { console.warn("TraineeCaseView: currentUser.uid not available for fetching data."); setLoadingCase(false); return; } // Changed: userId to currentUser?.uid

        setLoadingCase(true);
        let unsubscribeCaseFn = () => {};
        let unsubscribeSubmissionFn = () => {};

        const submissionRef = doc(db, FirestorePaths.USER_CASE_SUBMISSION(currentUser.uid, caseId)); // Changed: userId to currentUser.uid
        unsubscribeSubmissionFn = onSnapshot(submissionRef, (subSnap) => {
            if (subSnap.exists()) {
                const submissionData = subSnap.data();
                setPreviousSubmission(submissionData);
                const prevSelected = {};
                (submissionData.selectedPaymentIds || []).forEach(id => { prevSelected[id] = true; });
                setSelectedDisbursements(prevSelected);
                setSelectedPaymentIds(submissionData.selectedPaymentIds || []);
                setSubmittedDocuments(submissionData.retrievedDocuments || []);
                if (submissionData.classifications && submissionData.classifications.length > 0) {
                    // Feedback useEffect will handle setting stage to 'feedback'
                } else if (submissionData.selectedPaymentIds && submissionData.selectedPaymentIds.length > 0) {
                    setStage('classification');
                }
            } else {
                setPreviousSubmission(null);
                setStage('selection');
            }
        }, (error) => {
            console.error("Error fetching previous submission:", error);
            showModal("Error loading your previous submission: " + error.message, "Error");
        });

        unsubscribeCaseFn = onSnapshot(doc(db, FirestorePaths.CASE_DOCUMENT(caseId)), (docSnap) => {
            if (docSnap.exists() && !docSnap.data()._deleted) {
                const data = { id: docSnap.id, ...docSnap.data() };
                if (data.visibleToUserIds?.length > 0 && !data.visibleToUserIds.includes(currentUser.uid)) { // Changed: userId to currentUser.uid
                    showModal("You are not permitted to access this case.", "Access Denied");
                    navigate('/trainee');
                    return;
                }
                setCaseData(data);
            } else {
                showModal("Case not found or has been removed.", "Error");
                navigate('/trainee');
            }
            setLoadingCase(false);
        }, (error) => {
            showModal("Error fetching case data: " + error.message, "Error");
            setLoadingCase(false);
            navigate('/trainee');
        });

        return () => {
            unsubscribeCaseFn();
            unsubscribeSubmissionFn();
        };
    }, [caseId, navigate, currentUser, showModal]); // Changed: userId to currentUser

    useEffect(() => {
        if (!previousSubmission?.classifications || previousSubmission.classifications.length === 0 || feedbackResults) {
            if (previousSubmission && (!previousSubmission.classifications || previousSubmission.classifications.length === 0) && stage !== 'classification') {
                if (previousSubmission.selectedPaymentIds && previousSubmission.selectedPaymentIds.length > 0) {
                    setStage('classification');
                } else {
                    setStage('selection');
                }
            }
            return;
        }
        const builtFeedbackFromPrevious = previousSubmission.classifications.map(submittedClassification => ({
            paymentId: submittedClassification.paymentId,
            fileName: submittedClassification.fileName || 'N/A',
            traineeClassification: submittedClassification.traineeClassification,
            correctClassification: submittedClassification.snapshot_correctClassification || 'N/A (Snapshot Missing)',
            explanation: submittedClassification.snapshot_explanation || 'N/A (Snapshot Missing)',
            isCorrect: submittedClassification.traineeClassification === submittedClassification.snapshot_correctClassification,
        }));
        setFeedbackResults(builtFeedbackFromPrevious);
        setStage('feedback');
    }, [previousSubmission, feedbackResults, stage]);

    const handleSelectionChange = (paymentId) => {
        if (previousSubmission?.classificationsSubmittedAt) {
            showModal("Classifications have already been submitted for this case.", "Info");
            return;
        }
        setSelectedDisbursements(prev => ({ ...prev, [paymentId]: !prev[paymentId] }));
    };

    const handleClassificationChange = (paymentId, value) => {
        setClassifications(prev => ({ ...prev, [paymentId]: value }));
    };

    const handleViewApAgingReport = async () => {
        if (!caseData) return;
        if (caseData.apAgingReportDownloadURL) {
            window.open(caseData.apAgingReportDownloadURL, '_blank', 'noopener,noreferrer');
            return;
        }
        if (caseData.apAgingReportStoragePath) {
            showModal(<div className="flex items-center p-2"><Loader2 size={20} className="animate-spin mr-2" />Fetching...</div>, "Loading AP Aging Report", () => null);
            try {
                const url = await getDownloadURL(storageRef(storage, caseData.apAgingReportStoragePath));
                hideModal();
                window.open(url, '_blank', 'noopener,noreferrer');
            } catch (e) {
                hideModal();
                showModal(`Could not retrieve AP Aging Report.\nError: ${e.message}`, "View Error");
            }
        } else {
            showModal("No AP Aging Report available for this case.", "File Error");
        }
    };

    const handleSubmitClassifications = async () => {
        if (isSubmitting) return;
        if (!caseData || !caseData.disbursements) {
            showModal("Case data or disbursements not loaded. Cannot submit.", "Error");
            return;
        }
        const missing = selectedPaymentIds.filter(pid => !classifications[pid]);
        if (missing.length > 0) {
            showModal(`Please classify every selected invoice.\nMissing classifications for: ${missing.join(', ')}`, "Validation Error");
            return;
        }
        setIsSubmitting(true);
        try {
            const submittedClassificationsWithSnapshot = selectedPaymentIds.map(pid => {
                const docInfo = (submittedDocuments || []).find(d => d.paymentId === pid) || {};
                const originalDisbursement = caseData.disbursements.find(d => d.paymentId === pid);
                let snapshotData = {};
                if (originalDisbursement) {
                    snapshotData = {
                        snapshot_correctClassification: originalDisbursement.correctClassification || 'N/A (Admin Answer Missing)',
                        snapshot_explanation: originalDisbursement.explanation || 'No explanation provided by admin.'
                    };
                } else {
                    console.warn(`Disbursement details not found for paymentId ${pid} during submission snapshot.`);
                    snapshotData = {
                        snapshot_correctClassification: 'N/A (Disbursement details not found at submission)',
                        snapshot_explanation: 'N/A'
                    };
                }
                return {
                    paymentId: pid,
                    fileName: docInfo.fileName || 'N/A',
                    traineeClassification: classifications[pid],
                    ...snapshotData
                };
            });
            const subRef = doc(db, FirestorePaths.USER_CASE_SUBMISSION(currentUser.uid, caseId)); // Changed: userId to currentUser.uid
            const payload = {
                caseId,
                caseName: caseData.caseName,
                userId: currentUser.uid, // Changed: userId to currentUser.uid
                selectedPaymentIds,
                retrievedDocuments: submittedDocuments,
                classifications: submittedClassificationsWithSnapshot,
                classificationsSubmittedAt: Timestamp.now(),
                submittedAt: previousSubmission?.submittedAt || Timestamp.now()
            };
            await setDoc(subRef, payload, { merge: true });
            const feedback = submittedClassificationsWithSnapshot.map(sc => ({
                paymentId: sc.paymentId,
                fileName: sc.fileName,
                traineeClassification: sc.traineeClassification,
                correctClassification: sc.snapshot_correctClassification,
                explanation: sc.snapshot_explanation,
                isCorrect: sc.traineeClassification === sc.snapshot_correctClassification
            }));
            setFeedbackResults(feedback);
            setStage('feedback');
            showModal("Classifications submitted successfully!\nReview your feedback below.", "Success");
        } catch (err) {
            console.error("Error submitting classifications:", err);
            showModal(`Error saving classifications: ${err.message}`, "Save Error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmitSelections = async () => {
        if (!caseData) { showModal("Case data not loaded.", "Error"); return; }
        const currentSelectedIds = Object.entries(selectedDisbursements)
            .filter(([_, isSelected]) => isSelected)
            .map(([id]) => id);
        if (currentSelectedIds.length === 0) {
            showModal("Please select at least one disbursement to proceed.", "Info");
            return;
        }
        setIsSubmitting(true);
        const docsForReview = currentSelectedIds.flatMap(pid => {
            const matches = (caseData.invoiceMappings || []).filter(
                m => m.paymentId === pid && m.fileName && (m.storagePath || m.downloadURL)
            );
            if (matches.length === 0) {
                return [{
                    paymentId: pid,
                    fileName: "(No invoice PDF mapped by admin)",
                    storagePath: '',
                    downloadURL: '',
                    unmapped: true
                }];
            }
            return matches.map(m => ({
                paymentId: pid,
                fileName: m.fileName,
                storagePath: m.storagePath,
                downloadURL: m.downloadURL || ''
            }));
        });
        setSelectedPaymentIds(currentSelectedIds);
        setSubmittedDocuments(docsForReview);
        setStage('classification');
        setIsSubmitting(false);
        // Optional: Persist intermediate selections to Firestore here if desired
    };

    const handleViewDocument = async (docInfo) => {
        if (!docInfo || (!docInfo.storagePath && !docInfo.downloadURL)) { showModal("Document information is incomplete or missing.", "File Error"); return; }
        if (docInfo.unmapped) { showModal("This item does not have an invoice PDF mapped by the admin.", "No Document"); return; }
        if (docInfo.storagePath?.includes("PENDING_CASE_ID")) { showModal("Document is pending final setup by admin.", "Pending"); return; }
        let urlToOpen = docInfo.downloadURL;
        if (!urlToOpen && docInfo.storagePath) {
            showModal(<div className="flex items-center p-2"><Loader2 size={20} className="animate-spin mr-2" />Fetching document URL...</div>, "Loading Document", () => null);
            try {
                urlToOpen = await getDownloadURL(storageRef(storage, docInfo.storagePath));
                hideModal();
            } catch (e) {
                hideModal();
                showModal(`Could not retrieve document: ${docInfo.fileName}.\nError: ${e.message}`, "View Error");
                return;
            }
        }
        if (urlToOpen) {
            window.open(urlToOpen, '_blank', 'noopener,noreferrer');
        } else {
            showModal("No valid path or URL to view the document.", "File Access Error");
        }
    };
    const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

    if (loadingCase) return <div className="p-6 text-center"><Loader2 size={32} className="animate-spin text-blue-600 mx-auto mb-3" />Loading case data...</div>;
    if (!caseData) return <div className="p-6 text-center"><AlertTriangle size={32} className="text-red-500 mx-auto mb-3" />Case data could not be loaded.<Button onClick={() => navigate('/trainee')} className="mt-4">Back to Dashboard</Button></div>;

    const classificationsAlreadySubmitted = !!previousSubmission?.classificationsSubmittedAt;

    return (
        <div className="p-4 sm:p-6 bg-gray-100 min-h-screen">
            <div className="max-w-5xl mx-auto">
                <Button onClick={() => navigate('/trainee')} variant="secondary" className="mb-6 text-sm">&larr; Back to Cases</Button>
                <div className="bg-white p-6 sm:p-8 rounded-lg shadow-xl">
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">{caseData.caseName}</h1>
                    <p className="text-gray-600 mb-1">ID: <span className="text-xs">{caseData.id}</span></p>
                    <p className="text-gray-600 mb-6 text-sm">Task: Identify potential unrecorded liabilities. Review the provided disbursements. Select items you believe warrant further investigation by requesting their supporting invoice documents. Then, classify each selected item based on your review of the invoice and the AP Aging Report.</p>

                    {stage === 'selection' && !classificationsAlreadySubmitted && (
                        <>
                            {previousSubmission && !previousSubmission.classificationsSubmittedAt && previousSubmission.selectedPaymentIds?.length > 0 && (
                                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-300 rounded-md text-yellow-700">
                                    <AlertTriangle size={20} className="inline mr-2" />
                                    You previously selected items but did not submit classifications. Your selections are loaded. Proceed to classify.
                                    <Button onClick={() => setStage('classification')} className="ml-4 text-sm">Go to Classification</Button>
                                </div>
                            )}
                            {caseData.disbursements?.length > 0 ? (
                                <div className="space-y-3 mb-8">
                                    <h2 className="text-xl font-semibold text-gray-700 mb-3">Step 1: Select Disbursements for Investigation</h2>
                                    {caseData.disbursements.map(d => (
                                        <div
                                            key={d.paymentId}
                                            className={`flex items-center p-3 sm:p-4 border rounded-md transition-colors ${
                                                selectedDisbursements[d.paymentId]
                                                    ? 'bg-blue-50 border-blue-400 shadow-md'
                                                    : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                id={`cb-${d.paymentId}`}
                                                checked={!!selectedDisbursements[d.paymentId]}
                                                onChange={() => handleSelectionChange(d.paymentId)}
                                                disabled={classificationsAlreadySubmitted}
                                                className={`h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-3 sm:mr-4 shrink-0 disabled:opacity-70 ${
                                                    classificationsAlreadySubmitted ? 'cursor-not-allowed' : 'cursor-pointer'
                                                }`}
                                            />
                                            <label
                                                htmlFor={`cb-${d.paymentId}`}
                                                className={`flex-grow grid grid-cols-2 md:grid-cols-4 gap-x-2 sm:gap-x-4 gap-y-1 ${
                                                    classificationsAlreadySubmitted ? 'cursor-default' : 'cursor-pointer'
                                                }`}
                                            >
                                                <span className="text-sm text-gray-700"><strong>ID:</strong> {d.paymentId}</span>
                                                <span className="text-sm text-gray-700 truncate" title={d.payee}><strong>Payee:</strong> {d.payee}</span>
                                                <span className="text-sm text-gray-700"><strong>Amount:</strong> {currencyFormatter.format(parseFloat(d.amount || 0))}</span>
                                                <span className="text-sm text-gray-700"><strong>Date:</strong> {d.paymentDate}</span>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-gray-500 italic py-4">No disbursements listed for this case.</p>
                            )}
                            {!classificationsAlreadySubmitted && (
                                <Button
                                    onClick={handleSubmitSelections}
                                    disabled={Object.values(selectedDisbursements).every(v => !v) || isSubmitting}
                                    isLoading={isSubmitting}
                                    className="w-full sm:w-auto"
                                >
                                    <Send size={18} className="inline mr-2" /> Request Documents & Proceed to Classification
                                </Button>
                            )}
                        </>
                    )}

                    {stage === 'classification' && !classificationsAlreadySubmitted && (
                        <>
                            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                <h2 className="text-xl sm:text-2xl font-semibold text-gray-700">Step 2: Review Documents & Classify Invoices</h2>
                                <Button onClick={handleViewApAgingReport} variant="secondary" className="w-full sm:w-auto">
                                    <FileQuestion size={18} className="inline mr-2" /> View&nbsp;AP&nbsp;Aging&nbsp;Report
                                </Button>
                            </div>
                            <p className="text-sm text-gray-600 mb-6">Review the invoice for each selected Payment ID. Then, using the AP Aging Report and the invoice details, select the correct classification for each item.</p>
                            {submittedDocuments?.length > 0 ? (
                                <div className="space-y-4 mb-8">
                                    {submittedDocuments.map((docInfo, i) => (
                                        <div key={docInfo.paymentId || i} className="p-4 border rounded-md bg-gray-50 space-y-3">
                                            <div className="flex items-center justify-between flex-wrap gap-2">
                                                <span className="text-sm text-gray-700 truncate flex-1 flex items-center">
                                                    <FileText size={16} className={`${docInfo.unmapped ? 'text-gray-400' : 'text-blue-500'} mr-2 shrink-0`} />
                                                    <strong className="mr-1">{docInfo.paymentId}</strong> — {docInfo.fileName}
                                                </span>
                                                {!docInfo.unmapped && (
                                                    <Button onClick={() => handleViewDocument(docInfo)} variant="secondary" className="text-xs px-3 py-1.5 w-full sm:w-auto">
                                                        <Eye size={14} className="inline mr-1" /> View Invoice
                                                    </Button>
                                                )}
                                            </div>
                                            <Select
                                                name={`classification-${docInfo.paymentId}`}
                                                value={classifications[docInfo.paymentId] || ''}
                                                onChange={(e) => handleClassificationChange(docInfo.paymentId, e.target.value)}
                                                options={CLASSIFICATION_OPTIONS}
                                                required
                                                disabled={docInfo.unmapped}
                                            />
                                            {docInfo.unmapped && <p className="text-xs text-orange-600 mt-1">Classification disabled as no invoice is mapped.</p>}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-gray-500 italic py-4">No documents were retrieved for the selected disbursements. Please go back and make selections.</p>
                            )}
                            <Button
                                onClick={handleSubmitClassifications}
                                disabled={classificationsAlreadySubmitted || isSubmitting || (submittedDocuments || []).filter(d => !d.unmapped).length === 0}
                                className="w-full sm:w-auto"
                                isLoading={isSubmitting}
                            >
                                <Send size={18} className="inline mr-2" /> Submit&nbsp;Final&nbsp;Classifications
                            </Button>
                        </>
                    )}

                    {(stage === 'feedback' || classificationsAlreadySubmitted) && feedbackResults && (
                        <>
                            <div className="mb-6 mt-8 pt-6 border-t">
                                <h2 className="text-xl sm:text-2xl font-semibold text-gray-700">Step 3: Your Results & Feedback</h2>
                                <p className="text-gray-600 mt-1">Score: Correct {feedbackResults.filter(r => r.isCorrect).length} / {feedbackResults.length}</p>
                            </div>
                            <div className="space-y-4 mb-8">
                                {feedbackResults.map((result, i) => (
                                    <div key={result.paymentId || i} className={`p-4 border rounded-md ${result.isCorrect ? 'bg-green-50 border-green-200' : result.isCorrect === false ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-2">
                                            <span className="font-semibold text-gray-800 truncate">{result.paymentId} — {result.fileName}</span>
                                            <span className={`text-sm font-bold px-2 py-0.5 rounded-full text-white ${result.isCorrect ? 'bg-green-500' : result.isCorrect === false ? 'bg-red-500' : 'bg-gray-400'}`}>
                                                {result.isCorrect === null ? 'Undetermined' : result.isCorrect ? 'Correct' : 'Incorrect'}
                                            </span>
                                        </div>
                                        <div className="text-sm space-y-1">
                                            <p><strong>Your Classification:</strong> <span className="text-gray-700">{result.traineeClassification}</span></p>
                                            <p><strong>Correct Classification:</strong> <span className="text-gray-700">{result.correctClassification}</span></p>
                                        </div>
                                        {result.isCorrect === false && result.explanation && (
                                            <p className="mt-2 text-sm text-gray-600 bg-yellow-50 p-2 rounded-md"><strong>Explanation:</strong> {result.explanation}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <Button onClick={() => navigate('/trainee')} className="w-full sm:w-auto">Back to Dashboard</Button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};


// --- Main App Component ---
function App() {
    const { currentUser, userProfile, loadingAuth, logout } = useAuth(); // Changed: userId to currentUser
    const { route, navigate } = useRoute();

    useEffect(() => {
        if (loadingAuth) return;
        if (currentUser) {
            if (!userProfile && route !== '/select-role') navigate('/select-role');
            else if (userProfile && route === '/select-role') navigate('/');
        } else if (route !== '/select-role') {
             // Consider implications if not authenticated and not on role selection.
             // For now, if no currentUser and not on select-role, it might default to RoleSelectionPage anyway.
             // If you want to force to /select-role if not logged in:
             // navigate('/select-role');
        }
    }, [loadingAuth, currentUser, userProfile, route, navigate]);

    if (loadingAuth) return <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4 text-center"><Loader2 size={48} className="animate-spin text-blue-600 mb-4" /><h1 className="text-xl font-semibold text-gray-700">Loading AuditSim Pro...</h1><p className="text-sm text-gray-500">Initializing...</p></div>;

    let pageComponent = null;
    if (!currentUser && route !== '/select-role') { // If not logged in, and not already trying to select a role, show role selection.
        pageComponent = <RoleSelectionPage />;
    } else if (currentUser && !userProfile) { // Logged in, but no profile (role not set yet)
        pageComponent = <RoleSelectionPage />;
    } else if (userProfile) { // Logged in and profile exists
        if (userProfile.role === 'admin') {
            const p = route.split('/');
            if (route === '/' || route.startsWith('/admin/dashboard') || route === '/admin' || route === '') pageComponent = <AdminDashboardPage />;
            else if (route === '/admin/create-case') pageComponent = <CaseFormPage />;
            else if (p[0] === '' && p[1] === 'admin' && p[2] === 'edit-case' && p[3]) pageComponent = <CaseFormPage params={{ caseId: p[3] }} />;
            else if (route === '/admin/user-management') pageComponent = <AdminUserManagementPage />;
            else if (p[0] === '' && p[1] === 'admin' && p[2] === 'case-submissions' && p[3]) pageComponent = <AdminCaseSubmissionsPage params={{ caseId: p[3] }} />;
            else pageComponent = <AdminDashboardPage />;
        } else if (userProfile.role === 'trainee') {
            const p = route.split('/');
            if (route === '/' || route.startsWith('/trainee/dashboard') || route === '/trainee' || route === '') pageComponent = <TraineeDashboardPage />;
            else if (p[0] === '' && p[1] === 'trainee' && p[2] === 'case' && p[3]) pageComponent = <TraineeCaseViewPage params={{ caseId: p[3] }} />;
            else pageComponent = <TraineeDashboardPage />;
        } else { // Has a profile but unknown role, or trying to access /select-role with a profile
             pageComponent = <RoleSelectionPage />; // Default to role selection if role is invalid or they are on /select-role with a profile
        }
    } else { // Default catch-all, likely means no currentUser and on /select-role
        pageComponent = <RoleSelectionPage />;
    }


    return (
        <div className="font-sans antialiased text-gray-900 bg-gray-100 flex flex-col min-h-screen">
            <header className="bg-blue-700 text-white shadow-md sticky top-0 z-40"><div className="container mx-auto px-4 py-3 flex justify-between items-center"><h1 className="text-xl sm:text-2xl font-bold cursor-pointer hover:opacity-90" onClick={() => navigate('/')}>AuditSim Pro</h1><div className="flex items-center space-x-3 sm:space-x-4">{userProfile && <span className="text-xs sm:text-sm capitalize hidden sm:inline">Role: {userProfile.role}</span>}{currentUser?.uid && <span className="text-xs text-blue-200 hidden md:inline" title={currentUser.uid}>UID: {currentUser.uid.substring(0,8)}...</span>}{currentUser && (<Button onClick={logout} variant="secondary" className="text-xs sm:text-sm px-2 py-1 sm:px-3"><LogOut size={16} className="inline mr-1" /> Logout</Button>)}</div></div></header> {/* Changed: userId to currentUser?.uid */}
            <main className="flex-grow container mx-auto px-2 sm:px-4 py-4 sm:py-6">{pageComponent}</main>
            <footer className="bg-gray-800 text-white text-center p-4 text-xs sm:text-sm"><p>&copy; {new Date().getFullYear()} AuditSim Pro. For training purposes.</p>{appId && <p className="text-xs text-gray-400 mt-1">App ID: {appId}</p>}</footer>
        </div>
    );
}

// This is the main export that will be used by the legacy default export in the entry point (index.js or similar)
export default function AuditSimProAppWithProviders() {
    return (<ModalProvider><AuthProvider><RouterProvider><App /></RouterProvider></AuthProvider></ModalProvider>);
}

// Export individual pages if they need to be imported elsewhere, though typically App is the main entry.
export {
    RoleSelectionPage,
    AdminDashboardPage,
    AdminUserManagementPage,
    AdminCaseSubmissionsPage,
    CaseFormPage,
    TraineeDashboardPage,
    TraineeCaseViewPage,
    App // Exporting App itself might be useful for testing or other scenarios
};
