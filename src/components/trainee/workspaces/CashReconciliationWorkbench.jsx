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

function CashLedgerRow({
  item,
  statusEntry,
  onSelect,
  isSelected,
  onStatusChange,
  onNoteChange,
  linkedBankId,
  pendingBankId,
  onLink,
  isLocked,
}) {
  const noteText = statusEntry?.note || '';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.ledgerId)}
      className={`rounded-md border border-gray-200 p-3 transition ${
        isSelected ? 'border-indigo-400 bg-indigo-50' : 'bg-white'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
        <span className="font-semibold">{item.reference || item.ledgerId}</span>
        <span className="text-gray-500">Book Date: {item.issueDate || '—'}</span>
        <span className="text-gray-500">Amount: {currencyFormatter.format(toNumber(item.amount))}</span>
        {item.payee ? <span className="text-gray-500">{item.payee}</span> : null}
        {item._sourceBankId ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            Proposed Adjustment
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => {
            const active = statusEntry?.status === option.value;
            const disabled = isLocked;
            return (
              <button
                key={`${item.ledgerId}-${option.value}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (disabled) return;
                  onStatusChange(option.value);
                }}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  active
                    ? 'border-indigo-500 bg-indigo-100 text-indigo-800'
                    : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-indigo-200'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                disabled={disabled}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {linkedBankId ? (
          <span className="text-[11px] font-semibold text-emerald-700">
            Linked to cutoff item {linkedBankId}
          </span>
        ) : statusEntry?.status === 'cleared' ? (
          <span className="text-[11px] font-semibold text-amber-700">
            Link to a cutoff item to evidence clearance
          </span>
        ) : null}
        {pendingBankId ? (
          <Button
            type="button"
            variant="secondary"
            className="text-xs"
            onClick={(event) => {
              event.stopPropagation();
              onLink(pendingBankId);
            }}
            disabled={isLocked}
          >
            Match cutoff #{pendingBankId}
          </Button>
        ) : null}
      </div>
      <Textarea
        rows={2}
        placeholder="Notes / rationale (required for outstanding, void, or adjustments)"
        value={noteText}
        onChange={(event) => onNoteChange(event.target.value)}
        className="mt-2"
        disabled={isLocked}
      />
    </div>
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
    setLinkMap((prev) => ({ ...prev, [bankId]: ledgerId }));
    handleStatusUpdate(ledgerId, { linkedBankItemId: bankId, status: ledgerStatuses[ledgerId]?.status || 'cleared' });
    setSelectedCutoffId(null);
    setSelectedLedgerId(null);
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

  const pendingLedger = normalizedLedger.find((item) => item.ledgerId === selectedLedgerId);
  const pendingBank = normalizedCutoff.find((item) => item.bankId === selectedCutoffId);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Reconciliation Summary</p>
            <h3 className="text-xl font-semibold text-gray-800">Bank Rec math must tie out</h3>
            <p className="text-xs text-gray-500">
              Adjusted bank balance = Bank balance + Deposits in transit − Outstanding checks. Variance must be zero.
            </p>
          </div>
          <div
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              readyToSubmit ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {readyToSubmit ? 'Balanced — ready to submit' : 'Unbalanced — complete linking and math'}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-5 text-sm text-gray-700">
          <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
            <p className="text-xs uppercase text-gray-500">Balance per Bank</p>
            <p className="font-semibold">{currencyFormatter.format(bankBalance)}</p>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
            <p className="text-xs uppercase text-gray-500">+ Deposits in Transit</p>
            <p className="font-semibold">{currencyFormatter.format(ditSum)}</p>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
            <p className="text-xs uppercase text-gray-500">- Outstanding Checks</p>
            <p className="font-semibold">{currencyFormatter.format(outstandingSum)}</p>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
            <p className="text-xs uppercase text-gray-500">Adjusted Bank Balance (you enter)</p>
            <Input
              type="number"
              inputMode="decimal"
              value={adjustedBankInput}
              onChange={(e) => setAdjustedBankInput(e.target.value)}
              placeholder={computedAdjusted.toFixed(2)}
              className="mt-1"
              disabled={isLocked}
            />
            <p className="text-xs text-gray-500 mt-1">Enter your adjusted balance; placeholder shows system math.</p>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
            <p className="text-xs uppercase text-gray-500">Variance vs Book</p>
            <p className={`font-semibold ${varianceWithinTolerance ? 'text-emerald-700' : 'text-amber-700'}`}>
              {currencyFormatter.format(variance)}
            </p>
            {!hasUserInput ? (
              <p className="text-[11px] text-amber-700 mt-1">Enter the adjusted balance to check reconciliation.</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-1">
          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-800">Outstanding List (Ledger)</h4>
              {pendingBank ? (
                <span className="text-[11px] font-semibold text-indigo-700">
                  Pick a ledger row to match cutoff #{pendingBank.bankId}
                </span>
              ) : null}
            </div>
            <div className="mt-3 space-y-3">
              {normalizedLedger.length === 0 ? (
                <p className="text-sm text-gray-500">No ledger items provided for this case.</p>
              ) : (
                normalizedLedger.map((item) => {
                  const statusEntry = ledgerStatuses[item.ledgerId] || {};
                  const linkedBankId = findLinkedBankId(normalizedLinks, item.ledgerId);
                  return (
                    <CashLedgerRow
                      key={item.ledgerId}
                      item={item}
                      statusEntry={statusEntry}
                      onSelect={setSelectedLedgerId}
                      isSelected={selectedLedgerId === item.ledgerId}
                      onStatusChange={(status) => handleStatusUpdate(item.ledgerId, { status })}
                      onNoteChange={(note) => handleStatusUpdate(item.ledgerId, { note })}
                      linkedBankId={linkedBankId}
                      pendingBankId={selectedCutoffId}
                      onLink={(bankId) => handleLink(bankId, item.ledgerId)}
                      isLocked={isLocked}
                    />
                  );
                })
              )}
            </div>
          </div>
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
                  <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-gray-800">Cutoff Statement (List B)</h4>
                      {pendingLedger ? (
                        <span className="text-[11px] font-semibold text-indigo-700">
                          Select a cutoff line to match {pendingLedger.reference || pendingLedger.ledgerId}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 divide-y divide-gray-100">
                      {normalizedCutoff.length === 0 ? (
                        <p className="py-3 text-sm text-gray-500">No cutoff statement items provided.</p>
                      ) : (
                        normalizedCutoff.map((item) => {
                          const linkedLedgerId = normalizedLinks[item.bankId];
                          const isSelected = selectedCutoffId === item.bankId;
                          return (
                            <div
                              key={item.bankId}
                              className={`py-2 text-sm cursor-pointer rounded ${
                                isSelected ? 'bg-indigo-50' : ''
                              }`}
                              onClick={() => setSelectedCutoffId(item.bankId)}
                            >
                              <div className="flex flex-wrap items-center gap-2 text-gray-800">
                                <span className="font-semibold">{item.reference || item.bankId}</span>
                                <span className="text-gray-500">Cleared: {item.clearDate || '—'}</span>
                                <span className="text-gray-500">
                                  Amount: {currencyFormatter.format(toNumber(item.amount))}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                {linkedLedgerId ? (
                                  <span className="text-[11px] font-semibold text-emerald-700">
                                    Linked to ledger {linkedLedgerId}
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-gray-600">Unlinked</span>
                                )}
                                {pendingLedger ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="text-xs"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleLink(item.bankId, pendingLedger.ledgerId);
                                    }}
                                    disabled={isLocked}
                                  >
                                    Match to {pendingLedger.reference || pendingLedger.ledgerId}
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="text-xs"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handlePropose(item);
                                  }}
                                  disabled={isLocked}
                                >
                                  Propose Adjustment
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <EvidenceDocumentViewer artifact={cutoffArtifact} title="Cutoff Statement PDF" />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
