import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, PlusCircle, Trash2 } from 'lucide-react';
import { Input, Button, Select } from '../../AppCore';
import { AUDIT_AREAS } from '../../models/caseConstants';
import {
  DEFAULT_ANSWER_KEY_CLASSIFICATION,
  buildSingleAnswerKey,
  extractAnswerKeyMeta,
} from '../../utils/caseFormHelpers';
import { TAG_FIELDS, normalizeTagInput } from '../../services/tagService';

const InvoiceMappingInline = ({ mapping, disbursementTempId, onRemove, onFileSelect, acceptValue }) => {
  const fileInputId = `mapping-file-${mapping._tempId}`;
  const fileLabel =
    mapping.clientSideFile?.name || mapping.fileName || mapping.storagePath || mapping.downloadURL || 'No file selected';

  const status = (() => {
    if (mapping.uploadError) return { text: mapping.uploadError, className: 'text-red-600' };
    if (typeof mapping.uploadProgress === 'number' && mapping.uploadProgress < 100) {
      return { text: `Uploading (${Math.round(mapping.uploadProgress)}%)`, className: 'text-blue-600' };
    }
    if (mapping.clientSideFile) {
      return { text: 'Selected (uploads on Save)', className: 'text-amber-700' };
    }
    if (mapping.uploadProgress === 100 || mapping.storagePath || mapping.downloadURL) {
      return { text: 'Ready', className: 'text-emerald-600' };
    }
    if (mapping.fileName) {
      return { text: 'Missing file/link', className: 'text-amber-700' };
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

const HighlightedEvidenceUploader = ({
  disbursementTempId,
  document,
  onSelectFile,
  onClear,
  acceptValue,
  prettySupportedLabels,
  maxUploadBytes,
}) => {
  const fileInputId = `highlighted-upload-${disbursementTempId}`;
  const label =
    document?.clientSideFile?.name ||
    document?.fileName ||
    document?.storagePath ||
    document?.downloadURL ||
    'No highlighted PDF selected';

  const status = (() => {
    if (document?.uploadError) return { text: document.uploadError, className: 'text-red-600' };
    if (typeof document?.uploadProgress === 'number' && document.uploadProgress < 100) {
      return { text: `Uploading (${Math.round(document.uploadProgress)}%)`, className: 'text-blue-600' };
    }
    if (document?.clientSideFile) {
      return { text: 'Selected (uploads on Save)', className: 'text-amber-700' };
    }
    if (document?.uploadProgress === 100 || document?.storagePath || document?.downloadURL) {
      return { text: 'Ready', className: 'text-emerald-600' };
    }
    if (document?.fileName) {
      return { text: 'Missing file/link', className: 'text-amber-700' };
    }
    return { text: 'Pending upload', className: 'text-gray-500' };
  })();

  const helperText = `Upload a copy of the invoice with the error circled in red. Allowed formats: ${prettySupportedLabels}. Max size ${Math.round(
    maxUploadBytes / (1024 * 1024)
  )} MB.`;
  const hasSelection =
    !!document?.clientSideFile || !!document?.fileName || !!document?.storagePath || !!document?.downloadURL;

  return (
    <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Evidence Reveal (Highlighted PDF)
          </p>
          <p className="truncate text-sm font-medium text-gray-900" title={label}>
            {label}
          </p>
          <p className="mt-1 text-xs text-gray-600">{helperText}</p>
          <p className={`mt-1 text-xs ${status.className}`}>{status.text}</p>
          {document?.downloadURL ? (
            <a
              href={document.downloadURL}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 underline mt-1 inline-block"
            >
              Open download URL
            </a>
          ) : null}
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
            onChange={(event) => onSelectFile(disbursementTempId, event.target.files?.[0])}
          />
          {hasSelection ? (
            <button
              type="button"
              onClick={() => onClear(disbursementTempId)}
              className="inline-flex h-9 items-center justify-center rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
      {document?.uploadError ? (
        <p className="mt-2 text-xs text-red-600">Error: {document.uploadError}</p>
      ) : null}
    </div>
  );
};

const CreatableMultiTagSelect = ({
  id,
  values,
  options,
  placeholder,
  onChange,
  onCreate,
  field,
  label,
  single = false,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const normalizedOptions = useMemo(() => (Array.isArray(options) ? options : []), [options]);
  const selectedValues = useMemo(() => (Array.isArray(values) ? values : []), [values]);
  const selectedSet = useMemo(() => new Set(selectedValues.map((val) => val.toLowerCase())), [selectedValues]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return normalizedOptions
      .filter((option) => !selectedSet.has(option.toLowerCase()))
      .filter((option) => !trimmed || option.toLowerCase().includes(trimmed))
      .slice(0, 8);
  }, [normalizedOptions, query, selectedSet]);

  const requestCreate = async (tagValue) => {
    if (typeof onCreate !== 'function') return tagValue;
    const confirmCreate = window.confirm(
      `Create new global tag "${tagValue}"? This will be available to all instructors.`
    );
    if (!confirmCreate) return null;
    setCreating(true);
    try {
      const createdTag = await onCreate(field, tagValue);
      return createdTag || tagValue;
    } catch (err) {
      console.error(`[${label || 'tag'}] Failed to create tag`, err);
      return null;
    } finally {
      setCreating(false);
    }
  };

  const addTag = async (rawValue) => {
    const { resolved, matchedExisting } = normalizeTagInput(rawValue, normalizedOptions);
    if (!resolved) return;
    const lowerResolved = resolved.toLowerCase();
    const alreadySelected = selectedSet.has(lowerResolved);
    const nextBase = single ? [] : selectedValues;
    if (alreadySelected) {
      setQuery('');
      setOpen(false);
      return;
    }
    if (matchedExisting) {
      onChange([...nextBase, matchedExisting]);
      setQuery('');
      setOpen(false);
      return;
    }
    const createdTag = await requestCreate(resolved);
    if (createdTag) {
      onChange([...nextBase, createdTag]);
      setQuery('');
      setOpen(false);
    }
  };

  const removeTag = (tag) => {
    onChange(selectedValues.filter((item) => item !== tag));
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-300 px-2 py-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
        {selectedValues.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700"
          >
            <span>{tag}</span>
            <button
              type="button"
              className="text-blue-600 hover:text-blue-800"
              aria-label={`Remove ${tag}`}
              onClick={() => removeTag(tag)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addTag(query);
            }
            if (event.key === ',' && query.trim()) {
              event.preventDefault();
              addTag(query);
            }
            if (event.key === 'Backspace' && !query && selectedValues.length > 0) {
              removeTag(selectedValues[selectedValues.length - 1]);
            }
          }}
          placeholder={selectedValues.length === 0 ? placeholder : ''}
          className="flex-1 border-none bg-transparent text-sm text-gray-700 outline-none"
          aria-autocomplete="list"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-options`}
        />
      </div>
      {creating ? <p className="mt-1 text-xs text-gray-500">Saving new tag…</p> : null}
      {open ? (
        <ul
          id={`${id}-options`}
          role="listbox"
          className="relative z-10 mt-1 max-h-48 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
        >
          {filtered.length > 0 ? (
            filtered.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  className="flex w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addTag(option)}
                >
                  {option}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-gray-500">No matches. Press Enter to create.</li>
          )}
          <li className="px-3 py-2 text-xs text-gray-500">
            Press Enter to select or create “{query.trim() || '…'}”.
          </li>
        </ul>
      ) : null}
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
  onSelectHighlightedDocument,
  onClearHighlightedDocument,
  onSyncPaymentId,
  fileAcceptValue,
  maxUploadBytes,
  prettySupportedLabels,
  standardAssertions,
  availableSkillTags = [],
  availableErrorReasons = [],
  onAddGlobalTag,
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

  const handleCheckboxChange = (field, checked) => {
    onChange(index, { ...item, [field]: checked });
  };

  const handleValidatorChange = (field, value) => {
    const nextConfig = { ...(item.validator?.config || {}) };
    if (field === 'type') {
      if (value === 'cutoff') {
        nextConfig.toleranceDays = 0;
      }
    }
    onChange(index, {
      ...item,
      validator: {
        ...(item.validator || {}),
        [field]: value,
        config: nextConfig,
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
  const highlightedDoc = item.highlightedDocument || {};
  const hasHighlightedDocument =
    !!highlightedDoc.clientSideFile ||
    !!highlightedDoc.fileName ||
    !!highlightedDoc.storagePath ||
    !!highlightedDoc.downloadURL;
  const errorReasonValues = Array.isArray(item.errorReasons) ? item.errorReasons : [];
  const skillCategoryValues = Array.isArray(item.trapType)
    ? item.trapType
    : item.trapType
    ? [item.trapType]
    : [];
  const hasAdvancedData =
    (Array.isArray(skillCategoryValues) && skillCategoryValues.length > 0) ||
    (Array.isArray(item.correctAssertions) && item.correctAssertions.length > 0) ||
    (Array.isArray(item.requiredAssertions) && item.requiredAssertions.length > 0) ||
    !!item.validator?.type ||
    !!item.groundTruths ||
    hasHighlightedDocument;
  const [showTrapLogic, setShowTrapLogic] = useState(hasAdvancedData);

  useEffect(() => {
    setShowTrapLogic(hasAdvancedData);
  }, [hasAdvancedData]);

  const toggleCorrectAssertion = (assertionLabel) => {
    const currentList = Array.isArray(item.correctAssertions)
      ? item.correctAssertions
      : Array.isArray(item.requiredAssertions)
      ? item.requiredAssertions
      : [];
    let newList;

    if (currentList.includes(assertionLabel)) {
      newList = currentList.filter((a) => a !== assertionLabel);
    } else {
      newList = [...currentList, assertionLabel];
    }

    onChange(index, { ...item, correctAssertions: newList, requiredAssertions: newList });
  };

  const handleCreateGlobalTag = async (field, value) => {
    if (typeof onAddGlobalTag !== 'function') {
      return value;
    }
    return onAddGlobalTag({ field, value });
  };

  const handleSkillCategoryChange = (values) => {
    onChange(index, { ...item, trapType: values });
  };

  const handleErrorReasonsChange = (values) => {
    onChange(index, { ...item, errorReasons: values });
  };

  const formatAmount = (value) => {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return value || 'Pending';
  };

  const renderTransactionDetails = () => {
    switch (auditArea) {
      case AUDIT_AREAS.CASH:
        return (
          <div className="grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-3 sm:grid-cols-2">
            <div className="flex flex-col text-sm font-medium text-gray-700">
              <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Bank Statement Date</span>
              <Input
                type="date"
                value={item.groundTruths?.clearedBankDate || ''}
                onChange={(event) => handleGroundTruthChange('clearedBankDate', event.target.value)}
              />
            </div>
            <div className="flex flex-col text-sm font-medium text-gray-700">
              <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Bank Cleared Amount</span>
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
        );
      case AUDIT_AREAS.INVENTORY:
        return (
          <div className="grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-3 sm:grid-cols-2">
            <div className="flex flex-col text-sm font-medium text-gray-700">
              <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Physical Count Quantity</span>
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
              <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Condition / Notes</span>
              <Input
                type="text"
                placeholder="e.g., Damaged pallet, obsolete stock"
                value={item.groundTruths?.condition || ''}
                onChange={(event) => handleGroundTruthChange('condition', event.target.value)}
              />
            </div>
          </div>
        );
      case AUDIT_AREAS.PAYABLES:
      default:
        return (
          <div className="grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-3 sm:grid-cols-3">
            <div className="flex flex-col text-sm font-medium text-gray-700">
              <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Invoice Date</span>
              <Input
                type="date"
                value={item.groundTruths?.invoiceDate || ''}
                onChange={(event) => handleGroundTruthChange('invoiceDate', event.target.value)}
              />
            </div>
            <div className="flex flex-col text-sm font-medium text-gray-700">
              <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Service / Shipping / Receiving Date</span>
              <Input
                type="date"
                value={item.groundTruths?.serviceDate || ''}
                onChange={(event) => handleGroundTruthChange('serviceDate', event.target.value)}
              />
            </div>
            <div className="flex flex-col text-sm font-medium text-gray-700">
              <span className="mb-1 text-xs uppercase tracking-wide text-gray-500">Service Period End</span>
              <Input
                type="date"
                value={item.groundTruths?.servicePeriodEnd || ''}
                onChange={(event) => handleGroundTruthChange('servicePeriodEnd', event.target.value)}
              />
            </div>
          </div>
        );
    }
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
              <span className="ml-3 text-sm font-medium text-gray-900">Design Grading Logic</span>
            </label>
            <span className="text-xs text-gray-500">
              Enable when you want the Virtual Senior to guide and grade this item.
            </span>
          </div>

          {showTrapLogic ? (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Grading Logic</h4>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex flex-col text-sm font-medium text-gray-700">
                    <label className="mb-1 text-xs uppercase tracking-wide text-gray-500">Skill Categories</label>
                    <span className="text-xs text-gray-500 mb-1">
                      Tag for analytics (e.g., Completeness, Fraud). Stored as trapType (multiple allowed).
                    </span>
                    <CreatableMultiTagSelect
                      id={`${baseId}-skillCategory`}
                      values={skillCategoryValues}
                      options={availableSkillTags}
                      placeholder="Select or create skill categories"
                      onChange={handleSkillCategoryChange}
                      onCreate={handleCreateGlobalTag}
                      field={TAG_FIELDS.SKILL_CATEGORIES}
                      label="Skill Category"
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
                      Correct Assertions (Answer Key)
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Students always see the standard assertions list. Check the ones that are correct for this item.
                    </p>
                    <div className="grid grid-cols-2 gap-2 rounded-md border border-gray-200 bg-gray-50 p-2">
                      {standardAssertions.map((option) => {
                        const isChecked = (item.correctAssertions || []).includes(option);
                        return (
                          <label key={option} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={isChecked}
                              onChange={() => toggleCorrectAssertion(option)}
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
                    <CreatableMultiTagSelect
                      id={`${baseId}-errorReasons`}
                      values={errorReasonValues}
                      options={availableErrorReasons}
                      placeholder="Select or create error reasons"
                      onChange={handleErrorReasonsChange}
                      onCreate={handleCreateGlobalTag}
                      field={TAG_FIELDS.ERROR_REASONS}
                      label="Error Reasons"
                    />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex flex-col text-sm font-medium text-gray-700">
                    <label className="mb-1 text-xs uppercase tracking-wide text-gray-500">Auto-Grade Rule</label>
                    <Select
                      value={item.validator?.type || ''}
                      onChange={(event) => handleValidatorChange('type', event.target.value)}
                      options={[
                        { value: '', label: 'Manual grading only' },
                        { value: 'cutoff', label: 'Auto-Check Dates (use for cutoff)' },
                        { value: 'match_amount', label: 'Auto-Check Amounts (use for accuracy)' },
                      ]}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Robot graders apply these checks instantly. Date checks assume zero tolerance behind the scenes.
                    </p>
                  </div>
                  <div className="flex flex-col text-sm font-medium text-gray-700">
                    <label className="mb-1 text-xs uppercase tracking-wide text-gray-500">Status Override (optional)</label>
                    <Input
                      value={item.validator?.config?.expectedStatus ?? ''}
                      onChange={(event) => handleValidatorConfigChange('expectedStatus', event.target.value)}
                      placeholder="e.g., cleared"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <HighlightedEvidenceUploader
                    disbursementTempId={item._tempId}
                    document={highlightedDoc}
                    onSelectFile={onSelectHighlightedDocument}
                    onClear={onClearHighlightedDocument}
                    acceptValue={fileAcceptValue}
                    prettySupportedLabels={prettySupportedLabels}
                    maxUploadBytes={maxUploadBytes}
                  />
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
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Transaction Details (Virtual Senior)</h4>
                <p className="text-xs text-gray-500 mb-3">
                  Capture the key fact pattern the Virtual Senior will compare against the trainee&apos;s work.
                  Fields adapt based on the audit area.
                </p>
                {renderTransactionDetails()}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default DisbursementItem;
