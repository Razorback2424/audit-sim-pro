import React from 'react';
import { Input, Button, Select } from '../../AppCore';
import { PlusCircle, Trash2, UploadCloud } from 'lucide-react';
import { AUDIT_AREAS } from '../../models/caseConstants';
import { STANDARD_ASSERTIONS, CASH_RECON_SCENARIOS } from '../../constants/caseFormOptions';
import DisbursementItem from './DisbursementItem';
import StepIntro from './StepIntro';

export default function TransactionsStep({ transactions, files }) {
  const {
    disbursements,
    handleDisbursementChange,
    addDisbursement,
    removeDisbursement,
    addMappingToDisbursement,
    removeMappingFromDisbursement,
    handleMappingFileSelect,
    syncMappingsWithPaymentId,
    disbursementCsvInputRef,
    handleCsvImport,
    auditArea,
    cashOutstandingItems,
    cashCutoffItems,
    cashReconciliationMap,
    handleOutstandingChange,
    addOutstandingItem,
    removeOutstandingItem,
    handleCutoffChange,
    addCutoffItem,
    removeCutoffItem,
    handleReconciliationMapChange,
    addReconciliationMap,
    removeReconciliationMap,
    addFaClass,
    addFaAddition,
    addFaDisposal,
    faSummary,
    setFaSummary,
    faRisk,
    setFaRisk,
    faAdditions,
    setFaAdditions,
    faDisposals,
    setFaDisposals,
    cashContext,
    setCashContext,
  } = transactions;
  const { FILE_INPUT_ACCEPT, prettySupportedLabels, MAX_ARTIFACT_BYTES } = files;
  const isCash = auditArea === AUDIT_AREAS.CASH;
  const isFixedAssets = auditArea === AUDIT_AREAS.FIXED_ASSETS;
  const handleCashContextChange = (field, value) => {
    if (typeof setCashContext !== 'function') return;
    setCashContext((prev) => {
      const base =
        prev ||
        {
          bookBalance: '',
          bankBalance: '',
          reconciliationDate: '',
          simulateMathError: false,
          confirmedBalance: '',
          testingThreshold: '',
          cutoffWindowDays: '',
        };
      const next = { ...base, [field]: value };
      // Keep reportingDate in sync with reconciliationDate for legacy consumers.
      if (field === 'reconciliationDate') {
        next.reportingDate = value;
      }
      return next;
    });
  };
  const safeCashContext =
    cashContext || {
      bookBalance: '',
      bankBalance: '',
      reconciliationDate: '',
      simulateMathError: false,
      confirmedBalance: '',
      testingThreshold: '',
      cutoffWindowDays: '',
    };

  return (
    <div className="space-y-8">
      <StepIntro
      title="Complete these tasks"
      items={
        isCash
          ? [
                'Enter reconciliation context (book vs bank balance and the reconciliation/reporting date).',
                'Capture the client’s Outstanding Check List (this is the ledger list trainees will test).',
                'Add Cutoff Statement items (bank evidence students will trace from).',
                'Use the Reconciliation Mapper to describe the intended behavior of each outstanding item and link it to cutoff evidence where applicable.',
                'Use CSV import if you have many transactions to add at once.'
              ]
          : [
                'Review each disbursement and confirm amount, payee, and date.',
                'Attach supporting invoices for the transactions trainees will inspect.',
                'Use CSV import if you have many disbursements to add at once.'
              ]
        }
        helper="Keep each card closed once the details are confirmed. This keeps the list scannable, especially for longer cases."
      />

      {isCash ? (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold text-gray-800">Cash Context</h3>
            <p className="text-xs text-gray-500">
              Provide the balances and key date trainees will reconcile against. The reconciliation date also serves as the reporting date.
            </p>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">GL (Book) Balance</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="e.g., 1250000"
                value={safeCashContext.bookBalance}
                onChange={(e) => handleCashContextChange('bookBalance', e.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Bank Statement Balance</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="e.g., 1240000"
                value={safeCashContext.bankBalance}
                onChange={(e) => handleCashContextChange('bankBalance', e.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Reconciliation Date (also reporting date)</label>
              <Input
                type="date"
                value={safeCashContext.reconciliationDate}
                onChange={(e) => handleCashContextChange('reconciliationDate', e.target.value)}
                className="mt-2"
              />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex items-center gap-2">
              <input
                id="simulateMathError"
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={safeCashContext.simulateMathError}
                onChange={(e) => handleCashContextChange('simulateMathError', e.target.checked)}
              />
              <label htmlFor="simulateMathError" className="text-sm font-medium text-gray-700">
                Simulate Math/Transposition Error
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Confirmed Balance (Bank Confirm)</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="e.g., 1240000"
                value={safeCashContext.confirmedBalance}
                onChange={(e) => handleCashContextChange('confirmedBalance', e.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Testing Threshold (materiality)</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="e.g., 500"
                value={safeCashContext.testingThreshold}
                onChange={(e) => handleCashContextChange('testingThreshold', e.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cutoff Window (days after YE)</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="e.g., 15"
                value={safeCashContext.cutoffWindowDays}
                onChange={(e) => handleCashContextChange('cutoffWindowDays', e.target.value)}
                className="mt-2"
              />
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-gray-200 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-800">
              {isCash ? 'Ledger Transactions' : isFixedAssets ? 'Fixed Asset Activity' : 'Disbursements'}
            </h3>
            <p className="text-xs text-gray-500">
              Import a CSV or add entries manually. Answer keys stay hidden until you expand an item.
            </p>
          </div>
          <div>
            <label
              htmlFor="csvImportDisbursements"
              className="inline-flex cursor-pointer items-center rounded-md bg-green-500 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-green-600"
            >
              <UploadCloud size={16} className="mr-2" /> Import CSV
            </label>
            <Input
              id="csvImportDisbursements"
              type="file"
              accept=".csv"
              onChange={handleCsvImport}
              className="hidden"
              ref={disbursementCsvInputRef}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {isCash
            ? 'CSV format: Reference,Description,Amount,BookDate,Type (with header row). Dates should be YYYY-MM-DD.'
            : 'CSV format: PaymentID,Payee,Amount,PaymentDate (with header row). Dates should be YYYY-MM-DD.'}
        </p>
        <div className="mt-4 space-y-4">
          {disbursements.map((item, index) => (
            <DisbursementItem
              key={item._tempId}
              item={item}
              index={index}
              auditArea={auditArea}
              onChange={handleDisbursementChange}
              onRemove={removeDisbursement}
              onAddMapping={addMappingToDisbursement}
              onRemoveMapping={removeMappingFromDisbursement}
              onSelectMappingFile={handleMappingFileSelect}
              onSyncPaymentId={syncMappingsWithPaymentId}
              fileAcceptValue={FILE_INPUT_ACCEPT}
              maxUploadBytes={MAX_ARTIFACT_BYTES}
              prettySupportedLabels={prettySupportedLabels}
              standardAssertions={STANDARD_ASSERTIONS}
            />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={addDisbursement} variant="secondary" type="button">
            <PlusCircle size={16} className="mr-1" /> Add Disbursement
          </Button>
        </div>
      </section>

      {isFixedAssets ? (
        <section className="rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Fixed Asset Rollforward Summary</h3>
              <p className="text-xs text-gray-500">Ensure beginning + additions - disposals equals ending for each class.</p>
            </div>
            <Button onClick={addFaClass} variant="secondary" type="button">
              <PlusCircle size={16} className="mr-1" /> Add Asset Class
            </Button>
          </div>
          <div className="space-y-3">
            {faSummary.map((row, index) => (
              <div key={row._tempId} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-5">
                <Input
                  placeholder="Asset Class"
                  value={row.className}
                  onChange={(e) =>
                    setFaSummary((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, className: e.target.value } : item))
                    )
                  }
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="Beginning Balance"
                  value={row.beginningBalance}
                  onChange={(e) =>
                    setFaSummary((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, beginningBalance: e.target.value } : item))
                    )
                  }
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="Additions"
                  value={row.additions}
                  onChange={(e) =>
                    setFaSummary((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, additions: e.target.value } : item))
                    )
                  }
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="Disposals"
                  value={row.disposals}
                  onChange={(e) =>
                    setFaSummary((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, disposals: e.target.value } : item))
                    )
                  }
                />
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Ending Balance"
                    value={row.endingBalance}
                    onChange={(e) =>
                      setFaSummary((prev) =>
                        prev.map((item, i) => (i === index ? { ...item, endingBalance: e.target.value } : item))
                      )
                    }
                  />
                  <Button
                    onClick={() => setFaSummary((prev) => prev.filter((_, i) => i !== index))}
                    size="icon"
                    variant="ghost"
                    type="button"
                    className="text-red-600"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {isFixedAssets ? (
        <section className="rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Audit Risk Parameters</h3>
              <p className="text-xs text-gray-500">Tolerable misstatement and sampling expectations for additions/disposals.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              type="number"
              inputMode="decimal"
              placeholder="Tolerable Misstatement"
              value={faRisk.tolerableMisstatement}
              onChange={(e) => setFaRisk((prev) => ({ ...prev, tolerableMisstatement: e.target.value }))}
            />
            <Select
              value={faRisk.strategy}
              onChange={(e) => setFaRisk((prev) => ({ ...prev, strategy: e.target.value }))}
              options={[
                { value: 'all_over_tm', label: 'Test all items over TM' },
                { value: 'sample_remaining', label: 'Sample remaining if balance > TM' },
              ]}
            />
            <Input
              type="number"
              inputMode="decimal"
              placeholder="Sample size (optional)"
              value={faRisk.sampleSize}
              onChange={(e) => setFaRisk((prev) => ({ ...prev, sampleSize: e.target.value }))}
            />
          </div>
        </section>
      ) : null}

      {isFixedAssets ? (
        <section className="rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Additions Detail</h3>
              <p className="text-xs text-gray-500">Build the population of capital expenditure items.</p>
            </div>
            <Button onClick={addFaAddition} variant="secondary" type="button">
              <PlusCircle size={16} className="mr-1" /> Add Addition
            </Button>
          </div>
          <div className="space-y-3">
            {faAdditions.map((item, index) => (
              <div key={item._tempId} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Input
                    placeholder="Vendor / Description"
                    value={item.vendor}
                    onChange={(e) =>
                      setFaAdditions((prev) => prev.map((row, i) => (i === index ? { ...row, vendor: e.target.value } : row)))
                    }
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Amount"
                    value={item.amount}
                    onChange={(e) =>
                      setFaAdditions((prev) => prev.map((row, i) => (i === index ? { ...row, amount: e.target.value } : row)))
                    }
                  />
                  <Input
                    type="date"
                    placeholder="In-service date"
                    value={item.inServiceDate}
                    onChange={(e) =>
                      setFaAdditions((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, inServiceDate: e.target.value } : row))
                      )
                    }
                  />
                  <Input
                    placeholder="GL Account"
                    value={item.glAccount}
                    onChange={(e) =>
                      setFaAdditions((prev) => prev.map((row, i) => (i === index ? { ...row, glAccount: e.target.value } : row)))
                    }
                  />
                  <Select
                    value={item.natureOfExpenditure}
                    onChange={(e) =>
                      setFaAdditions((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, natureOfExpenditure: e.target.value } : row))
                      )
                    }
                    options={[
                      { value: '', label: 'Nature of expenditure' },
                      { value: 'capital_asset', label: 'Capital Asset' },
                      { value: 'repair_expense', label: 'Repair / Expense' },
                      { value: 'startup', label: 'Start-up Cost' },
                    ]}
                  />
                  <Select
                    value={item.properPeriod}
                    onChange={(e) =>
                      setFaAdditions((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, properPeriod: e.target.value } : row))
                      )
                    }
                    options={[
                      { value: '', label: 'Proper period' },
                      { value: 'current', label: 'Current Period' },
                      { value: 'prior', label: 'Prior Period' },
                      { value: 'next', label: 'Next Period' },
                    ]}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={() => setFaAdditions((prev) => prev.filter((_, i) => i !== index))}
                    variant="ghost"
                    type="button"
                    className="text-sm text-red-600"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {isFixedAssets ? (
        <section className="rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Disposals Detail</h3>
              <p className="text-xs text-gray-500">Capture proceeds and NBV to evaluate gains/losses.</p>
            </div>
            <Button onClick={addFaDisposal} variant="secondary" type="button">
              <PlusCircle size={16} className="mr-1" /> Add Disposal
            </Button>
          </div>
          <div className="space-y-3">
            {faDisposals.map((item, index) => (
              <div key={item._tempId} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Input
                    placeholder="Asset ID / Description"
                    value={item.assetId}
                    onChange={(e) =>
                      setFaDisposals((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, assetId: e.target.value } : row))
                      )
                    }
                  />
                  <Input
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) =>
                      setFaDisposals((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, description: e.target.value } : row))
                      )
                    }
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Proceeds"
                    value={item.proceeds}
                    onChange={(e) =>
                      setFaDisposals((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, proceeds: e.target.value } : row))
                      )
                    }
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="NBV"
                    value={item.nbv}
                    onChange={(e) =>
                      setFaDisposals((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, nbv: e.target.value } : row))
                      )
                    }
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={() => setFaDisposals((prev) => prev.filter((_, i) => i !== index))}
                    variant="ghost"
                    type="button"
                    className="text-sm text-red-600"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {isCash ? (
        <section className="rounded-lg border border-gray-200 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Outstanding Checks (Client List)</h3>
              <p className="text-xs text-gray-500">
                Enter the client’s reported outstanding items as of the reconciliation date. These form the “ledger” pane students will validate.
              </p>
            </div>
            <Button onClick={addOutstandingItem} variant="secondary" type="button">
              <PlusCircle size={16} className="mr-1" /> Add Outstanding Item
            </Button>
          </div>
          <div className="mt-4 space-y-4">
            {cashOutstandingItems.map((item, index) => (
              <div key={item._tempId} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Input
                    placeholder="Reference #"
                    value={item.reference}
                    onChange={(e) => handleOutstandingChange(index, { reference: e.target.value })}
                  />
                  <Input
                    placeholder="Description / Payee"
                    value={item.payee}
                    onChange={(e) => handleOutstandingChange(index, { payee: e.target.value })}
                  />
                  <Input
                    type="date"
                    placeholder="Book Date"
                    value={item.issueDate}
                    onChange={(e) => handleOutstandingChange(index, { issueDate: e.target.value })}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Amount"
                    value={item.amount}
                    onChange={(e) => handleOutstandingChange(index, { amount: e.target.value })}
                  />
                </div>
                <div className="mt-3 flex justify-end">
                  <Button onClick={() => removeOutstandingItem(index)} variant="ghost" type="button" className="text-sm text-red-600">
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {isCash ? (
        <section className="rounded-lg border border-gray-200 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Cutoff Statement Items (Evidence)</h3>
              <p className="text-xs text-gray-500">
                Add the transactions from the cutoff bank statement. Students will trace from these bank items to the ledger list.
              </p>
            </div>
            <Button onClick={addCutoffItem} variant="secondary" type="button">
              <PlusCircle size={16} className="mr-1" /> Add Cutoff Item
            </Button>
          </div>
          <div className="mt-4 space-y-4">
            {cashCutoffItems.map((item, index) => (
              <div key={item._tempId} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Input
                    placeholder="Reference #"
                    value={item.reference}
                    onChange={(e) => handleCutoffChange(index, { reference: e.target.value })}
                  />
                  <Input
                    type="date"
                    placeholder="Cleared Date"
                    value={item.clearDate}
                    onChange={(e) => handleCutoffChange(index, { clearDate: e.target.value })}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Amount"
                    value={item.amount}
                    onChange={(e) => handleCutoffChange(index, { amount: e.target.value })}
                  />
                </div>
                <div className="mt-3 flex justify-end">
                  <Button onClick={() => removeCutoffItem(index)} variant="ghost" type="button" className="text-sm text-red-600">
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {isCash ? (
        <section className="rounded-lg border border-gray-200 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Reconciliation Logic Mapper</h3>
              <p className="text-xs text-gray-500">
                Define the intended scenario for each outstanding item (clean, unrecorded, fictitious) and optionally pre-link to the related cutoff evidence.
                This guides the Virtual Senior’s grading and helps students understand the expected flow.
              </p>
            </div>
            <Button onClick={addReconciliationMap} variant="secondary" type="button">
              <PlusCircle size={16} className="mr-1" /> Add Mapping
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {cashReconciliationMap.map((row, index) => (
              <div key={row._tempId} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Select
                    value={row.outstandingTempId}
                    onChange={(event) => handleReconciliationMapChange(index, { outstandingTempId: event.target.value })}
                    options={[
                      { value: '', label: 'Select outstanding item…' },
                      ...cashOutstandingItems.map((item) => ({
                        value: item._tempId,
                        label: item.reference || item.payee || 'Outstanding item',
                      })),
                    ]}
                  />
                  <Select
                    value={row.scenarioType}
                    onChange={(event) => handleReconciliationMapChange(index, { scenarioType: event.target.value })}
                    options={[{ value: '', label: 'Choose scenario…' }, ...CASH_RECON_SCENARIOS]}
                  />
                  <Select
                    value={row.cutoffTempId}
                    onChange={(event) => handleReconciliationMapChange(index, { cutoffTempId: event.target.value })}
                    options={[
                      { value: '', label: 'Match to cutoff (optional)' },
                      ...cashCutoffItems.map((item) => ({
                        value: item._tempId,
                        label: item.reference || item.clearDate || 'Cutoff item',
                      })),
                    ]}
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <Button onClick={() => removeReconciliationMap(index)} variant="ghost" type="button" className="text-sm text-red-600">
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
