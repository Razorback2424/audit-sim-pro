import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Select } from '../../../AppCore';
import { currencyFormatter } from '../../../utils/formatters';

const RISK_STYLES = {
  low: 'bg-green-50 text-green-700',
  medium: 'bg-amber-50 text-amber-700',
  high: 'bg-red-50 text-red-700',
};

const buildTabs = (assertions = []) => {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    return ['general'];
  }
  const unique = Array.from(new Set(assertions.filter(Boolean)));
  return unique.includes('general') ? unique : ['general', ...unique];
};

const tabLabel = (key) => {
  if (!key) return 'General';
  return key === 'general'
    ? 'General'
    : key.charAt(0).toUpperCase() + key.slice(1);
};

const noop = () => {};

export default function AuditProcedureWorkspace({
  item,
  allocation,
  classificationFields,
  splitAllocationHint,
  singleAllocationHint,
  onSplitToggle = noop,
  onClassificationChange = noop,
  onSplitAmountChange = noop,
  isLocked,
  totalsMatch,
  totalEntered,
  pdfViewerState,
  onUpdate,
  workspaceState,
}) {
  const tabs = useMemo(() => buildTabs(item?.requiredAssertions), [item?.requiredAssertions]);
  const initialTab = useMemo(() => {
    if (workspaceState?.selectedAssertion && tabs.includes(workspaceState.selectedAssertion)) {
      return workspaceState.selectedAssertion;
    }
    return tabs[0];
  }, [tabs, workspaceState?.selectedAssertion]);
  const [activeTab, setActiveTab] = useState(initialTab);
  const isSplit = allocation.mode === 'split';
  const amountNumber = Number(item.amount) || 0;
  const classificationLabel =
    classificationFields.find(({ key }) => key === allocation.singleClassification)?.label ||
    'Select classification';
  const riskClass = RISK_STYLES[item?.riskLevel] || 'bg-gray-100 text-gray-600';
  const viewerState = pdfViewerState || { isOpen: false, currentDocId: null };
  const linkedEvidence = workspaceState?.evidenceLinked;
  const linkedDocId = workspaceState?.linkedDocId;
  const linkedTimestamp = workspaceState?.timestamp;

  const startTimeRef = useRef(
    workspaceState?.startedAt ? new Date(workspaceState.startedAt).getTime() : Date.now()
  );
  const emitUpdate = useCallback(
    (updates) => {
      if (typeof onUpdate !== 'function' || !item?.id || !updates || typeof updates !== 'object') {
        return;
      }
      onUpdate(item.id, {
        updatedAt: new Date().toISOString(),
        ...updates,
      });
    },
    [item?.id, onUpdate]
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
    const syncTab = workspaceState?.selectedAssertion;
    if (syncTab && tabs.includes(syncTab) && syncTab !== activeTab) {
      setActiveTab(syncTab);
    } else if (!tabs.includes(activeTab)) {
      setActiveTab(tabs[0]);
    }
  }, [activeTab, tabs, workspaceState?.selectedAssertion]);

  useEffect(() => {
    emitUpdate({ selectedAssertion: activeTab });
  }, [activeTab, emitUpdate]);

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

  const handleLinkEvidence = () => {
    if (!viewerState.isOpen || !viewerState.currentDocId) {
      window.alert('You cannot link evidence if the document is not open.');
      return;
    }
    emitUpdate({
      evidenceLinked: true,
      linkedDocId: viewerState.currentDocId,
      timestamp: new Date().toISOString(),
    });
  };

  const renderCutoffTab = () => (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        Invoice Date
        <Input
          type="date"
          className="mt-1"
          value={workspaceState?.invoiceDateInput || ''}
          onChange={(event) => emitUpdate({ invoiceDateInput: event.target.value })}
          disabled={isLocked}
        />
      </label>
      <label className="block text-sm font-medium text-gray-700">
        Service Period End
        <Input
          type="date"
          className="mt-1"
          value={workspaceState?.serviceEndInput || ''}
          onChange={(event) => emitUpdate({ serviceEndInput: event.target.value })}
          disabled={isLocked}
        />
      </label>
      <button
        type="button"
        onClick={handleLinkEvidence}
        disabled={isLocked}
        className="mt-3 inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-800 disabled:text-gray-400"
      >
        <span className="mr-2" aria-hidden>
          🔗
        </span>
        Link active document as evidence
      </button>
      {linkedEvidence && linkedTimestamp && (
        <p className="text-xs text-green-700">
          Evidence linked at {new Date(linkedTimestamp).toLocaleString()}
          {linkedDocId ? ` (Doc: ${linkedDocId})` : ''}
        </p>
      )}
    </div>
  );

  const renderExistenceTab = () => (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        Do you have a supporting invoice?
        <Select
          className="mt-1 w-full"
          value={workspaceState?.supportingInvoice || ''}
          onChange={(event) => emitUpdate({ supportingInvoice: event.target.value })}
          disabled={isLocked}
        >
          <option value="">Select an answer</option>
          <option value="yes">Yes, support obtained</option>
          <option value="no">No, still searching</option>
          <option value="na">Not applicable</option>
        </Select>
      </label>
      <label className="block text-sm font-medium text-gray-700">
        Notes or observations
        <textarea
          className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
          rows={3}
          value={workspaceState?.existenceNotes || ''}
          onChange={(event) => emitUpdate({ existenceNotes: event.target.value })}
          disabled={isLocked}
        />
      </label>
      <button
        type="button"
        onClick={handleLinkEvidence}
        disabled={isLocked}
        className="inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-800 disabled:text-gray-400"
      >
        <span className="mr-2" aria-hidden>
          🔗
        </span>
        Link active document as evidence
      </button>
      {linkedEvidence && linkedTimestamp && (
        <p className="text-xs text-green-700">
          Evidence linked at {new Date(linkedTimestamp).toLocaleString()}
          {linkedDocId ? ` (Doc: ${linkedDocId})` : ''}
        </p>
      )}
    </div>
  );

  const renderGeneralTab = () => (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Use this workspace to record audit notes, reference assertions, and tie your documentation back to
        the evidence viewer.
      </p>
      <label className="block text-sm font-medium text-gray-700">
        Planner notes
        <textarea
          className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
          rows={3}
          value={workspaceState?.generalNotes || ''}
          onChange={(event) => emitUpdate({ generalNotes: event.target.value })}
          disabled={isLocked}
        />
      </label>
      <button
        type="button"
        onClick={handleLinkEvidence}
        disabled={isLocked}
        className="inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-800 disabled:text-gray-400"
      >
        <span className="mr-2" aria-hidden>
          🔗
        </span>
        Link active document as evidence
      </button>
      {linkedEvidence && linkedTimestamp && (
        <p className="text-xs text-green-700">
          Evidence linked at {new Date(linkedTimestamp).toLocaleString()}
          {linkedDocId ? ` (Doc: ${linkedDocId})` : ''}
        </p>
      )}
    </div>
  );

  const renderActiveTab = () => {
    if (activeTab === 'cutoff') return renderCutoffTab();
    if (activeTab === 'existence') return renderExistenceTab();
    return renderGeneralTab();
  };

  return (
    <div className="audit-workspace border rounded-lg p-4 bg-white shadow-sm space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-bold text-lg text-gray-900">
            {item.payee} • {currencyFormatter.format(amountNumber)}
          </h3>
          <p className="text-sm text-gray-600">Payment ID: {item.paymentId}</p>
          {item.paymentDate && <p className="text-xs text-gray-500">Payment date: {item.paymentDate}</p>}
        </div>
        {item.riskLevel && (
          <span className={`badge inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase ${riskClass}`}>
            {item.riskLevel.toUpperCase()} risk
          </span>
        )}
      </div>

      <div>
        <div className="tabs flex flex-wrap gap-3 border-b border-gray-200 pb-2">
          {tabs.map((assertion) => (
            <button
              key={assertion}
              type="button"
              className={`capitalize px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === assertion
                  ? 'border-b-2 border-blue-600 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setActiveTab(assertion)}
            >
              {tabLabel(assertion)}
            </button>
          ))}
        </div>
        <div className="workspace-content pt-4">{renderActiveTab()}</div>
      </div>

      <div className="space-y-3 border-t border-gray-100 pt-4">
        <h4 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">
          Classification & allocation
        </h4>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="flex-1 text-sm font-medium text-gray-700">
            <span className="mb-1 block">Classification</span>
            <Select
              value={allocation.singleClassification}
              onChange={(event) => onClassificationChange(item.id, event.target.value)}
              disabled={isSplit || isLocked}
              className="w-full"
            >
              <option value="">Select classification</option>
              {classificationFields.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
              checked={isSplit}
              disabled={isLocked}
              onChange={(event) => onSplitToggle(item.id, event.target.checked, item)}
            />
            Split across classifications
          </label>
        </div>

        {isSplit ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3">
            <p className="text-xs text-gray-500">{splitAllocationHint}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {classificationFields.map(({ key, label }) => (
                <label key={key} className="flex flex-col text-sm text-gray-700">
                  <span className="font-medium mb-1">{label}</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9.,]*"
                    value={allocation.splitValues[key] ?? ''}
                    onChange={(event) => onSplitAmountChange(item.id, key, event.target.value)}
                    disabled={isLocked}
                  />
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            {allocation.singleClassification
              ? `Entire amount allocated to ${classificationLabel}.`
              : singleAllocationHint}
          </div>
        )}

        <div className="text-xs text-gray-500">
          Entered total: <strong>{currencyFormatter.format(totalEntered)}</strong>{' '}
          {totalsMatch ? (
            <span className="text-green-600">(Balanced)</span>
          ) : (
            <span className="text-amber-600">
              (Must equal {currencyFormatter.format(amountNumber)})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
