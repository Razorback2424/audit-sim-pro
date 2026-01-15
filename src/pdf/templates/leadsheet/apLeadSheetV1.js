import React from 'react';

const safe = (value) => (value === null || value === undefined ? '' : String(value));

const pick = (data, keys, fallback = '') => {
  for (const key of keys) {
    if (data && Object.prototype.hasOwnProperty.call(data, key)) {
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

const money = (value, currency = 'USD') =>
  Number(value || 0).toLocaleString('en-US', { style: 'currency', currency });

const formatMoneyValue = (value, currency) => {
  const parsed = parseAmount(value);
  if (parsed === null) return safe(value);
  return money(parsed, currency);
};

const sumLines = (lines, keys) =>
  lines.reduce((sum, line) => {
    const value = pick(line, keys, null);
    const parsed = parseAmount(value);
    return sum + (parsed === null ? 0 : parsed);
  }, 0);

function ApLeadSheetV1({ data }) {
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const currency = pick(data, ['currency', 'curr'], 'USD');
  const totals = data?.totals || data?.total || {};

  const workpaperTitle = pick(data, ['workpaperTitle', 'workpaper_title'], '');
  const clientName = pick(data, ['clientName', 'client_name'], '');
  const periodEnding = pick(data, ['periodEnding', 'period_ending'], '');
  const trialBalanceName = pick(data, ['trialBalanceName', 'trial_balance_name'], '');
  const priorDate = pick(data, ['priorDate', 'prior_date'], '');
  const currentDate = pick(data, ['currentDate', 'current_date'], '');
  const groupCode = pick(data, ['groupCode', 'group_code'], '');
  const groupName = pick(data, ['groupName', 'group_name'], '');
  const subgroupName = pick(data, ['subgroupName', 'subgroup_name'], '');
  const footerNote = pick(data, ['footerNote', 'footer_note'], '');

  const totalPrior =
    parseAmount(pick(totals, ['priorAmount', 'prior_amount'], null)) ??
    sumLines(lines, ['priorAmount', 'prior_amount']);
  const totalUnadj =
    parseAmount(pick(totals, ['unadjAmount', 'unadj_amount'], null)) ??
    sumLines(lines, ['unadjAmount', 'unadj_amount']);
  const totalAje =
    parseAmount(pick(totals, ['ajeAmount', 'aje_amount'], null)) ??
    sumLines(lines, ['ajeAmount', 'aje_amount']);
  const totalRje =
    parseAmount(pick(totals, ['rjeAmount', 'rje_amount'], null)) ??
    sumLines(lines, ['rjeAmount', 'rje_amount']);
  const totalFinal =
    parseAmount(pick(totals, ['finalAmount', 'final_amount'], null)) ??
    sumLines(lines, ['finalAmount', 'final_amount']);

  return (
    <div className="page">
      <table className="meta" aria-label="Engagement metadata">
        <tbody>
          <tr>
            <td className="label">Client:</td>
            <td>{safe(clientName)}</td>
          </tr>
          <tr>
            <td className="label">Period Ending:</td>
            <td>{safe(periodEnding)}</td>
          </tr>
          <tr>
            <td className="label">Trial Balance:</td>
            <td>{safe(trialBalanceName)}</td>
          </tr>
          <tr>
            <td className="label">Workpaper:</td>
            <td>{safe(workpaperTitle)}</td>
          </tr>
        </tbody>
      </table>

      <table className="sheet" aria-label="Accounts payable leadsheet">
        <colgroup>
          <col className="c1" />
          <col className="c2" />
          <col className="c3" />
          <col className="c4" />
          <col className="c5" />
          <col className="c6" />
          <col className="c7" />
          <col className="c8" />
          <col className="c9" />
          <col className="c10" />
          <col className="c11" />
          <col className="c12" />
          <col className="c13" />
          <col className="c14" />
        </colgroup>
        <thead>
          <tr className="hdr">
            <th rowSpan={2}>Account</th>
            <th rowSpan={2}>Description</th>
            <th colSpan={2} className="center">
              1st PP-FINAL
            </th>
            <th colSpan={2} className="center">
              UNADJ
            </th>
            <th rowSpan={2} className="center">
              JE Ref #
            </th>
            <th colSpan={2} className="center">
              AJE
            </th>
            <th rowSpan={2} className="center">
              JE Ref #
            </th>
            <th colSpan={2} className="center">
              RJE
            </th>
            <th colSpan={2} className="center">
              FINAL
            </th>
          </tr>
          <tr className="hdr">
            <th className="center">{safe(priorDate)}</th>
            <th className="center muted" />
            <th className="center">{safe(currentDate)}</th>
            <th className="center muted" />
            <th className="center">{safe(currentDate)}</th>
            <th className="center muted" />
            <th className="center">{safe(currentDate)}</th>
            <th className="center muted" />
            <th className="center">{safe(currentDate)}</th>
            <th className="center muted" />
          </tr>
        </thead>
        <tbody>
          <tr className="group-row">
            <td colSpan={14}>
              Group : {safe(groupCode)}&nbsp;&nbsp;&nbsp;{safe(groupName)}
            </td>
          </tr>
          <tr className="subgroup-row">
            <td colSpan={14}>Subgroup : {safe(subgroupName)}</td>
          </tr>
          {lines.map((line, index) => (
            <tr key={index}>
              <td>{safe(pick(line, ['account', 'acct', 'accountNumber']))}</td>
              <td>{safe(pick(line, ['description', 'desc']))}</td>
              <td className="num">{formatMoneyValue(pick(line, ['priorAmount', 'prior_amount']), currency)}</td>
              <td className="tick">{safe(pick(line, ['priorTick', 'prior_tick']))}</td>
              <td className="num">{formatMoneyValue(pick(line, ['unadjAmount', 'unadj_amount']), currency)}</td>
              <td className="tick">{safe(pick(line, ['unadjTick', 'unadj_tick']))}</td>
              <td className="tick">{safe(pick(line, ['ajeRef', 'aje_ref']))}</td>
              <td className="num">{formatMoneyValue(pick(line, ['ajeAmount', 'aje_amount']), currency)}</td>
              <td className="tick">{safe(pick(line, ['ajeTick', 'aje_tick']))}</td>
              <td className="tick">{safe(pick(line, ['rjeRef', 'rje_ref']))}</td>
              <td className="num">{formatMoneyValue(pick(line, ['rjeAmount', 'rje_amount']), currency)}</td>
              <td className="tick">{safe(pick(line, ['rjeTick', 'rje_tick']))}</td>
              <td className="num">{formatMoneyValue(pick(line, ['finalAmount', 'final_amount']), currency)}</td>
              <td className="tick">{safe(pick(line, ['finalTick', 'final_tick']))}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td>Total {safe(groupCode)}</td>
            <td>{safe(groupName)}</td>
            <td className="num">{money(totalPrior, currency)}</td>
            <td className="tick" />
            <td className="num">{money(totalUnadj, currency)}</td>
            <td className="tick" />
            <td className="tick" />
            <td className="num">{money(totalAje, currency)}</td>
            <td className="tick" />
            <td className="tick" />
            <td className="num">{money(totalRje, currency)}</td>
            <td className="tick" />
            <td className="num">{money(totalFinal, currency)}</td>
            <td className="tick" />
          </tr>
        </tbody>
      </table>

      {footerNote ? <div className="footer-note">{safe(footerNote)}</div> : null}
    </div>
  );
}

export const apLeadSheetV1 = {
  id: 'refdoc.ap-leadsheet.v1',
  page: {
    pdfOptions: { format: 'Letter', landscape: true },
  },
  Component: ApLeadSheetV1,
  css: ({ theme }) => {
    const t = {
      navy: '#000080',
      gray: '#c0c0c0',
      grid: '#000000',
      text: '#111111',
      ...theme,
    };

    return `
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
  },
};
