import React from 'react';
import { CheckBody, checkCopyBodyCss } from './checkCopyV1.js';

const money = (value, currency = 'USD') =>
  Number(value || 0).toLocaleString('en-US', { style: 'currency', currency });

const safe = (value) => (value === null || value === undefined ? '' : String(value));

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const parseMoneyLike = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  // Accept strings like "$1,234.56", "1,234.56", "(1,234.56)", "-123.45"
  const raw = String(value).trim();
  if (!raw) return 0;

  const isParenNegative = raw.startsWith('(') && raw.endsWith(')');
  const cleaned = raw
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .replace(/[$,\s]/g, '')
    .replace(/\u2212/g, '-'); // unicode minus

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return isParenNegative ? -Math.abs(n) : n;
};

function BankStatement({ data }) {
  const {
    bankName = 'Bank Statement',
    bankLogoUrl,
    accountName,
    accountAddressLine1,
    accountAddressLine2,
    accountAddressLine3,
    accountNumber,
    periodLabel,
    openingBalance = 0,
    rows = [],
    currency = 'USD',
    footerNote,
    pageNumber = 1,
    pageCount = 1,
    creditsContinuedNotice,
    layout = {},
    checkPages = [],
    canceledCheckPages = [],
    canceledChecks = [],
  } = data || {};

  let runningBalance = Number(openingBalance || 0);
  const statementRows = rows.map((row) => {
    // Prefer a single signed amount; fall back to debit/credit inputs if provided.
    const amountSource =
      row.amount !== undefined && row.amount !== null
        ? row.amount
        : row.credit !== undefined && row.credit !== null
          ? row.credit
          : row.debit !== undefined && row.debit !== null
            ? -row.debit
            : 0;

    const amount = parseMoneyLike(amountSource);
    runningBalance = roundMoney(runningBalance + amount);
    return {
      ...row,
      amount,
      debit: amount < 0 ? Math.abs(amount) : 0,
      credit: amount > 0 ? amount : 0,
      balance: runningBalance,
    };
  });

  const totals = statementRows.reduce(
    (acc, row) => {
      acc.debits += row.debit || 0;
      acc.credits += row.credit || 0;
      return acc;
    },
    { debits: 0, credits: 0 },
  );
  const endingBalance =
    statementRows.length > 0
      ? statementRows[statementRows.length - 1].balance
      : Number(openingBalance || 0);
  const debitRows = statementRows.filter((row) => Number(row.debit) > 0);
  const creditRows = statementRows.filter((row) => Number(row.credit) > 0);

  const showDebits = layout.showDebits !== false;
  const showCredits = layout.showCredits !== false;
  const debitsTitle = layout.debitsTitle || 'DEBITS';
  const creditsTitle = layout.creditsTitle || 'CREDITS';
  const showFooter = footerNote || pageNumber || pageCount;
  // Always stack debits then credits vertically for predictable PDF layout.
  const txGridClass = 'txGrid';

  const formatCheckAmount = (value) => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string') return value;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return String(value);
    return parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const buildCheckData = (chk) => {
    const payerName = chk?.payer?.name || chk?.payerName || accountName || '';
    const payerAddress =
      chk?.payer?.addressLine ||
      chk?.payer?.address_line ||
      chk?.payerAddressLine ||
      accountAddressLine1 ||
      '';
    const amountNumeric = formatCheckAmount(
      chk?.amountNumeric ?? chk?.amount_numeric ?? chk?.amount ?? chk?.checkAmount,
    );
    const checkNumber = chk?.checkNumber || chk?.check_number || chk?.micr?.checkNumber || '';
    return {
      payer: {
        name: payerName,
        addressLine: payerAddress,
      },
      checkNumber,
      date: chk?.date || chk?.checkDate,
      payee: chk?.payee,
      amountNumeric,
      amountWords: chk?.amountWords || chk?.amount_words || '',
      bank: {
        name: chk?.bank?.name || bankName || '',
        subName: chk?.bank?.subName || chk?.bank?.sub_name || '',
        logoUrl: chk?.bank?.logoUrl,
      },
      memo: chk?.memo || '',
      signatureName: chk?.signatureName || chk?.signature_name || '',
      micr: chk?.micr || {},
    };
  };

  const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const inferChecksFromRows = () => {
    // Try to infer canceled checks from debit rows if none were supplied.
    const candidates = statementRows
      .filter((r) => Number(r.debit) > 0)
      .map((r) => {
        const rawDesc = safe(r.description);
        let checkNumber = r.checkNumber;
        let payee = r.payee;

        // If description starts with "Check 10431 ..." parse it.
        const m = rawDesc.match(/^\s*Check\s+(\d{3,})\s*(.*)$/i);
        if (!checkNumber && m) checkNumber = m[1];
        if (!payee && m) payee = m[2] || '';

        // Only treat it as a check if we have a check number from either source.
        if (!checkNumber) return null;

        return {
          checkNumber,
          date: r.date,
          amount: r.debit,
          payee,
          imageUrl: r.imageUrl || r.checkImageUrl || r.canceledCheckImageUrl,
        };
      })
      .filter(Boolean);

    return candidates;
  };

  // Preferred input: paged structure: [{ checks: [...] }, ...]
  let canceledPages =
    (Array.isArray(canceledCheckPages) && canceledCheckPages.length > 0
      ? canceledCheckPages
      : Array.isArray(checkPages) && checkPages.length > 0
        ? checkPages
        : []) || [];

  // Support a flat list: canceledChecks: [{checkNumber,date,amount,payee,imageUrl?}, ...]
  if (canceledPages.length === 0 && Array.isArray(canceledChecks) && canceledChecks.length > 0) {
    canceledPages = chunk(canceledChecks, 6).map((checks) => ({ checks }));
  }

  // Last resort: infer from the debit rows (checks) if nothing was supplied.
  if (canceledPages.length === 0 && layout.autoGenerateCanceledChecks !== false) {
    const inferred = inferChecksFromRows();
    if (inferred.length > 0) canceledPages = chunk(inferred, 6).map((checks) => ({ checks }));
  }

  const showCanceledPages = layout.showCanceledChecks !== false && canceledPages.length > 0;
  const effectivePageCount = Math.max(Number(pageCount || 1), Number(pageNumber || 1) + (showCanceledPages ? canceledPages.length : 0));

  return (
    <>
      <div className="page">
        <div className="hdr">
          <div>
            <div className="title">Account Statement</div>
            <div className="sub">
              <span className="label">Account Number:</span> {safe(accountNumber)}
            </div>
            <div className="sub">{safe(periodLabel)}</div>
            {(accountName || accountAddressLine1 || accountAddressLine2 || accountAddressLine3) && (
              <div className="addr">
                {safe(accountName)}
                {accountAddressLine1 ? `\n${safe(accountAddressLine1)}` : ''}
                {accountAddressLine2 ? `\n${safe(accountAddressLine2)}` : ''}
                {accountAddressLine3 ? `\n${safe(accountAddressLine3)}` : ''}
              </div>
            )}
          </div>
          <div className="logo">
            {bankLogoUrl ? (
              <img src={bankLogoUrl} alt={safe(bankName)} />
            ) : (
              <div className="bank-name">{safe(bankName)}</div>
            )}
          </div>
        </div>

        <div className="rule" />

        <div className="sectionTitle">ACCOUNT SUMMARY</div>
        <table className="summary" aria-label="Account summary">
          <thead>
            <tr>
              <th>Account Number</th>
              <th className="num">Beginning Balance</th>
              <th className="num">Total Debits</th>
              <th className="num">Total Credits</th>
              <th className="num">Ending Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{safe(accountNumber)}</td>
              <td className="num">{money(openingBalance, currency)}</td>
              <td className="num">{money(totals.debits, currency)}</td>
              <td className="num">{money(totals.credits, currency)}</td>
              <td className="num">{money(endingBalance, currency)}</td>
            </tr>
          </tbody>
        </table>

        <div className={txGridClass}>
          {showDebits && (
            <div className="txBlock">
              <h3>{debitsTitle}</h3>
              <table className="txTable" aria-label="Debits">
                <thead>
                  <tr>
                    <th className="date">Date</th>
                    <th className="amt num">Amount</th>
                    <th className="desc">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {debitRows.map((row, index) => (
                    <tr key={index}>
                      <td className="date">{safe(row.date)}</td>
                      <td className="amt num">{money(row.debit, currency)}</td>
                      <td className="desc">{safe(row.description)}</td>
                    </tr>
                  ))}
                  {debitRows.length === 0 && (
                    <tr>
                      <td className="empty" colSpan={3}>
                        No debits this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {showCredits && (
            <div className="txBlock">
              <h3>{creditsTitle}</h3>
              <table className="txTable" aria-label="Credits">
                <thead>
                  <tr>
                    <th className="date">Date</th>
                    <th className="amt num">Amount</th>
                    <th className="desc">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {creditRows.map((row, index) => (
                    <tr key={index}>
                      <td className="date">{safe(row.date)}</td>
                      <td className="amt num">{money(row.credit, currency)}</td>
                      <td className="desc">{safe(row.description)}</td>
                    </tr>
                  ))}
                  {creditRows.length === 0 && (
                    <tr>
                      <td className="empty" colSpan={3}>
                        No credits this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {creditsContinuedNotice && (
                <div className="continuedNote">{safe(creditsContinuedNotice)}</div>
              )}
            </div>
          )}
        </div>

        {showFooter && (
          <div className="footer">
            <div className="note">
              {footerNote || `Ending balance: ${money(endingBalance, currency)}`}
            </div>
            <div>
              Page {pageNumber} of {effectivePageCount}
            </div>
          </div>
        )}
      </div>
      {showCanceledPages &&
        canceledPages.map((p, i) => {
          const checks = Array.isArray(p?.checks) ? p.checks : Array.isArray(p) ? p : [];
          const derivedPageNumber = Number(pageNumber || 1) + i + 1;
          return (
            <div className="page pageBreak" key={`canceled-checks-${i}`}>
              <div className="hdr">
                <div>
                  <div className="title">Canceled Checks</div>
                  <div className="sub">
                    <span className="label">Account Number:</span> {safe(accountNumber)}
                  </div>
                  <div className="sub">{safe(periodLabel)}</div>
                  {(accountName || accountAddressLine1 || accountAddressLine2 || accountAddressLine3) && (
                    <div className="addr">
                      {safe(accountName)}
                      {accountAddressLine1 ? `\n${safe(accountAddressLine1)}` : ''}
                      {accountAddressLine2 ? `\n${safe(accountAddressLine2)}` : ''}
                      {accountAddressLine3 ? `\n${safe(accountAddressLine3)}` : ''}
                    </div>
                  )}
                </div>
                <div className="logo">
                  {bankLogoUrl ? (
                    <img src={bankLogoUrl} alt={safe(bankName)} />
                  ) : (
                    <div className="bank-name">{safe(bankName)}</div>
                  )}
                </div>
              </div>

              <div className="rule" />

              <div className="sectionTitle">CANCELED CHECK IMAGES</div>

              <div className="checksGrid" aria-label="Canceled check images">
                {checks.map((chk, j) => (
                  <div className="checkCard" key={j}>
                    {chk?.imageUrl ? (
                      <img className="checkImg" src={chk.imageUrl} alt={`Check ${safe(chk?.checkNumber)}`} />
                    ) : chk?.payer || chk?.amountWords || chk?.amountNumeric || chk?.bank || chk?.micr ? (
                      <div className="checkScale">
                        <CheckBody data={buildCheckData(chk)} />
                      </div>
                    ) : (
                      <div className="checkPlaceholder">
                        <div><strong>Check</strong> {safe(chk?.checkNumber)}</div>
                        <div>{safe(chk?.date || chk?.checkDate)}</div>
                        <div>{money(chk?.amount || chk?.checkAmount || 0, currency)}</div>
                        <div>{safe(chk?.payee)}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="footer">
                <div className="note">{footerNote || `Ending balance: ${money(endingBalance, currency)}`}</div>
                <div>
                  Page {derivedPageNumber} of {effectivePageCount}
                </div>
              </div>
            </div>
          );
        })}
    </>
  );
}

export const bankStatementV1 = {
  id: 'refdoc.bank-statement.v1',
  page: {
    pdfOptions: { format: 'Letter' },
  },
  Component: BankStatement,
  css: ({ theme }) => {
    const t = {
      ink: '#111',
      muted: '#666',
      grid: '#000',
      headerBg: '#111',
      headerInk: '#ffffff',
      rule: '#111',
      ...theme,
    };

    return `
@page { size: Letter; margin: 0.6in; }
html, body { margin: 0; padding: 0; }
body { color: ${t.ink}; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.25; }

.page { width: 100%; page-break-after: always; break-after: page; }
.page:last-of-type { page-break-after: auto; break-after: auto; }

.hdr {
  display: grid;
  grid-template-columns: 1fr auto;
  column-gap: 16px;
  align-items: start;
}
.title { font-size: 16pt; font-weight: 700; letter-spacing: 0.3px; }
.sub { color: ${t.muted}; margin: 2px 0; font-size: 10pt; }
.addr { margin-top: 12px; white-space: pre-line; font-size: 10pt; }
.logo { text-align: right; min-width: 160px; }
.logo img { max-width: 170px; height: auto; display: block; margin-left: auto; }
.bank-name { margin-top: 6px; font-weight: 700; letter-spacing: 0.3px; font-size: 10pt; }
.rule { border-top: 4px solid ${t.rule}; margin: 14px 0; }

.sectionTitle { font-weight: 700; font-size: 14pt; margin: 0 0 6px 0; letter-spacing: 0.2px; }
.summary {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 10pt;
  margin-bottom: 12px;
}
.summary th, .summary td {
  padding: 6px 6px;
  border-bottom: 2px solid ${t.grid};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.summary thead th {
  text-align: left;
  color: ${t.muted};
  font-weight: 700;
  padding-bottom: 4px;
}
.summary tbody td { font-weight: 700; }
.num { text-align: right; font-variant-numeric: tabular-nums; }

.txGrid {
  display: grid;
  grid-template-columns: 1fr;
  row-gap: 18px;
  margin-top: 8px;
}
.txBlock h3 {
  margin: 0 0 6px 0;
  font-size: 12pt;
  letter-spacing: 0.2px;
}
.txTable {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 10pt;
}
.txTable th, .txTable td {
  padding: 4px 4px;
  vertical-align: top;
  border-bottom: 1px solid ${t.grid};
}
.txTable thead th {
  color: ${t.muted};
  font-weight: 700;
  text-align: left;
  padding-bottom: 6px;
}
.txTable .date { width: 38%; white-space: nowrap; }
.txTable .amt { width: 24%; }
.txTable .desc { width: 38%; }
.txTable td.desc { white-space: normal; overflow: visible; }
.txTable .empty {
  color: ${t.muted};
  font-style: italic;
  padding: 8px 4px;
}
.continuedNote {
  margin-top: 8px;
  font-size: 9.5pt;
  color: ${t.muted};
}

.footer {
  margin-top: 14px;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  font-size: 9.5pt;
  color: ${t.muted};
}

.pageBreak { page-break-before: always; break-before: page; }
.checksGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: 180px;
  align-content: start;
  gap: 12px 14px;
  margin-top: 10px;
  --check-scale: 0.38;
}
.checkCard {
  border: none;
  padding: 0;
  height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.checkImg { width: 100%; height: 100%; display: block; object-fit: contain; }
.checkPlaceholder {
  width: 100%;
  color: ${t.muted};
  font-size: 9.5pt;
  line-height: 1.2;
}
.checkScale {
  width: 1000px;
  height: 468px;
  transform: scale(var(--check-scale));
  transform-origin: center center;
}
.checkScale .check {
  width: 1000px;
  max-width: none;
  height: 468px;
}
${checkCopyBodyCss({ theme })}
`;
  },
};
