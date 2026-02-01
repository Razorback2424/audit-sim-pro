import React from 'react';

export default function EvidenceList({ items, activeEvidenceId, onSelect, isEvidenceWorkflowLinked }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-800">Supporting Documents</h2>
        <p className="text-xs text-gray-500">Select a disbursement to preview its support.</p>
      </div>
      <div className="max-h-[460px] overflow-y-auto divide-y divide-gray-100">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No supporting documents selected yet.</p>
        ) : (
          items.map((item, index) => {
            const evidenceId = String(item.evidenceId);
            const isActive = evidenceId === String(activeEvidenceId);
            const invoiceLabel =
              item.evidenceFileName ||
              item.fileName ||
              (item.paymentId ? `Invoice for ${item.paymentId}` : `Invoice ${index + 1}`);
            const payeeLabel = item.payee || 'Unknown payee';
            const documentLabel = item.documentLabel || `Invoice: ${invoiceLabel}`;
            const ariaLabel = item.documentLabel ? documentLabel : `${invoiceLabel} — ${payeeLabel}`;
            const evidenceSatisfied = item.hasLinkedDocument || isEvidenceWorkflowLinked(item.paymentId);
            return (
              <button
                key={evidenceId}
                type="button"
                onClick={() => onSelect(evidenceId)}
                aria-label={`Evidence for ${ariaLabel}`}
                className={`w-full text-left px-4 py-3 focus:outline-none transition-colors ${
                  isActive ? 'bg-blue-50 border-l-4 border-blue-500' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>
                    {documentLabel}
                  </span>
                  {!evidenceSatisfied && (
                    <span className="ml-3 inline-flex items-center text-[10px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                      Document not linked
                    </span>
                  )}
                </div>
                {!item.documentLabel ? (
                  <div className="mt-1 text-xs text-gray-500">
                    Payee: <strong className="text-gray-700 font-medium">{payeeLabel}</strong>
                  </div>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
