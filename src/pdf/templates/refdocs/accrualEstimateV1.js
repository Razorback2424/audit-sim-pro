import React from 'react';

const money = (value, currency = 'USD') =>
  Number(value || 0).toLocaleString('en-US', { style: 'currency', currency });

const safe = (value) => (value === null || value === undefined ? '' : String(value));

function AccrualEstimateMemo({ data }) {
  const {
    companyName,
    vendor,
    paymentId,
    periodEnding,
    memoDate,
    estimateAmount = 0,
    settlementTotal = 0,
    note,
    currency = 'USD',
  } = data || {};
  const variance = Number(settlementTotal || 0) - Number(estimateAmount || 0);

  return (
    <div className="page">
      <div className="header">
        <div className="company">{safe(companyName)}</div>
        <div className="title">Accrual Estimate Memo</div>
        <div className="subtitle">Period ending {safe(periodEnding)}</div>
      </div>

      <div className="meta">
        <div className="metaRow">
          <span className="label">Memo Date</span>
          <span className="value">{safe(memoDate)}</span>
        </div>
        <div className="metaRow">
          <span className="label">Vendor</span>
          <span className="value">{safe(vendor)}</span>
        </div>
        <div className="metaRow">
          <span className="label">Related Payment</span>
          <span className="value">{safe(paymentId)}</span>
        </div>
      </div>

      <table className="summaryTable" role="table" aria-label="Accrual estimate summary">
        <tbody>
          <tr>
            <td className="label">Year-end estimate</td>
            <td className="num">{money(estimateAmount, currency)}</td>
          </tr>
          <tr>
            <td className="label">Later invoices settled</td>
            <td className="num">{money(settlementTotal, currency)}</td>
          </tr>
          <tr>
            <td className="label">Variance</td>
            <td className="num">{money(variance, currency)}</td>
          </tr>
        </tbody>
      </table>

      <div className="note">
        <div className="noteTitle">Notes</div>
        <div className="noteBody">
          {safe(note) || 'Estimate recorded at year-end; settle when invoices arrive.'}
        </div>
      </div>
    </div>
  );
}

export const accrualEstimateV1 = {
  id: 'refdoc.accrual-estimate.v1',
  page: {
    pdfOptions: { format: 'Letter' },
  },
  Component: AccrualEstimateMemo,
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

.header { text-align: center; margin-bottom: 18px; }
.company { font-size: 18px; font-weight: 700; letter-spacing: 0.3px; }
.title { font-size: 22px; font-weight: 700; margin-top: 6px; }
.subtitle { font-size: 12px; margin-top: 4px; }

.meta { display: grid; gap: 6px; margin-bottom: 16px; font-size: 11px; }
.metaRow { display: flex; justify-content: space-between; border: 1px solid ${t.grid}; padding: 6px 8px; }
.metaRow .label { font-weight: 700; }

.summaryTable {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
  margin-bottom: 18px;
}

.summaryTable td {
  border: 1px solid ${t.grid};
  padding: 8px 10px;
}

.summaryTable .label { font-weight: 700; }
.summaryTable .num { text-align: right; }

.note {
  border: 1px solid ${t.grid};
  padding: 10px 12px;
  font-size: 11px;
}

.noteTitle { font-weight: 700; margin-bottom: 6px; }
`;
  },
};
