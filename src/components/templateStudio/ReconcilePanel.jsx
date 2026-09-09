import React from 'react';
import { getPath } from '../../shared/generation/templateDataBuilder';
import FieldControl from './FieldControl';

const money = (value, currency = 'USD') =>
  Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency,
  });

export default function ReconcilePanel({ spec, values, onChange, derived }) {
  const totals = derived?.totals || {};
  const warnings = derived?.warnings || [];
  const currency = getPath(values, 'currency') || 'USD';

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">Reconciliation</h2>
        <p className="text-sm text-gray-500">
          Warnings are informational. Intentional tie-out errors can still be generated.
        </p>
      </div>

      {spec.controls?.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {spec.controls.map((field) => {
            const id = `template-control-${field.key.replace(/\./g, '-')}`;
            return (
              <div key={field.key} className="space-y-1">
                <label htmlFor={id} className="block text-sm font-medium text-gray-700">
                  {field.label}
                </label>
                <FieldControl
                  field={field}
                  value={getPath(values, field.key)}
                  onChange={(value) => onChange(field.key, value)}
                  id={id}
                />
                {field.help ? <p className="text-xs text-gray-500">{field.help}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        {spec.computeKind === 'apAging' ? (
          <>
            <SummaryItem label="Amounts" value={money(totals.amount, currency)} />
            <SummaryItem label="Current" value={money(totals.current, currency)} />
            <SummaryItem label="1-30" value={money(totals.days30, currency)} />
            <SummaryItem label="31-60" value={money(totals.days60, currency)} />
            <SummaryItem label="90+" value={money(totals.days90Plus, currency)} />
            <SummaryItem label="Control balance" value={money(totals.controlBalance, currency)} />
            <SummaryItem label="Bucket total" value={money(totals.bucketTotal, currency)} />
          </>
        ) : (
          <>
            <SummaryItem label="Subtotal" value={money(totals.subtotal, currency)} />
            <SummaryItem label="Tax" value={money(totals.tax, currency)} />
            <SummaryItem label="Shipping" value={money(totals.shipping, currency)} />
            <SummaryItem label="Grand total" value={money(totals.grandTotal, currency)} emphasized />
          </>
        )}
      </div>

      {warnings.length > 0 ? (
        <div className="space-y-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
          {warnings.map((entry, index) => (
            <div key={`${entry.type}-${entry.rowIndex ?? 'all'}-${index}`}>{entry.message}</div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-emerald-700">No reconciliation warnings.</div>
      )}
    </section>
  );
}

function SummaryItem({ label, value, emphasized = false }) {
  return (
    <div className={`rounded-md bg-gray-50 p-3 ${emphasized ? 'ring-1 ring-gray-300' : ''}`}>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 font-semibold text-gray-800">{value}</div>
    </div>
  );
}
