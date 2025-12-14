import React from 'react';
import { Button } from '../../../AppCore';
import { currencyFormatter } from '../../../utils/formatters';

export default function SelectionStep({
  disbursementList,
  selectedDisbursements,
  onSelectionChange,
  isLocked,
  onBack,
  onContinue,
  continueDisabled,
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-gray-800">Step 1 — Select Disbursements</h2>
        <p className="text-sm text-gray-500">
          Choose which disbursements you want to test. You will review supporting documents on the next step.
        </p>
      </div>

      {disbursementList.length === 0 ? (
        <p className="text-gray-500">No disbursements are available for this case.</p>
      ) : (
        <div className="space-y-3">
          {disbursementList.map((d, index) => {
            const paymentId = d.paymentId === null || d.paymentId === undefined ? '' : String(d.paymentId).trim();
            const displayId = paymentId || d.reference || d._tempId || d.id || `item-${index + 1}`;
            const checkboxId = paymentId ? `cb-${paymentId}` : `cb-missing-${index + 1}`;
            const disabled = isLocked || !paymentId;
            const displayDate = d.paymentDate || d.issueDate || d.bookDate || '';
            return (
              <div
                key={displayId}
                className="flex items-center p-4 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
              >
                <input
                  type="checkbox"
                  id={checkboxId}
                  checked={paymentId ? !!selectedDisbursements[paymentId] : false}
                  onChange={() => (paymentId ? onSelectionChange(paymentId) : undefined)}
                  disabled={disabled}
                  className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-4 cursor-pointer disabled:cursor-not-allowed"
                />
                <label
                  htmlFor={checkboxId}
                  className={`flex-grow grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className="text-sm text-gray-700">
                    <strong className="font-medium">ID:</strong> {displayId}
                  </span>
                  <span className="text-sm text-gray-700">
                    <strong className="font-medium">Payee:</strong> {d.payee || d.reference || '—'}
                  </span>
                  <span className="text-sm text-gray-700">
                    <strong className="font-medium">Amount:</strong> {currencyFormatter.format(Number(d.amount) || 0)}
                  </span>
                  <span className="text-sm text-gray-700">
                    <strong className="font-medium">Date:</strong> {displayDate}
                  </span>
                  {d.expectedClassification ? (
                    <span className="text-xs text-gray-500">Expected classification: {d.expectedClassification}</span>
                  ) : null}
                  {!paymentId ? (
                    <span className="text-xs text-amber-700">
                      This disbursement is missing a payment ID and cannot be selected.
                    </span>
                  ) : null}
                </label>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <Button variant="secondary" onClick={onBack}>
          Back to Cases
        </Button>
        <Button onClick={onContinue} disabled={isLocked || continueDisabled}>
          Continue to Testing
        </Button>
      </div>
    </div>
  );
}
