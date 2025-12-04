import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, PlusCircle, Trash2 } from 'lucide-react';
import { Input, Button, Select } from '../../AppCore';
import { AUDIT_AREAS } from '../../models/caseConstants';
import {
  DEFAULT_ANSWER_KEY_CLASSIFICATION,
  buildSingleAnswerKey,
  extractAnswerKeyMeta,
} from '../../utils/caseFormHelpers';

const InvoiceMappingInline = ({ mapping, disbursementTempId, onRemove, onFileSelect, acceptValue }) => {
  const fileInputId = `mapping-file-${mapping._tempId}`;
  const fileLabel =
    mapping.clientSideFile?.name || mapping.fileName || mapping.storagePath || mapping.downloadURL || 'No file selected';

  const status = (() => {
    if (mapping.uploadError) return { text: mapping.uploadError, className: 'text-red-600' };
    if (typeof mapping.uploadProgress === 'number' && mapping.uploadProgress < 100) {
      return { text: `Uploading (${Math.round(mapping.uploadProgress)}%)`, className: 'text-blue-600' };
    }
    if (mapping.uploadProgress === 100 || mapping.storagePath || mapping.downloadURL || mapping.fileName) {
      return { text: 'Ready', className: 'text-emerald-600' };
    }
    return { text: 'Pending upload', className: 'text-gray-500' };
  })();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap">Attachment</p>
          <p className="truncate text-sm font-medium text-gray-900" title={fileLabel}>
            {fileLabel}
          </p>
          {mapping.storagePath ? (
            <p className="mt-1 truncate text-xs text-gray-500" title={mapping.storagePath}>
              {mapping.storagePath}
            </p>
          ) : null}
          {mapping.downloadURL ? (
            <a
              href={mapping.downloadURL}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              Open download URL
            </a>
          ) : null}
          {mapping.uploadError ? (
            <p className="mt-1 text-xs text-red-600">Error: {mapping.uploadError}</p>
          ) : (
            <p className={`mt-1 text-xs ${status.className}`}>{status.text}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor={fileInputId}
            className="inline-flex cursor-pointer items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
          >
            Upload
          </label>
          <input
            id={fileInputId}
            type="file"
            accept={acceptValue}
            className="hidden"
            onChange={(event) => onFileSelect(disbursementTempId, mapping._tempId, event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => onRemove(disbursementTempId, mapping._tempId)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2"
          >
            <Trash2 size={16} />
            <span className="sr-only">Remove</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const DisbursementItem = ({
  item,
  index,
  auditArea,
  onChange,
  onRemove,
  onAddMapping,
  onRemoveMapping,
  onSelectMappingFile,
  onSyncPaymentId,
  fileAcceptValue,
  maxUploadBytes,
  prettySupportedLabels,
  standardAssertions,
}) => {
  const isCash = auditArea === AUDIT_AREAS.CASH;
  const isNewItem = !item.paymentId && !item.payee && !item.amount && !item.paymentDate;
  const [expanded, setExpanded] = useState(isNewItem || index === 0);

  useEffect(() => {
    if (isNewItem) {
      setExpanded(true);
    }
  }, [isNewItem]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    let nextItem = { ...item, [name]: value };
    if (name === 'amount' && nextItem.answerKeyMode !== 'split') {
      const classification = nextItem.answerKeySingleClassification || DEFAULT_ANSWER_KEY_CLASSIFICATION;
      const amountNumber = Number(value) || 0;
      const explanation = nextItem.answerKey?.explanation || '';
      const meta = extractAnswerKeyMeta(nextItem.answerKey);
      nextItem.answerKey = buildSingleAnswerKey(classification, amountNumber, explanation, meta);
    }
    onChange(index, nextItem);
    if (name === 'paymentId') {
      onSyncPaymentId(nextItem._tempId, value);
    }
  };

  const handleArrayFieldChange = (field, rawValue) => {
    const parts = String(rawValue || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    onChange(index, { ...item, [field]: parts });
  };

  const handleCheckboxChange = (field, checked) => {
    onChange(index, { ...item, [field]: checked });
  };

  const handleValidatorChange = (field, value) => {
    onChange(index, {
      ...item,
      validator: {
        ...(item.validator || {}),
        [field]: value,
        config: { ...(item.validator?.config || {}) },
      },
    });
  };

  const handleValidatorConfigChange = (key, value) => {
    onChange(index, {
      ...item,
      validator: {
        ...(item.validator || {}),
        config: { ...(item.validator?.config || {}), [key]: value },
      },
    });
  };

  const handleGroundTruthChange = (field, value, { asNumber = false } = {}) => {
    const nextTruths = { ...(item.groundTruths || {}) };
    let normalizedValue = value;
    if (value === '' || value === null || value === undefined) {
      normalizedValue = undefined;
    } else if (asNumber) {
      const numericValue = Number(value);
      normalizedValue = Number.isFinite(numericValue) ? numericValue : undefined;
    }
    if (normalizedValue === undefined) {
      delete nextTruths[field];
    } else {
      nextTruths[field] = normalizedValue;
    }
    const cleanedTruths = Object.keys(nextTruths).length > 0 ? nextTruths : undefined;
    onChange(index, { ...item, groundTruths: cleanedTruths });
  };
  const baseId = item._tempId || item.paymentId || `disbursement-${index}`;
  const mappings = item.mappings || [];
  const errorReasonsInput = Array.isArray(item.errorReasons) ? item.errorReasons.join(', ') : '';
  const hasAdvancedData =
    !!item.trapType ||
    (Array.isArray(item.requiredAssertions) && item.requiredAssertions.length > 0) ||
    !!item.validator?.type ||
    !!item.groundTruths;
  const [showTrapLogic, setShowTrapLogic] = useState(hasAdvancedData);

  useEffect(() => {
    setShowTrapLogic(hasAdvancedData);
  }, [hasAdvancedData]);

  const toggleAssertion = (assertionLabel) => {
    const currentList = Array.isArray(item.requiredAssertions) ? item.requiredAssertions : [];
    let newList;

    if (currentList.includes(assertionLabel)) {
      newList = currentList.filter((a) => a !== assertionLabel);
    } else {
      newList = [...currentList, assertionLabel];
    }

    onChange(index, { ...item, requiredAssertions: newList });
  };

  const formatAmount = (value) => {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return value || 'Pending';
  };

  const summaryFields = [
    {
      label: isCash ? 'Reference #' : 'Payment ID',
      value: item.paymentId || 'Pending',
      editor: (
        <Input
          id={`${baseId}-paymentId`}
          name="paymentId"
          value={item.paymentId}
          onChange={handleChange}
          placeholder={isCash ? 'Check # / Ref #' : 'Payment ID'}
          required
        />
      ),
    },
    {
      label: isCash ? 'Description / Payee' : 'Payee',
      value: item.payee || 'Pending',
      editor: (
        <Input
          id={`${baseId}-payee`}
          name="payee"
          value={item.payee}
          onChange={handleChange}
          placeholder={isCash ? 'Description or payee' : 'Payee'}
          required
        />
      ),
    },
    {
      label: 'Amount',
      value: item.amount ? `$${formatAmount(item.amount)}` : 'Pending',
      editor: (
        <Input
          id={`${baseId}-amount`}
          name="amount"
          type="number"
          value={item.amount}
          onChange={handleChange}
          placeholder="Amount (e.g., 123.45)"
          required
        />
      ),
    },
    {
      label: isCash ? 'Book Date' : 'Payment Date',
      value: item.paymentDate
        ? new Date(item.paymentDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : 'Pending',
      editor: (
        <Input
          id={`${baseId}-date`}
          name="paymentDate"
          type="date"
          value={item.paymentDate}
          onChange={handleChange}
          placeholder={isCash ? 'Book Date (YYYY-MM-DD)' : 'Payment Date (YYYY-MM-DD)'}
          required
        />
      ),
    },
  ];

  if (isCash) {
    summaryFields.splice(3, 0, {
      label: 'Transaction Type',
      value: item.transactionType || 'Pending',
      editor: (
        <Select
          id={`${baseId}-transactionType`}
          value={item.transactionType}
          onChange={(event) => handleChange({ target: { name: 'transactionType', value: event.target.value } })}
          options={[
            { value: '', label: 'Choose type…' },
            { value: 'check', label: 'Check' },
            { value: 'deposit', label: 'Deposit' },
            { value: 'wire', label: 'EFT / Wire' },
            { value: 'fee', label: 'Bank Fee' },
            { value: 'interest', label: 'Interest' },
          ]}
          className="w-full"
        />
      ),
    });
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:border-blue-200">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid w-full gap-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-[170px_minmax(0,1fr)_140px_160px]">
          {summaryFields.map(({ label, value, editor }) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap">{label}</span>
              {expanded ? (
                editor
              ) : (
                <span className={`truncate font-semibold ${value === 'Pending' ? 'text-gray-400' : 'text-gray-900'}`}>{value}</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-10 w-32 items-center justify-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {expanded ? 'Done' : 'Edit details'}
          </button>
          <Button onClick={() => onRemove(index)} variant="danger" className="h-10 w-12 justify-center">
            <Trash2 size={16} />
            <span className="sr-only">Remove disbursement</span>
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-2 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={showTrapLogic}
                onChange={(e) => setShowTrapLogic(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              <span className="ml-3 text-sm font-medium text-gray-900">Configure Trap &amp; Grading Logic</span>
            </label>
            <span className="text-xs text-gray-500">
              Enable for items needing specific feedback or automated validation.
            </span>
          </div>

          {showTrapLogic ? (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Trap & Assertions</h4>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex flex-col text-sm font-medium text-gray-700">
                    <label className="mb-1 text-xs uppercase tracking-wide text-gray-500">Trap Type</label>
                    <Input
                      value={item.trapType || ''}
                      onChange={(event) => onChange(index, { ...item, trapType: event.target.value })}
                      placeholder="e.g., cutoff, existence, classification"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id={`${baseId}-shouldFlag`}
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={!!item.shouldFlag}
                      onChange={(event) => handleCheckboxChange('shouldFlag', event.target.checked)}
                    />
                    <label htmlFor={`${baseId}-shouldFlag`} className="text-sm font-medium text-gray-700">
                      Expected outcome is to flag as exception
                    </label>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex flex-col text-sm font-medium text-gray-700">
                    <label className="mb-2 text-xs uppercase tracking-wide text-gray-500">
                      Required Assertions (Student Options)
                    </label>
                    <div className="grid grid-cols-2 gap-2 rounded-md border border-gray-200 bg-gray-50 p-2">
                      {standardAssertions.map((option) => {
                        const isChecked = (item.requiredAssertions || []).includes(option);
                        return (
                          <label key={option} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={isChecked}
                              onChange={() => toggleAssertion(option)}
                            />
                            <span className={`text-xs ${isChecked ? 'font-semibold text-blue-700' : 'text-gray-600'}`}>
                              {option}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-col text-sm font-medium text-gray-700">
                    <label className="mb-1 text-xs uppercase tracking-wide text-gray-500">Error Reasons</label>
                    <Input
                      value={errorReasonsInput}
                      onChange={(event) => handleArrayFieldChange('errorReasons', event.target.value)}
                      placeholder="Comma-separated (e.g., date, amount, authorization)"
                    />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="flex flex-col text-sm font-medium text-gray-700">
                    <label className="mb-1 text-xs uppercase tracking-wide text-gray-500">Validator Type</label>
                    <Select
                      value={item.validator?.type || ''}
                      onChange={(event) => handleValidatorChange('type', event.target.value)}
                      options={[
                        { value: '', label: 'None (manual grading)' },
                        { value: 'cutoff', label: 'Cutoff date check' },
                        { value: 'match_amount', label: 'Amount match' },
                      ]}
                    />
                  </div>
                  <div className="flex flex-col text-sm font-medium text-gray-700">
                    <label className="mb-1 text-xs uppercase tracking-wide text-gray-500">Validator Config: toleranceDays</label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={item.validator?.config?.toleranceDays ?? ''}
                      onChange={(event) => handleValidatorConfigChange('toleranceDays', event.target.value)}
                      placeholder="e.g., 5"
                    />
                  </div>
                  <div className="flex flex-col text-sm font-medium text-gray-700">
                    <label className="mb-1 text-xs uppercase tracking-wide text-gray-500">Validator Config: expectedStatus</label>
                    <Input
                      value={item.validator?.config?.expectedStatus ?? ''}
                      onChange={(event) => handleValidatorConfigChange('expectedStatus', event.target.value)}
                      placeholder="e.g., cleared"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-blue-800">Supporting Documents</h4>
                    <p className="text-xs text-blue-700">
                      {mappings.length > 0 ? `${mappings.length} document${mappings.length === 1 ? '' : 's'} linked` : 'No documents yet'}
                    </p>
                  </div>
                  <Button
                    onClick={() => onAddMapping(item._tempId)}
                    variant="secondary"
                    type="button"
                    className="text-sm"
                  >
                    <PlusCircle size={16} className="mr-1" />
                    Add document
                  </Button>
                </div>

                <div className="mt-4 space-y-3">
                  {mappings.length === 0 ? (
                    <p className="rounded-md border border-dashed border-blue-200 bg-white/80 p-3 text-xs text-blue-700">
                      Attach the supporting invoice trainees will review. Allowed formats: {prettySupportedLabels}. Maximum size{' '}
                      {Math.round(maxUploadBytes / (1024 * 1024))} MB.
                    </p>
                  ) : (
                    mappings.map((mapping) => (
                      <InvoiceMappingInline
                        key={mapping._tempId}
                        mapping={mapping}
                        disbursementTempId={item._tempId}
                        onRemove={onRemoveMapping}
                        onFileSelect={onSelectMappingFile}
                        acceptValue={fileAcceptValue}
                      />
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4 border-t border-gray-100 pt-4">
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Virtual Senior Ground Truths</h4>
                <p className="text-xs text-gray-500 mb-3">
                  Enter the factual evidence found in the document. The system compares this against the student's selections.
                </p>
                {isCash ? (
                  <div className="grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-3 sm:grid-cols-2">
                    <div className="flex flex-col text-sm font-medium text-gray-700">
                      <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Cleared Bank Date</span>
                      <Input
                        type="date"
                        value={item.groundTruths?.clearedBankDate || ''}
                        onChange={(event) => handleGroundTruthChange('clearedBankDate', event.target.value)}
                      />
                    </div>
                    <div className="flex flex-col text-sm font-medium text-gray-700">
                      <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Bank Amount</span>
                      <Input
                        type="number"
                        placeholder="e.g., 500.00"
                        value={
                          item.groundTruths?.bankAmount !== undefined && item.groundTruths.bankAmount !== null
                            ? item.groundTruths.bankAmount
                            : ''
                        }
                        onChange={(event) => handleGroundTruthChange('bankAmount', event.target.value, { asNumber: true })}
                      />
                    </div>
                    <div className="flex flex-col text-sm font-medium text-gray-700 sm:col-span-2">
                      <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Status (optional override)</span>
                      <Select
                        value={item.groundTruths?.status || ''}
                        onChange={(event) => handleGroundTruthChange('status', event.target.value)}
                        options={[
                          { value: '', label: 'Auto-detect' },
                          { value: 'cleared', label: 'Cleared' },
                          { value: 'outstanding', label: 'Outstanding' },
                          { value: 'void', label: 'Void' },
                          { value: 'nsf', label: 'NSF' },
                        ]}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-3 sm:grid-cols-2">
                    <div className="flex flex-col text-sm font-medium text-gray-700">
                      <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">
                        Document Date (Invoice / Count Sheet)
                      </span>
                      <Input
                        type="date"
                        value={item.groundTruths?.invoiceDate || ''}
                        onChange={(event) => handleGroundTruthChange('invoiceDate', event.target.value)}
                      />
                    </div>
                    <div className="flex flex-col text-sm font-medium text-gray-700">
                      <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Service / Shipping Date</span>
                      <Input
                        type="date"
                        value={item.groundTruths?.servicePeriodEnd || ''}
                        onChange={(event) => handleGroundTruthChange('servicePeriodEnd', event.target.value)}
                      />
                    </div>
                    <div className="flex flex-col text-sm font-medium text-gray-700">
                      <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">
                        Actual Count (Inventory)
                      </span>
                      <Input
                        type="number"
                        placeholder="e.g., 95"
                        value={
                          item.groundTruths?.actualCount !== undefined && item.groundTruths.actualCount !== null
                            ? item.groundTruths.actualCount
                            : ''
                        }
                        onChange={(event) => handleGroundTruthChange('actualCount', event.target.value, { asNumber: true })}
                      />
                    </div>
                    <div className="flex flex-col text-sm font-medium text-gray-700">
                      <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">
                        Confirmed Value (Cash / AR)
                      </span>
                      <Input
                        type="number"
                        placeholder="e.g., 50000"
                        value={
                          item.groundTruths?.confirmedValue !== undefined && item.groundTruths.confirmedValue !== null
                            ? item.groundTruths.confirmedValue
                            : ''
                        }
                        onChange={(event) =>
                          handleGroundTruthChange('confirmedValue', event.target.value, { asNumber: true })
                        }
                      />
                    </div>
                    <div className="sm:col-span-2 flex flex-col text-sm font-medium text-gray-700">
                      <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Condition / Notes</span>
                      <Input
                        type="text"
                        placeholder="e.g., Damaged pallet, obsolete stock"
                        value={item.groundTruths?.condition || ''}
                        onChange={(event) => handleGroundTruthChange('condition', event.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default DisbursementItem;
