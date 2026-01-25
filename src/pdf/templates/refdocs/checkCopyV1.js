import React from 'react';

const safe = (value) => (value === null || value === undefined ? '' : String(value));

export function CheckBody({ data }) {
  const {
    payer = {},
    checkNumber,
    date,
    payee,
    amountNumeric,
    amountWords,
    bank = {},
    memo,
    signatureName,
    micr = {},
  } = data || {};

  return (
    <div className="check" aria-label="Check image template">
      <div className="payer-name">{safe(payer.name)}</div>
      <div className="payer-addr">{safe(payer.addressLine)}</div>

      <div className="check-no">{safe(checkNumber)}</div>

      <div className="date-label">Date:</div>
      <div className="date-value hand">{safe(date)}</div>

      <div className="paymentBlock">
        <div className="payto-row">
          <div className="payto-label">Pay to the Order of:</div>
          <div className="payto-field">
            <span className="payto-value hand">{safe(payee)}</span>
          </div>
        </div>
        <div className="words-row">
          <div className="words-field">
            <span className="words-text hand">{safe(amountWords)}</span>
          </div>
          <div className="dollars-label">Dollars</div>
        </div>
      </div>

      <div className="amount-dollar">$</div>
      <div className="amount-box">
        <div className="amount-value hand">{safe(amountNumeric)}</div>
      </div>

      <div className="bankmark">
        <div className="bankmark-box">
          {bank.logoUrl ? <img src={bank.logoUrl} alt={safe(bank.name)} /> : null}
        </div>
      </div>
      <div className="bankname-block">
        <div className="bankname">
          {safe(bank.name)}
          {bank.subName ? <span className="sub">{safe(bank.subName)}</span> : null}
        </div>
      </div>

      <div className="memo-label">Memo:</div>
      <div className="memo-line" />
      <div className="memo-value">{safe(memo)}</div>

      <div className="sig-line" />
      <div className="sig-value hand">{safe(signatureName)}</div>

      <div className="micr">
        {safe(micr.routingSymbol)}
        {safe(micr.routingNumber)}
        {safe(micr.routingSymbol)} {safe(micr.accountSymbol)}
        {safe(micr.accountNumber)}
        {safe(micr.accountSymbol)} {safe(micr.checkNumber)}
      </div>
    </div>
  );
}

function CheckCopy({ data }) {
  return (
    <div className="page">
      <div className="checkFrame">
        <div className="checkScale">
          <CheckBody data={data} />
        </div>
      </div>
    </div>
  );
}

export const checkCopyBodyCss = ({ theme }) => {
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

  /* Legacy vars kept for compatibility (no longer used for placement) */
  --y-payee: calc(var(--H) * 0.26);
  --y-payee-rule: calc(var(--H) * 0.28);
  --y-amount-top: calc(var(--H) * 0.27);
  --y-amount-bottom: calc(var(--H) * 0.37);
  --y-words: calc(var(--H) * 0.35);
  --y-words-rule: calc(var(--H) * 0.37);

  /* Mid-band branding placement (also height-anchored) */
  --y-brand-top: calc(var(--H) * 0.52);
  --y-logo: calc(var(--H) * 0.56);

  /* Footer */
  --y-memo: calc(var(--H) * 0.78);
  --y-memo-rule: calc(var(--H) * 0.80);
  --y-micr: calc(var(--H) * 0.90);

  /* Payment block moved down to reduce top compression */
  --payment-top: calc(var(--H) * 0.28);
  /* Payment block sizing (required by .paymentBlock, .amount-box, .amount-dollar) */
  --payee-row-h: calc(var(--H) * 0.08);
  --words-row-h: calc(var(--H) * 0.07);
  --payment-row-gap: calc(var(--H) * 0.02);
  --amount-top: calc(var(--payment-top) + var(--payee-row-h) - (var(--L) * 0.3));
  --amount-bottom: calc(
    var(--payment-top) + var(--payee-row-h) + var(--payment-row-gap) + var(--words-row-h)
  );
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

export const checkCopyV1 = {
  id: 'refdoc.check-copy.v1',
  page: {
    pdfOptions: { format: 'Letter' },
  },
  Component: CheckCopy,
  css: ({ theme }) => {
    return `
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
${checkCopyBodyCss({ theme })}
`;
  },
};
