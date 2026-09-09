import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, useRoute, useUser, appId } from '../AppCore';
import { listFieldSpecs } from '../shared/generation/templateFieldSpecs';
import { buildPayloadFromForm } from '../shared/generation/templateDataBuilder';
import useTemplateDocForm from '../hooks/useTemplateDocForm';
import { generateTemplateDoc } from '../services/templateDocService';
import FieldGrid from '../components/templateStudio/FieldGrid';
import RowsEditor from '../components/templateStudio/RowsEditor';
import ReconcilePanel from '../components/templateStudio/ReconcilePanel';

const decodePdfBase64 = (base64, contentType = 'application/pdf') => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType });
};

export default function AdminTemplateStudioPage() {
  const { navigate } = useRoute();
  const { role, loadingRole } = useUser();
  const templateSpecs = useMemo(() => listFieldSpecs(), []);
  const [templateId, setTemplateId] = useState(templateSpecs[0]?.templateId || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const objectUrlRef = useRef('');
  const { spec, values, rows, handleFieldChange, handleRowChange, addRow, removeRow, applyBucket, loadSample, derived } =
    useTemplateDocForm({ templateId });

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  const replaceObjectUrl = (nextUrl) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = nextUrl;
    setDocumentUrl(nextUrl);
  };

  const handleGenerate = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setIsGenerating(true);
    try {
      const data = buildPayloadFromForm(spec, { values, rows });
      const result = await generateTemplateDoc({ appId, templateId, data });
      if (!result?.pdfBase64) throw new Error('No PDF was returned by document generation.');

      const blob = decodePdfBase64(result.pdfBase64, result.contentType);
      const nextUrl = URL.createObjectURL(blob);
      replaceObjectUrl(nextUrl);
      const anchor = document.createElement('a');
      anchor.href = nextUrl;
      anchor.download = result.fileName || `${templateId}.pdf`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setSuccessMessage(`Generated ${result.fileName || `${templateId}.pdf`}.`);
    } catch (err) {
      console.error('[AdminTemplateStudio] Template generation failed', err);
      setErrorMessage(err?.message || 'Failed to generate template document.');
    } finally {
      setIsGenerating(false);
    }
  };

  if (loadingRole || (role !== 'admin' && role !== 'owner')) {
    return <div className="p-6">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Document Studio</h1>
            <p className="mt-1 text-sm text-gray-600">
              Author reference PDFs from real template parameters. Reconciliation warnings never block generation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate('/admin/debug-docs')} variant="secondary" className="text-sm">
              Debug docs
            </Button>
            <Button onClick={() => navigate('/admin')} variant="secondary" className="text-sm">
              &larr; Dashboard
            </Button>
          </div>
        </div>

        {errorMessage ? <div className="text-sm text-rose-600">{errorMessage}</div> : null}
        {successMessage ? <div className="text-sm text-emerald-700">{successMessage}</div> : null}

        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-md">
              <label htmlFor="template-id" className="mb-1 block text-sm font-medium text-gray-700">
                Template
              </label>
              <Select
                id="template-id"
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                {templateSpecs.map((entry) => (
                  <option key={entry.templateId} value={entry.templateId}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={loadSample} variant="secondary" className="text-sm">
              Load sample
            </Button>
          </div>
          <div className="text-xs text-gray-500">{spec.templateId}</div>
        </section>

        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Document fields</h2>
            <p className="text-sm text-gray-500">These values are passed to the selected PDF renderer.</p>
          </div>
          <FieldGrid fields={spec.fields} values={values} onChange={handleFieldChange} />
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <RowsEditor
            rowsSpec={spec.rows}
            rows={rows}
            onRowChange={handleRowChange}
            onAddRow={addRow}
            onRemoveRow={removeRow}
            onApplyBucket={applyBucket}
          />
        </section>

        <ReconcilePanel spec={spec} values={values} onChange={handleFieldChange} derived={derived} />

        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <Button onClick={handleGenerate} isLoading={isGenerating} disabled={isGenerating}>
            {isGenerating ? 'Generating…' : 'Generate and download'}
          </Button>
          <Button
            onClick={() => window.open(documentUrl, '_blank', 'noopener,noreferrer')}
            variant="secondary"
            disabled={!documentUrl || isGenerating}
          >
            Preview
          </Button>
          {documentUrl ? (
            <a
              href={documentUrl}
              download={`${templateId}.pdf`}
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Download again
            </a>
          ) : null}
        </section>
      </div>
    </div>
  );
}
