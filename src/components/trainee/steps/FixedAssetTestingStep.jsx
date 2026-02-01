import React, { useMemo } from 'react';
import { Button, Input, Textarea } from '../../../AppCore';
import { CheckCircle2, XCircle, Send, Download } from 'lucide-react';
import { currencyFormatter } from '../../../utils/formatters';
import EvidenceList from '../evidence/EvidenceList';
import EvidenceViewer from '../evidence/EvidenceViewer';

export default function FixedAssetTestingStep({
  fixedAssetDraft,
  fixedAssetRisk,
  fixedAssetTotals,
  fixedAssetSummary,
  fixedAssetAdditions,
  fixedAssetDisposals,
  referenceDocuments,
  selectedEvidenceItems,
  viewerEvidenceItems,
  onSelectEvidence,
  activeEvidenceId,
  viewerEnabled,
  activeEvidenceLoading,
  activeEvidenceError,
  activeEvidenceUrl,
  handleViewDocument,
  handleDownloadAllReferences,
  isEvidenceWorkflowLinked,
  pdfViewerState,
  toggleLeadScheduleTick,
  updateScopingDecision,
  updateAdditionResponse,
  updateDisposalResponse,
  updateAnalyticsResponse,
  handleSubmitFixedAsset,
  setActiveStep,
  firstWorkflowStep,
  onBackToSelection,
  isLocked,
  isScopingModalOpen,
  setIsScopingModalOpen,
  scopingModalError,
  setScopingModalError,
  visibleSections,
  submitLabel = 'Submit Fixed Asset Testing',
}) {
  const sectionVisibility = {
    scopingSummary: true,
    leadSchedule: true,
    strategy: true,
    policy: true,
    evidence: true,
    additions: true,
    disposals: true,
    analytics: true,
    submit: true,
    ...(visibleSections || {}),
  };
  const policyDoc = useMemo(() => {
    if (!Array.isArray(referenceDocuments)) return null;
    return (
      referenceDocuments.find(
        (doc) =>
          doc?.key === 'capitalization_policy' ||
          doc?.generationSpec?.templateId === 'refdoc.fa-policy.v1'
      ) || referenceDocuments[0] || null
    );
  }, [referenceDocuments]);
  const leadTicks = fixedAssetDraft.leadScheduleTicks || {};
  const totalTickTargets = ['total:beginningBalance', 'total:additions', 'total:disposals', 'total:endingBalance'];
  const totalsTicked = totalTickTargets.every((key) => leadTicks[key]);
  const scopingDraft = useMemo(() => fixedAssetDraft.scopingDecision || {}, [fixedAssetDraft]);
  const tmValue = scopingDraft.tmInput ?? fixedAssetRisk?.tolerableMisstatement ?? '';
  const additionsValue = fixedAssetTotals.additions || 0;
  const tmNumber = Number(tmValue);
  const additionsExceedTm = Number.isFinite(tmNumber) ? additionsValue > tmNumber : false;
  const studentPlan = scopingDraft.studentPlan || '';
  const rationale = scopingDraft.rationale || '';
  const outcome = scopingDraft.outcome || '';
  const evidenceList = Array.isArray(viewerEvidenceItems) && viewerEvidenceItems.length > 0
    ? viewerEvidenceItems
    : selectedEvidenceItems;
  const leadCellClass = (cellKey) => {
    const state = leadTicks[cellKey];
    if (state === 'verified') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (state === 'exception') return 'border-rose-200 bg-rose-50 text-rose-800';
    return 'border-gray-200 bg-gray-50 text-gray-700';
  };
  const handleBackToSelection = onBackToSelection || (() => setActiveStep(firstWorkflowStep));

  const renderScopingModal = () => {
    if (!isScopingModalOpen) return null;
    const planLabel =
      studentPlan === 'testing' ? 'Proceed to testing' : studentPlan === 'no_testing' ? 'No testing' : '—';
    const handleConfirmScopingDecision = () => {
      if (!studentPlan) {
        setScopingModalError('Choose a testing strategy before continuing.');
        return;
      }
      const nextOutcome =
        studentPlan === 'no_testing'
          ? additionsExceedTm
            ? 'insufficient_scope'
            : 'no_testing'
          : 'requires_testing';
      setScopingModalError('');
      updateScopingDecision({
        tmInput: tmValue,
        additionsTotal: additionsValue,
        additionsExceedTm,
        studentPlan,
        rationale,
        outcome: nextOutcome,
        decidedAt: new Date().toISOString(),
      });
      setIsScopingModalOpen(false);
      handleBackToSelection();
    };

    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
        <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
          <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
            <div>
              <p className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Testing Strategy Selector</p>
              <h3 className="text-lg font-bold text-gray-900">Decide whether testing is required</h3>
            </div>
            <button
              type="button"
              className="text-gray-500 hover:text-gray-700"
              onClick={() => {
                setIsScopingModalOpen(false);
                setScopingModalError('');
              }}
            >
              ✕
            </button>
          </div>
          <div className="space-y-5 px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-gray-700">
                Tolerable Misstatement
                <Input
                  type="number"
                  inputMode="decimal"
                  className="mt-1"
                  value={tmValue}
                  onChange={(event) => updateScopingDecision({ tmInput: event.target.value })}
                />
              </label>
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">System check</p>
                <p className="mt-1 text-sm text-indigo-900">
                  Is Total Additions ({currencyFormatter.format(additionsValue)}) {'>'} TM (
                  {tmValue ? currencyFormatter.format(Number(tmValue) || 0) : 'enter TM'})?
                </p>
                <p className="mt-1 text-sm font-semibold text-indigo-800">
                  {additionsExceedTm ? 'Yes — testing expected.' : 'No — testing may not be required.'}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-3">
              <p className="text-sm font-semibold text-gray-800">Your decision</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    checked={studentPlan === 'testing'}
                    onChange={() => updateScopingDecision({ studentPlan: 'testing' })}
                  />
                  Proceed to detailed testing
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    checked={studentPlan === 'no_testing'}
                    onChange={() => updateScopingDecision({ studentPlan: 'no_testing' })}
                  />
                  No testing required
                </label>
                <span className="text-xs text-gray-500">Virtual Senior expects testing when additions exceed TM.</span>
              </div>
              <Textarea
                placeholder="Document your rationale (e.g., why testing is or is not required)."
                value={rationale}
                onChange={(event) => updateScopingDecision({ rationale: event.target.value })}
                rows={3}
              />
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p className="font-semibold">Outcome preview</p>
                <p className="mt-1">
                  Plan: {planLabel}.{' '}
                  {additionsExceedTm && studentPlan === 'no_testing'
                    ? 'Virtual Senior will flag insufficient scope.'
                    : studentPlan
                    ? 'Decision will be recorded when you lock the strategy.'
                    : 'Choose a strategy to continue.'}
                </p>
              </div>
              {scopingModalError ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {scopingModalError}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsScopingModalOpen(false);
                  setScopingModalError('');
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmScopingDecision}>Lock Strategy</Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const scopingSummaryCard = (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Scoping checkpoint</p>
        <p className="text-sm text-indigo-900">
          Additions: {currencyFormatter.format(fixedAssetTotals.additions || 0)} · TM:{' '}
          {tmValue ? currencyFormatter.format(Number(tmValue) || 0) : 'not entered'}
        </p>
        <p className="text-xs text-indigo-800">
          Outcome:{' '}
          {outcome === 'requires_testing'
            ? 'Testing required'
            : outcome === 'no_testing'
            ? 'No testing required'
            : 'Insufficient scope'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={handleBackToSelection}>
          Edit Strategy
        </Button>
      </div>
    </div>
  );

  const enableScopingGate = sectionVisibility.scopingSummary || sectionVisibility.strategy;

  if (enableScopingGate && !outcome) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
        <h2 className="text-2xl font-semibold text-gray-800">Lock your testing strategy</h2>
        <p className="text-sm text-gray-600">
          Finish the rollforward tickmarking and open the Testing Strategy Selector before starting work.
        </p>
        <div className="mt-4">
          <Button variant="secondary" onClick={handleBackToSelection}>
            Return to Lead Schedule
          </Button>
        </div>
      </div>
    );
  }

  if (enableScopingGate && outcome !== 'requires_testing') {
    return (
      <div className="space-y-4">
        {sectionVisibility.scopingSummary ? scopingSummaryCard : null}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-3">
          <h3 className="text-xl font-semibold text-gray-800">
            {outcome === 'no_testing' && !additionsExceedTm ? 'No further testing required' : 'Virtual Senior: scope failed'}
          </h3>
          <p className="text-sm text-gray-600">
            {outcome === 'no_testing' && !additionsExceedTm
              ? 'You concluded testing is unnecessary because additions are under tolerable misstatement.'
              : 'Additions exceed tolerable misstatement, so skipping testing will be flagged as insufficient scope.'}
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={handleBackToSelection}>
              Back
            </Button>
            <Button onClick={handleSubmitFixedAsset}>Record Decision and Finish</Button>
          </div>
        </div>
      </div>
    );
  }

  const capitalizationThreshold =
    Number(fixedAssetRisk.capitalizationThreshold || fixedAssetRisk.tolerableMisstatement || 0) || 0;

  return (
    <div className="relative">
      {sectionVisibility.strategy ? renderScopingModal() : null}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-5">
        {sectionVisibility.scopingSummary ? scopingSummaryCard : null}
        {sectionVisibility.leadSchedule ? (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Lead Schedule</p>
              <h2 className="text-2xl font-semibold text-gray-800">Tick and tie the rollforward before testing</h2>
              <p className="text-sm text-gray-500">
                Click each balance to mark it as verified (green) or not agreed (red). Summary totals must be ticked before you choose your testing strategy.
              </p>
            </div>

            {fixedAssetSummary.length === 0 ? (
              <p className="text-gray-600 text-sm">No rollforward data available. Contact your instructor before proceeding.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Asset Class</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Beg Bal</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Additions</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Disposals</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">End Bal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {fixedAssetSummary.map((row, index) => {
                      const rowKey = row.className || `class-${index + 1}`;
                      const renderCell = (fieldKey, value) => {
                        const cellKey = `${rowKey}:${fieldKey}`;
                        return (
                          <td key={cellKey} className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => toggleLeadScheduleTick(cellKey)}
                              className={`w-full rounded-md border px-3 py-2 text-right transition ${leadCellClass(cellKey)}`}
                              aria-label={`Tick ${row.className || rowKey} ${fieldKey}`}
                            >
                              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
                                <span>{leadTicks[cellKey] === 'exception' ? 'Does not agree' : 'Tick'}</span>
                                {leadTicks[cellKey] === 'verified' ? (
                                  <CheckCircle2 size={14} />
                                ) : leadTicks[cellKey] === 'exception' ? (
                                  <XCircle size={14} />
                                ) : null}
                              </div>
                              <div className="text-base font-semibold">{currencyFormatter.format(Number(value) || 0)}</div>
                            </button>
                          </td>
                        );
                      };

                      return (
                        <tr key={rowKey}>
                          <td className="px-3 py-2 font-semibold text-gray-800">{row.className || `Class ${index + 1}`}</td>
                          {renderCell('beginningBalance', row.beginningBalance)}
                          {renderCell('additions', row.additions)}
                          {renderCell('disposals', row.disposals)}
                          {renderCell('endingBalance', row.endingBalance)}
                        </tr>
                      );
                    })}
                    <tr className="bg-slate-50 font-semibold text-gray-900">
                      <td className="px-3 py-2">Total</td>
                      {['beginningBalance', 'additions', 'disposals', 'endingBalance'].map((col) => {
                        const cellKey = `total:${col}`;
                        return (
                          <td key={cellKey} className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => toggleLeadScheduleTick(cellKey)}
                              className={`w-full rounded-md border px-3 py-2 text-right transition ${leadCellClass(cellKey)}`}
                              aria-label={`Tick total ${col}`}
                            >
                              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
                                <span>{leadTicks[cellKey] === 'exception' ? 'Does not agree' : 'Tick'}</span>
                                {leadTicks[cellKey] === 'verified' ? (
                                  <CheckCircle2 size={14} />
                                ) : leadTicks[cellKey] === 'exception' ? (
                                  <XCircle size={14} />
                                ) : null}
                              </div>
                              <div className="text-base font-semibold">
                                {currencyFormatter.format(Number(fixedAssetTotals[col]) || 0)}
                              </div>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}

        {sectionVisibility.strategy ? (
        <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-gray-800">Testing strategy</h3>
              <p className="text-sm text-gray-600">Totals must be ticked before you can choose a testing strategy.</p>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Strategy status</div>
              <div className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-800">
                {outcome === 'requires_testing'
                  ? 'Testing unlocked'
                  : outcome === 'no_testing'
                  ? 'No testing required'
                  : outcome === 'insufficient_scope'
                  ? 'Insufficient scope'
                  : 'Pending strategy'}
              </div>
              <div className="text-xs text-gray-500">
                TM: {tmValue ? currencyFormatter.format(Number(tmValue) || 0) : 'enter TM'} | Additions:{' '}
                {currencyFormatter.format(additionsValue)}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={handleBackToSelection}>
              Back to Cases
            </Button>
            <Button
              onClick={() => {
                setIsScopingModalOpen(true);
                setScopingModalError('');
              }}
              disabled={isLocked || !totalsTicked || fixedAssetSummary.length === 0}
            >
              Open Testing Strategy Selector
            </Button>
          </div>
        </section>
        ) : null}

        {(sectionVisibility.policy || sectionVisibility.evidence) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {sectionVisibility.policy ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Capitalization Policy</p>
            <h3 className="text-lg font-semibold text-gray-800">Keep the policy visible while testing</h3>
            <p className="mt-1 text-sm text-gray-600">
              Use the client policy to benchmark nature, threshold, and useful life conclusions.
            </p>
            {policyDoc ? (
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    handleViewDocument({
                      fileName: policyDoc.fileName,
                      storagePath: policyDoc.storagePath,
                      downloadURL: policyDoc.downloadURL,
                    })
                  }
                >
                  Open {policyDoc.fileName || 'Capitalization Policy'}
                </Button>
                {Array.isArray(referenceDocuments) && referenceDocuments.length > 1 ? (
                  <Button variant="ghost" onClick={handleDownloadAllReferences}>
                    <Download size={14} className="inline mr-1" />
                    Download all reference docs
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                No policy document linked. Check the Reference Materials section.
              </p>
            )}
          </div>
          ) : null}
          {sectionVisibility.evidence ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Invoice Viewer</p>
            <h3 className="text-lg font-semibold text-gray-800">Reference tray for source documents</h3>
            <p className="mt-1 text-sm text-gray-600">
              Use the existing document viewer to open each invoice while you record conclusions below.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <EvidenceList
                items={evidenceList}
                activeEvidenceId={activeEvidenceId}
                onSelect={onSelectEvidence}
                isEvidenceWorkflowLinked={isEvidenceWorkflowLinked}
              />
              <EvidenceViewer
                items={evidenceList}
                viewerEnabled={viewerEnabled}
                activeEvidenceId={activeEvidenceId}
                activeEvidenceLoading={activeEvidenceLoading}
                activeEvidenceError={activeEvidenceError}
                activeEvidenceUrl={activeEvidenceUrl}
                onOpenDocument={handleViewDocument}
              />
            </div>
          </div>
          ) : null}
        </div>
        ) : null}

        {sectionVisibility.additions ? (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Additions workbench</p>
            <h3 className="text-lg font-semibold text-gray-800">Nature, threshold, and useful life tests</h3>
          </div>
          {fixedAssetAdditions.length === 0 ? (
            <p className="text-sm text-gray-600">No additions were provided for this case.</p>
          ) : (
            <div className="space-y-3">
              {fixedAssetAdditions.map((item, index) => {
                const additionId = item._tempId || item.vendor || item.description || `addition-${index + 1}`;
                const response = fixedAssetDraft.additionResponses?.[additionId] || {};
                const amountNumber = Number(item.amount) || 0;
                const exceedsThreshold = item.amountThreshold
                  ? amountNumber > Number(item.amountThreshold)
                  : capitalizationThreshold > 0
                  ? amountNumber >= capitalizationThreshold
                  : null;
                return (
                  <div key={additionId} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-800">{item.vendor || 'Addition'}</p>
                        <p className="text-sm text-gray-600">{item.description || 'No description provided'}</p>
                        <p className="text-sm text-gray-500">Amount: {currencyFormatter.format(amountNumber)}</p>
                      </div>
                      <div className="flex flex-col gap-1 text-xs text-gray-600">
                        {item.amountThreshold ? (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-1 font-semibold ${
                              exceedsThreshold ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            Threshold: {currencyFormatter.format(Number(item.amountThreshold) || 0)}
                          </span>
                        ) : null}
                        {item.usefulLife ? (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-800">
                            Useful life: {item.usefulLife} years
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
                        Treatment
                        <select
                          className="rounded-md border border-gray-300 p-2"
                          value={response.treatment || ''}
                          onChange={(event) => updateAdditionResponse(additionId, { treatment: event.target.value })}
                        >
                          <option value="">Choose...</option>
                          <option value="expense">Expense</option>
                          <option value="capitalize">Capitalize</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
                        Threshold check
                        <select
                          className="rounded-md border border-gray-300 p-2"
                          value={response.threshold || (exceedsThreshold === null ? '' : exceedsThreshold ? 'over' : 'under')}
                          onChange={(event) => updateAdditionResponse(additionId, { threshold: event.target.value })}
                        >
                          <option value="">Choose...</option>
                          <option value="over">Above threshold</option>
                          <option value="under">Below threshold</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
                        Useful life
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={response.usefulLife || ''}
                          onChange={(event) => updateAdditionResponse(additionId, { usefulLife: event.target.value })}
                        />
                      </label>
                    </div>
                    <Textarea
                      className="mt-2"
                      placeholder="Note your conclusion"
                      value={response.note || ''}
                      onChange={(event) => updateAdditionResponse(additionId, { note: event.target.value })}
                      rows={3}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>
        ) : null}

        {sectionVisibility.disposals ? (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Disposals workbench</p>
            <h3 className="text-lg font-semibold text-gray-800">Gain/loss checks</h3>
          </div>
          {fixedAssetDisposals.length === 0 ? (
            <p className="text-sm text-gray-600">No disposals were provided for this case.</p>
          ) : (
            <div className="space-y-3">
              {fixedAssetDisposals.map((item, index) => {
                const disposalId = item._tempId || item.vendor || item.description || `disposal-${index + 1}`;
                const response = fixedAssetDraft.disposalResponses?.[disposalId] || {};
                return (
                  <div key={disposalId} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-800">{item.vendor || 'Disposal'}</p>
                        <p className="text-sm text-gray-600">{item.description || 'No description provided'}</p>
                        <p className="text-sm text-gray-500">Proceeds: {currencyFormatter.format(Number(item.proceeds) || 0)}</p>
                      </div>
                      <div className="flex flex-col gap-1 text-xs text-gray-600">
                        {item.gainLossPerBooks ? (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-800">
                            Booked gain/loss: {currencyFormatter.format(Number(item.gainLossPerBooks) || 0)}
                          </span>
                        ) : null}
                        {item.expectedGainLoss ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">
                            Expected: {currencyFormatter.format(Number(item.expectedGainLoss) || 0)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
                        Recalc gain/loss
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={response.recalcGainLoss || ''}
                          onChange={(event) => updateDisposalResponse(disposalId, { recalcGainLoss: event.target.value })}
                        />
                      </label>
                      <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
                        Difference vs books
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={response.difference || ''}
                          onChange={(event) => updateDisposalResponse(disposalId, { difference: event.target.value })}
                        />
                      </label>
                      <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
                        Conclusion
                        <select
                          className="rounded-md border border-gray-300 p-2"
                          value={response.conclusion || ''}
                          onChange={(event) => updateDisposalResponse(disposalId, { conclusion: event.target.value })}
                        >
                          <option value="">Choose...</option>
                          <option value="reasonable">Reasonable</option>
                          <option value="issue">Issue noted</option>
                        </select>
                      </label>
                    </div>
                    <Textarea
                      className="mt-2"
                      placeholder="Note your conclusion"
                      value={response.note || ''}
                      onChange={(event) => updateDisposalResponse(disposalId, { note: event.target.value })}
                      rows={3}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>
        ) : null}

        {sectionVisibility.analytics ? (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Analytics</p>
            <h3 className="text-lg font-semibold text-gray-800">Straight-line amortization reasonableness</h3>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">System calc</p>
              <p className="text-sm text-blue-900">
                Expected expense (using weighted average life):{' '}
                {(() => {
                  const life =
                    Number(fixedAssetDraft.analyticsResponse?.weightedAverageLife) ||
                    Number(fixedAssetRisk.weightedAverageLife) ||
                    0;
                  const baseAmount = fixedAssetTotals.endingBalance || fixedAssetTotals.beginningBalance || 0;
                  const expected = life > 0 ? baseAmount / life : 0;
                  return currencyFormatter.format(expected || 0);
                })()}
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
              Your expected expense
              <Input
                type="number"
                inputMode="decimal"
                value={fixedAssetDraft.analyticsResponse?.expectedExpense || ''}
                onChange={(event) => updateAnalyticsResponse({ expectedExpense: event.target.value })}
              />
            </label>
            <label className="text-xs font-semibold text-gray-700 flex flex-col gap-1">
              Client recorded expense
              <Input
                type="number"
                inputMode="decimal"
                value={fixedAssetDraft.analyticsResponse?.recordedExpense || ''}
                onChange={(event) => updateAnalyticsResponse({ recordedExpense: event.target.value })}
              />
            </label>
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-gray-700 mb-1">Conclusion</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    checked={fixedAssetDraft.analyticsResponse?.conclusion === 'reasonable'}
                    onChange={() => updateAnalyticsResponse({ conclusion: 'reasonable' })}
                  />
                  Reasonable (within 5%)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    checked={fixedAssetDraft.analyticsResponse?.conclusion === 'investigate'}
                    onChange={() => updateAnalyticsResponse({ conclusion: 'investigate' })}
                  />
                  Investigate (>5% variance)
                </label>
              </div>
            </div>
          </div>
          <Textarea
            className="mt-2"
            placeholder="Analytics note"
            value={fixedAssetDraft.analyticsResponse?.note || ''}
            onChange={(event) => updateAnalyticsResponse({ note: event.target.value })}
            rows={3}
          />
        </section>
        ) : null}

        {sectionVisibility.submit ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <Button variant="secondary" onClick={handleBackToSelection} disabled={isLocked}>
              Back to Lead Schedule
            </Button>
            <Button onClick={handleSubmitFixedAsset} disabled={isLocked}>
              <Send size={18} className="inline mr-2" /> {submitLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
