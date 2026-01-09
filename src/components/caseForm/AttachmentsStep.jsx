import React, { useEffect, useState } from 'react';
import { Input, Button } from '../../AppCore';
import { PlusCircle, Trash2, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { AUDIT_AREAS } from '../../models/caseConstants';
import StepIntro from './StepIntro';
import { CASH_ARTIFACT_TYPES } from '../../constants/caseFormOptions';

export default function AttachmentsStep({ attachments, files, generation }) {
  const {
    disbursements,
    referenceDocuments,
    handleReferenceDocChange,
    addReferenceDocument,
    removeReferenceDocument,
    handleReferenceDocFileSelect,
    cashArtifacts,
    handleCashArtifactChange,
    handleCashArtifactFileSelect,
    auditArea,
  } = attachments;
  const { FILE_INPUT_ACCEPT } = files;
  const isCash = auditArea === AUDIT_AREAS.CASH;
  const planSpecCount = Array.isArray(generation?.generationPlan?.referenceDocumentSpecs)
    ? generation.generationPlan.referenceDocumentSpecs.length
    : 0;
  const hasGenerationPlan = planSpecCount > 0;
  const generationDocs = referenceDocuments.filter(
    (doc) => doc && doc.generationSpec && typeof doc.generationSpec === 'object'
  );
  const generationReady = generationDocs.filter((doc) => doc.downloadURL || doc.storagePath).length;
  const generationTotal = Math.max(generationDocs.length, planSpecCount);
  const generationPending = Math.max(0, generationTotal - generationReady);
  const generationPct = generationTotal > 0 ? Math.round((generationReady / generationTotal) * 100) : 0;
  const generationJobStatus = generation?.generationPlan?.lastJob?.status || null;
  const generationInFlight =
    generation?.generationPolling || generationJobStatus === 'queued' || generationJobStatus === 'processing';
  const generationStatusLabel = generationInFlight
    ? 'Generating PDFs'
    : generationJobStatus === 'completed'
    ? 'Generation complete'
    : generationJobStatus === 'partial'
    ? 'Generation partially complete'
    : generationJobStatus === 'error'
    ? 'Generation error'
    : 'Ready to generate';

  return (
    <div className="space-y-6">
      <StepIntro
        title="Check supporting files"
        items={[
          'Review invoice documents linked to each disbursement.',
          'Upload or link reference materials trainees need for context.',
          'Confirm file names and statuses before publishing.'
        ]}
        helper="Use this step as a final file audit. Disbursement invoices are edited in the Transactions step; reference files can be updated here."
      />

      <section className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-base font-semibold text-gray-800">Invoice Attachments</h3>
        <p className="mt-1 text-xs text-gray-500">
          Each {isCash ? 'transaction' : 'disbursement'} should have at least one supporting document. Use the Transactions step to add or remove files.
        </p>
        <div className="mt-4 space-y-4">
          {disbursements.map((disbursement) => (
            <div
              key={disbursement._tempId}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {disbursement.paymentId || 'Payment ID pending'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {disbursement.payee || 'Payee pending'} ·{' '}
                    {disbursement.amount ? `$${Number(disbursement.amount).toLocaleString()}` : 'Amount pending'}
                  </p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  {(disbursement.mappings || []).length} document{(disbursement.mappings || []).length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {(disbursement.mappings || []).length === 0 ? (
                  <p className="rounded border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
                    No documents linked yet. Add them under the Transactions step.
                  </p>
                ) : (
                  (disbursement.mappings || []).map((mapping) => (
                    <InvoiceMappingSummaryRow key={mapping._tempId} mapping={mapping} />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {isCash ? (
        <section className="rounded-lg border border-gray-200 p-4">
          <h3 className="text-base font-semibold text-gray-800">Cash Artifacts</h3>
          <p className="mt-1 text-xs text-gray-500">
            Upload the bank statement, bank confirmation, and cutoff statement the trainee will reference. Confirmation balance can be captured for grading.
          </p>
          <div className="mt-4 space-y-4">
            {cashArtifacts.map((doc, index) => {
              const label = CASH_ARTIFACT_TYPES.find((entry) => entry.value === doc.type)?.label || 'Cash Artifact';
              const effectiveNeedsConfirm = doc.type === 'cash_bank_confirmation';
              return (
                <div key={doc._tempId} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{label}</p>
                      <p className="text-xs text-gray-500">{doc.fileName || 'No file selected'}</p>
                    </div>
                    <Input
                      type="file"
                      accept={FILE_INPUT_ACCEPT}
                      onChange={(event) => handleCashArtifactFileSelect(index, event.target.files?.[0] || null)}
                      className="sm:max-w-xs"
                    />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Display Name
                      </label>
                      <Input
                        value={doc.fileName}
                        onChange={(e) => handleCashArtifactChange(index, { fileName: e.target.value })}
                        placeholder={`${label} file name`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Storage Path or URL
                      </label>
                      <Input
                        value={doc.storagePath || doc.downloadURL || ''}
                        onChange={(e) =>
                          handleCashArtifactChange(index, {
                            storagePath: e.target.value,
                            downloadURL: '',
                          })
                        }
                        placeholder="gs:// or https://"
                      />
                    </div>
                  </div>
                  {effectiveNeedsConfirm ? (
                    <div className="mt-3">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Confirmed Balance (from confirmation)
                      </label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        placeholder="e.g., 1240000"
                        value={doc.confirmedBalance || ''}
                        onChange={(e) => handleCashArtifactChange(index, { confirmedBalance: e.target.value })}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-base font-semibold text-gray-800">Reference Documents</h3>
        <p className="mt-1 text-xs text-gray-500">
          {isCash
            ? 'Upload the bank statement or other global evidence trainees will reference. Mark key files so they are easy to find.'
            : 'Provide supplemental files (e.g., AP aging, accrual schedules). Expand an item to configure download URLs or storage paths.'}
        </p>
        {hasGenerationPlan ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              onClick={() => generation?.queueGenerationJob?.()}
              variant="secondary"
              type="button"
              disabled={generationInFlight}
            >
              {generationInFlight ? 'Generating PDFs…' : 'Generate Invoice PDFs'}
            </Button>
            <span className="text-xs text-gray-500">
              Generates PDFs from the current recipe and links them to disbursements.
            </span>
          </div>
        ) : null}
        {hasGenerationPlan && (generationTotal > 0 || generationJobStatus) ? (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
              {generationTotal > 0 ? (
                <span>
                  {generationReady} of {generationTotal} PDFs generated
                </span>
              ) : (
                <span>Generation status</span>
              )}
              <span className="font-semibold text-gray-700">{generationStatusLabel}</span>
            </div>
            {generationTotal > 0 ? (
              <>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${generationPct}%` }}
                  />
                </div>
                {generationPending > 0 ? (
                  <p className="mt-2 text-xs text-gray-500">
                    {generationPending} remaining. This will refresh automatically as files finish.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 space-y-4">
          {referenceDocuments.map((item, index) => (
            <ReferenceDocumentItem
              key={item._tempId}
              item={item}
              index={index}
              onChange={handleReferenceDocChange}
              onRemove={removeReferenceDocument}
              onFileSelect={handleReferenceDocFileSelect}
              acceptValue={FILE_INPUT_ACCEPT}
            />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={addReferenceDocument} variant="secondary" type="button">
            <PlusCircle size={16} className="mr-1" /> Add Reference Document
          </Button>
        </div>
      </section>
    </div>
  );
}

const InvoiceMappingSummaryRow = ({ mapping }) => {
  const summary = (() => {
    if (mapping.uploadError) return { text: mapping.uploadError, tone: 'text-red-600' };
    if (typeof mapping.uploadProgress === 'number' && mapping.uploadProgress < 100) {
      return { text: `Uploading (${Math.round(mapping.uploadProgress)}%)`, tone: 'text-blue-600' };
    }
    if (mapping.clientSideFile) {
      return { text: 'Selected (uploads on Save)', tone: 'text-amber-700' };
    }
    if (mapping.uploadProgress === 100 || mapping.storagePath || mapping.downloadURL) {
      return { text: 'Ready', tone: 'text-emerald-600' };
    }
    if (mapping.fileName) {
      return { text: 'Missing file/link', tone: 'text-amber-700' };
    }
    return { text: 'Pending upload', tone: 'text-gray-500' };
  })();

  const label = mapping.fileName || mapping.clientSideFile?.name || mapping.storagePath || mapping.downloadURL || 'Unnamed file';

  return (
    <div className="flex flex-col rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-gray-800" title={label}>
          {label}
        </span>
        <span className={`font-semibold ${summary.tone}`}>{summary.text}</span>
      </div>
      {mapping.storagePath ? (
        <span className="mt-1 truncate text-[11px] text-gray-500" title={mapping.storagePath}>
          {mapping.storagePath}
        </span>
      ) : null}
      {mapping.downloadURL ? (
        <a
          href={mapping.downloadURL}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center text-[11px] text-blue-600 underline"
        >
          View file
        </a>
      ) : null}
    </div>
  );
};

const ReferenceDocumentItem = ({ item, index, onChange, onRemove, onFileSelect, acceptValue }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isNewDoc =
    !item.fileName && !item.clientSideFile && !item.storagePath && !item.downloadURL;
  const [expanded, setExpanded] = useState(isNewDoc || index === 0);
  const fileInputId = `referenceFile-${item._tempId}`;

  useEffect(() => {
    if (isNewDoc) {
      setExpanded(true);
    }
  }, [isNewDoc]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    onChange(index, { ...item, [name]: value });
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      onFileSelect(index, file);
    }
  };

  const storagePathLabel = (item.storagePath || '').trim();
  const downloadUrlLabel = (item.downloadURL || '').trim();
  const hasDisplayName = Boolean((item.fileName || '').trim());
  const hasAttachment = Boolean(item.clientSideFile || storagePathLabel || downloadUrlLabel);

  const summarySource = (() => {
    if (item.clientSideFile) return item.clientSideFile.name;
    if (storagePathLabel) return storagePathLabel;
    if (downloadUrlLabel) return downloadUrlLabel;
    if (item.generationSpec) return `Generated via ${item.generationSpec.templateId || 'template'}`;
    return 'No attachment yet';
  })();

  const statusLabel = (() => {
    if (item.uploadError) return 'Upload error';
    if (typeof item.uploadProgress === 'number' && item.uploadProgress < 100) {
      return `Uploading (${Math.round(item.uploadProgress)}%)`;
    }
    if (item.clientSideFile) return 'Selected (uploads on Save)';
    if (item.uploadProgress === 100 || hasAttachment) return 'Ready';
    if (hasDisplayName) return 'Missing file/link';
    return 'Pending';
  })();

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:border-blue-200">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid w-full gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-[220px_minmax(0,1fr)_140px]">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-gray-500">Display name</span>
            {expanded ? (
              <Input
                id={`referenceName-${item._tempId}`}
                name="fileName"
                value={item.fileName}
                onChange={handleChange}
                placeholder="e.g., AP Aging Summary"
                className="mt-1"
              />
            ) : (
              <span className={`truncate font-semibold ${item.fileName ? 'text-gray-900' : 'text-gray-400'}`}>
                {item.fileName || 'Untitled reference'}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-gray-500">Attachment</span>
            {expanded ? (
              <>
                <Input id={fileInputId} type="file" accept={acceptValue} onChange={handleFileChange} className="mt-1" />
                <p className="mt-1 text-xs text-gray-500">{summarySource}</p>
              </>
            ) : (
              <span className={`truncate font-semibold ${summarySource === 'No attachment yet' ? 'text-gray-400' : 'text-gray-900'}`}>
                {summarySource}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-gray-500">Status</span>
            <span
              className={`font-semibold ${
                item.uploadError
                  ? 'text-red-600'
                  : statusLabel === 'Ready'
                  ? 'text-emerald-600'
                  : statusLabel === 'Uploading (0%)' || statusLabel.startsWith('Uploading')
                  ? 'text-blue-600'
                  : statusLabel.includes('Selected') || statusLabel.includes('Missing')
                  ? 'text-amber-700'
                  : 'text-gray-900'
              }`}
            >
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-10 w-32 items-center justify-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {expanded ? 'Done' : 'Edit details'}
          </button>
          <Button onClick={() => onRemove(index)} variant="danger" className="h-10 w-12 justify-center">
            <Trash2 size={16} />
            <span className="sr-only">Remove reference document</span>
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-xs text-gray-600">
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900"
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Advanced options
            </button>

            {showAdvanced ? (
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700" htmlFor={`referenceUrl-${item._tempId}`}>
                    Download URL (optional)
                  </label>
                  <Input
                    id={`referenceUrl-${item._tempId}`}
                    name="downloadURL"
                    value={item.downloadURL}
                    onChange={handleChange}
                    placeholder="https://storage.googleapis.com/..."
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700" htmlFor={`referencePath-${item._tempId}`}>
                    Storage Path (optional)
                  </label>
                  <Input
                    id={`referencePath-${item._tempId}`}
                    name="storagePath"
                    value={item.storagePath}
                    onChange={handleChange}
                    placeholder="Set automatically when uploading"
                    className="mt-1"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">Provide only if referencing an existing Firebase Storage file.</p>
                </div>
              </div>
            ) : null}
          </div>

          {typeof item.uploadProgress === 'number' && item.uploadProgress < 100 ? (
            <p className="text-xs text-blue-600">Upload in progress: {item.uploadProgress}%</p>
          ) : null}
          {item.uploadProgress === 100 && !item.uploadError ? (
            <p className="flex items-center text-xs text-emerald-600">
              <CheckCircle2 size={14} className="mr-1" /> Uploaded successfully
            </p>
          ) : null}
          {item.uploadError ? (
            <p className="flex items-center text-xs text-red-500">
              <AlertTriangle size={14} className="mr-1" /> {item.uploadError}
            </p>
          ) : null}
          {item.generationSpec && !item.clientSideFile && !item.storagePath && !item.downloadURL ? (
            <p className="text-xs text-amber-700">
              This file will be generated from a template when the generation job runs.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
