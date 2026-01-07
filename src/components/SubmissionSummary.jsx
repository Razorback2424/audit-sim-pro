import React, { useMemo } from 'react';
import { FileText } from 'lucide-react';
import { Button } from '../AppCore';
import { getClassificationFields } from '../constants/classificationFields';
import { DEFAULT_AUDIT_AREA } from '../models/caseConstants';

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const SubmissionSummary = ({
  items,
  extraDocuments = [],
  onViewDocument,
  emptyMessage = 'No disbursements were recorded.',
  auditArea = DEFAULT_AUDIT_AREA,
}) => {
  const classificationFields = useMemo(() => getClassificationFields(auditArea), [auditArea]);

  if (!items || items.length === 0) {
    return <p className="text-sm text-gray-500">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {items.map(({ paymentId, metadata = {}, classification = {}, documents = [] }) => {
          const displayPaymentId = paymentId || metadata.paymentId || 'N/A';
          const parsedValues = classificationFields.map(({ key }) => toNumber(classification[key]));
          const totalEntered = parsedValues.reduce((sum, value) => sum + value, 0);

          const amountNumber = toNumber(metadata.amount);

          return (
            <li key={displayPaymentId} className="border border-gray-200 rounded-md p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-700">
                <span>
                  <strong className="font-medium">ID:</strong> {displayPaymentId}
                </span>
                {metadata.payee ? (
                  <span>
                    <strong className="font-medium">Payee:</strong> {metadata.payee}
                  </span>
                ) : null}
                <span>
                  <strong className="font-medium">Amount:</strong> {currencyFormatter.format(amountNumber)}
                </span>
                {metadata.paymentDate ? (
                  <span>
                    <strong className="font-medium">Date:</strong> {metadata.paymentDate}
                  </span>
                ) : null}
                {metadata.expectedClassification ? (
                  <span className="text-xs text-gray-500 col-span-full">
                    Expected classification: {metadata.expectedClassification}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm text-left text-gray-700 border border-gray-200 rounded-md">
                  <thead className="bg-gray-100">
                    <tr>
                      {classificationFields.map(({ label }) => (
                        <th key={label} className="px-3 py-2 font-semibold text-gray-600">
                          {label}
                        </th>
                      ))}
                      <th className="px-3 py-2 font-semibold text-gray-600">Total Entered</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {classificationFields.map(({ label }, index) => (
                        <td key={label} className="px-3 py-2">
                          {currencyFormatter.format(parsedValues[index])}
                        </td>
                      ))}
                      <td className="px-3 py-2">{currencyFormatter.format(totalEntered)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {documents.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium text-gray-600">Supporting Documents</p>
                  <ul className="space-y-2">
                    {documents.map((doc, docIndex) => (
                      <li
                        key={`${displayPaymentId}-${docIndex}-${doc.fileName || 'document'}`}
                        className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-700"
                      >
                        <span className="flex items-center">
                          <FileText size={16} className="text-blue-500 mr-2 flex-shrink-0" /> {doc.fileName || 'Document'}
                        </span>
                        {onViewDocument && (doc.storagePath || doc.downloadURL) ? (
                          <Button
                            onClick={() => onViewDocument(doc)}
                            variant="secondary"
                            className="text-xs px-2 py-1"
                          >
                            View Document
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-500">No supporting documents were available.</p>
              )}
            </li>
          );
        })}
      </ul>

      {extraDocuments.length > 0 ? (
        <div className="border border-blue-100 rounded-md p-4 bg-blue-50">
          <p className="text-sm font-medium text-gray-700 mb-2">Additional Documents</p>
          <ul className="space-y-2">
            {extraDocuments.map((doc, index) => (
              <li
                key={`general-${index}-${doc.fileName || 'document'}`}
                className="flex items-center justify-between bg-white border border-blue-100 rounded-md px-3 py-2 text-sm text-gray-700"
              >
                <span className="flex items-center">
                  <FileText size={16} className="text-blue-500 mr-2 flex-shrink-0" /> {doc.fileName || 'Document'}
                </span>
                {onViewDocument && (doc.storagePath || doc.downloadURL) ? (
                  <Button
                    onClick={() => onViewDocument(doc)}
                    variant="secondary"
                    className="text-xs px-2 py-1"
                  >
                    View Document
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

export default SubmissionSummary;
