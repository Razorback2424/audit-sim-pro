import React from 'react';

const money = (value, currency = 'USD') =>
  Number(value || 0).toLocaleString('en-US', { style: 'currency', currency });

const safe = (value) => (value === null || value === undefined ? '' : String(value));

const formatCheckNumber = (value) => {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : '-';
};

function DisbursementListing({ data }) {
  const {
    companyName,
    periodLabel,
    reportTitle = 'January Disbursements Listing',
    rows = [],
    currency = 'USD',
  } = data || {};

  return (
    <div className="page">
      <div className="header">
        <div className="company">{safe(companyName)}</div>
        <div className="title">{safe(reportTitle)}</div>
        <div className="subtitle">{safe(periodLabel)}</div>
      </div>

      <table className="listingTable" role="table" aria-label="January disbursements listing">
        <colgroup>
          <col className="col-date" />
          <col className="col-check" />
          <col className="col-payee" />
          <col className="col-type" />
          <col className="col-amount" />
        </colgroup>
        <thead>
          <tr>
            <th>Date</th>
            <th>Check #</th>
            <th>Payee</th>
            <th>Type</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>{safe(row.paymentDate || row.date)}</td>
              <td>{formatCheckNumber(row.checkNumber)}</td>
              <td>{safe(row.payee)}</td>
              <td>{safe(row.paymentType || row.type || 'Check')}</td>
              <td className="num">{money(row.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="totalLabel">
              Total
            </td>
            <td className="num">
              {money(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export const disbursementListingV1 = {
  id: 'refdoc.disbursement-listing.v1',
  page: {
    pdfOptions: { format: 'Letter' },
  },
  Component: DisbursementListing,
  css: ({ theme }) => {
    const t = {
      ink: '#111',
      grid: '#b6b6b6',
      headerBg: '#111827',
      headerInk: '#ffffff',
      ...theme,
    };

    return `
@page { size: Letter; margin: 0.6in; }
html, body { margin: 0; padding: 0; }
body { color: ${t.ink}; font-family: "Times New Roman", Times, serif; }

.page { width: 100%; }

.header { text-align: center; margin-bottom: 20px; }
.company { font-size: 18px; font-weight: 700; letter-spacing: 0.3px; }
.title { font-size: 22px; font-weight: 700; margin-top: 6px; }
.subtitle { font-size: 12px; margin-top: 4px; }

.listingTable {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 11px;
}

.listingTable .col-date { width: 14%; }
.listingTable .col-check { width: 14%; }
.listingTable .col-payee { width: 36%; }
.listingTable .col-type { width: 14%; }
.listingTable .col-amount { width: 22%; }

.listingTable th,
.listingTable td {
  border: 1px solid ${t.grid};
  padding: 6px 8px;
}

.listingTable thead th {
  background: ${t.headerBg};
  color: ${t.headerInk};
  font-weight: 700;
  text-align: left;
}

.listingTable .num { text-align: right; }
.listingTable tfoot td { font-weight: 700; }
.listingTable tfoot .totalLabel { text-align: right; }
`;
  },
};
