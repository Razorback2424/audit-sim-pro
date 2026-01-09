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

const renderPromotadorInvoiceV1 = ({ data = {}, theme = {}, layout = {} }) => {
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
    colDesc: '52%',
    colQty: '12%',
    colPrice: '18%',
    colTotal: '18%',
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
            <span class="mutedLabel">Date Shipped:</span> ${escapeHtml(shippingInfo.dateShipped)}<br />
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
              <td class="cPrice totalsLabel">TAX (${Math.round(taxRate * 100)}%)</td>
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

.items tfoot tr:first-child td { border-top: 2px solid ${t.ink}; }

.totalsLabel { text-align: left; font-weight: 500; white-space: normal; }
.totalsValue { font-weight: 500; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }

.totalsRow.grand .totalsLabel,
.totalsRow.grand .totalsValue {
  font-weight: 900;
  font-size: 28px;
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

const TEMPLATE_REGISTRY = {
  'invoice.promotador.v1': renderPromotadorInvoiceV1,
  'refdoc.ap-aging.v1': renderApAgingSummaryV1,
};

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
