import React from 'react';

const money = (value, currency = 'USD') =>
  Number(value || 0).toLocaleString('en-US', { style: 'currency', currency });

const safe = (value) => (value === null || value === undefined ? '' : String(value));

function RemittanceBundle({ data }) {
  const {
    companyName,
    vendor,
    paymentId,
    paymentDate,
    invoices = [],
    currency = 'USD',
  } = data || {};

  return (
    <div className="page">
      <div className="header">
        <div className="company">{safe(companyName)}</div>
        <div className="title">Remittance Advice</div>
        <div className="subtitle">Payment {safe(paymentId)} · {safe(paymentDate)}</div>
      </div>

      <div className="meta">
        <div className="metaRow">
          <span className="label">Payee</span>
          <span className="value">{safe(vendor)}</span>
        </div>
        <div className="metaRow">
          <span className="label">Invoice count</span>
          <span className="value">{safe(invoices.length)}</span>
        </div>
      </div>

      <table className="bundleTable" role="table" aria-label="Invoice bundle listing">
        <colgroup>
          <col className="col-invoice" />
          <col className="col-inv-date" />
          <col className="col-service" />
          <col className="col-amount" />
          <col className="col-recorded" />
        </colgroup>
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Invoice Date</th>
            <th>Service Date</th>
            <th className="num">Amount</th>
            <th>In AP Aging</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((row, index) => (
            <tr key={index}>
              <td>{safe(row.invoiceNumber)}</td>
              <td>{safe(row.invoiceDate)}</td>
              <td>{safe(row.serviceDate)}</td>
              <td className="num">{money(row.amount, currency)}</td>
              <td>{row.isRecorded ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="totalLabel">
              Total Paid
            </td>
            <td className="num">
              {money(invoices.reduce((sum, row) => sum + Number(row.amount || 0), 0), currency)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export const remittanceBundleV1 = {
  id: 'refdoc.remittance-bundle.v1',
  page: {
    pdfOptions: { format: 'Letter' },
  },
  Component: RemittanceBundle,
  css: ({ theme }) => {
    const t = {
      ink: '#111',
      grid: '#b6b6b6',
      headerBg: '#0f172a',
      headerInk: '#ffffff',
      ...theme,
    };

    return `
@page { size: Letter; margin: 0.6in; }
html, body { margin: 0; padding: 0; }
body { color: ${t.ink}; font-family: "Times New Roman", Times, serif; }

.page { width: 100%; }

.header { text-align: center; margin-bottom: 18px; }
.company { font-size: 18px; font-weight: 700; letter-spacing: 0.3px; }
.title { font-size: 22px; font-weight: 700; margin-top: 6px; }
.subtitle { font-size: 12px; margin-top: 4px; }

.meta { display: grid; gap: 6px; margin-bottom: 14px; font-size: 11px; }
.metaRow { display: flex; justify-content: space-between; border: 1px solid ${t.grid}; padding: 6px 8px; }
.metaRow .label { font-weight: 700; }

.bundleTable {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 11px;
}

.bundleTable .col-invoice { width: 18%; }
.bundleTable .col-inv-date { width: 16%; }
.bundleTable .col-service { width: 18%; }
.bundleTable .col-amount { width: 20%; }
.bundleTable .col-recorded { width: 12%; }

.bundleTable th,
.bundleTable td {
  border: 1px solid ${t.grid};
  padding: 6px 8px;
}

.bundleTable thead th {
  background: ${t.headerBg};
  color: ${t.headerInk};
  font-weight: 700;
  text-align: left;
}

.bundleTable .num { text-align: right; }
.bundleTable tfoot td { font-weight: 700; }
.bundleTable tfoot .totalLabel { text-align: right; }
`;
  },
};
