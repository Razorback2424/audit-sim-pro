import React, { useMemo, useState } from 'react';
import { Button, useRoute, useModal, useUser, appId, storage } from '../AppCore';
import { getDownloadURL, listAll, ref as storageRef, deleteObject } from 'firebase/storage';
import { generateDebugReferenceDoc } from '../services/debugDocService';

const buildTemplatePath = (templateId) =>
  String(templateId || '')
    .trim()
    .replace(/[^\w.\-]/g, '_');

const inferTimestampLabel = (fileName, prefix) => {
  const normalized = String(fileName || '');
  const trimmed = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  return trimmed.replace(/\.pdf$/i, '');
};

export default function AdminDebugDocsPage() {
  const { navigate } = useRoute();
  const { showModal } = useModal();
  const { role, loadingRole } = useUser();
  const [busyTemplateId, setBusyTemplateId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [docsByTemplate, setDocsByTemplate] = useState({});

  const debugTemplates = useMemo(
    () => [
      { id: 'invoice.seed.alpha.v1', label: 'Alpha Invoice' },
      { id: 'invoice.seed.beta.v1', label: 'Beta Invoice' },
      { id: 'invoice.seed.gamma.v1', label: 'Gamma Invoice' },
      { id: 'refdoc.bank-statement.v1', label: 'Bank Statement' },
      { id: 'refdoc.check-copy.v1', label: 'Check Copy' },
      { id: 'refdoc.ap-aging.v1', label: 'AP Aging Summary' },
      { id: 'refdoc.ap-leadsheet.v1', label: 'AP Lead Sheet' },
      { id: 'refdoc.disbursement-listing.v1', label: 'Disbursement Listing' },
      { id: 'refdoc.payroll-register.v1', label: 'Payroll Register' },
      { id: 'refdoc.remittance-bundle.v1', label: 'Remittance Bundle' },
      { id: 'refdoc.accrual-estimate.v1', label: 'Accrual Estimate' },
      { id: 'refdoc.fa-policy.v1', label: 'FA Capitalization Policy' },
      { id: 'refdoc.ppe-rollforward.v1', label: 'PP&E Rollforward' },
      { id: 'refdoc.fa-listing.v1', label: 'Fixed Asset Listing' },
    ],
    []
  );

  const loadTemplateDocs = async (templateId) => {
    if (!templateId || !appId) return;
    const safeTemplate = buildTemplatePath(templateId);
    const prefix = `artifacts/${appId}/debug/reference/${safeTemplate}`;
    setDocsByTemplate((prev) => ({
      ...prev,
      [templateId]: { ...(prev[templateId] || {}), loading: true, error: '' },
    }));
    try {
      const listing = await listAll(storageRef(storage, prefix));
      const items = listing.items.map((item) => ({
        name: item.name,
        fullPath: item.fullPath,
        createdAtLabel: inferTimestampLabel(item.name, `${safeTemplate}-`),
      }));
      items.sort((a, b) => b.name.localeCompare(a.name));
      setDocsByTemplate((prev) => ({
        ...prev,
        [templateId]: {
          items,
          loading: false,
          error: '',
          latest: items[0] || null,
        },
      }));
    } catch (err) {
      console.error('[AdminDebugDocs] Failed to list debug docs', err);
      setDocsByTemplate((prev) => ({
        ...prev,
        [templateId]: {
          ...(prev[templateId] || {}),
          items: [],
          loading: false,
          error: err?.message || 'Unable to list debug documents.',
        },
      }));
    }
  };

  const handleGenerate = async (templateId) => {
    if (!templateId || !appId) return;
    setErrorMessage('');
    setBusyTemplateId(templateId);
    try {
      const result = await generateDebugReferenceDoc({ templateId, appId });
      if (!result?.storagePath) {
        throw new Error('No storage path returned from debug generation.');
      }
      await loadTemplateDocs(templateId);
      showModal(
        `Generated ${result.fileName || result.storagePath}.`,
        'Debug doc created'
      );
    } catch (err) {
      console.error('[AdminDebugDocs] Debug generation failed', err);
      setErrorMessage(err?.message || 'Failed to generate reference document.');
    } finally {
      setBusyTemplateId('');
    }
  };

  const handleView = async (doc) => {
    if (!doc?.fullPath) return;
    try {
      const url = await getDownloadURL(storageRef(storage, doc.fullPath));
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('[AdminDebugDocs] Failed to open debug doc', err);
      setErrorMessage(err?.message || 'Unable to open the generated document.');
    }
  };

  const handleDelete = async (templateId, doc) => {
    if (!doc?.fullPath) return;
    const ok = window.confirm(`Delete ${doc.name}?`);
    if (!ok) return;
    try {
      await deleteObject(storageRef(storage, doc.fullPath));
      setDocsByTemplate((prev) => {
        const next = { ...prev };
        const existing = next[templateId]?.items || [];
        const items = existing.filter((item) => item.fullPath !== doc.fullPath);
        next[templateId] = {
          ...(next[templateId] || {}),
          items,
          latest: items[0] || null,
        };
        return next;
      });
    } catch (err) {
      console.error('[AdminDebugDocs] Failed to delete debug doc', err);
      setErrorMessage(err?.message || 'Failed to delete document.');
    }
  };

  if (loadingRole || (role !== 'admin' && role !== 'owner')) {
    return <div className="p-6">Loading…</div>;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Manage Debug Docs</h1>
            <p className="text-sm text-gray-600">
              Generate, view, and delete standalone reference documents stored under the debug bucket.
            </p>
          </div>
          <Button onClick={() => navigate('/admin')} variant="secondary" className="text-sm">
            &larr; Back to Dashboard
          </Button>
        </div>

        {errorMessage ? <div className="text-sm text-rose-600">{errorMessage}</div> : null}

        <div className="grid gap-4">
          {debugTemplates.map((template) => {
            const state = docsByTemplate[template.id] || {};
            const isBusy = busyTemplateId === template.id;
            return (
              <section key={template.id} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-800">{template.label}</div>
                    <div className="text-xs text-gray-500">{template.id}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => handleGenerate(template.id)}
                      disabled={isBusy}
                      className="text-xs"
                    >
                      {isBusy ? 'Generating…' : 'Generate'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => loadTemplateDocs(template.id)}
                      disabled={state.loading}
                      className="text-xs"
                    >
                      {state.loading ? 'Loading…' : 'Refresh list'}
                    </Button>
                  </div>
                </div>
                {state.error ? <div className="text-xs text-rose-600">{state.error}</div> : null}
                {state.items && state.items.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {state.items.map((doc) => (
                      <div key={doc.fullPath} className="py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-xs text-gray-700">{doc.name}</div>
                          <div className="text-[11px] text-gray-400">Generated: {doc.createdAtLabel}</div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="secondary" onClick={() => handleView(doc)} className="text-xs">
                            View
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => handleDelete(template.id, doc)}
                            className="text-xs"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">No debug documents generated yet.</div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
