import React, { useEffect, useState } from 'react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { storage, Button, useRoute, useModal } from '../AppCore';
import { fetchCase } from '../services/caseService';
import { getAuditAreaLabel, getCaseGroupLabel } from '../models/caseConstants';

export default function AdminCaseOverviewPage({ params }) {
  const { caseId } = params;
  const { navigate } = useRoute();
  const { showModal } = useModal();

  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!caseId) {
      navigate('/admin');
      return;
    }
    setLoading(true);
    fetchCase(caseId)
      .then((doc) => {
        setCaseData(doc);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching case:', err);
        showModal('Error fetching case: ' + err.message, 'Error');
        setLoading(false);
      });
  }, [caseId, navigate, showModal]);

  const handleView = async (mapping) => {
    if (mapping.downloadURL) {
      window.open(mapping.downloadURL, '_blank');
      return;
    }
    if (!mapping.storagePath) {
      showModal('No file path available.', 'Error');
      return;
    }
    try {
      const url = await getDownloadURL(storageRef(storage, mapping.storagePath));
      window.open(url, '_blank');
    } catch (err) {
      console.error('Error getting URL:', err);
      showModal('Could not get document URL.', 'Error');
    }
  };

  if (loading) return <div className="p-4 text-center">Loading case...</div>;
  if (!caseData) return <div className="p-4 text-center">Case not found.</div>;

  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const formatTimestamp = (value) => {
    if (!value) return '—';
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    if (!date || Number.isNaN(date.getTime())) return '—';
    return date.toUTCString();
  };
  const isPublic =
    typeof caseData.publicVisible === 'boolean'
      ? caseData.publicVisible
      : !(Array.isArray(caseData.visibleToUserIds) && caseData.visibleToUserIds.length > 0);
  const caseTitle = caseData.title || caseData.caseName || 'Audit Case';
  const auditAreaLabel = getAuditAreaLabel(caseData.auditArea);
  const caseGroupLabel = getCaseGroupLabel(caseData.caseGroupId);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex justify-between">
          <Button onClick={() => navigate('/admin')} variant="secondary" className="text-sm">&larr; Back</Button>
          <div className="space-x-2">
            <Button onClick={() => navigate(`/admin/edit-case/${caseId}`)} variant="secondary" className="text-sm">Edit Case</Button>
            <Button onClick={() => navigate(`/admin/case-submissions/${caseId}`)} variant="secondary" className="text-sm">View Submissions</Button>
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h1 className="text-3xl font-bold text-gray-800 mb-4">{caseTitle}</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600 mb-6">
            <div><strong>Status:</strong> {caseData.status || 'assigned'}</div>
            <div>
              <strong>Audience:</strong>{' '}
              {isPublic
                ? 'All signed-in trainees'
                : `${Array.isArray(caseData.visibleToUserIds) ? caseData.visibleToUserIds.length : 0} rostered user(s)`}
            </div>
            <div><strong>Opens At:</strong> {formatTimestamp(caseData.opensAt)}</div>
            <div><strong>Due At:</strong> {formatTimestamp(caseData.dueAt)}</div>
            <div><strong>Audit Area:</strong> {auditAreaLabel}</div>
            <div><strong>Case Group:</strong> {caseGroupLabel}</div>
          </div>
          <h2 className="text-xl font-semibold text-gray-700 mt-4 mb-2">Disbursements</h2>
          {caseData.disbursements && caseData.disbursements.length > 0 ? (
            <ul className="space-y-2">
              {caseData.disbursements.map((d) => (
                <li key={d.paymentId} className="p-3 border rounded-md grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <span><strong>ID:</strong> {d.paymentId}</span>
                  <span><strong>Payee:</strong> {d.payee}</span>
                  <span><strong>Amount:</strong> {currency.format(parseFloat(d.amount || 0))}</span>
                  <span><strong>Date:</strong> {d.paymentDate}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">No disbursements recorded.</p>
          )}

          <h2 className="text-xl font-semibold text-gray-700 mt-6 mb-2">Invoice Documents</h2>
          {caseData.invoiceMappings && caseData.invoiceMappings.length > 0 ? (
            <ul className="space-y-2">
              {caseData.invoiceMappings.map((m, idx) => (
                <li key={idx} className="p-3 border rounded-md flex items-center justify-between text-sm">
                  <span className="mr-2 flex-1 truncate">
                    <strong>{m.paymentId}:</strong> {m.fileName}
                    {m.contentType ? <span className="ml-2 text-xs text-gray-500">({m.contentType})</span> : null}
                  </span>
                  <Button onClick={() => handleView(m)} variant="secondary" className="text-xs px-2 py-1">Open</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">No invoice documents uploaded.</p>
          )}

          <h2 className="text-xl font-semibold text-gray-700 mt-6 mb-2">Reference Documents</h2>
          {caseData.referenceDocuments && caseData.referenceDocuments.length > 0 ? (
            <ul className="space-y-2">
              {caseData.referenceDocuments.map((doc, idx) => (
                <li key={idx} className="p-3 border rounded-md flex items-center justify-between text-sm">
                  <span className="mr-2 flex-1 truncate">
                    {doc.fileName}
                    {doc.storagePath ? <span className="ml-2 text-xs text-gray-500">({doc.storagePath})</span> : null}
                  </span>
                  <Button onClick={() => handleView(doc)} variant="secondary" className="text-xs px-2 py-1">Open</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">No reference documents linked.</p>
          )}
        </div>
      </div>
    </div>
  );
}
