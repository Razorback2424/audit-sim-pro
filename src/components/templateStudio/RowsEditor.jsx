import React from 'react';
import { getPath } from '../../shared/generation/templateDataBuilder';
import FieldControl from './FieldControl';

export default function RowsEditor({
  rowsSpec,
  rows = [],
  onRowChange,
  onAddRow,
  onRemoveRow,
  onApplyBucket,
}) {
  if (!rowsSpec) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">{rowsSpec.label}</h2>
          <p className="text-xs text-gray-500">
            {rows.length} of {rowsSpec.maxRows} rows
          </p>
        </div>
        <button
          type="button"
          onClick={onAddRow}
          disabled={rows.length >= rowsSpec.maxRows}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {rowsSpec.addLabel}
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">#</th>
              {rowsSpec.columns.map((field) => (
                <th key={field.key} className="min-w-32 px-3 py-2">
                  {field.label}
                </th>
              ))}
              {rowsSpec.bucketOptions ? <th className="min-w-36 px-3 py-2">Bucket shortcut</th> : null}
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={rowsSpec.columns.length + (rowsSpec.bucketOptions ? 3 : 2)}
                  className="px-3 py-6 text-center text-sm text-gray-500"
                >
                  No rows yet. Add a row to begin.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={row._tempId || `row-${index}`} className="align-top">
                  <td className="px-3 py-3 font-medium text-gray-500">{index + 1}</td>
                  {rowsSpec.columns.map((field) => {
                    const id = `template-row-${index}-${field.key.replace(/\./g, '-')}`;
                    return (
                      <td key={field.key} className="px-3 py-3">
                        <label htmlFor={id} className="sr-only">
                          Row {index + 1} {field.label}
                        </label>
                        <FieldControl
                          field={field}
                          value={getPath(row, field.key)}
                          onChange={(value) => onRowChange(index, { [field.key]: value })}
                          id={id}
                          compact
                        />
                      </td>
                    );
                  })}
                  {rowsSpec.bucketOptions ? (
                    <td className="px-3 py-3">
                      <label htmlFor={`template-row-${index}-bucket`} className="sr-only">
                        Row {index + 1} bucket shortcut
                      </label>
                      <select
                        id={`template-row-${index}-bucket`}
                        value=""
                        onChange={(event) => {
                          if (event.target.value) onApplyBucket(index, event.target.value);
                        }}
                        className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Assign one bucket…</option>
                        {rowsSpec.bucketOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  ) : null}
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => onRemoveRow(index)}
                      className="text-sm font-medium text-rose-600 hover:text-rose-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
