import React from 'react';

const safe = (value) => (value === null || value === undefined ? '' : String(value));

function PayrollRegister({ data }) {
  const {
    reportTitle = 'Payroll Register',
    payPeriod = '',
    reportScopeLabel = '',
    payDate = '',
    companyCode = '',
    companyNameLine1 = '',
    companyNameLine2 = '',
    pageNumber = '',
    pageCount = '',
    totalHours = '',
    totalEmployees = '',
    totals = [],
    footerNote = '',
  } = data || {};

  const pageLabel =
    pageNumber || pageCount ? `Page ${safe(pageNumber)} of ${safe(pageCount)}` : '';

  return (
    <div className="page" role="document" aria-label={safe(reportTitle) || 'Payroll register'}>
      <div className="topbar">
        <div className="leftMeta">
          <div className="row">
            <div className="label">Pay Period:</div>
            <div className="value">{safe(payPeriod)}</div>
          </div>
          {reportScopeLabel ? (
            <div className="row">
              <div className="label"></div>
              <div className="value">{safe(reportScopeLabel)}</div>
            </div>
          ) : null}
          <div className="row">
            <div className="label">Pay Date:</div>
            <div className="value">{safe(payDate)}</div>
          </div>
          <div className="row">
            <div className="label">Company Code:</div>
            <div className="value">{safe(companyCode)}</div>
          </div>
        </div>

        <div className="company">
          <div className="line1">{safe(companyNameLine1)}</div>
          <div className="line2">{safe(companyNameLine2)}</div>
        </div>

        <div className="rightMeta">
          <div className="row single">
            <div className="value">{pageLabel}</div>
          </div>
        </div>
      </div>

      <div className="divider" />

      <div className="title">{safe(reportTitle)}</div>

      <div className="rule" />

      <table className="summary" aria-label="Payroll totals summary">
        <tbody>
          {totalHours !== null && totalHours !== undefined ? (
            <tr>
              <td className="key">
                <span className="label">Total Hours:</span> {safe(totalHours)}
              </td>
              <td className="val"></td>
            </tr>
          ) : null}
          {totalEmployees !== null && totalEmployees !== undefined ? (
            <tr>
              <td className="key">
                <span className="label">Total Employees:</span> {safe(totalEmployees)}
              </td>
              <td className="val"></td>
            </tr>
          ) : null}
          {Array.isArray(totals)
            ? totals.map((item, index) => (
                <tr key={index}>
                  <td className="key">
                    <span className="label">{safe(item?.label)}</span>
                  </td>
                  <td className="val">{safe(item?.amount)}</td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      {footerNote ? <div className="footerNote">{safe(footerNote)}</div> : null}
    </div>
  );
}

export const payrollRegisterV1 = {
  id: 'refdoc.payroll-register.v1',
  page: {
    pdfOptions: { format: 'Letter' },
  },
  Component: PayrollRegister,
  css: ({ theme }) => {
    const t = {
      ink: '#111',
      rule: '#000',
      ...theme,
    };

    return `
@page { size: Letter; margin: 0.6in; }
html, body { margin: 0; padding: 0; }
body { color: ${t.ink}; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.25; }

.page { width: 100%; }

.topbar {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1fr;
  align-items: start;
  column-gap: 10px;
}

.leftMeta, .rightMeta { font-size: 10pt; }
.leftMeta .row, .rightMeta .row {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 6px;
  margin: 2px 0;
}
.rightMeta .row.single { grid-template-columns: 1fr; }
.label { font-weight: 700; white-space: nowrap; }
.value { white-space: nowrap; }

.company { text-align: center; font-weight: 700; letter-spacing: 0.2px; }
.company .line1 { font-size: 12pt; }
.company .line2 { font-size: 12pt; }

.rightMeta { text-align: right; }

.divider { height: 10px; }

.title { text-align: center; font-weight: 700; margin: 6px 0 10px; letter-spacing: 0.3px; }

.summary { width: 100%; border-collapse: collapse; margin-top: 6px; }
.summary td { padding: 2px 0; vertical-align: bottom; }
.summary .key { width: 65%; }
.summary .val {
  width: 35%;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.rule { border-top: 1px solid ${t.rule}; margin: 10px 0 6px; }

.footerNote { margin-top: 12px; font-size: 9.5pt; }
`;
  },
};
