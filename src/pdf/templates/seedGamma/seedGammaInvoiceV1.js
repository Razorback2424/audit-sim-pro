import React from 'react';

const money = (value, { minimumFractionDigits = 2, maximumFractionDigits = 2 } = {}) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits });

const safe = (value) => (value === null || value === undefined ? '' : String(value));

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

function SeedGammaInvoice({ data }) {
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

  return (
    <div className="page" role="document" aria-label={`Invoice ${safe(invoiceNumber)}`}>
      <div className="top">
        <div>
          <h1 className="brand">{safe(brandName)}</h1>
        </div>

        <div className="meta">
          <div>
            <span className="label">Invoice:</span>
            <span className="value">{safe(invoiceNumber)}</span>
          </div>
          <div>
            <span className="label">Invoice Date:</span>
            <span className="value">{safe(invoiceDate)}</span>
          </div>
          <div>
            <span className="label">Due Date:</span>
            <span className="value">{safe(resolvedDueDate)}</span>
          </div>
        </div>
      </div>

      <div className="rule" />

      <div className="mid">
        <div>
          <div className="section-title">Bill To:</div>
          <div className="billto">
            {issuedTo?.name ? <div className="name">{safe(issuedTo.name)}</div> : null}
            {issuedTo?.line1 ? <div>{safe(issuedTo.line1)}</div> : null}
            {issuedTo?.line2 ? <div>{safe(issuedTo.line2)}</div> : null}
            {issuedTo?.line3 ? <div>{safe(issuedTo.line3)}</div> : null}
          </div>
        </div>
        <div className="shipping">
          <div className="section-title">Shipping Terms:</div>
          <div className="shipping-value">{safe(shippingInfo.terms)}</div>
          <div className="section-title shipping-title">
            {safe(shippingInfo.dateLabel || 'Shipping Date')}:
          </div>
          <div className="shipping-value">
            {safe(shippingInfo.dateValue || shippingInfo.dateShipped)}
          </div>
        </div>
      </div>

      <table aria-label="Invoice line items">
        <thead>
          <tr>
            <th className="desc">DESCRIPTION</th>
            <th className="price num">PRICE</th>
            <th className="sub num">SUBTOTAL</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const lineTotal = Number(item.qty || 0) * Number(item.unitPrice || 0);
            return (
              <tr key={index}>
                <td className="desc">
                  <span className="qty-inline">{safe(item.qty)}</span>
                  <span className="desc-text">{safe(item.description)}</span>
                </td>
                <td className="price num">
                  <span className="dollar">$</span>
                  {money(item.unitPrice, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </td>
                <td className="sub num">
                  <span className="dollar">$</span>
                  {money(lineTotal)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="totals" aria-label="Invoice totals">
        <div className="totals-row">
          <div className="k">Subtotal:</div>
          <div className="v">
            <span className="dollar">$</span>
            {money(totals.subtotal)}
          </div>
        </div>
        <div className="totals-row">
          <div className="k">Shipping:</div>
          <div className="v">
            <span className="dollar">$</span>
            {money(totals.ship)}
          </div>
        </div>
        <div className="totals-row">
          <div className="k">Sales Tax ({formatTaxPercent(taxRate)}%):</div>
          <div className="v">
            <span className="dollar">$</span>
            {money(totals.tax)}
          </div>
        </div>
        <div className="totals-row grand">
          <div className="k">Grand Total:</div>
          <div className="v">
            <span className="dollar">$</span>
            {money(totals.grandTotal)}
          </div>
        </div>
      </div>
    </div>
  );
}

export const seedGammaInvoiceV1 = {
  id: 'invoice.seed.gamma.v1',
  page: {
    pdfOptions: { format: 'Letter' },
  },
  Component: SeedGammaInvoice,
  css: ({ theme, layout }) => {
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

    return `
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
.totals-row .dollar{ padding-right: 6px; }
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
  },
};
