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

function ReviewStep({ summaryData, reviewChecklist = [], allChecklistItemsReady = true }) {
  const formatDateTime = (value) => {
    if (!value) return 'Not set';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not set';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  };

  const audienceLabel = summaryData.publicVisible
    ? 'Visible to all trainees'
    : `${summaryData.selectedUserIds.length} specific user${summaryData.selectedUserIds.length === 1 ? '' : 's'}`;

  return (
    <div className="space-y-6">
      <StepIntro
        title="Before you publish"
        items={[
          'Double-check the basics and audience visibility.',
          'Confirm transactions and answer keys are complete.',
          'Ensure reference documents are uploaded and accessible.',
        ]}
      />

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Case Summary</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <span className="text-xs uppercase tracking-wide text-gray-500">Case</span>
            <h3 className="text-lg font-semibold text-gray-900">{summaryData.caseName || 'Untitled Case'}</h3>
            <p className="mt-1 text-sm text-gray-500 capitalize">Status: {summaryData.status}</p>
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <span className="text-xs uppercase tracking-wide text-gray-500">Audience</span>
            <h3 className="text-lg font-semibold text-gray-900">{audienceLabel}</h3>
            <p className="mt-1 text-sm text-gray-500">
              Opens: {formatDateTime(summaryData.opensAtStr)} · Due: {formatDateTime(summaryData.dueAtStr)}
            </p>
            {!summaryData.publicVisible && summaryData.selectedUserIds.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                {summaryData.selectedUserIds.slice(0, 6).map((id) => (
                  <li key={id} className="rounded bg-white px-2 py-1 shadow-sm">
                    {id}
                  </li>
                ))}
                {summaryData.selectedUserIds.length > 6 ? (
                  <li className="rounded bg-white px-2 py-1 shadow-sm text-gray-500">
                    +{summaryData.selectedUserIds.length - 6} more
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <SummaryPill label="Disbursements" value={summaryData.disbursementCount} />
          <SummaryPill label="Invoice Docs" value={summaryData.mappingCount} />
          <SummaryPill label="References" value={summaryData.attachmentCount} />
        </div>
      </div>

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
