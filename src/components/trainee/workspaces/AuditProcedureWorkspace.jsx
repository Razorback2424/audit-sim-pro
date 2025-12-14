import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Select } from '../../../AppCore';
import { currencyFormatter } from '../../../utils/formatters';

const RISK_STYLES = {
  low: 'bg-green-50 text-green-700',
  medium: 'bg-amber-50 text-amber-700',
  high: 'bg-red-50 text-red-700',
};

const DECISION = {
  UNDECIDED: 'undecided',
  PASS: 'pass',
  EXCEPTION: 'exception',
};

const PASS_OPTIONS = [
  { value: 'properlyIncluded', label: 'Properly Included' },
  { value: 'properlyExcluded', label: 'Properly Excluded' },
];

const EXCEPTION_OPTIONS = [
  { value: 'improperlyIncluded', label: 'Improperly Included' },
  { value: 'improperlyExcluded', label: 'Missing / Unrecorded' },
];

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
  splitAllocationHint,
  singleAllocationHint,
  onSplitToggle = noop,
  onClassificationChange = noop,
  onSplitAmountChange = noop,
  onRationaleChange = noop,
  isLocked,
  totalsMatch,
  totalEntered,
  onUpdate,
  workspaceState,
}) {
  const itemKey = item?.paymentId || item?.id || '';
  const amountNumber = Number(item?.amount) || 0;
  const classificationLabel =
    classificationFields.find(({ key }) => key === allocation.singleClassification)?.label ||
    'selected classification';
  const riskClass = RISK_STYLES[item?.riskLevel] || 'bg-gray-100 text-gray-600';
  const isSplit = allocation.mode === 'split';

  const [currentDecision, setCurrentDecision] = useState(() => deriveDecision(allocation));
  const [showAdvanced, setShowAdvanced] = useState(isSplit);

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

  useEffect(() => {
    if (allocation?.mode === 'split') {
      setShowAdvanced(true);
    }
  }, [allocation?.mode]);

  const assertionOptions = useMemo(() => {
    if (!Array.isArray(item?.requiredAssertions)) return [];
    return item.requiredAssertions.filter(Boolean);
  }, [item?.requiredAssertions]);

  const reasonOptions = useMemo(() => {
    if (!Array.isArray(item?.errorReasons)) return [];
    return item.errorReasons.filter(Boolean);
  }, [item?.errorReasons]);

  const effectivePassClassification = useMemo(() => {
    const current = allocation?.singleClassification || '';
    if (PASS_OPTIONS.some((option) => option.value === current)) return current;
    return '';
  }, [allocation?.singleClassification]);

  const effectiveExceptionNature = useMemo(() => {
    const current = allocation?.singleClassification || '';
    if (EXCEPTION_OPTIONS.some((option) => option.value === current)) return current;
    return '';
  }, [allocation?.singleClassification]);

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
    const isException = nextDecision === DECISION.EXCEPTION;
    setCurrentDecision(nextDecision);
    if (!itemKey) return;
    onRationaleChange(itemKey, 'isException', isException);

    if (!isException) {
      onRationaleChange(itemKey, 'assertion', '');
      onRationaleChange(itemKey, 'reason', '');
      applySingleAllocation(effectivePassClassification || 'properlyIncluded');
      setShowAdvanced(false);
    } else {
      clearAllClassificationAmounts();
      onClassificationChange(itemKey, '');
    }
  };

  const handlePassConfirmationChange = (value) => {
    const nextValue = value || '';
    if (!nextValue) return;
    setCurrentDecision(DECISION.PASS);
    if (!itemKey) return;
    onRationaleChange(itemKey, 'isException', false);
    applySingleAllocation(nextValue);
  };

  const handleNatureChange = (value) => {
    const nature = value || '';
    if (!nature) return;
    setCurrentDecision(DECISION.EXCEPTION);
    if (!itemKey) return;
    onRationaleChange(itemKey, 'isException', true);
    onClassificationChange(itemKey, nature);
    applySingleAllocation(nature);
  };

  const handleSplitToggleInternal = (checked) => {
    if (!itemKey) return;
    onSplitToggle(itemKey, checked, item);
    setShowAdvanced(true);

    if (!checked) {
      if (allocation.singleClassification) {
        applySingleAllocation(allocation.singleClassification);
      } else {
        clearAllClassificationAmounts();
      }
      return;
    }
  };

  return (
    <div className="audit-workspace space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Payment ID: {item.paymentId}
          </p>
          <h3 className="text-2xl font-bold text-gray-900">
            {currencyFormatter.format(amountNumber)}
          </h3>
          <p className="text-sm text-gray-700">{item.payee}</p>
          {item.paymentDate && <p className="text-xs text-gray-500">Paid {item.paymentDate}</p>}
        </div>
        <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center">
          {item.riskLevel && (
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase ${riskClass}`}
            >
              {item.riskLevel.toUpperCase()} risk
            </span>
          )}
          <div className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-1 shadow-inner">
            <button
              type="button"
              onClick={() => handleDecisionChange(DECISION.PASS)}
              disabled={isLocked}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                currentDecision === DECISION.PASS
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-gray-700 hover:bg-white'
              }`}
            >
              ✅ Pass
            </button>
            <button
              type="button"
              onClick={() => handleDecisionChange(DECISION.EXCEPTION)}
              disabled={isLocked}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                currentDecision === DECISION.EXCEPTION
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-gray-700 hover:bg-white'
              }`}
            >
              ⚠️ Exception
            </button>
          </div>
        </div>
      </div>

      {currentDecision === DECISION.PASS ? (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-emerald-900">Audit decision: Pass</p>
            <p className="text-xs text-emerald-800">Confirm the classification</p>
          </div>
          <label className="block text-sm font-semibold text-gray-800">
            Confirmation
            <Select
              className="mt-1 w-full"
              value={effectivePassClassification}
              onChange={(event) => handlePassConfirmationChange(event.target.value)}
              disabled={isLocked}
            >
              <option value="">Select classification...</option>
              {PASS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <p className="text-xs text-emerald-800">
            Pass keeps the item as-is. No extra detail required.
          </p>
        </div>
      ) : currentDecision === DECISION.EXCEPTION ? (
        <div className="space-y-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-rose-900">Exception — add context</p>
            <p className="text-xs text-rose-800">Verdict first, then theory.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-sm font-semibold text-gray-800">
              Nature of Error
              <Select
                className="mt-1 w-full"
                value={effectiveExceptionNature}
                onChange={(event) => handleNatureChange(event.target.value)}
                disabled={isLocked}
              >
                <option value="">Select nature...</option>
                {EXCEPTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>

            {assertionOptions.length > 0 && (
              <label className="block text-sm font-semibold text-gray-800">
                Primary Assertion Failure
                <Select
                  className="mt-1 w-full"
                  value={allocation.assertion || ''}
                  onChange={(event) => (itemKey ? onRationaleChange(itemKey, 'assertion', event.target.value) : null)}
                  disabled={isLocked}
                >
                  <option value="">Select assertion...</option>
                  {assertionOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            {reasonOptions.length > 0 && (
              <label className="block text-sm font-semibold text-gray-800">
                Specific Reason
                <Select
                  className="mt-1 w-full"
                  value={allocation.reason || ''}
                  onChange={(event) => (itemKey ? onRationaleChange(itemKey, 'reason', event.target.value) : null)}
                  disabled={isLocked}
                >
                  <option value="">Select reason...</option>
                  {reasonOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-900">Choose your verdict</p>
          <p className="mt-1 text-xs text-blue-800">
            Decide first: Pass or Exception. Your selection unlocks the rest of the workpaper.
          </p>
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Allocation</p>
            <p className="text-xs text-gray-600">
              {isSplit
                ? 'Split only when the scenario truly needs it.'
                : 'We default to a 100% allocation based on your verdict.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            disabled={isLocked}
            className="text-xs font-semibold text-gray-700 underline decoration-gray-300 underline-offset-4 transition-colors hover:text-gray-900 disabled:text-gray-400"
          >
            {showAdvanced ? 'Hide advanced' : 'Advanced / Split'}
          </button>
        </div>

        {showAdvanced ? (
          <div className="space-y-3">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={isSplit}
                onChange={(event) => handleSplitToggleInternal(event.target.checked)}
                disabled={isLocked}
              />
              Split across classifications
            </label>

            {isSplit ? (
              <div className="space-y-3 rounded-lg border border-white/60 bg-white p-3 shadow-inner">
                <p className="text-xs text-gray-500">{splitAllocationHint}</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                  {classificationFields.map(({ key, label }) => (
                    <label key={key} className="flex flex-col text-sm font-semibold text-gray-800">
                      <span className="mb-1">{label}</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9.,]*"
                        value={resolveSplitValue(key)}
                        onChange={(event) =>
                          (itemKey ? onSplitAmountChange(itemKey, key, event.target.value) : null)
                        }
                        disabled={isLocked}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-white/60 bg-white px-3 py-2 text-sm text-gray-700">
                {allocation.singleClassification
                  ? `Entire amount allocated to ${classificationLabel}.`
                  : singleAllocationHint}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-white/60 bg-white px-3 py-2 text-sm text-gray-700">
            {allocation.singleClassification
              ? `Allocated to ${classificationLabel}. Open advanced if you need a split.`
              : 'Choose Pass or Exception, then confirm the classification or enter a split.'}
          </div>
        )}

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
    </div>
  );
}
