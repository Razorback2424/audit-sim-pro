const fs = require('fs');
const path = require('path');

const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const money = (value, currency = 'USD') =>
  Number(value || 0).toLocaleString('en-US', { style: 'currency', currency });

const computeTotals = ({ items = [], taxRate = 0, shipping = 0 }) => {
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
    0
  );
  const tax = subtotal * Number(taxRate || 0);
  const ship = Number(shipping || 0);
  return { subtotal, tax, ship, grandTotal: subtotal + tax + ship };
};

const moneyNumber = (value, { minimumFractionDigits = 2, maximumFractionDigits = 2 } = {}) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits });

const formatTaxPercent = (rate) => {
  const percent = Number(rate || 0) * 100;
  const rounded = Math.round(percent * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 0.005) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(2);
};

const renderCheckBodyHtml = ({ data = {} } = {}) => {
  const {
    payer = {},
    checkNumber = '',
    date = '',
    payee = '',
    amountNumeric = '',
    amountWords = '',
    bank = {},
    memo = '',
    signatureName = '',
    micr = {},
  } = data || {};

  const logoHtml = bank.logoUrl
    ? `<img src="${escapeHtml(bank.logoUrl)}" alt="${escapeHtml(bank.name)}" />`
    : `<div class="logo-fallback">LOGO</div>`;

  const subNameHtml = bank.subName
    ? `<span class="sub">${escapeHtml(bank.subName)}</span>`
    : '';

  return `
    <div class="check" aria-label="Check image template">
      <div class="payer-name">${escapeHtml(payer.name)}</div>
      <div class="payer-addr">${escapeHtml(payer.addressLine)}</div>

      <div class="check-no">${escapeHtml(checkNumber)}</div>

      <div class="date-label">Date:</div>
      <div class="date-value hand">${escapeHtml(date)}</div>

      <div class="paymentBlock">
        <div class="payto-row">
          <div class="payto-label">Pay to the Order of:</div>
          <div class="payto-field">
            <span class="payto-value hand">${escapeHtml(payee)}</span>
          </div>
        </div>
        <div class="words-row">
          <div class="words-field">
            <span class="words-text hand">${escapeHtml(amountWords)}</span>
          </div>
          <div class="dollars-label">Dollars</div>
        </div>
      </div>

      <div class="amount-dollar">$</div>
      <div class="amount-box">
        <div class="amount-value hand">${escapeHtml(amountNumeric)}</div>
      </div>

      <div class="bankmark">
        <div class="bankmark-box">
          ${logoHtml}
        </div>
      </div>
      <div class="bankname-block">
        <div class="bankname">${escapeHtml(bank.name)}${subNameHtml}</div>
      </div>

      <div class="memo-label">Memo:</div>
      <div class="memo-line"></div>
      <div class="memo-value">${escapeHtml(memo)}</div>

      <div class="sig-line"></div>
      <div class="sig-value hand">${escapeHtml(signatureName)}</div>

      <div class="micr">
        ${escapeHtml(micr.routingSymbol)}${escapeHtml(micr.routingNumber)}${escapeHtml(
    micr.routingSymbol
  )} ${escapeHtml(micr.accountSymbol)}${escapeHtml(micr.accountNumber)}${escapeHtml(
    micr.accountSymbol
  )} ${escapeHtml(micr.checkNumber)}
      </div>
    </div>
  `;
};

const renderCheckBodyCss = ({ theme = {} }) => {
  const t = {
    ink: '#111',
    muted: '#333',
    paper: '#f7f7f7',
    border: '#8a7d6e',
    accent: '#b89a3b',
    ...theme,
  };

  return `
.check {
  position: relative;
  width: 100%;
  height: 100%;
  background: ${t.paper};
  border: 18px solid ${t.border};
  padding: 0;
  color: ${t.ink};
  overflow: hidden;
  box-sizing: border-box;
  --W: 1000px;
  --H: 468px;
  --L: 14px;
  --lh: calc(var(--L) * 1.2);
  --inset-x: 6%;
  --inset-y: 6%;
  --x-right: 94%;
  --x-date-right: 82%;
  --x-amount-left: 78%;
  --x-amount-right: 94%;
  --x-dollar: 70%;
  --x-dollars: 86%;
  --x-words-end: 84%;
  --date-field-w: calc(var(--W) * 0.12);
  --date-gap: 10px;
  /* Amount column width = (94% - 78%) of W */
  --amount-col-w: calc(var(--W) * 0.16);
  /* Height-anchored vertical coordinates (stable under scaling) */
  --y-name: calc(var(--H) * 0.12);
  --y-addr: calc(var(--H) * 0.16);
  --y-check: calc(var(--H) * 0.12);
  --y-date: calc(var(--H) * 0.16);

  /* Legacy vars retained (not used for placement, but kept to avoid surprises) */
  --y-payee: calc(var(--H) * 0.26);
  --y-payee-rule: calc(var(--H) * 0.28);
  --y-amount-top: calc(var(--H) * 0.27);
  --y-amount-bottom: calc(var(--H) * 0.37);
  --y-words: calc(var(--H) * 0.35);
  --y-words-rule: calc(var(--H) * 0.37);

  /* Branding band */
  --y-brand-top: calc(var(--H) * 0.52);
  --y-logo: calc(var(--H) * 0.56);

  /* Footer */
  --y-memo: calc(var(--H) * 0.78);
  --y-memo-rule: calc(var(--H) * 0.80);
  --y-micr: calc(var(--H) * 0.90);

  /* Payment block moved down to reduce top compression */
  --payment-top: calc(var(--H) * 0.28);
  --payee-row-h: calc(var(--H) * 0.08);
  --words-row-h: calc(var(--H) * 0.07);
  --payment-row-gap: calc(var(--H) * 0.02);
  --amount-top: calc(var(--payment-top) + var(--payee-row-h) - (var(--L) * 0.3));
  --amount-bottom: calc(var(--payment-top) + var(--payee-row-h) + var(--payment-row-gap) + var(--words-row-h));
}

.hand {
  font-family: "Bradley Hand", "Segoe Script", "Comic Sans MS", "Apple Chancery", cursive;
  letter-spacing: 0.2px;
}

.payer-name {
  position: absolute;
  left: var(--inset-x);
  top: calc(var(--y-name) - (var(--L) * 1.2));
  font-size: calc(var(--L) * 1.6);
  font-weight: 700;
  line-height: 1.1;
  max-width: 60%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.payer-addr {
  position: absolute;
  left: var(--inset-x);
  top: calc(var(--y-addr) - (var(--L) * 0.9));
  font-size: calc(var(--L) * 0.9);
  line-height: 1.05;
  max-width: 60%;
}

.check-no {
  position: absolute;
  right: calc(100% - var(--x-right));
  top: calc(var(--y-check) - (var(--L) * 1.1));
  font-size: calc(var(--L) * 1.4);
  font-weight: 700;
  line-height: 1;
  text-align: right;
}

.date-label {
  position: absolute;
  right: calc(100% - var(--x-date-right) + var(--date-field-w) + var(--date-gap));
  top: calc(var(--y-date) - (var(--L) * 1.28));
  font-size: var(--L);
  font-weight: 700;
  line-height: 1;
  text-align: right;
}
.date-value {
  position: absolute;
  right: calc(100% - var(--x-date-right));
  top: calc(var(--y-date) - (var(--L) * 1.28));
  width: var(--date-field-w);
  font-size: calc(var(--L) * 1.6);
  line-height: 1;
  text-align: left;
  border-bottom: 2px solid #000;
  padding: 0 6px 4px;
}

.paymentBlock {
  position: absolute;
  left: calc(var(--W) * 0.06);
  top: var(--payment-top);
  width: calc(var(--W) * 0.88);
  height: calc(var(--payee-row-h) + var(--payment-row-gap) + var(--words-row-h));
  display: grid;
  grid-template-rows: var(--payee-row-h) var(--words-row-h);
  row-gap: var(--payment-row-gap);
  align-items: end;
  padding-right: var(--amount-col-w);
  box-sizing: border-box;
}
.payto-row,
.words-row {
  display: flex;
  align-items: flex-end;
  gap: calc(var(--W) * 0.015);
}
.payto-label {
  font-size: var(--L);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
.payto-field {
  position: relative;
  flex: 1;
  min-width: 0;
  padding-bottom: 4px;
}
.payto-field::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  border-bottom: 2px solid #000;
}
.payto-value {
  display: block;
  font-size: calc(var(--L) * 2.2);
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-bottom: 2px;
}
.words-field {
  position: relative;
  flex: 1;
  min-width: 0;
  padding-bottom: 4px;
}
.words-field::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  border-bottom: 2px solid #000;
}
.words-text {
  display: block;
  font-size: calc(var(--L) * 1.6);
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-bottom: 2px;
}
.dollars-label {
  font-size: var(--L);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  margin-left: calc(var(--W) * 0.01);
  padding-bottom: 6px;
}

.amount-dollar { display: none; }
.amount-box {
  position: absolute;
  left: calc(var(--W) * 0.78);
  right: calc(var(--W) * 0.06);
  top: var(--amount-top);
  height: calc(var(--amount-bottom) - var(--amount-top));
  border: 2px solid #000;
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  padding: 0 10px 6px calc(var(--L) * 0.9);
}
.amount-box::before {
  content: '$';
  position: absolute;
  left: calc(-1 * (var(--L) * 1.2));
  bottom: 6px;
  font-size: var(--L);
  font-weight: 700;
  line-height: 1;
}
.amount-value {
  font-size: calc(var(--L) * 1.8);
  line-height: 1;
}

.bankmark {
  position: absolute;
  left: var(--inset-x);
  top: var(--y-logo);
  width: 11%;
  height: 16%;
}
.bankmark-box {
  width: 100%;
  height: 100%;
  border: 1px solid #999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bankmark-box img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.bankname-block {
  position: absolute;
  left: var(--inset-x);
  top: var(--y-brand-top);
  max-width: 30%;
}
.bankname {
  font-size: calc(var(--L) * 0.9);
  letter-spacing: 0.6px;
  font-weight: 600;
  color: ${t.ink};
  line-height: 1.05;
}
.bankname .sub {
  display: block;
  letter-spacing: 0.4px;
  font-weight: 600;
  font-size: calc(var(--L) * 0.85);
  margin-top: 2px;
}

.memo-label {
  position: absolute;
  left: var(--inset-x);
  top: calc(var(--y-memo) - (var(--L) * 0.8));
  font-size: var(--L);
  font-weight: 700;
  line-height: 1;
}
.memo-line {
  position: absolute;
  left: calc(var(--inset-x) + 6.5%);
  width: 40%;
  top: var(--y-memo-rule);
  border-bottom: 2px solid #000;
  height: 0;
}
.memo-value {
  position: absolute;
  left: calc(var(--inset-x) + 6.5% + (var(--L) * 0.6));
  top: calc(var(--y-memo) - (var(--L) * 0.8));
  width: 34%;
  font-size: var(--L);
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sig-value {
  position: absolute;
  left: calc(var(--inset-x) + 60% + (var(--L) * 0.6));
  right: calc(100% - var(--x-right));
  top: calc(var(--y-memo) - (var(--L) * 1.7));
  font-size: calc(var(--L) * 2.2);
  line-height: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sig-line {
  position: absolute;
  left: calc(var(--inset-x) + 60%);
  right: calc(100% - var(--x-right));
  top: var(--y-memo-rule);
  border-bottom: 2px solid #000;
  height: 0;
}

.micr {
  position: absolute;
  left: var(--inset-x);
  top: calc(var(--y-micr) - (var(--L) * 0.8));
  font-family: "OCRB", "Courier New", monospace;
  font-size: calc(var(--L) * 1.4);
  letter-spacing: 2px;
  white-space: nowrap;
}
`;
};

const renderCheckCopyV1 = ({ data = {}, theme = {} }) => `
  <div class="page">
    <div class="checkFrame">
      <div class="checkScale">
        ${renderCheckBodyHtml({ data })}
      </div>
    </div>
  </div>
`;

const renderCheckCopyV1Css = ({ theme = {} }) => `
@page { size: Letter; margin: 0.6in; }
html, body { margin: 0; padding: 0; }
body { color: ${theme?.ink || '#111'}; font-family: Arial, Helvetica, sans-serif; }

.page { width: 100%; display: flex; justify-content: center; }
.checkFrame {
  width: 700px;
  height: 328px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.checkScale {
  width: 1000px;
  height: 468px;
  transform: scale(0.7);
  transform-origin: center center;
}
.checkScale .check {
  width: 1000px;
  max-width: none;
  height: 468px;
}
${renderCheckBodyCss({ theme })}
`;

const renderSeedAlphaInvoiceV1 = ({ data = {}, theme = {}, layout = {} }) => {
  const {
    brandName = 'SEED ALPHA',
    invoiceNumber = '',
    invoiceDate = '',
    issuedTo = {},
    shippingInfo = {},
    items = [],
    taxRate = 0.05,
    shipping = 0,
    currency = 'USD',
    showThankYou = true,
    thankYouText = 'THANK\nYOU',
  } = data || {};

  const totals = computeTotals({ items, taxRate, shipping });
  const dataInvoiceTotal = Number(data?.invoiceTotal);
  if (Number.isFinite(dataInvoiceTotal)) {
    const adjustedSubtotal = dataInvoiceTotal - totals.tax - totals.ship;
    if (adjustedSubtotal >= 0) {
      totals.subtotal = adjustedSubtotal;
      totals.grandTotal = dataInvoiceTotal;
    }
  }

  const t = {
    ink: '#111',
    grid: '#9d9d9d',
    headerBg: '#000',
    thank: '#a6a6a6',
    ...theme,
  };

  const l = {
    pageMargin: '0.65in',
    colDesc: '50%',
    colQty: '12%',
    colPrice: '18%',
    colTotal: '20%',
    ...layout,
  };

  const rowsHtml = items
    .map((item) => {
      const line = Number(item.qty || 0) * Number(item.unitPrice || 0);
      return `
        <tr>
          <td class="cDesc">${escapeHtml(item.description)}</td>
          <td class="cQty">${escapeHtml(item.qty)}</td>
          <td class="cPrice">${escapeHtml(money(item.unitPrice, currency))}</td>
          <td class="cTotal">${escapeHtml(money(line, currency))}</td>
        </tr>`;
    })
    .join('');

  const thankYouBlock = showThankYou
    ? `<div class="thankYou">${escapeHtml(thankYouText).replace(/\n/g, '<br />')}</div>`
    : '';

  const html = `
    <div class="page">
      <div class="top">
        <div class="brand">${escapeHtml(brandName)}</div>
        <div class="topRight">
          <div class="invoiceBox">
            <div class="invoiceNumber">${escapeHtml(invoiceNumber)}</div>
          </div>
          <div class="invoiceDate">
            <div class="labelStrong">Invoice Date:</div>
            <div class="valueLarge">${escapeHtml(invoiceDate)}</div>
          </div>
        </div>
      </div>

      <div class="mid">
        <div class="issued">
          <div class="labelStrong">Issued to:</div>
          <div class="blockText">
            ${escapeHtml(issuedTo.name)}<br />
            ${escapeHtml(issuedTo.line1)}<br />
            ${escapeHtml(issuedTo.line2)}
          </div>
        </div>

        <div class="shipping">
          <div class="labelStrong">Shipping Info:</div>
          <div class="blockText">
            <span class="mutedLabel">${escapeHtml(
              shippingInfo.dateLabel || 'Date Shipped'
            )}:</span> ${escapeHtml(
              shippingInfo.dateValue || shippingInfo.dateShipped
            )}<br />
            <span class="mutedLabel">Shipping Terms:</span> ${escapeHtml(shippingInfo.terms)}
          </div>
        </div>
      </div>

      <div class="itemsWrap">
        <table class="items" role="table" aria-label="Invoice items">
          <colgroup>
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th class="cDesc">DESCRIPTION</th>
              <th class="cQty">QTY</th>
              <th class="cPrice">PRICE</th>
              <th class="cTotal">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr class="totalsRow">
              <td class="cDesc totalsSpacer"></td>
              <td class="cQty totalsSpacer"></td>
              <td class="cPrice totalsLabel">SUBTOTAL</td>
              <td class="cTotal totalsValue">${escapeHtml(money(totals.subtotal, currency))}</td>
            </tr>
            <tr class="totalsRow">
              <td class="cDesc totalsSpacer"></td>
              <td class="cQty totalsSpacer"></td>
              <td class="cPrice totalsLabel">TAX (${formatTaxPercent(taxRate)}%)</td>
              <td class="cTotal totalsValue">${escapeHtml(money(totals.tax, currency))}</td>
            </tr>
            <tr class="totalsRow">
              <td class="cDesc totalsSpacer"></td>
              <td class="cQty totalsSpacer"></td>
              <td class="cPrice totalsLabel">SHIPPING</td>
              <td class="cTotal totalsValue">${escapeHtml(money(totals.ship, currency))}</td>
            </tr>
            <tr class="totalsRow grand">
              <td class="cDesc totalsSpacer"></td>
              <td class="cQty totalsSpacer"></td>
              <td class="cPrice totalsLabel">GRAND TOTAL</td>
              <td class="cTotal totalsValue">${escapeHtml(money(totals.grandTotal, currency))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      ${thankYouBlock}
    </div>
  `;

  const css = `
@page { size: Letter; margin: ${l.pageMargin}; }
html, body { margin: 0; padding: 0; }
body { color: ${t.ink}; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }

.page { width: 100%; }

.top {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: start;
  gap: 24px;
  margin-top: 8px;
}

.brand {
  font-weight: 900;
  font-size: 78px;
  letter-spacing: 1px;
  line-height: 0.95;
}

.topRight { display: grid; justify-items: end; gap: 14px; }

.invoiceBox {
  border: 4px solid ${t.ink};
  padding: 16px 28px;
  min-width: 320px;
  text-align: center;
}

.invoiceNumber {
  font-weight: 900;
  font-size: 60px;
  letter-spacing: 1px;
}

.invoiceDate { text-align: right; }
.labelStrong { font-weight: 900; font-size: 34px; line-height: 1.05; }
.valueLarge { font-size: 34px; line-height: 1.05; }

.mid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-top: 120px;
  gap: 24px;
  align-items: start;
}

.issued { justify-self: start; }
.shipping { justify-self: end; text-align: right; }

.blockText { margin-top: 10px; font-size: 30px; line-height: 1.25; }
.mutedLabel { font-weight: 400; }

.thankYou {
  margin: 80px 0 60px 0;
  text-align: center;
  font-weight: 900;
  color: ${t.thank};
  font-size: 90px;
  letter-spacing: 2px;
  line-height: 0.9;
  white-space: pre-line;
}

.itemsWrap { margin-top: 10px; }

.items {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.items th, .items td { padding: 26px 22px; }
.items th.cPrice, .items td.cPrice,
.items th.cTotal, .items td.cTotal,
.items tfoot td.cPrice, .items tfoot td.cTotal {
  padding-left: 12px;
  padding-right: 14px;
}
.items th.cQty, .items td.cQty,
.items tfoot td.cQty {
  padding-left: 12px;
  padding-right: 12px;
}

.items thead th {
  background: ${t.headerBg};
  color: #fff;
  font-weight: 900;
  font-size: 28px;
  letter-spacing: 1px;
  text-align: left;
}
.items thead th.cQty { text-align: center; }
.items thead th.cPrice,
.items thead th.cTotal { text-align: right; }

.cQty { text-align: center; }
.cPrice, .cTotal { text-align: right; }
.cQty, .cPrice, .cTotal { white-space: nowrap; font-variant-numeric: tabular-nums; }
.items tbody td { font-size: 28px; }
.items tbody td.cQty { text-align: center; }
.items tbody td.cPrice,
.items tbody td.cTotal { text-align: right; font-size: 24px; }
.items tbody td.cPrice,
.items tbody td.cTotal { font-size: 26px; }

.items colgroup col:nth-child(1) { width: ${l.colDesc}; }
.items colgroup col:nth-child(2) { width: ${l.colQty}; }
.items colgroup col:nth-child(3) { width: ${l.colPrice}; }
.items colgroup col:nth-child(4) { width: ${l.colTotal}; }

.items tbody tr td { border-bottom: 2px solid ${t.ink}; }

.items thead th:nth-child(2),
.items tbody td:nth-child(2),
.items tfoot td:nth-child(2) { border-left: 4px solid ${t.grid}; }

.items thead th:nth-child(3),
.items tbody td:nth-child(3),
.items tfoot td:nth-child(3) { border-left: 4px solid ${t.grid}; }

.items thead th:nth-child(4),
.items tbody td:nth-child(4),
.items tfoot td:nth-child(4) { border-left: 4px solid ${t.grid}; }

.items tfoot {
  display: table-row-group;
}
.items tfoot tr {
  break-inside: avoid;
  page-break-inside: avoid;
}
.items tfoot td {
  padding: 26px 22px;
  font-size: 24px;
  border-bottom: 2px solid ${t.ink};
}
.items tfoot td.cPrice,
.items tfoot td.cTotal {
  padding-right: 10px;
}

.items tfoot tr:first-child td { border-top: 2px solid ${t.ink}; }

.totalsLabel { text-align: left; font-weight: 500; white-space: normal; }
.totalsValue { font-weight: 500; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }

.totalsRow.grand .totalsLabel,
.totalsRow.grand .totalsValue {
  font-weight: 900;
  font-size: 26px;
}
`;

  return { html, css, pdfOptions: { format: 'Letter' } };
};

const renderSeedBetaInvoiceV1 = ({ data = {}, theme = {}, layout = {} }) => {
  const {
    brandName = 'SEED BETA',
    invoiceNumber = '',
    invoiceDate = '',
    issuedTo = {},
    shippingInfo = {},
    items = [],
    taxRate = 0.05,
    shipping = 0,
  } = data || {};

  const totals = computeTotals({ items, taxRate, shipping });
  const dataInvoiceTotal = Number(data?.invoiceTotal);
  if (Number.isFinite(dataInvoiceTotal)) {
    const adjustedSubtotal = dataInvoiceTotal - totals.tax - totals.ship;
    if (adjustedSubtotal >= 0) {
      totals.subtotal = adjustedSubtotal;
      totals.grandTotal = dataInvoiceTotal;
    }
  }

  const t = {
    ink: '#111',
    muted: '#5c5c5c',
    rule: '#c9c2bf',
    tableBorder: '#b9b1ad',
    hdrBg: '#ded4cf',
    totalBg: '#b1aba7',
    ...theme,
  };

  const l = {
    pageWidth: '8.5in',
    pageHeight: '11in',
    contentSide: '0.85in',
    contentTop: '1.15in',
    contentBottom: '0.85in',
    ...layout,
  };

  const itemCount = Math.max(1, Array.isArray(items) ? items.length : 0);
  const spacerHeight = Math.max(0, 3.85 - Math.max(0, itemCount - 2) * 1.18);
  const brandText = escapeHtml(brandName);
  const brandLength = String(brandName || '').replace(/\s+/g, '').length;
  const brandClass =
    brandLength > 20 ? 'brand tiny' : brandLength > 14 ? 'brand small' : 'brand';

  const issuedLines = [
    issuedTo.name ? `<div class="name">${escapeHtml(issuedTo.name)}</div>` : '',
    issuedTo.line1 ? `<div>${escapeHtml(issuedTo.line1)}</div>` : '',
    issuedTo.line2 ? `<div>${escapeHtml(issuedTo.line2)}</div>` : '',
    issuedTo.line3 ? `<div>${escapeHtml(issuedTo.line3)}</div>` : '',
  ]
    .filter(Boolean)
    .join('');

  const rowsHtml = items
    .map((item, index) => {
      const description = escapeHtml(item.description || '').replace(/\n/g, '<br />');
      const lineTotal = Number(item.qty || 0) * Number(item.unitPrice || 0);
      return `
        <tr>
          <td class="mono cell-center">${index + 1}</td>
          <td class="mono desc">${description}</td>
          <td class="mono cell-center">${escapeHtml(item.qty)}</td>
          <td class="mono money"><span class="dollar">$</span>${escapeHtml(
            moneyNumber(item.unitPrice, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
          )}</td>
          <td class="mono money"><span class="dollar">$</span>${escapeHtml(moneyNumber(lineTotal))}</td>
        </tr>`;
    })
    .join('');

  const html = `
    <div class="page" role="document" aria-label="Invoice ${escapeHtml(invoiceNumber)}">
      <div class="invoice-no">
        <div class="label">Invoice No:</div>
        <div class="value">#${escapeHtml(invoiceNumber)}</div>
      </div>

      <div class="content">
        <div class="brand-row">
          <div class="${brandClass}">${brandText}</div>
          <div class="brand-rule"></div>
        </div>

        <div class="details">
          <div>
            <div class="detail-label">Invoice Date:</div>
            <div class="detail-value">${escapeHtml(invoiceDate)}</div>

            <div class="detail-label">${escapeHtml(
              shippingInfo.dateLabel || 'Date Shipped'
            )}:</div>
            <div class="detail-value">${escapeHtml(
              shippingInfo.dateValue || shippingInfo.dateShipped
            )}</div>

            <div class="detail-label">FOB:</div>
            <div class="detail-value">${escapeHtml(shippingInfo.terms || 'Shipping Point')}</div>
          </div>

          <div>
            <div class="detail-label">Issued to:</div>
            <div class="detail-value">${issuedLines}</div>
          </div>
        </div>

        <div class="items-wrap">
          <table class="items" aria-label="Invoice line items">
            <thead>
              <tr>
                <th class="c-no">NO</th>
                <th class="c-desc">DESCRIPTION</th>
                <th class="c-qty">QTY</th>
                <th class="c-price">PRICE</th>
                <th class="c-sub">SUBTOTAL</th>
              </tr>
            </thead>

            <tbody>
              ${rowsHtml}
              <tr class="spacer" style="--spacer-height: ${spacerHeight}in;">
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <div class="totals-block">
            <div class="totals-row">
              <div class="label">Subtotal</div>
              <div class="value"><span class="dollar">$</span>${escapeHtml(moneyNumber(totals.subtotal))}</div>
            </div>
            <div class="totals-row">
              <div class="label">Shipping and Handling</div>
              <div class="value"><span class="dollar">$</span>${escapeHtml(moneyNumber(totals.ship))}</div>
            </div>
            <div class="totals-row">
              <div class="label">Sales Tax (${formatTaxPercent(taxRate)}%)</div>
              <div class="value"><span class="dollar">$</span>${escapeHtml(moneyNumber(totals.tax))}</div>
            </div>
            <div class="totals-row grand">
              <div class="label">Grand Total</div>
              <div class="value"><span class="dollar">$</span>${escapeHtml(
                moneyNumber(totals.grandTotal)
              )}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const css = `
@page { size: Letter; margin: 0; }
html, body { margin: 0; padding: 0; }
body { background: #fff; color: ${t.ink}; }

.page{
  width: ${l.pageWidth};
  min-height: ${l.pageHeight};
  background: #fff;
  margin: 0 auto;
  position: relative;
  overflow: visible;
}

.invoice-no{
  position: absolute;
  top: 0.55in;
  right: ${l.contentSide};
  text-align: right;
  font-family: "Montserrat", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  letter-spacing: .12em;
  color: #2d2d2d;
}
.invoice-no .label{
  font-size: 12px;
  font-weight: 400;
}
.invoice-no .value{
  margin-top: 12px;
  font-size: 18px;
  font-weight: 500;
  letter-spacing: .16em;
}

.content{
  padding: ${l.contentTop} ${l.contentSide} ${l.contentBottom};
}

.brand-row{
  display: flex;
  align-items: center;
  gap: 22px;
}
.brand{
  font-family: "Montserrat", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-size: 62px;
  font-weight: 300;
  letter-spacing: .22em;
  color: #1a1a1a;
  line-height: 1;
  max-width: 100%;
  white-space: normal;
  word-break: break-word;
}
.brand.small{
  font-size: 50px;
  letter-spacing: .18em;
}
.brand.tiny{
  font-size: 42px;
  letter-spacing: .14em;
}
.brand-rule{
  flex: 1;
  height: 1px;
  background: ${t.rule};
  margin-top: 10px;
}

.details{
  margin-top: 32px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 1.55in;
}

.detail-label{
  font-family: "Montserrat", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-size: 14px;
  letter-spacing: .12em;
  color: #2d2d2d;
  margin-bottom: 10px;
}
.detail-value{
  font-family: "Courier Prime", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 18px;
  letter-spacing: .06em;
  color: #111;
  line-height: 1.55;
  margin-bottom: 18px;
}

.items-wrap{
  margin-top: 30px;
}

table.items{
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1px solid ${t.tableBorder};
}

table.items thead th{
  background: ${t.hdrBg};
  font-family: "Montserrat", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: #3a3a3a;
  padding: 18px 12px;
  border-right: 1px solid ${t.tableBorder};
}
table.items thead th:last-child{ border-right: 0; }

table.items tbody td{
  border-right: 1px solid ${t.tableBorder};
  vertical-align: top;
  padding: 20px 14px;
  min-height: 1.18in;
}
table.items tbody tr:nth-child(1) td{ padding-top: 22px; }
table.items tbody td:last-child{ border-right: 0; }
table.items tbody tr + tr td{ border-top: 0; }

.c-no{ width: 7%; }
.c-desc{ width: 45%; }
.c-qty{ width: 10%; }
.c-price{ width: 15%; }
.c-sub{ width: 23%; }

.mono{
  font-family: "Courier Prime", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  letter-spacing: .06em;
}
.desc{
  font-size: 18px;
  font-weight: 700;
  line-height: 1.25;
  padding-right: 8px;
}
.cell-center{
  text-align: center;
  font-size: 18px;
}
.money{
  font-size: 18px;
  text-align: right;
  white-space: nowrap;
}
.money .dollar{ padding-right: 10px; }

tr.spacer td{
  height: var(--spacer-height, 3.85in);
  padding: 0;
  page-break-inside: avoid;
  break-inside: avoid;
}

.totals-block{
  margin-top: 0;
  border-left: 1px solid ${t.tableBorder};
  border-right: 1px solid ${t.tableBorder};
  border-bottom: 1px solid ${t.tableBorder};
  background: ${t.totalBg};
  font-family: "Courier Prime", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  letter-spacing: .06em;
  color: #171717;
}
.totals-row{
  display: flex;
  justify-content: space-between;
  padding: 14px 48px;
  border-top: 1px solid ${t.tableBorder};
  font-size: 18px;
}
.totals-row:first-child{ border-top: 0; }
.totals-row .label{
  text-transform: uppercase;
  letter-spacing: .14em;
  font-size: 14px;
}
.totals-row .value{
  white-space: nowrap;
  font-weight: 600;
}
.totals-row .dollar{ padding-right: 10px; }
.totals-row.grand{
  font-size: 22px;
  font-weight: 700;
}
.totals-row.grand .label{
  font-size: 20px;
  letter-spacing: .12em;
  text-transform: none;
}
`;

  return { html, css, pdfOptions: { format: 'Letter' } };
};

const renderSeedGammaInvoiceV1 = ({ data = {}, theme = {}, layout = {} }) => {
  const {
    brandName = 'SEED GAMMA',
    invoiceNumber = '',
    invoiceDate = '',
    dueDate = '',
    issuedTo = {},
    shippingInfo = {},
    items = [],
    taxRate = 0.05,
    shipping = 0,
  } = data || {};

  const totals = computeTotals({ items, taxRate, shipping });
  const resolvedDueDate = dueDate || invoiceDate;
  const dataInvoiceTotal = Number(data?.invoiceTotal);
  if (Number.isFinite(dataInvoiceTotal)) {
    const adjustedSubtotal = dataInvoiceTotal - totals.tax - totals.ship;
    if (adjustedSubtotal >= 0) {
      totals.subtotal = adjustedSubtotal;
      totals.grandTotal = dataInvoiceTotal;
    }
  }

  const t = {
    ink: '#111',
    muted: '#666',
    rule: '#d9d9d9',
    ...theme,
  };

  const l = {
    pageWidth: '8.5in',
    pageHeight: '11in',
    pad: '0.65in',
    ...layout,
  };

  const issuedLines = [
    issuedTo.name ? `<div class="name">${escapeHtml(issuedTo.name)}</div>` : '',
    issuedTo.line1 ? `<div>${escapeHtml(issuedTo.line1)}</div>` : '',
    issuedTo.line2 ? `<div>${escapeHtml(issuedTo.line2)}</div>` : '',
    issuedTo.line3 ? `<div>${escapeHtml(issuedTo.line3)}</div>` : '',
  ]
    .filter(Boolean)
    .join('');

  const rowsHtml = items
    .map((item) => {
      const description = escapeHtml(item.description || '').replace(/\n/g, '<br />');
      const lineTotal = Number(item.qty || 0) * Number(item.unitPrice || 0);
      return `
        <tr>
          <td class="desc"><span class="qty-inline">${escapeHtml(item.qty)}</span><span class="desc-text">${description}</span></td>
          <td class="price num"><span class="dollar">$</span>${escapeHtml(
            moneyNumber(item.unitPrice, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
          )}</td>
          <td class="sub num"><span class="dollar">$</span>${escapeHtml(moneyNumber(lineTotal))}</td>
        </tr>`;
    })
    .join('');

  const html = `
    <div class="page" role="document" aria-label="Invoice ${escapeHtml(invoiceNumber)}">
      <div class="top">
        <div>
          <h1 class="brand">${escapeHtml(brandName)}</h1>
        </div>

        <div class="meta">
          <div><span class="label">Invoice:</span><span class="value">${escapeHtml(
            invoiceNumber
          )}</span></div>
          <div><span class="label">Invoice Date:</span><span class="value">${escapeHtml(
            invoiceDate
          )}</span></div>
          <div><span class="label">Due Date:</span><span class="value">${escapeHtml(
            resolvedDueDate
          )}</span></div>
        </div>
      </div>

      <div class="rule"></div>

      <div class="mid">
        <div>
          <div class="section-title">Bill To:</div>
          <div class="billto">${issuedLines}</div>
        </div>
        <div class="shipping">
          <div class="section-title">Shipping Terms:</div>
          <div class="shipping-value">${escapeHtml(shippingInfo.terms)}</div>
          <div class="section-title shipping-title">${escapeHtml(
            shippingInfo.dateLabel || 'Shipping Date'
          )}:</div>
          <div class="shipping-value">${escapeHtml(
            shippingInfo.dateValue || shippingInfo.dateShipped
          )}</div>
        </div>
      </div>

      <table aria-label="Invoice line items">
        <thead>
          <tr>
            <th class="desc">DESCRIPTION</th>
            <th class="price num">PRICE</th>
            <th class="sub num">SUBTOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="totals" aria-label="Invoice totals">
        <div class="totals-row"><div class="k">Subtotal:</div><div class="v"><span class="dollar">$</span>${escapeHtml(
          moneyNumber(totals.subtotal)
        )}</div></div>
        <div class="totals-row"><div class="k">Shipping:</div><div class="v"><span class="dollar">$</span>${escapeHtml(
          moneyNumber(totals.ship)
        )}</div></div>
        <div class="totals-row"><div class="k">Sales Tax (${formatTaxPercent(
          taxRate
        )}%):</div><div class="v"><span class="dollar">$</span>${escapeHtml(
          moneyNumber(totals.tax)
        )}</div></div>
        <div class="totals-row grand"><div class="k">Grand Total:</div><div class="v"><span class="dollar">$</span>${escapeHtml(
          moneyNumber(totals.grandTotal)
        )}</div></div>
      </div>
    </div>
  `;

  const css = `
@page { size: Letter; margin: 0; }
html, body { margin: 0; padding: 0; }
body { background: #fff; color: ${t.ink}; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }

.page{
  width: ${l.pageWidth};
  min-height: ${l.pageHeight};
  background: #fff;
  padding: ${l.pad};
  position: relative;
}

.top{
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 16px;
  align-items: start;
  margin-bottom: 6px;
}

.brand{
  font-size: 54px;
  font-weight: 700;
  letter-spacing: .4px;
  margin: 0;
  line-height: 1;
  font-family: "Segoe Script", "Brush Script MT", "Comic Sans MS", cursive;
}

.meta{
  justify-self: end;
  text-align: right;
  font-size: 13px;
  line-height: 1.25;
}

.meta .label{
  color: ${t.ink};
  font-size: 13px;
  font-weight: 700;
  margin-right: 6px;
}
.meta .value{
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
}

.mid{
  display: grid;
  grid-template-columns: 1fr 0.9fr;
  gap: 20px;
  margin-top: 10px;
  margin-bottom: 12px;
  align-items: start;
}

.section-title{
  font-size: 12px;
  letter-spacing: .6px;
  text-transform: uppercase;
  font-weight: 700;
  margin: 10px 0 6px;
}

.billto{
  font-size: 14px;
  line-height: 1.35;
}
.billto .name{
  font-weight: 700;
}

.shipping{
  font-size: 13px;
  line-height: 1.35;
  text-align: right;
}
.shipping .section-title{
  margin: 0 0 4px;
}
.shipping-title{
  margin-top: 12px;
}
.shipping-value{
  font-size: 13px;
}

.rule{
  height: 1px;
  background: ${t.rule};
  margin: 14px 0;
}

table{
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
thead th{
  text-align: left;
  color: ${t.muted};
  font-weight: 700;
  font-size: 12px;
  padding: 10px 8px;
  border-bottom: 1px solid ${t.rule};
  letter-spacing: .4px;
}
tbody td{
  padding: 12px 8px;
  border-bottom: 1px solid #efefef;
  vertical-align: top;
}
tbody tr:last-child td{
  border-bottom: 1px solid ${t.rule};
}
.num{ text-align: right; font-variant-numeric: tabular-nums; }
.desc{ width: 56%; }
.price{ width: 22%; }
.sub{ width: 22%; }
.dollar{ padding-right: 6px; }
.qty-inline{
  display: inline-block;
  min-width: 44px;
  font-variant-numeric: tabular-nums;
}
.desc-text{
  padding-left: 6px;
}

.totals{
  margin-top: 18px;
  margin-left: auto;
  width: 100%;
  max-width: 260px;
  font-size: 13px;
}
.totals-row{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
}
.totals-row:last-child{ border-bottom: none; }
.totals-row .k{
  color: ${t.muted};
  font-size: 12px;
  letter-spacing: .3px;
  text-transform: uppercase;
  font-weight: 700;
  text-align: right;
}
.totals-row .v{
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.totals-row.grand{
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid ${t.rule};
}
.totals-row.grand .k{
  color: ${t.ink};
  font-size: 13px;
}
.totals-row.grand .v{
  font-weight: 800;
  font-size: 15px;
}
`;

  return { html, css, pdfOptions: { format: 'Letter' } };
};

const renderApAgingSummaryV1 = ({ data = {}, theme = {} }) => {
  const { companyName, asOfDate, rows = [], currency = 'USD' } = data || {};

  const rowHtml = rows
    .map((row) => {
      return `
        <tr>
          <td>${escapeHtml(row.vendor)}</td>
          <td>${escapeHtml(row.invoiceNumber)}</td>
          <td>${escapeHtml(row.invoiceDate)}</td>
          <td>${escapeHtml(row.dueDate)}</td>
          <td class="num">${escapeHtml(money(row.amount, currency))}</td>
          <td class="num">${escapeHtml(money(row.buckets?.current, currency))}</td>
          <td class="num">${escapeHtml(money(row.buckets?.days30, currency))}</td>
          <td class="num">${escapeHtml(money(row.buckets?.days60, currency))}</td>
          <td class="num">${escapeHtml(money(row.buckets?.days90Plus, currency))}</td>
        </tr>`;
    })
    .join('');

  const totals = rows.reduce(
    (acc, row) => {
      acc.amount += Number(row.amount || 0);
      acc.current += Number(row.buckets?.current || 0);
      acc.days30 += Number(row.buckets?.days30 || 0);
      acc.days60 += Number(row.buckets?.days60 || 0);
      acc.days90Plus += Number(row.buckets?.days90Plus || 0);
      return acc;
    },
    { amount: 0, current: 0, days30: 0, days60: 0, days90Plus: 0 }
  );

  const t = {
    ink: '#111',
    grid: '#b6b6b6',
    headerBg: '#0f172a',
    headerInk: '#ffffff',
    ...theme,
  };

  const html = `
    <div class="page">
      <div class="header">
        <div class="company">${escapeHtml(companyName)}</div>
        <div class="title">AP Aging Summary</div>
        <div class="subtitle">As of ${escapeHtml(asOfDate)}</div>
      </div>

      <table class="agingTable" role="table" aria-label="AP aging summary">
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
            <th class="num">Amount</th>
            <th class="num">Current</th>
            <th class="num">1-30</th>
            <th class="num">31-60</th>
            <th class="num">90+</th>
          </tr>
        </thead>
        <tbody>
          ${rowHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="4" class="totalLabel">Total</td>
            <td class="num">${escapeHtml(money(totals.amount, currency))}</td>
            <td class="num">${escapeHtml(money(totals.current, currency))}</td>
            <td class="num">${escapeHtml(money(totals.days30, currency))}</td>
            <td class="num">${escapeHtml(money(totals.days60, currency))}</td>
            <td class="num">${escapeHtml(money(totals.days90Plus, currency))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  const css = `
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

  return { html, css, pdfOptions: { format: 'Letter' } };
};

const renderApLeadSheetV1 = ({ data = {}, theme = {} }) => {
  const pick = (keys, fallback = '') => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const value = data[key];
        if (value !== null && value !== undefined && String(value).trim() !== '') {
          return value;
        }
      }
    }
    return fallback;
  };

  const parseAmount = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  };

  const formatMoneyValue = (value, currency) => {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    const parsed = parseAmount(value);
    if (parsed === null) return escapeHtml(value);
    return escapeHtml(money(parsed, currency));
  };

  const lines = Array.isArray(data.lines) ? data.lines : [];
  const totals = data.totals || data.total || {};
  const currency = pick(['currency', 'curr'], 'USD');

  const totalPrior =
    parseAmount(totals.priorAmount ?? totals.prior_amount) ??
    lines.reduce((sum, line) => sum + (parseAmount(line?.priorAmount ?? line?.prior_amount) || 0), 0);
  const totalUnadj =
    parseAmount(totals.unadjAmount ?? totals.unadj_amount) ??
    lines.reduce((sum, line) => sum + (parseAmount(line?.unadjAmount ?? line?.unadj_amount) || 0), 0);
  const totalAje =
    parseAmount(totals.ajeAmount ?? totals.aje_amount) ??
    lines.reduce((sum, line) => sum + (parseAmount(line?.ajeAmount ?? line?.aje_amount) || 0), 0);
  const totalRje =
    parseAmount(totals.rjeAmount ?? totals.rje_amount) ??
    lines.reduce((sum, line) => sum + (parseAmount(line?.rjeAmount ?? line?.rje_amount) || 0), 0);
  const totalFinal =
    parseAmount(totals.finalAmount ?? totals.final_amount) ??
    lines.reduce((sum, line) => sum + (parseAmount(line?.finalAmount ?? line?.final_amount) || 0), 0);

  const workpaperTitle = pick(['workpaperTitle', 'workpaper_title'], '');
  const clientName = pick(['clientName', 'client_name'], '');
  const periodEnding = pick(['periodEnding', 'period_ending'], '');
  const trialBalanceName = pick(['trialBalanceName', 'trial_balance_name'], '');
  const priorDate = pick(['priorDate', 'prior_date'], '');
  const currentDate = pick(['currentDate', 'current_date'], '');
  const groupCode = pick(['groupCode', 'group_code'], '');
  const groupName = pick(['groupName', 'group_name'], '');
  const subgroupName = pick(['subgroupName', 'subgroup_name'], '');
  const footerNote = pick(['footerNote', 'footer_note'], '');

  const groupRow = `<tr class="group-row">
          <td colspan="14">Group : ${escapeHtml(groupCode)}&nbsp;&nbsp;&nbsp;${escapeHtml(groupName)}</td>
        </tr>`;
  const subgroupRow = `<tr class="subgroup-row">
        <td colspan="14">Subgroup : ${escapeHtml(subgroupName)}</td>
      </tr>`;

  const rowsHtml = lines
    .map((line) => {
      const account = escapeHtml(line?.account ?? line?.acct ?? line?.accountNumber ?? '');
      const description = escapeHtml(line?.description ?? line?.desc ?? '');
      const priorAmount = formatMoneyValue(line?.priorAmount ?? line?.prior_amount, currency);
      const priorTick = escapeHtml(line?.priorTick ?? line?.prior_tick ?? '');
      const unadjAmount = formatMoneyValue(line?.unadjAmount ?? line?.unadj_amount, currency);
      const unadjTick = escapeHtml(line?.unadjTick ?? line?.unadj_tick ?? '');
      const ajeRef = escapeHtml(line?.ajeRef ?? line?.aje_ref ?? '');
      const ajeAmount = formatMoneyValue(line?.ajeAmount ?? line?.aje_amount, currency);
      const ajeTick = escapeHtml(line?.ajeTick ?? line?.aje_tick ?? '');
      const rjeRef = escapeHtml(line?.rjeRef ?? line?.rje_ref ?? '');
      const rjeAmount = formatMoneyValue(line?.rjeAmount ?? line?.rje_amount, currency);
      const rjeTick = escapeHtml(line?.rjeTick ?? line?.rje_tick ?? '');
      const finalAmount = formatMoneyValue(line?.finalAmount ?? line?.final_amount, currency);
      const finalTick = escapeHtml(line?.finalTick ?? line?.final_tick ?? '');

      return `
        <tr>
          <td>${account}</td>
          <td>${description}</td>
          <td class="num">${priorAmount}</td>
          <td class="tick">${priorTick}</td>
          <td class="num">${unadjAmount}</td>
          <td class="tick">${unadjTick}</td>
          <td class="tick">${ajeRef}</td>
          <td class="num">${ajeAmount}</td>
          <td class="tick">${ajeTick}</td>
          <td class="tick">${rjeRef}</td>
          <td class="num">${rjeAmount}</td>
          <td class="tick">${rjeTick}</td>
          <td class="num">${finalAmount}</td>
          <td class="tick">${finalTick}</td>
        </tr>`;
    })
    .join('');

  const footerHtml = footerNote
    ? `<div class="footer-note">${escapeHtml(footerNote)}</div>`
    : '';

  const html = `
    <div class="page">
      <table class="meta" aria-label="Engagement metadata">
        <tr>
          <td class="label">Client:</td>
          <td>${escapeHtml(clientName)}</td>
        </tr>
        <tr>
          <td class="label">Period Ending:</td>
          <td>${escapeHtml(periodEnding)}</td>
        </tr>
        <tr>
          <td class="label">Trial Balance:</td>
          <td>${escapeHtml(trialBalanceName)}</td>
        </tr>
        <tr>
          <td class="label">Workpaper:</td>
          <td>${escapeHtml(workpaperTitle)}</td>
        </tr>
      </table>

      <table class="sheet" aria-label="Accounts payable leadsheet">
        <colgroup>
          <col class="c1" /><col class="c2" /><col class="c3" /><col class="c4" />
          <col class="c5" /><col class="c6" /><col class="c7" /><col class="c8" />
          <col class="c9" /><col class="c10" /><col class="c11" /><col class="c12" />
          <col class="c13" /><col class="c14" />
        </colgroup>
        <thead>
          <tr class="hdr">
            <th rowspan="2">Account</th>
            <th rowspan="2">Description</th>
            <th colspan="2" class="center">1st PP-FINAL</th>
            <th colspan="2" class="center">UNADJ</th>
            <th rowspan="2" class="center">JE Ref #</th>
            <th colspan="2" class="center">AJE</th>
            <th rowspan="2" class="center">JE Ref #</th>
            <th colspan="2" class="center">RJE</th>
            <th colspan="2" class="center">FINAL</th>
          </tr>
          <tr class="hdr">
            <th class="center">${escapeHtml(priorDate)}</th>
            <th class="center muted"></th>
            <th class="center">${escapeHtml(currentDate)}</th>
            <th class="center muted"></th>
            <th class="center">${escapeHtml(currentDate)}</th>
            <th class="center muted"></th>
            <th class="center">${escapeHtml(currentDate)}</th>
            <th class="center muted"></th>
            <th class="center">${escapeHtml(currentDate)}</th>
            <th class="center muted"></th>
          </tr>
        </thead>
        <tbody>
          ${groupRow}
          ${subgroupRow}
          ${rowsHtml}
          <tr class="total-row">
            <td>Total ${escapeHtml(groupCode)}</td>
            <td>${escapeHtml(groupName)}</td>
            <td class="num">${escapeHtml(money(totalPrior, currency))}</td>
            <td class="tick"></td>
            <td class="num">${escapeHtml(money(totalUnadj, currency))}</td>
            <td class="tick"></td>
            <td class="tick"></td>
            <td class="num">${escapeHtml(money(totalAje, currency))}</td>
            <td class="tick"></td>
            <td class="tick"></td>
            <td class="num">${escapeHtml(money(totalRje, currency))}</td>
            <td class="tick"></td>
            <td class="num">${escapeHtml(money(totalFinal, currency))}</td>
            <td class="tick"></td>
          </tr>
        </tbody>
      </table>

      ${footerHtml}
    </div>
  `;

  const t = {
    navy: '#000080',
    gray: '#c0c0c0',
    grid: '#000000',
    text: '#111111',
    ...theme,
  };

  const css = `
@page { size: Letter landscape; margin: 0.6in; }
html, body { margin: 0; padding: 0; }
body { color: ${t.text}; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.25; }

.page { width: 100%; }

.meta { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
.meta td { padding: 2px 6px; vertical-align: top; }
.meta .label { width: 130px; font-weight: 700; white-space: nowrap; }

.sheet {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1px solid ${t.grid};
}

.sheet col.c1 { width: 9.71%; }
.sheet col.c2 { width: 16.98%; }
.sheet col.c3 { width: 10.38%; }
.sheet col.c4 { width: 3.04%; }
.sheet col.c5 { width: 10.38%; }
.sheet col.c6 { width: 2.44%; }
.sheet col.c7 { width: 4.30%; }
.sheet col.c8 { width: 10.38%; }
.sheet col.c9 { width: 2.44%; }
.sheet col.c10 { width: 4.30%; }
.sheet col.c11 { width: 10.38%; }
.sheet col.c12 { width: 2.44%; }
.sheet col.c13 { width: 10.38%; }
.sheet col.c14 { width: 2.44%; }

.sheet th, .sheet td {
  border: 1px solid ${t.grid};
  padding: 4px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hdr th { background: ${t.navy}; color: #ffffff; font-weight: 700; text-align: left; }
.hdr .center { text-align: center; }
.hdr .right { text-align: right; }

.group-row td { background: ${t.navy}; color: #ffffff; font-weight: 700; }
.subgroup-row td { background: ${t.gray}; color: #000000; font-weight: 700; }

.num { text-align: right; font-variant-numeric: tabular-nums; }
.tick { text-align: center; padding: 4px 0; }

.total-row td { font-weight: 700; border-top: 1px solid ${t.grid}; border-bottom: 3px double ${t.grid}; }

.muted { color: #444444; }

.footer-note { margin-top: 10px; color: #444444; }
`;

  return { html, css, pdfOptions: { format: 'Letter', landscape: true } };
};

const renderDisbursementListingV1 = ({ data = {}, theme = {} }) => {
  const {
    companyName = '',
    periodLabel = '',
    reportTitle = 'January Disbursements Listing',
    rows = [],
    currency = 'USD',
  } = data || {};

  const formatCheckNumber = (value) => {
    const trimmed = String(value || '').trim();
    return trimmed ? trimmed : '-';
  };

  const rowHtml = (rows || [])
    .map((row) => {
      return `
        <tr>
          <td>${escapeHtml(row.paymentDate || row.date)}</td>
          <td>${escapeHtml(formatCheckNumber(row.checkNumber))}</td>
          <td>${escapeHtml(row.paymentId)}</td>
          <td>${escapeHtml(row.payee)}</td>
          <td>${escapeHtml(row.paymentType || row.type || 'Check')}</td>
          <td class="num">${escapeHtml(money(row.amount, currency))}</td>
        </tr>`;
    })
    .join('');

  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const t = {
    ink: '#111',
    grid: '#b6b6b6',
    headerBg: '#111827',
    headerInk: '#ffffff',
    ...theme,
  };

  const html = `
    <div class="page">
      <div class="header">
        <div class="company">${escapeHtml(companyName)}</div>
        <div class="title">${escapeHtml(reportTitle)}</div>
        <div class="subtitle">${escapeHtml(periodLabel)}</div>
      </div>

      <table class="listingTable" role="table" aria-label="January disbursements listing">
        <colgroup>
          <col class="col-date" />
          <col class="col-check" />
          <col class="col-payment" />
          <col class="col-payee" />
          <col class="col-type" />
          <col class="col-amount" />
        </colgroup>
        <thead>
          <tr>
            <th>Date</th>
            <th>Check #</th>
            <th>Payment ID</th>
            <th>Payee</th>
            <th>Type</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5" class="totalLabel">Total</td>
            <td class="num">${escapeHtml(money(total, currency))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  const css = `
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
.listingTable .col-check { width: 12%; }
.listingTable .col-payment { width: 12%; }
.listingTable .col-payee { width: 32%; }
.listingTable .col-type { width: 12%; }
.listingTable .col-amount { width: 18%; }

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

  return { html, css, pdfOptions: { format: 'Letter' } };
};

const renderRemittanceBundleV1 = ({ data = {}, theme = {} }) => {
  const { companyName = '', vendor = '', paymentId = '', paymentDate = '', invoices = [], currency = 'USD' } =
    data || {};

  const rowHtml = (invoices || [])
    .map((row) => {
      return `
        <tr>
          <td>${escapeHtml(row.invoiceNumber)}</td>
          <td>${escapeHtml(row.invoiceDate)}</td>
          <td>${escapeHtml(row.serviceDate)}</td>
          <td class="num">${escapeHtml(money(row.amount, currency))}</td>
          <td>${row.isRecorded ? 'Yes' : 'No'}</td>
        </tr>`;
    })
    .join('');

  const total = invoices.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const t = {
    ink: '#111',
    grid: '#b6b6b6',
    headerBg: '#0f172a',
    headerInk: '#ffffff',
    ...theme,
  };

  const html = `
    <div class="page">
      <div class="header">
        <div class="company">${escapeHtml(companyName)}</div>
        <div class="title">Remittance Advice</div>
        <div class="subtitle">Payment ${escapeHtml(paymentId)} - ${escapeHtml(paymentDate)}</div>
      </div>

      <div class="meta">
        <div class="metaRow">
          <span class="label">Payee</span>
          <span class="value">${escapeHtml(vendor)}</span>
        </div>
        <div class="metaRow">
          <span class="label">Invoice count</span>
          <span class="value">${escapeHtml(invoices.length)}</span>
        </div>
      </div>

      <table class="bundleTable" role="table" aria-label="Invoice bundle listing">
        <colgroup>
          <col class="col-invoice" />
          <col class="col-inv-date" />
          <col class="col-service" />
          <col class="col-amount" />
          <col class="col-recorded" />
        </colgroup>
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Invoice Date</th>
            <th>Service Date</th>
            <th class="num">Amount</th>
            <th>In AP Aging</th>
          </tr>
        </thead>
        <tbody>
          ${rowHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" class="totalLabel">Total Paid</td>
            <td class="num">${escapeHtml(money(total, currency))}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  const css = `
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

  return { html, css, pdfOptions: { format: 'Letter' } };
};

const renderAccrualEstimateV1 = ({ data = {}, theme = {} }) => {
  const {
    companyName = '',
    vendor = '',
    paymentId = '',
    periodEnding = '',
    memoDate = '',
    estimateAmount = 0,
    settlementTotal = 0,
    note = '',
    currency = 'USD',
  } = data || {};
  const variance = Number(settlementTotal || 0) - Number(estimateAmount || 0);

  const t = {
    ink: '#111',
    grid: '#b6b6b6',
    headerBg: '#111827',
    headerInk: '#ffffff',
    ...theme,
  };

  const html = `
    <div class="page">
      <div class="header">
        <div class="company">${escapeHtml(companyName)}</div>
        <div class="title">Accrual Estimate Memo</div>
        <div class="subtitle">Period ending ${escapeHtml(periodEnding)}</div>
      </div>

      <div class="meta">
        <div class="metaRow">
          <span class="label">Memo Date</span>
          <span class="value">${escapeHtml(memoDate)}</span>
        </div>
        <div class="metaRow">
          <span class="label">Vendor</span>
          <span class="value">${escapeHtml(vendor)}</span>
        </div>
        <div class="metaRow">
          <span class="label">Related Payment</span>
          <span class="value">${escapeHtml(paymentId)}</span>
        </div>
      </div>

      <table class="summaryTable" role="table" aria-label="Accrual estimate summary">
        <tbody>
          <tr>
            <td class="label">Year-end estimate</td>
            <td class="num">${escapeHtml(money(estimateAmount, currency))}</td>
          </tr>
          <tr>
            <td class="label">Later invoices settled</td>
            <td class="num">${escapeHtml(money(settlementTotal, currency))}</td>
          </tr>
          <tr>
            <td class="label">Variance</td>
            <td class="num">${escapeHtml(money(variance, currency))}</td>
          </tr>
        </tbody>
      </table>

      <div class="note">
        <div class="noteTitle">Notes</div>
        <div class="noteBody">${
          escapeHtml(note) || 'Estimate recorded at year-end; settle when invoices arrive.'
        }</div>
      </div>
    </div>
  `;

  const css = `
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

  return { html, css, pdfOptions: { format: 'Letter' } };
};

const renderBankStatementV1 = ({ data = {}, theme = {}, layout = {} }) => {
  const resolvedLayout =
    layout && Object.keys(layout).length ? layout : data?.layout && typeof data.layout === 'object' ? data.layout : {};
  const {
    bankName = 'Bank Statement',
    bankLogoUrl = '',
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
    checkPages = [],
    canceledCheckPages = [],
    canceledChecks = [],
  } = data || {};

  const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  let runningBalance = Number(openingBalance || 0);
  const statementRows = (rows || []).map((row) => {
    const amount = Number(row.amount || 0);
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
    { debits: 0, credits: 0 }
  );

  const endingBalance =
    statementRows.length > 0 ? statementRows[statementRows.length - 1].balance : Number(openingBalance || 0);

  const debitRows = statementRows.filter((row) => row.debit);
  const creditRows = statementRows.filter((row) => row.credit);

  const showDebits = resolvedLayout.showDebits !== false;
  const showCredits = resolvedLayout.showCredits !== false;
  const debitsTitle = resolvedLayout.debitsTitle || 'DEBITS';
  const creditsTitle = resolvedLayout.creditsTitle || 'CREDITS';
  const txGridClass = 'txGrid';
  const showFooter = footerNote || pageNumber || pageCount;

  const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const formatCheckAmount = (value) => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string') return value;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return String(value);
    return parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const buildCheckData = (chk = {}) => {
    const payerName = chk?.payer?.name || chk?.payerName || accountName || '';
    const payerAddress =
      chk?.payer?.addressLine ||
      chk?.payer?.address_line ||
      chk?.payerAddressLine ||
      accountAddressLine1 ||
      '';
    const amountNumeric = formatCheckAmount(
      chk?.amountNumeric ?? chk?.amount_numeric ?? chk?.amount ?? chk?.checkAmount
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

  const renderCheckSlotHtml = (chk = {}) => `
    <div class="checkScale">
      ${renderCheckBodyHtml({ data: buildCheckData(chk) })}
    </div>
  `;

  const inferChecksFromRows = () => {
    const candidates = statementRows
      .filter((r) => Number(r.debit) > 0)
      .map((r) => {
        const rawDesc = String(r.description || '');
        let checkNumber = r.checkNumber;
        let payee = r.payee;
        const m = rawDesc.match(/^\s*Check\s+(\d{3,})\s*(.*)$/i);
        if (!checkNumber && m) checkNumber = m[1];
        if (!payee && m) payee = m[2] || '';
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

  let canceledPages =
    (Array.isArray(canceledCheckPages) && canceledCheckPages.length > 0
      ? canceledCheckPages
      : Array.isArray(checkPages) && checkPages.length > 0
        ? checkPages
        : []) || [];

  if (canceledPages.length === 0 && Array.isArray(canceledChecks) && canceledChecks.length > 0) {
    canceledPages = chunk(canceledChecks, 6).map((checks) => ({ checks }));
  }

  if (canceledPages.length === 0 && resolvedLayout.autoGenerateCanceledChecks !== false) {
    const inferred = inferChecksFromRows();
    if (inferred.length > 0) canceledPages = chunk(inferred, 6).map((checks) => ({ checks }));
  }

  const showCanceledPages = resolvedLayout.showCanceledChecks !== false && canceledPages.length > 0;
  const effectivePageCount = Math.max(
    Number(pageCount || 1),
    Number(pageNumber || 1) + (showCanceledPages ? canceledPages.length : 0)
  );

  const addressLines = [accountName, accountAddressLine1, accountAddressLine2, accountAddressLine3].filter(
    (line) => String(line || '').trim()
  );
  const addressHtml = addressLines.length
    ? `<div class="addr">${addressLines.map((line) => escapeHtml(line)).join('<br />')}</div>`
    : '';

  const bankLogoHtml = bankLogoUrl
    ? `<img src="${escapeHtml(bankLogoUrl)}" alt="${escapeHtml(bankName)}" />`
    : `<div class="bank-name">${escapeHtml(bankName)}</div>`;

  const debitRowsHtml =
    debitRows.length > 0
      ? debitRows
          .map(
            (row) => `
              <tr>
                <td class="date">${escapeHtml(row.date)}</td>
                <td class="amt num">${escapeHtml(money(row.debit, currency))}</td>
                <td class="desc">${escapeHtml(row.description)}</td>
              </tr>`
          )
          .join('')
      : `
            <tr>
              <td class="empty" colspan="3">No debits this period.</td>
            </tr>`;

  const creditRowsHtml =
    creditRows.length > 0
      ? creditRows
          .map(
            (row) => `
              <tr>
                <td class="date">${escapeHtml(row.date)}</td>
                <td class="amt num">${escapeHtml(money(row.credit, currency))}</td>
                <td class="desc">${escapeHtml(row.description)}</td>
              </tr>`
          )
          .join('')
      : `
            <tr>
              <td class="empty" colspan="3">No credits this period.</td>
            </tr>`;

  const creditsNoticeHtml = creditsContinuedNotice
    ? `<div class="continuedNote">${escapeHtml(creditsContinuedNotice)}</div>`
    : '';

  const footerHtml = showFooter
    ? `
        <div class="footer">
          <div class="note">${
            footerNote
              ? escapeHtml(footerNote)
              : `Ending balance: ${escapeHtml(money(endingBalance, currency))}`
          }</div>
          <div>Page ${escapeHtml(pageNumber)} of ${escapeHtml(effectivePageCount)}</div>
        </div>`
    : '';

  const canceledPagesHtml = showCanceledPages
    ? canceledPages
        .map((page, index) => {
          const checks = Array.isArray(page?.checks) ? page.checks : Array.isArray(page) ? page : [];
          const derivedPageNumber = Number(pageNumber || 1) + index + 1;
          const checksHtml = checks
            .map((chk) => {
              if (chk?.imageUrl) {
                return `
                  <div class="checkCard">
                    <img class="checkImg" src="${escapeHtml(chk.imageUrl)}" alt="Check ${escapeHtml(
                  chk?.checkNumber
                )}" />
                  </div>`;
              }
              if (chk?.payer || chk?.amountWords || chk?.amountNumeric || chk?.bank || chk?.micr) {
                return `<div class="checkCard">${renderCheckSlotHtml(chk)}</div>`;
              }
              return `
                <div class="checkCard">
                  <div class="checkPlaceholder">
                    <div><strong>Check</strong> ${escapeHtml(chk?.checkNumber)}</div>
                    <div>${escapeHtml(chk?.date || chk?.checkDate)}</div>
                    <div>${escapeHtml(money(chk?.amount || chk?.checkAmount || 0, currency))}</div>
                    <div>${escapeHtml(chk?.payee)}</div>
                  </div>
                </div>`;
            })
            .join('');

          return `
            <div class="page pageBreak">
              <div class="hdr">
                <div>
                  <div class="title">Canceled Checks</div>
                  <div class="sub"><span class="label">Account Number:</span> ${escapeHtml(
                    accountNumber
                  )}</div>
                  <div class="sub">${escapeHtml(periodLabel)}</div>
                  ${addressHtml}
                </div>
                <div class="logo">${bankLogoHtml}</div>
              </div>
              <div class="rule"></div>
              <div class="sectionTitle">CANCELED CHECK IMAGES</div>
              <div class="checksGrid" aria-label="Canceled check images">
                ${checksHtml}
              </div>
              <div class="footer">
                <div class="note">${
                  footerNote
                    ? escapeHtml(footerNote)
                    : `Ending balance: ${escapeHtml(money(endingBalance, currency))}`
                }</div>
                <div>Page ${escapeHtml(derivedPageNumber)} of ${escapeHtml(
            effectivePageCount
          )}</div>
              </div>
            </div>
          `;
        })
        .join('')
    : '';

  const html = `
    <div class="page">
      <div class="hdr">
        <div>
          <div class="title">Account Statement</div>
          <div class="sub"><span class="label">Account Number:</span> ${escapeHtml(accountNumber)}</div>
          <div class="sub">${escapeHtml(periodLabel)}</div>
          ${addressHtml}
        </div>
        <div class="logo">${bankLogoHtml}</div>
      </div>

      <div class="rule"></div>

      <div class="sectionTitle">ACCOUNT SUMMARY</div>
      <table class="summary" aria-label="Account summary">
        <thead>
          <tr>
            <th>Account Number</th>
            <th class="num">Beginning Balance</th>
            <th class="num">Total Debits</th>
            <th class="num">Total Credits</th>
            <th class="num">Ending Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(accountNumber)}</td>
            <td class="num">${escapeHtml(money(openingBalance, currency))}</td>
            <td class="num">${escapeHtml(money(totals.debits, currency))}</td>
            <td class="num">${escapeHtml(money(totals.credits, currency))}</td>
            <td class="num">${escapeHtml(money(endingBalance, currency))}</td>
          </tr>
        </tbody>
      </table>

      <div class="${txGridClass}">
        ${
          showDebits
            ? `
          <div class="txBlock">
            <h3>${escapeHtml(debitsTitle)}</h3>
            <table class="txTable" aria-label="Debits">
              <thead>
                <tr>
                  <th class="date">Date</th>
                  <th class="amt num">Amount</th>
                  <th class="desc">Description</th>
                </tr>
              </thead>
              <tbody>
                ${debitRowsHtml}
              </tbody>
            </table>
          </div>`
            : ''
        }
        ${
          showCredits
            ? `
          <div class="txBlock">
            <h3>${escapeHtml(creditsTitle)}</h3>
            <table class="txTable" aria-label="Credits">
              <thead>
                <tr>
                  <th class="date">Date</th>
                  <th class="amt num">Amount</th>
                  <th class="desc">Description</th>
                </tr>
              </thead>
              <tbody>
                ${creditRowsHtml}
              </tbody>
            </table>
            ${creditsNoticeHtml}
          </div>`
            : ''
        }
      </div>

      ${footerHtml}
    </div>
    ${canceledPagesHtml}
  `;

  const t = {
    ink: '#111',
    muted: '#666',
    grid: '#000',
    rule: '#111',
    ...theme,
  };

  const css = `
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
${renderCheckBodyCss({ theme })}
`;

  return { html, css, pdfOptions: { format: 'Letter' } };
};

const renderPayrollRegisterV1 = ({ data = {}, theme = {} }) => {
  const formatText = (value) =>
    escapeHtml(value === null || value === undefined ? '' : String(value));

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
    pageNumber || pageCount ? `Page ${formatText(pageNumber)} of ${formatText(pageCount)}` : '';

  const totalsRows = Array.isArray(totals)
    ? totals
        .map(
          (row) => `
        <tr>
          <td class="key"><span class="label">${formatText(row?.label)}</span></td>
          <td class="val">${formatText(row?.amount)}</td>
        </tr>`
        )
        .join('')
    : '';

  const totalHoursRow =
    totalHours !== null && totalHours !== undefined
      ? `
      <tr>
        <td class="key"><span class="label">Total Hours:</span> ${formatText(totalHours)}</td>
        <td class="val"></td>
      </tr>`
      : '';

  const totalEmployeesRow =
    totalEmployees !== null && totalEmployees !== undefined
      ? `
      <tr>
        <td class="key"><span class="label">Total Employees:</span> ${formatText(
          totalEmployees
        )}</td>
        <td class="val"></td>
      </tr>`
      : '';

  const footerHtml = footerNote
    ? `<div class="footerNote">${formatText(footerNote).replace(/\n/g, '<br />')}</div>`
    : '';

  const html = `
    <div class="page" role="document" aria-label="${formatText(reportTitle) || 'Payroll register'}">
      <div class="topbar">
        <div class="leftMeta">
          <div class="row">
            <div class="label">Pay Period:</div>
            <div class="value">${formatText(payPeriod)}</div>
          </div>
          ${
            reportScopeLabel
              ? `<div class="row">
            <div class="label"></div>
            <div class="value">${formatText(reportScopeLabel)}</div>
          </div>`
              : ''
          }
          <div class="row">
            <div class="label">Pay Date:</div>
            <div class="value">${formatText(payDate)}</div>
          </div>
          <div class="row">
            <div class="label">Company Code:</div>
            <div class="value">${formatText(companyCode)}</div>
          </div>
        </div>

        <div class="company">
          <div class="line1">${formatText(companyNameLine1)}</div>
          <div class="line2">${formatText(companyNameLine2)}</div>
        </div>

        <div class="rightMeta">
          <div class="row single">
            <div class="value">${pageLabel}</div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="title">${formatText(reportTitle)}</div>

      <div class="rule"></div>

      <table class="summary" aria-label="Payroll totals summary">
        <tbody>
          ${totalHoursRow}
          ${totalEmployeesRow}
          ${totalsRows}
        </tbody>
      </table>

      ${footerHtml}
    </div>
  `;

  const t = {
    ink: '#111',
    rule: '#000',
    ...theme,
  };

  const css = `
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

  return { html, css, pdfOptions: { format: 'Letter' } };
};

const TEMPLATE_REGISTRY = {
  'invoice.seed.alpha.v1': renderSeedAlphaInvoiceV1,
  'invoice.seed.beta.v1': renderSeedBetaInvoiceV1,
  'invoice.seed.gamma.v1': renderSeedGammaInvoiceV1,
  'refdoc.ap-aging.v1': renderApAgingSummaryV1,
  'refdoc.ap-leadsheet.v1': renderApLeadSheetV1,
  'refdoc.disbursement-listing.v1': renderDisbursementListingV1,
  'refdoc.bank-statement.v1': renderBankStatementV1,
  'refdoc.payroll-register.v1': renderPayrollRegisterV1,
  'refdoc.remittance-bundle.v1': renderRemittanceBundleV1,
  'refdoc.accrual-estimate.v1': renderAccrualEstimateV1,
  'refdoc.check-copy.v1': ({ data = {}, theme = {} } = {}) => ({
    html: renderCheckCopyV1({ data, theme }),
    css: renderCheckCopyV1Css({ theme }),
    pdfOptions: { format: 'Letter' },
  }),
};

const resolveTemplateIds = () => {
  const templateIdsPath = path.resolve(__dirname, './shared/pdfTemplateIds.json');
  if (!fs.existsSync(templateIdsPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(templateIdsPath, 'utf8'));
};

const registryIds = Object.keys(TEMPLATE_REGISTRY);
const templateIds = resolveTemplateIds();
if (templateIds) {
  const missing = templateIds.filter((id) => !TEMPLATE_REGISTRY[id]);
  const extras = registryIds.filter((id) => !templateIds.includes(id));
  if (missing.length || extras.length) {
    throw new Error(
      `Template registry mismatch. Missing: ${missing.join(', ') || 'none'}; Extra: ${
        extras.join(', ') || 'none'
      }.`
    );
  }
} else {
  console.warn(
    '[pdfTemplates] pdfTemplateIds.json not found; using registry defaults.'
  );
}

const getTemplateRenderer = (templateId) => {
  const renderer = TEMPLATE_REGISTRY[templateId];
  if (!renderer) {
    throw new Error(`Unknown templateId: ${templateId}`);
  }
  return renderer;
};

module.exports = {
  getTemplateRenderer,
};
