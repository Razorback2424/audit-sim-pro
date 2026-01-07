import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Input, Textarea } from '../../../AppCore';
import { currencyFormatter } from '../../../utils/formatters';

const DECISION = {
  UNDECIDED: 'undecided',
  PASS: 'pass',
  EXCEPTION: 'exception',
};

const noop = () => {};

const deriveDecision = (allocation) => {
  if (allocation?.isException === true) return DECISION.EXCEPTION;
  if (allocation?.isException === false) return DECISION.PASS;
  return DECISION.UNDECIDED;
};

export default function AuditProcedureWorkspace({
  item,
  allocation,
  classificationFields,
  onSplitToggle = noop,
  onClassificationChange = noop,
  onSplitAmountChange = noop,
  onRationaleChange = noop,
  onNoteChange = noop,
  canMakeDecision = true,
  onDecisionBlocked = noop,
  isComplete,
  isLocked,
  totalsMatch,
  totalEntered,
  onUpdate,
  workspaceState,
}) {
  const itemKey = item?.paymentId || item?.id || '';
  const amountNumber = Number(item?.amount) || 0;
  const isSplit = allocation.mode === 'split';

  const [currentDecision, setCurrentDecision] = useState(() => deriveDecision(allocation));

  const startTimeRef = useRef(
    workspaceState?.startedAt ? new Date(workspaceState.startedAt).getTime() : Date.now()
  );

  const emitUpdate = useCallback(
    (updates) => {
      if (typeof onUpdate !== 'function' || !itemKey || !updates || typeof updates !== 'object') {
        return;
      }
      onUpdate(itemKey, {
        updatedAt: new Date().toISOString(),
        ...updates,
      });
    },
    [itemKey, onUpdate]
  );

  useEffect(() => {
    if (!workspaceState?.startedAt) {
      emitUpdate({ startedAt: new Date(startTimeRef.current).toISOString() });
      return;
    }
    const parsed = new Date(workspaceState.startedAt);
    if (!Number.isNaN(parsed.getTime())) {
      startTimeRef.current = parsed.getTime();
    }
  }, [workspaceState?.startedAt, emitUpdate]);

  useEffect(() => {
    const updateDuration = () => {
      const elapsedSeconds = Math.max(
        0,
        Math.round((Date.now() - startTimeRef.current) / 1000)
      );
      emitUpdate({ interactionDuration: elapsedSeconds });
    };

    updateDuration();
    const intervalId = window.setInterval(updateDuration, 5000);
    return () => window.clearInterval(intervalId);
  }, [emitUpdate]);

  useEffect(() => {
    setCurrentDecision(deriveDecision(allocation));
  }, [allocation]);

  const workpaperNote = typeof allocation?.workpaperNote === 'string'
    ? allocation.workpaperNote
    : typeof allocation?.notes === 'string'
    ? allocation.notes
    : '';

  const resolveSplitValue = useCallback(
    (key) => {
      if (allocation?.splitValues && allocation.splitValues[key] !== undefined) {
        return allocation.splitValues[key];
      }
      return allocation?.[key] ?? '';
    },
    [allocation]
  );

  const clearAllClassificationAmounts = useCallback(() => {
    if (!itemKey) return;
    classificationFields.forEach(({ key }) => onSplitAmountChange(itemKey, key, ''));
  }, [classificationFields, itemKey, onSplitAmountChange]);

  const applySingleAllocation = useCallback(
    (classificationKey) => {
      if (!itemKey) return;
      onSplitToggle(itemKey, false, item);
      onClassificationChange(itemKey, classificationKey);
      classificationFields.forEach(({ key }) => {
        const value = key === classificationKey ? amountNumber : '';
        onSplitAmountChange(itemKey, key, value === '' ? '' : String(value));
      });
    },
    [amountNumber, classificationFields, item, itemKey, onClassificationChange, onSplitAmountChange, onSplitToggle]
  );

  const handleDecisionChange = (nextDecision) => {
    if (!canMakeDecision) {
      onDecisionBlocked();
      return;
    }
    const isException = nextDecision === DECISION.EXCEPTION;
    setCurrentDecision(nextDecision);
    if (!itemKey) return;
    onRationaleChange(itemKey, 'isException', isException);

    if (!isException) {
      onRationaleChange(itemKey, 'assertion', '');
      onRationaleChange(itemKey, 'reason', '');
      applySingleAllocation('properlyIncluded');
    } else {
      clearAllClassificationAmounts();
      onClassificationChange(itemKey, '');
    }
  };

  const handleSplitToggleInternal = (checked) => {
    if (!canMakeDecision) {
      onDecisionBlocked();
      return;
    }
    if (!itemKey) return;
    onSplitToggle(itemKey, checked, item);

    if (!checked) {
      if (allocation.singleClassification) {
        applySingleAllocation(allocation.singleClassification);
      } else {
        clearAllClassificationAmounts();
      }
      return;
    }
  };

  const statusTone =
    currentDecision === DECISION.EXCEPTION
      ? 'border-rose-200 bg-rose-50/60'
      : currentDecision === DECISION.PASS
      ? 'border-emerald-200 bg-emerald-50/70'
      : 'border-amber-200 bg-amber-50/70';

  return (
    <div
      className={`audit-workspace space-y-5 rounded-2xl border p-5 shadow-sm transition-colors ${statusTone}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor</p>
          <p className="text-2xl font-semibold text-slate-900">{item.payee || 'Unknown payee'}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</p>
          <p className="text-2xl font-bold text-slate-900">{currencyFormatter.format(amountNumber)}</p>
        </div>
      </div>

      <div className="text-xs text-slate-500">
        <span className="font-medium text-slate-600">Payment ID:</span> {item.paymentId || '—'}{' '}
        <span className="mx-2 text-slate-300">|</span>
        <span className="font-medium text-slate-600">Payment Date:</span> {item.paymentDate || '—'}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => handleDecisionChange(DECISION.PASS)}
          disabled={isLocked}
          className={`w-full rounded-xl px-5 py-3 text-sm font-semibold shadow-sm transition-all ${
            currentDecision === DECISION.PASS
              ? 'bg-emerald-600 text-white ring-2 ring-emerald-200'
              : 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50'
          }`}
        >
          ✅ No Exception
        </button>
        <button
          type="button"
          onClick={() => handleDecisionChange(DECISION.EXCEPTION)}
          disabled={isLocked}
          className={`w-full rounded-xl px-5 py-3 text-sm font-semibold shadow-sm transition-all ${
            currentDecision === DECISION.EXCEPTION
              ? 'bg-rose-600 text-white ring-2 ring-rose-200'
              : 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50'
          }`}
        >
          ⚠️ Exception
        </button>
      </div>

      {currentDecision === DECISION.EXCEPTION ? (
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-gray-800">
            Exception note <span className="text-rose-700">*</span>
            <Textarea
              className="mt-1"
              rows={3}
              value={workpaperNote}
              onChange={(event) => (itemKey ? onNoteChange(itemKey, event.target.value) : null)}
              disabled={isLocked}
              placeholder="Why is this an exception?"
            />
          </label>
        </div>
      ) : null}

      <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          checked={isSplit}
          onChange={(event) => handleSplitToggleInternal(event.target.checked)}
          disabled={isLocked}
        />
        Split Payment Across Classifications
      </label>

      {isSplit ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {classificationFields.map(({ key, label }) => (
              <label key={key} className="flex flex-col text-sm font-semibold text-gray-800">
                <span className="mb-1">{label}</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9.,]*"
                  value={resolveSplitValue(key)}
                  onChange={(event) => {
                    if (!canMakeDecision) {
                      onDecisionBlocked();
                      return;
                    }
                    if (itemKey) onSplitAmountChange(itemKey, key, event.target.value);
                  }}
                  disabled={isLocked}
                />
              </label>
            ))}
          </div>
          <div className="text-xs text-gray-600">
            Entered total: <strong>{currencyFormatter.format(totalEntered)}</strong>{' '}
            {totalsMatch ? (
              <span className="text-emerald-700">(Balanced)</span>
            ) : (
              <span className="text-amber-700">
                (Must equal {currencyFormatter.format(amountNumber)})
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
