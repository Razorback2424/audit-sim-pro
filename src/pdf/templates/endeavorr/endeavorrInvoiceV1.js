import React from 'react';

const money = (value, { minimumFractionDigits = 2, maximumFractionDigits = 2 } = {}) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits });

const safe = (value) => (value === null || value === undefined ? '' : String(value));

const renderMultiline = (value) =>
  safe(value)
    .split('\n')
    .map((line, index) => (
      <React.Fragment key={index}>
        {index > 0 ? <br /> : null}
        {line}
      </React.Fragment>
    ));

const renderIssuedTo = (issuedTo) => {
  if (!issuedTo || typeof issuedTo !== 'object') return null;
  const lines = [issuedTo.name, issuedTo.line1, issuedTo.line2, issuedTo.line3].filter(Boolean);
  return lines.map((line, index) =>
    index === 0 ? (
      line
    ) : (
      <React.Fragment key={index}>
        <br />
        {line}
      </React.Fragment>
    )
  );
};

const computeTotals = ({ items = [], taxRate = 0, shipping = 0 }) => {
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
    0
  );
  const tax = subtotal * Number(taxRate || 0);
  const ship = Number(shipping || 0);
  return { subtotal, tax, ship, grandTotal: subtotal + tax + ship };
};

const formatTaxPercent = (rate) => {
  const percent = Number(rate || 0) * 100;
  const rounded = Math.round(percent * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 0.005) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(2);
};

function EndeavorrInvoice({ data }) {
  const {
    brandName = 'ENDEAVORR',
    invoiceNumber = '',
    invoiceDate = '',
    issuedTo = {},
    shippingInfo = {},
    items = [],
    taxRate = 0.05,
    shipping = 0,
  } = data || {};

  const totals = computeTotals({ items, taxRate, shipping });
  const itemCount = Math.max(1, Array.isArray(items) ? items.length : 0);
  const spacerHeight = Math.max(0, 3.85 - Math.max(0, itemCount - 2) * 1.18);
  const brandText = safe(brandName);
  const brandLength = brandText.replace(/\s+/g, '').length;
  const brandClass =
    brandLength > 20 ? 'brand tiny' : brandLength > 14 ? 'brand small' : 'brand';

  return (
    <div className="page" role="document" aria-label={`Invoice ${safe(invoiceNumber)}`}>
      <div className="invoice-no">
        <div className="label">Invoice No:</div>
        <div className="value">#{safe(invoiceNumber)}</div>
      </div>

      <div className="content">
        <div className="brand-row">
          <div className={brandClass}>{brandText}</div>
          <div className="brand-rule" />
        </div>

        <div className="details">
          <div>
            <div className="detail-label">Invoice Date:</div>
            <div className="detail-value">{safe(invoiceDate)}</div>

            <div className="detail-label">
              {safe(shippingInfo.dateLabel || 'Date Shipped')}:
            </div>
            <div className="detail-value">
              {safe(shippingInfo.dateValue || shippingInfo.dateShipped)}
            </div>

            <div className="detail-label">FOB:</div>
            <div className="detail-value">{safe(shippingInfo.terms || 'Shipping Point')}</div>
          </div>

          <div>
            <div className="detail-label">Issued to:</div>
            <div className="detail-value">{renderIssuedTo(issuedTo)}</div>
          </div>
        </div>

        <div className="items-wrap">
          <table className="items" aria-label="Invoice line items">
            <thead>
              <tr>
                <th className="c-no">NO</th>
                <th className="c-desc">DESCRIPTION</th>
                <th className="c-qty">QTY</th>
                <th className="c-price">PRICE</th>
                <th className="c-sub">SUBTOTAL</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const lineTotal = Number(item.qty || 0) * Number(item.unitPrice || 0);
                return (
                  <tr key={index}>
                    <td className="mono cell-center">{index + 1}</td>
                    <td className="mono desc">{renderMultiline(item.description)}</td>
                    <td className="mono cell-center">{safe(item.qty)}</td>
                    <td className="mono money">
                      <span className="dollar">$</span>
                      {money(item.unitPrice, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </td>
                    <td className="mono money">
                      <span className="dollar">$</span>
                      {money(lineTotal)}
                    </td>
                  </tr>
                );
              })}
              <tr className="spacer" style={{ '--spacer-height': `${spacerHeight}in` }}>
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
            </tbody>
          </table>
          <div className="totals-block">
            <div className="totals-row">
              <div className="label">Subtotal</div>
              <div className="value">
                <span className="dollar">$</span>
                {money(totals.subtotal)}
              </div>
            </div>
            <div className="totals-row">
              <div className="label">Shipping and Handling</div>
              <div className="value">
                <span className="dollar">$</span>
                {money(totals.ship)}
              </div>
            </div>
            <div className="totals-row">
              <div className="label">Sales Tax ({formatTaxPercent(taxRate)}%)</div>
              <div className="value">
                <span className="dollar">$</span>
                {money(totals.tax)}
              </div>
            </div>
            <div className="totals-row grand">
              <div className="label">Grand Total</div>
              <div className="value">
                <span className="dollar">$</span>
                {money(totals.grandTotal)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const endeavorrInvoiceV1 = {
  id: 'invoice.endeavorr.v1',
  page: {
    pdfOptions: { format: 'Letter' },
  },
  Component: EndeavorrInvoice,
  css: ({ theme, layout }) => {
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
      pagePadding: '0.25in',
      contentSide: '0.85in',
      contentTop: '1.15in',
      contentBottom: '0.85in',
      ...layout,
    };

    return `
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
  },
};
