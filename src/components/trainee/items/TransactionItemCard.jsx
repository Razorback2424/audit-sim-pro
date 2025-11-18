import React from 'react';
import { Input, Select } from '../../../AppCore';
import { currencyFormatter } from '../../../utils/formatters';

export default function TransactionItemCard({
  item,
  allocation,
  classificationFields,
  splitAllocationHint,
  singleAllocationHint,
  onSplitToggle,
  onClassificationChange,
  onSplitAmountChange,
  isLocked,
  totalsMatch,
  totalEntered,
}) {
  const isSplit = allocation.mode === 'split';
  const amountNumber = Number(item.amount) || 0;
  const classificationLabel =
    classificationFields.find(({ key }) => key === allocation.singleClassification)?.label ||
    'Select classification';

  return (
    <div
      className={`rounded-md p-4 space-y-4 border ${
        isSplit ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-700">
        <span>
          <strong className="font-medium">ID:</strong> {item.id}
        </span>
        <span>
          <strong className="font-medium">Payee:</strong> {item.payee}
        </span>
        <span>
          <strong className="font-medium">Amount:</strong> {currencyFormatter.format(amountNumber)}
        </span>
        <span>
          <strong className="font-medium">Date:</strong> {item.paymentDate}
        </span>
        {item.expectedClassification ? (
          <span className="text-xs text-gray-500 col-span-full">
            Expected classification: {item.expectedClassification}
          </span>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex  flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
          <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
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
      </div>

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
  );
}
