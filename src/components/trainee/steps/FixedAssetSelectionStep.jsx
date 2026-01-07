import React, { useMemo } from 'react';
import { Button, Input, Textarea } from '../../../AppCore';
import { CheckCircle2, XCircle } from 'lucide-react';
import { currencyFormatter } from '../../../utils/formatters';

export default function FixedAssetSelectionStep({
  fixedAssetDraft,
  fixedAssetTotals,
  fixedAssetSummary,
  fixedAssetRisk,
  isLocked,
  navigate,
  toggleLeadScheduleTick,
  updateScopingDecision,
  setIsScopingModalOpen,
  scopingModalError,
  setScopingModalError,
  isScopingModalOpen,
  onStrategyLocked,
}) {
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
  const leadCellClass = (cellKey) => {
    const state = leadTicks[cellKey];
    if (state === 'verified') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (state === 'exception') return 'border-rose-200 bg-rose-50 text-rose-800';
    return 'border-gray-200 bg-gray-50 text-gray-700';
  };

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
      onStrategyLocked?.();
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
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Lead Schedule</p>
          <h2 className="text-2xl font-semibold text-gray-800">Tick and tie the rollforward before testing</h2>
          <p className="text-sm text-gray-500">
            Click each balance to mark it as verified (green) or not agreed (red). Summary totals must be ticked before
            you choose your testing strategy.
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
                    const value = fixedAssetTotals[col] || 0;
                    return (
                      <td key={cellKey} className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleLeadScheduleTick(cellKey)}
                          className={`w-full rounded-md border px-3 py-2 text-right transition ${leadCellClass(cellKey)}`}
                          aria-label={`Tick total ${col}`}
                        >
                          <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
                            <span>Summary total</span>
                            {leadTicks[cellKey] === 'verified' ? (
                              <CheckCircle2 size={14} />
                            ) : leadTicks[cellKey] === 'exception' ? (
                              <XCircle size={14} />
                            ) : null}
                          </div>
                          <div className="text-base font-semibold">{currencyFormatter.format(value)}</div>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1 text-sm text-gray-700">
            <p className="font-semibold text-gray-800">Tickmark legend</p>
            <p>
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 mr-2">
                Verified
              </span>
              <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                Does not agree
              </span>
            </p>
            <p className="text-xs text-gray-500">Totals must be ticked before you can choose a testing strategy.</p>
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
          <Button variant="secondary" onClick={() => navigate('/trainee')}>
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
      </div>
    </div>
  );
}
