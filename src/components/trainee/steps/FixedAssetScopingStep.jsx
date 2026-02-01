import React, { useMemo } from 'react';
import { Button, Input, Textarea } from '../../../AppCore';
import { currencyFormatter } from '../../../utils/formatters';

export default function FixedAssetScopingStep({
  fixedAssetDraft,
  fixedAssetRisk,
  fixedAssetTotals,
  isLocked,
  updateScopingDecision,
  isScopingModalOpen,
  setIsScopingModalOpen,
  scopingModalError,
  setScopingModalError,
  onSubmit,
  submitLabel = 'Submit Scoping Decision',
}) {
  const scopingDraft = useMemo(() => fixedAssetDraft.scopingDecision || {}, [fixedAssetDraft]);
  const tmValue = scopingDraft.tmInput ?? fixedAssetRisk?.tolerableMisstatement ?? '';
  const additionsValue = fixedAssetTotals.additions || 0;
  const tmNumber = Number(tmValue);
  const additionsExceedTm = Number.isFinite(tmNumber) ? additionsValue > tmNumber : false;
  const studentPlan = scopingDraft.studentPlan || '';
  const rationale = scopingDraft.rationale || '';
  const outcome = scopingDraft.outcome || '';

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

  return (
    <div className="relative">
      {renderScopingModal()}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-5">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Scoping Decision</p>
          <h2 className="text-2xl font-semibold text-gray-800">Define how much testing is required</h2>
          <p className="text-sm text-gray-500">
            Use tolerable misstatement and additions totals to determine your testing strategy.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
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
                : outcome === 'insufficient_scope'
                ? 'Insufficient scope'
                : 'Pending'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setIsScopingModalOpen(true);
                setScopingModalError('');
              }}
              disabled={isLocked}
            >
              Open Testing Strategy Selector
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={onSubmit} disabled={isLocked}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
