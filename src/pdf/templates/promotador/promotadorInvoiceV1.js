import React from 'react';

const money = (value, currency = 'USD') =>
  Number(value || 0).toLocaleString('en-US', { style: 'currency', currency });

const safe = (value) => (value === null || value === undefined ? '' : String(value));

function computeTotals({ items = [], taxRate = 0, shipping = 0 }) {
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
    0
  );
  const tax = subtotal * Number(taxRate || 0);
  const ship = Number(shipping || 0);
  return { subtotal, tax, ship, grandTotal: subtotal + tax + ship };
}

const formatTaxPercent = (rate) => {
  const percent = Number(rate || 0) * 100;
  const rounded = Math.round(percent * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 0.005) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(2);
};

function PromotadorInvoice({ data }) {
  const {
    brandName = 'PROMOTADOR',
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

  return (
    <div className="page">
      <div className="top">
        <div className="brand">{safe(brandName)}</div>

        <div className="topRight">
          <div className="invoiceBox">
            <div className="invoiceNumber">{safe(invoiceNumber)}</div>
          </div>

          <div className="invoiceDate">
            <div className="labelStrong">Invoice Date:</div>
            <div className="valueLarge">{safe(invoiceDate)}</div>
          </div>
        </div>
      </div>

      <div className="mid">
        <div className="issued">
          <div className="labelStrong">Issued to:</div>
          <div className="blockText">
            {safe(issuedTo.name)}
            <br />
            {safe(issuedTo.line1)}
            <br />
            {safe(issuedTo.line2)}
          </div>
        </div>

        <div className="shipping">
          <div className="labelStrong">Shipping Info:</div>
          <div className="blockText">
            <span className="mutedLabel">
              {safe(shippingInfo.dateLabel || 'Date Shipped')}:
            </span>{' '}
            {safe(shippingInfo.dateValue || shippingInfo.dateShipped)}
            <br />
            <span className="mutedLabel">Shipping Terms:</span> {safe(shippingInfo.terms)}
          </div>
        </div>
      </div>

      <div className="itemsWrap">
        <table className="items" role="table" aria-label="Invoice items">
          <colgroup>
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className="cDesc">DESCRIPTION</th>
              <th className="cQty">QTY</th>
              <th className="cPrice">PRICE</th>
              <th className="cTotal">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const line = Number(item.qty || 0) * Number(item.unitPrice || 0);
              return (
                <tr key={index}>
                  <td className="cDesc">{safe(item.description)}</td>
                  <td className="cQty">{safe(item.qty)}</td>
                  <td className="cPrice">{money(item.unitPrice, currency)}</td>
                  <td className="cTotal">{money(line, currency)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="totalsRow">
              <td className="cDesc totalsSpacer" />
              <td className="cQty totalsSpacer" />
              <td className="cPrice totalsLabel">SUBTOTAL</td>
              <td className="cTotal totalsValue">{money(totals.subtotal, currency)}</td>
            </tr>
            <tr className="totalsRow">
              <td className="cDesc totalsSpacer" />
              <td className="cQty totalsSpacer" />
              <td className="cPrice totalsLabel">TAX ({formatTaxPercent(taxRate)}%)</td>
              <td className="cTotal totalsValue">{money(totals.tax, currency)}</td>
            </tr>
            <tr className="totalsRow">
              <td className="cDesc totalsSpacer" />
              <td className="cQty totalsSpacer" />
              <td className="cPrice totalsLabel">SHIPPING</td>
              <td className="cTotal totalsValue">{money(totals.ship, currency)}</td>
            </tr>
            <tr className="totalsRow grand">
              <td className="cDesc totalsSpacer" />
              <td className="cQty totalsSpacer" />
              <td className="cPrice totalsLabel">GRAND TOTAL</td>
              <td className="cTotal totalsValue">{money(totals.grandTotal, currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {showThankYou ? <div className="thankYou">{safe(thankYouText)}</div> : null}
    </div>
  );
}

export const promotadorInvoiceV1 = {
  id: 'invoice.promotador.v1',
  page: {
    pdfOptions: { format: 'Letter' },
  },
  Component: PromotadorInvoice,
  css: ({ theme, layout }) => {
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

    return `
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
  },
};
