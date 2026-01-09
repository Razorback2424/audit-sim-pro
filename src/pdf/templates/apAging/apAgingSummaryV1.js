import React from 'react';

const money = (value, currency = 'USD') =>
  Number(value || 0).toLocaleString('en-US', { style: 'currency', currency });

const safe = (value) => (value === null || value === undefined ? '' : String(value));

const sumBuckets = (buckets = {}) =>
  ['current', 'days30', 'days60', 'days90', 'days90Plus'].reduce(
    (sum, key) => sum + Number(buckets[key] || 0),
    0
  );

function ApAgingSummary({ data }) {
  const { companyName, asOfDate, rows = [], currency = 'USD' } = data || {};

  return (
    <div className="page">
      <div className="header">
        <div className="company">{safe(companyName)}</div>
        <div className="title">AP Aging Summary</div>
        <div className="subtitle">As of {safe(asOfDate)}</div>
      </div>

      <table className="agingTable" role="table" aria-label="AP aging summary">
        <colgroup>
          <col />
          <col />
          <col />
          <col />
          <col />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Invoice #</th>
            <th>Invoice Date</th>
            <th>Due Date</th>
            <th className="num">Amount</th>
            <th className="num">Current</th>
            <th className="num">1-30</th>
            <th className="num">31-60</th>
            <th className="num">90+</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>{safe(row.vendor)}</td>
              <td>{safe(row.invoiceNumber)}</td>
              <td>{safe(row.invoiceDate)}</td>
              <td>{safe(row.dueDate)}</td>
              <td className="num">{money(row.amount, currency)}</td>
              <td className="num">{money(row.buckets?.current, currency)}</td>
              <td className="num">{money(row.buckets?.days30, currency)}</td>
              <td className="num">{money(row.buckets?.days60, currency)}</td>
              <td className="num">{money(row.buckets?.days90Plus, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="totalLabel">
              Total
            </td>
            <td className="num">{money(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), currency)}</td>
            <td className="num">
              {money(rows.reduce((sum, row) => sum + Number(row.buckets?.current || 0), 0), currency)}
            </td>
            <td className="num">
              {money(rows.reduce((sum, row) => sum + Number(row.buckets?.days30 || 0), 0), currency)}
            </td>
            <td className="num">
              {money(rows.reduce((sum, row) => sum + Number(row.buckets?.days60 || 0), 0), currency)}
            </td>
            <td className="num">
              {money(rows.reduce((sum, row) => sum + Number(row.buckets?.days90Plus || 0), 0), currency)}
            </td>
          </tr>
          <tr>
            <td colSpan={4} className="totalLabel">
              Total by aging bucket
            </td>
            <td className="num">{money(rows.reduce((sum, row) => sum + sumBuckets(row.buckets), 0), currency)}</td>
            <td colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export const apAgingSummaryV1 = {
  id: 'refdoc.ap-aging.v1',
  page: {
    pdfOptions: { format: 'Letter' },
  },
  Component: ApAgingSummary,
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

.header { text-align: center; margin-bottom: 24px; }
.company { font-size: 20px; font-weight: 700; letter-spacing: 0.4px; }
.title { font-size: 26px; font-weight: 700; margin-top: 6px; }
.subtitle { font-size: 14px; margin-top: 4px; }

.agingTable {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}

.agingTable th,
.agingTable td {
  border: 1px solid ${t.grid};
  padding: 6px 8px;
}

.agingTable thead th {
  background: ${t.headerBg};
  color: ${t.headerInk};
  font-weight: 700;
  text-align: left;
}

.agingTable .num { text-align: right; }
.agingTable tfoot td { font-weight: 700; }
.agingTable tfoot .totalLabel { text-align: right; }
`;
  },
};
