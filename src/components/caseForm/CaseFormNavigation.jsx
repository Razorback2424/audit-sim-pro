import React, { useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import StepIntro from './StepIntro';

function CaseFormStepNav({ steps, activeStep, onStepChange, disabled }) {
  const progressPct = Math.round(((activeStep + 1) / steps.length) * 100);

  return (
    <div className="mb-6">
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-[560px] flex-nowrap gap-2">
          {steps.map((step, index) => {
            const isActive = index === activeStep;
            const isComplete = index < activeStep;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => !disabled && onStepChange(index)}
                className={
                  'flex min-w-[140px] items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ' +
                  (isActive
                    ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                    : isComplete
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 bg-gray-100 text-gray-600 hover:border-gray-300 hover:bg-gray-200')
                }
                disabled={disabled}
              >
                <span
                  className={
                    'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ' +
                    (isActive || isComplete ? 'bg-current text-white' : 'bg-white text-gray-600')
                  }
                >
                  {index + 1}
                </span>
                <span className="truncate">{step.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 h-2 w-full rounded-full bg-gray-200" aria-hidden="true">
        <div
          className="h-2 rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {progressPct}% complete
      </p>
      {steps[activeStep]?.description ? (
        <p className="mt-3 text-sm text-gray-500">{steps[activeStep].description}</p>
      ) : null}
    </div>
  );
}

const normalizeChecklistDetail = (detail) => {
  if (Array.isArray(detail)) {
    return detail.map((d) => String(d).trim()).filter(Boolean);
  }
  if (typeof detail === 'string') {
    const text = detail.trim();
    if (!text) return [];
    const items = [];
    const re = /Answer key incomplete for disbursement\s*#(\d+)[^()]*\(([^)]+)\)\.?/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      items.push(`Answer key incomplete for disbursement #${m[1]} (${m[2]})`);
    }
    if (items.length > 0) return items;
    return text
      .split(/(?:\.\s+|\n)/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

const ChecklistItem = ({ label, isReady, detail, readyText = 'Ready', unreadyText = 'Incomplete' }) => {
  const Icon = isReady ? CheckCircle2 : AlertTriangle;
  const colorClass = isReady ? 'text-emerald-600' : 'text-amber-600';
  const items = useMemo(() => normalizeChecklistDetail(detail), [detail]);
  const [expanded, setExpanded] = useState(false);
  const MAX_PREVIEW = 6;
  const visibleItems = expanded ? items : items.slice(0, MAX_PREVIEW);

  const copyAll = async () => {
    try {
      const text = items.length > 0 ? items.join('\n') : String(detail || '');
      await navigator.clipboard.writeText(text);
    } catch {
      // no-op
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-start gap-3">
            <Icon size={20} className={colorClass} />
            <div className="min-w-0">
              <span className="text-sm font-medium text-gray-800">{label}</span>
              {!isReady && items.length === 0 && detail ? (
                <p className="mt-1 text-xs text-amber-600">{detail}</p>
              ) : null}
            </div>
          </div>

          {!isReady && items.length > 0 ? (
            <div className="mt-2">
              <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-6 pr-2 text-xs text-amber-700">
                {visibleItems.map((line, idx) => (
                  <li key={idx} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {items.length > MAX_PREVIEW ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    {expanded ? 'Show less' : `Show all ${items.length}`}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={copyAll}
                  className="text-xs text-gray-600 hover:underline"
                  title="Copy the list to clipboard"
                >
                  Copy list
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <span className={`shrink-0 text-sm font-semibold ${colorClass}`}>
          {isReady ? readyText : unreadyText}
        </span>
      </div>
    </div>
  );
};

const SummaryPill = ({ label, value }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
    <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap">
      {label}
    </span>
    <span className="mt-2 block text-2xl font-semibold text-gray-900">{value}</span>
  </div>
);

function ReviewStep({
  summaryData,
  reviewChecklist = [],
  allChecklistItemsReady = true,
  generationReview = null,
  onQueueGeneration,
  isQueueing = false,
}) {
  const generationTotal = summaryData.generationTotalCount || 0;
  const generationPending = summaryData.generationPendingCount || 0;
  const generationReady = Math.max(0, generationTotal - generationPending);
  const generationPct = generationTotal > 0 ? Math.round((generationReady / generationTotal) * 100) : 0;
  const shouldOfferQueue =
    !!onQueueGeneration &&
    (!generationReview || (Array.isArray(generationReview.invoices) && generationReview.invoices.length === 0));

  return (
    <div className="space-y-6">
      <StepIntro
        title="Before you publish"
        items={[
          'Confirm the basics and generation plan.',
          'Make sure the instruction video and gate check are ready.',
          'Validate the reference documents are attached.',
        ]}
      />

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Case Summary</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <span className="text-xs uppercase tracking-wide text-gray-500">Case</span>
            <h3 className="text-lg font-semibold text-gray-900">{summaryData.caseName || 'Untitled Case'}</h3>
            <p className="mt-1 text-sm text-gray-500 capitalize">Status: {summaryData.status}</p>
            <p className="mt-1 text-sm text-gray-500">
              Type: {summaryData.caseTypeLabel || summaryData.auditArea || '—'} · Level:{' '}
              {(summaryData.caseLevel || '').charAt(0).toUpperCase()}
              {(summaryData.caseLevel || '').slice(1) || '—'} · Year-End: {summaryData.yearEnd || '—'}
            </p>
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <span className="text-xs uppercase tracking-wide text-gray-500">Publishing</span>
            <h3 className="text-lg font-semibold text-gray-900">Visible to all trainees</h3>
            <p className="mt-1 text-sm text-gray-500">Opens on publish · No due date</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <SummaryPill label="Disbursements" value={summaryData.disbursementCount} />
          <SummaryPill label="Invoice Docs" value={summaryData.mappingCount} />
          <SummaryPill label="References" value={summaryData.attachmentCount} />
        </div>

        {generationTotal > 0 ? (
          <div
            className={`mt-4 rounded-lg border p-3 text-sm ${
              generationPending > 0
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {generationPending > 0 ? (
              <p>
                {generationReady} of {generationTotal} generated reference
                {generationTotal === 1 ? '' : 's'} are ready. Generation is still in progress.
              </p>
            ) : (
              <p>All generated reference documents are ready.</p>
            )}
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/70">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${generationPct}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {shouldOfferQueue ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-800">Reference documents pending</p>
              <p className="mt-1">Queue document generation to build invoice PDFs.</p>
            </div>
            <button
              type="button"
              onClick={onQueueGeneration}
              disabled={isQueueing}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isQueueing ? 'Queueing…' : 'Queue Document Generation'}
            </button>
          </div>
        </div>
      ) : null}

      {generationReview ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-gray-900">Generated Evidence Review</h3>
            <span className="text-xs text-gray-500">
              {generationReview.invoices.length} invoices · {generationReview.disbursements.length} disbursements
            </span>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-800">Disbursements</h4>
                <span className="text-xs text-gray-500">Invoice totals vs. disbursement</span>
              </div>
              <div className="mt-3 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="px-2 py-1 text-left font-semibold">Payment ID</th>
                      <th className="px-2 py-1 text-left font-semibold">Payee</th>
                      <th className="px-2 py-1 text-left font-semibold">Pay Date</th>
                      <th className="px-2 py-1 text-right font-semibold">Amount</th>
                      <th className="px-2 py-1 text-right font-semibold">Invoices</th>
                      <th className="px-2 py-1 text-center font-semibold">Trap</th>
                      <th className="px-2 py-1 text-left font-semibold">PDFs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 text-gray-700">
                    {generationReview.disbursements.map((row) => (
                      <tr key={row.paymentId}>
                        <td className="px-2 py-1 font-semibold">{row.paymentId}</td>
                        <td className="px-2 py-1">{row.payee}</td>
                        <td className="px-2 py-1">{row.paymentDate || '—'}</td>
                        <td className="px-2 py-1 text-right">
                          {row.amount ? `$${row.amount.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {row.invoiceCount} · ${row.invoiceTotal.toLocaleString()}
                        </td>
                        <td className="px-2 py-1 text-center">
                          {row.hasTrap ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              Trap
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-left">
                          {row.invoiceLinks && row.invoiceLinks.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {row.invoiceLinks.map((link) => (
                                <a
                                  key={link.url}
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-blue-600 underline"
                                >
                                  View
                                </a>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray-400">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-800">Invoice Evidence</h4>
                  <span className="text-xs text-gray-500">Service date + aging rule</span>
                </div>
                <div className="mt-3 space-y-2">
                  {generationReview.invoices.map((invoice) => (
                    <div key={invoice.id} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-gray-900">{invoice.fileName}</p>
                          <p className="text-[11px] text-gray-500">
                            Payment {invoice.paymentId} · Service {invoice.serviceDate || '—'}
                            {invoice.shippingDate ? ` · Ship ${invoice.shippingDate}` : ''}
                          </p>
                        </div>
                        <div className="text-right text-[11px] text-gray-500">
                          {invoice.amount ? `$${invoice.amount.toLocaleString()}` : '—'}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span
                          className={`rounded-full px-2 py-0.5 font-semibold ${
                            invoice.shouldBeInAging
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {invoice.shouldBeInAging ? 'Should be in AP Aging' : 'Post-year-end'}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-semibold ${
                            invoice.isRecorded ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {invoice.isRecorded ? 'Recorded' : 'Not recorded'}
                        </span>
                        {invoice.templateId ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                            {invoice.templateId}
                          </span>
                        ) : null}
                        {invoice.downloadURL ? (
                          <a
                            href={invoice.downloadURL}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 underline"
                          >
                            View PDF
                          </a>
                        ) : invoice.storagePath ? (
                          <span className="text-gray-500">Stored in Firebase</span>
                        ) : (
                          <span className="text-amber-700">Pending generation</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <h4 className="text-sm font-semibold text-gray-800">AP Aging Summary</h4>
                {generationReview.apAgingDoc ? (
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
                    <span>{generationReview.apAgingDoc.fileName}</span>
                    {generationReview.apAgingDoc.downloadURL ? (
                      <a
                        href={generationReview.apAgingDoc.downloadURL}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline"
                      >
                        View PDF
                      </a>
                    ) : generationReview.apAgingDoc.storagePath ? (
                      <span className="text-gray-500">Stored in Firebase</span>
                    ) : (
                      <span className="text-amber-700">Pending generation</span>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">No AP aging reference document found.</p>
                )}
              </div>
              {generationReview.jobStatus ? (
                <div
                  className={`rounded-lg border p-3 text-xs ${
                    generationReview.jobStatus.status === 'completed'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : generationReview.jobStatus.status === 'partial'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-red-200 bg-red-50 text-red-700'
                  }`}
                >
                  <p className="font-semibold">
                    Generation job status: {generationReview.jobStatus.status}
                  </p>
                  {generationReview.jobStatus.errorCount ? (
                    <p className="mt-1">
                      {generationReview.jobStatus.errorCount} error
                      {generationReview.jobStatus.errorCount === 1 ? '' : 's'} reported.
                    </p>
                  ) : null}
                  {Array.isArray(generationReview.jobStatus.errors) &&
                  generationReview.jobStatus.errors.length > 0 ? (
                    <ul className="mt-2 list-disc pl-4">
                      {generationReview.jobStatus.errors.map((err, index) => (
                        <li key={index}>
                          {err?.fileName ? `${err.fileName}: ` : ''}
                          {err?.templateId ? `${err.templateId} · ` : ''}
                          {err?.error || 'Generation error'}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {reviewChecklist.map((item) => (
          <ChecklistItem
            key={item.id}
            label={item.label}
            isReady={item.isReady}
            detail={item.detail}
            readyText="Ready"
            unreadyText="Needs attention"
          />
        ))}
      </div>

      {allChecklistItemsReady ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 shadow-sm">
          <p className="text-sm font-medium">All checks passed. You can submit this case when ready.</p>
        </div>
      ) : null}
    </div>
  );
}

export { CaseFormStepNav, ReviewStep };
