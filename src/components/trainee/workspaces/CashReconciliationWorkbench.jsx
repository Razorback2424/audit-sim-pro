import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Textarea } from '../../../AppCore';
import { currencyFormatter } from '../../../utils/formatters';

const STATUS_OPTIONS = [
  { value: 'cleared', label: 'Cleared (matched in cutoff)' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'void', label: 'Void / Invalid' },
  { value: 'adjustment', label: 'Propose Adjustment (Unrecorded)' },
];

const TAB_KEYS = {
  YEAR_END: 'yearEnd',
  CUTOFF: 'cutoff',
  CONFIRMATION: 'confirmation',
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeLedger = (items = []) =>
  items.map((item, index) => {
    const ledgerId =
      item.paymentId ||
      item.reference ||
      item.payment_id ||
      item.id ||
      item._tempId ||
      `ledger-${index + 1}`;
    return {
      ...item,
      ledgerId,
      amount: item.amount ?? 0,
      payee: item.payee || item.description || item.memo || '',
      issueDate: item.issueDate || item.bookDate || item.paymentDate || item.date || '',
    };
  });

const normalizeCutoff = (items = []) =>
  items.map((item, index) => {
    const bankId = item._tempId || item.reference || item.id || item.paymentId || `bank-${index + 1}`;
    return {
      ...item,
      bankId,
      amount: item.amount ?? 0,
      reference: item.reference || item.paymentId || bankId,
    };
  });

const findLinkedBankId = (linkMap, ledgerId) =>
  Object.entries(linkMap || {}).find(([, lId]) => lId === ledgerId)?.[0] || '';

const requiresNote = (status) => status === 'outstanding' || status === 'void' || status === 'adjustment';
const requiresLink = (status) => status === 'cleared';

const getLedgerValidation = ({ statusEntry, linkedBankId }) => {
  const status = statusEntry?.status || '';
  const note = statusEntry?.note || '';
  return {
    missingStatus: !status,
    missingLink: requiresLink(status) && !linkedBankId,
    missingNote: requiresNote(status) && !note.trim(),
  };
};

function EvidenceDocumentViewer({ artifact, title }) {
  if (!artifact) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
        {title} not provided by instructor.
      </div>
    );
  }
  const url = artifact.downloadURL || '';
  return (
    <div className="rounded-md border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <div>
          <p className="text-sm font-semibold text-gray-800">{title}</p>
          <p className="text-xs text-gray-500">{artifact.fileName || 'File'}</p>
        </div>
        {url ? (
          <Button variant="secondary" className="text-xs px-3 py-1" onClick={() => window.open(url, '_blank')}>
            Open PDF
          </Button>
        ) : null}
      </div>
      <div className="min-h-[320px] bg-gray-50">
        {url ? (
          <iframe title={title} src={url} className="h-[320px] w-full rounded-b-md" />
        ) : (
          <div className="px-4 py-6 text-sm text-gray-600">No download URL provided.</div>
        )}
      </div>
    </div>
  );
}

function WorkpaperGridShell({ title, hint, children, onKeyDown, containerRef }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <div>
          <h4 className="font-semibold text-gray-800">{title}</h4>
          {hint ? <p className="text-[11px] text-gray-500">{hint}</p> : null}
        </div>
      </div>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="focus:outline-none focus:ring-2 focus:ring-indigo-200"
      >
        {children}
      </div>
    </div>
  );
}

function StickySummaryFooter({
  bankBalance,
  ditSum,
  outstandingSum,
  adjustedBankInput,
  setAdjustedBankInput,
  computedAdjusted,
  variance,
  varianceWithinTolerance,
  readyToSubmit,
  isLocked,
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-50 px-6 py-4">
      <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-sm">
          <div>
            <p className="text-[10px] uppercase text-gray-500 font-bold">Bank Balance</p>
            <p className="font-mono font-medium">{currencyFormatter.format(bankBalance)}</p>
          </div>
          <div className="text-gray-400 font-light text-lg">+</div>
          <div>
            <p className="text-[10px] uppercase text-gray-500 font-bold">Deposits (DIT)</p>
            <p className="font-mono font-medium text-emerald-700">{currencyFormatter.format(ditSum)}</p>
          </div>
          <div className="text-gray-400 font-light text-lg">-</div>
          <div>
            <p className="text-[10px] uppercase text-gray-500 font-bold">Outstanding</p>
            <p className="font-mono font-medium text-red-700">{currencyFormatter.format(outstandingSum)}</p>
          </div>
          <div className="text-gray-400 font-light text-lg">=</div>
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-blue-600 font-bold">Adjusted Balance</label>
            <div className="relative">
              <input
                type="number"
                value={adjustedBankInput}
                onChange={(e) => setAdjustedBankInput(e.target.value)}
                placeholder={computedAdjusted.toFixed(2)}
                disabled={isLocked}
                className="w-32 border-b-2 border-blue-200 bg-transparent py-1 font-mono font-bold text-blue-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 border-l border-gray-200 pl-6">
          <div className="text-right">
            <p className="text-[10px] uppercase text-gray-500 font-bold">Variance</p>
            <p className={`text-2xl font-mono font-bold ${varianceWithinTolerance ? 'text-emerald-600' : 'text-red-600'}`}>
              {currencyFormatter.format(variance)}
            </p>
          </div>
          <div className={`h-3 w-3 rounded-full ${readyToSubmit ? 'bg-emerald-500 animate-pulse' : 'bg-red-200'}`} />
        </div>
      </div>
    </div>
  );
}

function LedgerGrid({
  items,
  selectedLedgerId,
  setSelectedLedgerId,
  selectedCutoffId,
  statusByLedgerId,
  getLinkedBankId,
  onStatusChange,
  onNoteChange,
  onLink,
  isLocked,
  expandedLedgerId,
  setExpandedLedgerId,
}) {
  const gridRef = React.useRef(null);
  const [hotkeyTipDismissed, setHotkeyTipDismissed] = useState(false);
  const [hasUsedStatusHotkeys, setHasUsedStatusHotkeys] = useState(false);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.ledgerId === selectedLedgerId)
  );

  useEffect(() => {
    if (!selectedLedgerId && items.length > 0) {
      setSelectedLedgerId(items[0].ledgerId);
    }
  }, [items, selectedLedgerId, setSelectedLedgerId]);

  const handleGridKeyDown = (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = items[Math.min(items.length - 1, selectedIndex + 1)];
      if (next) setSelectedLedgerId(next.ledgerId);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = items[Math.max(0, selectedIndex - 1)];
      if (prev) setSelectedLedgerId(prev.ledgerId);
      return;
    }

    const currentItem = items[selectedIndex];
    if (!currentItem || isLocked) return;

    const key = event.key.toLowerCase();

    if (key === 'c') {
      event.preventDefault();
      setHasUsedStatusHotkeys(true);
      onStatusChange(currentItem.ledgerId, 'cleared');
      return;
    }
    if (key === 'o') {
      event.preventDefault();
      setHasUsedStatusHotkeys(true);
      onStatusChange(currentItem.ledgerId, 'outstanding');
      return;
    }
    if (key === 'v') {
      event.preventDefault();
      setHasUsedStatusHotkeys(true);
      onStatusChange(currentItem.ledgerId, 'void');
      return;
    }

    if (key === 'enter') {
      if (!selectedCutoffId) return;
      event.preventDefault();
      onLink(selectedCutoffId, currentItem.ledgerId);
    }
  };

  return (
    <WorkpaperGridShell
      title="Outstanding List (Ledger)"
      hint="Arrow keys move; Enter matches. Hotkeys: C=Cleared, O=Outstanding, V=Void."
      onKeyDown={handleGridKeyDown}
      containerRef={gridRef}
    >
      {!isLocked && !hotkeyTipDismissed && !hasUsedStatusHotkeys ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          <span>
            Tip: select a row, then press <span className="font-mono font-bold">C</span>, <span className="font-mono font-bold">O</span>, or{' '}
            <span className="font-mono font-bold">V</span> to set status (no dropdowns).
          </span>
          <button
            type="button"
            className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-indigo-800 shadow-sm hover:bg-indigo-100"
            onClick={() => setHotkeyTipDismissed(true)}
          >
            Got it
          </button>
        </div>
      ) : null}
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Ref</th>
              <th className="px-3 py-2">Book Date</th>
              <th className="px-3 py-2">Payee/Memo</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Link</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-sm text-gray-500">
                  No ledger items provided.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const statusEntry = statusByLedgerId[item.ledgerId] || {};
                const linkedBankId = getLinkedBankId(item.ledgerId);
                const validation = getLedgerValidation({ statusEntry, linkedBankId });
                const isSelected = selectedLedgerId === item.ledgerId;
                const isExpanded = expandedLedgerId === item.ledgerId;
                const canMatch = Boolean(selectedCutoffId) && !isLocked;
                const noteText = statusEntry.note || '';
                const statusValue = statusEntry.status || '';

                return (
                  <React.Fragment key={item.ledgerId}>
                    <tr
                      className={`cursor-pointer ${isSelected ? 'bg-indigo-50' : 'bg-white'} hover:bg-indigo-50/40`}
                      onClick={() => {
                        setSelectedLedgerId(item.ledgerId);
                        gridRef.current?.focus();
                      }}
                    >
                      <td className="px-3 py-2 font-semibold text-gray-800">
                        <div className="flex items-center gap-2">
                          <span>{item.reference || item.ledgerId}</span>
                          {item._sourceBankId ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              Adjustment
                            </span>
                          ) : null}
                          {validation.missingStatus || validation.missingLink || validation.missingNote ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              Needs input
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{item.issueDate || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{item.payee || '—'}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800">
                        {currencyFormatter.format(toNumber(item.amount))}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-semibold ${
                              !statusValue ? 'text-amber-700' : statusValue === 'cleared' ? 'text-emerald-700' : 'text-gray-700'
                            }`}
                          >
                            {statusValue ? statusValue.toUpperCase() : '—'}
                          </span>
                          {!isLocked ? (
                            <span className="text-[10px] text-gray-400">C/O/V</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {linkedBankId ? (
                            <span className="text-xs font-semibold text-emerald-700">Cutoff #{linkedBankId}</span>
                          ) : (
                            <span className="text-xs text-gray-500">Unlinked</span>
                          )}
                          {canMatch ? (
                            <Button
                              type="button"
                              variant="secondary"
                              className="text-xs px-2 py-1"
                              onClick={(event) => {
                                event.stopPropagation();
                                onLink(selectedCutoffId, item.ledgerId);
                              }}
                              disabled={isLocked}
                            >
                              Match
                            </Button>
                          ) : null}
                        </div>
                        {statusValue === 'cleared' && !linkedBankId ? (
                          <p className="mt-1 text-[11px] font-semibold text-amber-700">Cleared requires a cutoff match.</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          className={`text-xs ${validation.missingNote ? 'text-amber-800' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedLedgerId(isExpanded ? null : item.ledgerId);
                          }}
                          disabled={isLocked}
                        >
                          {isExpanded ? 'Hide' : noteText ? 'Edit' : 'Add'}
                        </Button>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className={isSelected ? 'bg-indigo-50' : 'bg-white'}>
                        <td colSpan={7} className="px-3 pb-3">
                          <Textarea
                            rows={2}
                            placeholder="Notes / rationale (required for outstanding, void, or adjustments)"
                            value={noteText}
                            onChange={(event) => onNoteChange(item.ledgerId, event.target.value)}
                            disabled={isLocked}
                            className={`${validation.missingNote ? 'border-amber-300' : ''}`}
                          />
                          {requiresNote(statusValue) ? (
                            <p className="mt-1 text-[11px] text-gray-600">Reviewer: add a short rationale for this status.</p>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </WorkpaperGridShell>
  );
}

function CutoffGrid({
  items,
  selectedCutoffId,
  setSelectedCutoffId,
  selectedLedgerId,
  getLinkedLedgerId,
  onLink,
  onPropose,
  isLocked,
}) {
  const gridRef = React.useRef(null);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.bankId === selectedCutoffId)
  );

  const handleGridKeyDown = (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = items[Math.min(items.length - 1, selectedIndex + 1)];
      if (next) setSelectedCutoffId(next.bankId);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = items[Math.max(0, selectedIndex - 1)];
      if (prev) setSelectedCutoffId(prev.bankId);
      return;
    }
    if (event.key === 'Enter') {
      if (!selectedLedgerId || !items[selectedIndex]) return;
      event.preventDefault();
      onLink(items[selectedIndex].bankId, selectedLedgerId);
    }
  };

  const pendingLedgerHint = selectedLedgerId ? `Enter matches to ledger ${selectedLedgerId}.` : 'Select a ledger row to enable matching.';

  return (
    <WorkpaperGridShell
      title="Cutoff Statement (List B)"
      hint={pendingLedgerHint}
      onKeyDown={handleGridKeyDown}
      containerRef={gridRef}
    >
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Ref</th>
              <th className="px-3 py-2">Cleared</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Linked</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-sm text-gray-500">
                  No cutoff statement items provided.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isSelected = selectedCutoffId === item.bankId;
                const linkedLedgerId = getLinkedLedgerId(item.bankId);
                const canMatch = Boolean(selectedLedgerId) && !isLocked;
                return (
                  <tr
                    key={item.bankId}
                    className={`cursor-pointer ${isSelected ? 'bg-indigo-50' : 'bg-white'} hover:bg-indigo-50/40`}
                    onClick={() => {
                      setSelectedCutoffId(item.bankId);
                      gridRef.current?.focus();
                    }}
                  >
                    <td className="px-3 py-2 font-semibold text-gray-800">{item.reference || item.bankId}</td>
                    <td className="px-3 py-2 text-gray-600">{item.clearDate || '—'}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-800">
                      {currencyFormatter.format(toNumber(item.amount))}
                    </td>
                    <td className="px-3 py-2">
                      {linkedLedgerId ? (
                        <span className="text-xs font-semibold text-emerald-700">Ledger {linkedLedgerId}</span>
                      ) : (
                        <span className="text-xs text-gray-500">Unlinked</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="text-xs px-2 py-1"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!selectedLedgerId) return;
                            onLink(item.bankId, selectedLedgerId);
                          }}
                          disabled={!canMatch}
                        >
                          Match
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-xs px-2 py-1"
                          onClick={(event) => {
                            event.stopPropagation();
                            onPropose(item);
                          }}
                          disabled={isLocked}
                        >
                          Propose Adj
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </WorkpaperGridShell>
  );
}

export default function CashReconciliationWorkbench({
  ledgerItems = [],
  cutoffItems = [],
  artifacts = [],
  cashContext = {},
  classificationAmounts = {},
  links = {},
  adjustments = [],
  summaryDraft = {},
  onUpdateStatus,
  onLinkChange,
  onVarianceChange,
  onProposeAdjustment,
  onSummaryChange,
  isLocked = false,
}) {
  const normalizedLedger = useMemo(
    () => normalizeLedger([...ledgerItems, ...adjustments]),
    [ledgerItems, adjustments]
  );
  const normalizedCutoff = useMemo(() => normalizeCutoff(cutoffItems), [cutoffItems]);
  const [selectedCutoffId, setSelectedCutoffId] = useState(null);
  const [selectedLedgerId, setSelectedLedgerId] = useState(null);
  const [activeTab, setActiveTab] = useState(TAB_KEYS.CUTOFF);
  const [linkMap, setLinkMap] = useState(() => ({ ...links }));
  const [adjustedBankInput, setAdjustedBankInput] = useState(summaryDraft?.adjustedBankInput || '');
  const [expandedLedgerId, setExpandedLedgerId] = useState(null);

  useEffect(() => {
    setLinkMap({ ...(links || {}) });
  }, [links]);

  useEffect(() => {
    setAdjustedBankInput(summaryDraft?.adjustedBankInput || '');
  }, [summaryDraft]);

  useEffect(() => {
    if (typeof onLinkChange === 'function') {
      onLinkChange(linkMap);
    }
  }, [linkMap, onLinkChange]);

  const ledgerStatuses = useMemo(() => {
    const result = {};
    normalizedLedger.forEach((item) => {
      const entry = classificationAmounts[item.ledgerId] || {};
      result[item.ledgerId] = {
        status: entry.status || '',
        note: entry.note || entry.notes || entry.workpaperNote || '',
        linkedBankItemId: entry.linkedBankItemId || findLinkedBankId(linkMap, item.ledgerId),
      };
    });
    return result;
  }, [normalizedLedger, classificationAmounts, linkMap]);

  const normalizedLinks = useMemo(() => {
    const validBankIds = new Set(normalizedCutoff.map((c) => c.bankId));
    const validLedgerIds = new Set(normalizedLedger.map((l) => l.ledgerId));
    return Object.entries(linkMap || {}).reduce((acc, [bankId, ledgerId]) => {
      if (validBankIds.has(bankId) && validLedgerIds.has(ledgerId)) {
        acc[bankId] = ledgerId;
      }
      return acc;
    }, {});
  }, [linkMap, normalizedCutoff, normalizedLedger]);

  const outstandingSum = useMemo(() => {
    return normalizedLedger.reduce((sum, item) => {
      const status = ledgerStatuses[item.ledgerId]?.status;
      if (status === 'outstanding') {
        return sum + toNumber(item.amount);
      }
      return sum;
    }, 0);
  }, [normalizedLedger, ledgerStatuses]);

  const ditSum = useMemo(() => {
    return Object.entries(normalizedLinks).reduce((sum, [bankId]) => {
      const bankItem = normalizedCutoff.find((b) => b.bankId === bankId);
      if (!bankItem) return sum;
      return sum + toNumber(bankItem.amount);
    }, 0);
  }, [normalizedLinks, normalizedCutoff]);

  const bankBalance =
    toNumber(cashContext.confirmedBalance || cashContext.bankBalance) || toNumber(cashContext.bankBalance);
  const bookBalance = toNumber(cashContext.bookBalance);
  const computedAdjusted = bankBalance + ditSum - outstandingSum;
  const adjustedBank = adjustedBankInput === '' ? computedAdjusted : toNumber(adjustedBankInput);
  const variance = adjustedBank - bookBalance;
  const varianceWithinTolerance = Math.abs(variance) <= 0.01;
  const hasUserInput = adjustedBankInput !== '';

  const statusesComplete = useMemo(() => {
    if (normalizedLedger.length === 0) return false;
    return normalizedLedger.every((item) => {
      const entry = ledgerStatuses[item.ledgerId] || {};
      if (!entry.status) return false;
      if (requiresLink(entry.status) && !findLinkedBankId(normalizedLinks, item.ledgerId)) {
        return false;
      }
      if (requiresNote(entry.status)) {
        return Boolean(entry.note && entry.note.trim().length > 0);
      }
      return true;
    });
  }, [normalizedLedger, ledgerStatuses, normalizedLinks]);

  const readyToSubmit = statusesComplete && varianceWithinTolerance && hasUserInput;

  useEffect(() => {
    if (typeof onVarianceChange === 'function') {
      onVarianceChange(readyToSubmit);
    }
  }, [readyToSubmit, onVarianceChange]);

  useEffect(() => {
    if (typeof onSummaryChange === 'function') {
      onSummaryChange({
        adjustedBankInput,
        computedAdjusted,
        outstandingSum,
        depositsInTransit: ditSum,
        variance,
        bankBalance,
        bookBalance,
        varianceWithinTolerance,
      });
    }
  }, [
    onSummaryChange,
    adjustedBankInput,
    computedAdjusted,
    outstandingSum,
    ditSum,
    variance,
    bankBalance,
    bookBalance,
    varianceWithinTolerance,
  ]);

  const handleStatusUpdate = (ledgerId, updates) => {
    if (typeof onUpdateStatus === 'function') {
      onUpdateStatus(ledgerId, updates);
    }
  };

  const handleLink = (bankId, ledgerId) => {
    if (!bankId || !ledgerId) return;
    const previousLedgerId = normalizedLinks[bankId];
    setLinkMap((prev) => {
      const next = { ...(prev || {}) };
      Object.entries(next).forEach(([existingBankId, existingLedgerId]) => {
        if (existingLedgerId === ledgerId && existingBankId !== bankId) {
          delete next[existingBankId];
        }
      });
      next[bankId] = ledgerId;
      return next;
    });
    if (previousLedgerId && previousLedgerId !== ledgerId) {
      handleStatusUpdate(previousLedgerId, { linkedBankItemId: '' });
    }
    handleStatusUpdate(ledgerId, { linkedBankItemId: bankId, status: ledgerStatuses[ledgerId]?.status || 'cleared' });
    setSelectedCutoffId(null);
  };

  const handlePropose = (bankItem) => {
    if (typeof onProposeAdjustment === 'function') {
      onProposeAdjustment(bankItem);
    }
  };

  const artifactByType = useMemo(() => {
    const map = {};
    artifacts.forEach((doc) => {
      if (!doc?.type) return;
      map[doc.type] = doc;
    });
    return map;
  }, [artifacts]);

  const cutoffArtifact = artifactByType.cash_cutoff_statement;
  const yearEndArtifact = artifactByType.cash_year_end_statement;
  const confirmationArtifact = artifactByType.cash_bank_confirmation;

  const pendingBank = normalizedCutoff.find((item) => item.bankId === selectedCutoffId);

  return (
    <div className="space-y-4 pb-40 md:pb-32 lg:pb-24">

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-1">
          {pendingBank ? (
            <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] font-semibold text-indigo-800">
              Selected cutoff #{pendingBank.bankId}. Use “Match” or press Enter in the ledger grid.
            </div>
          ) : null}
          <LedgerGrid
            items={normalizedLedger}
            selectedLedgerId={selectedLedgerId}
            setSelectedLedgerId={setSelectedLedgerId}
            selectedCutoffId={selectedCutoffId}
            statusByLedgerId={ledgerStatuses}
            getLinkedBankId={(ledgerId) => findLinkedBankId(normalizedLinks, ledgerId)}
            onStatusChange={(ledgerId, status) => handleStatusUpdate(ledgerId, { status })}
            onNoteChange={(ledgerId, note) => handleStatusUpdate(ledgerId, { note })}
            onLink={(bankId, ledgerId) => handleLink(bankId, ledgerId)}
            isLocked={isLocked}
            expandedLedgerId={expandedLedgerId}
            setExpandedLedgerId={setExpandedLedgerId}
          />
        </div>

        <div className="space-y-3 lg:col-span-2">
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2">
              {[TAB_KEYS.YEAR_END, TAB_KEYS.CUTOFF, TAB_KEYS.CONFIRMATION].map((tabKey) => {
                const label =
                  tabKey === TAB_KEYS.YEAR_END
                    ? 'Year-End Bank Statement'
                    : tabKey === TAB_KEYS.CUTOFF
                    ? 'Cutoff Statement'
                    : 'Bank Confirmation';
                const isActive = activeTab === tabKey;
                return (
                  <button
                    key={tabKey}
                    type="button"
                    className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                      isActive ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-700'
                    }`}
                    onClick={() => setActiveTab(tabKey)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="p-4">
              {activeTab === TAB_KEYS.YEAR_END ? (
                <EvidenceDocumentViewer artifact={yearEndArtifact} title="Year-End Bank Statement" />
              ) : null}
              {activeTab === TAB_KEYS.CONFIRMATION ? (
                <EvidenceDocumentViewer artifact={confirmationArtifact} title="Bank Confirmation" />
              ) : null}
              {activeTab === TAB_KEYS.CUTOFF ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  <CutoffGrid
                    items={normalizedCutoff}
                    selectedCutoffId={selectedCutoffId}
                    setSelectedCutoffId={setSelectedCutoffId}
                    selectedLedgerId={selectedLedgerId}
                    getLinkedLedgerId={(bankId) => normalizedLinks[bankId]}
                    onLink={(bankId, ledgerId) => handleLink(bankId, ledgerId)}
                    onPropose={(bankItem) => handlePropose(bankItem)}
                    isLocked={isLocked}
                  />
                  <EvidenceDocumentViewer artifact={cutoffArtifact} title="Cutoff Statement PDF" />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <StickySummaryFooter
        {...{
          bankBalance,
          ditSum,
          outstandingSum,
          adjustedBankInput,
          setAdjustedBankInput,
          computedAdjusted,
          variance,
          varianceWithinTolerance,
          readyToSubmit,
          isLocked,
        }}
      />
    </div>
  );
}
