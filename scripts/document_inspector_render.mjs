import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../functions/node_modules/playwright-core');
const chromiumBinary = require('../functions/node_modules/@sparticuz/chromium');
const { getTemplateRenderer } = require('../functions/pdfTemplates');

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const variant = process.env.DOCUMENT_INSPECTOR_VARIANT || 'default';
const artifactsRoot = path.join(
  repoRoot,
  'artifacts',
  variant === 'stress' ? 'document-inspector-stress' : 'document-inspector'
);
const templateIds = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'functions', 'shared', 'pdfTemplateIds.json'), 'utf8')
);

function extractDebugDataBuilder() {
  const source = fs.readFileSync(path.join(repoRoot, 'functions', 'src', 'cases', 'index.js'), 'utf8');
  const match = source.match(
    /const buildDebugDataForTemplate = \(templateId\) => \{[\s\S]*?\n\};\n\nconst normalizeStoragePath/
  );
  if (!match) {
    throw new Error('Unable to locate buildDebugDataForTemplate in functions/src/cases/index.js');
  }
  const fnSource = match[0].replace(/\n\nconst normalizeStoragePath$/, '\n');
  const script = new vm.Script(`${fnSource}\nbuildDebugDataForTemplate;`);
  const sandbox = {};
  return script.runInNewContext(sandbox);
}

const buildDebugDataForTemplate = extractDebugDataBuilder();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function repeatRows(rows = [], target = 8, mapFn = (row) => row) {
  const base = Array.isArray(rows) ? rows : [];
  if (base.length === 0) return [];
  const out = [];
  for (let i = 0; i < target; i += 1) {
    out.push(mapFn(clone(base[i % base.length]), i));
  }
  return out;
}

function applyStressVariant(templateId, input) {
  if (variant !== 'stress') return input;
  const data = clone(input) || {};
  const longVendor = 'Northwest Industrial Supplies and Maintenance Services Group, LLC';
  const longClient = 'Team Up Promotional Products and Corporate Branding Solutions, LLC';

  switch (templateId) {
    case 'invoice.seed.alpha.v1':
    case 'invoice.seed.beta.v1':
    case 'invoice.seed.gamma.v1':
      data.brandName = `${data.brandName || 'SEED'} EXTENDED`;
      data.invoiceNumber = 'INV-VERY-LONG-REFERENCE-2048-A';
      data.issuedTo = {
        ...(data.issuedTo || {}),
        name: longClient,
        line1: '2150 Riverfront Avenue, Building 4, Accounts Payable Department',
        line2: 'Denver, CO 80202-4567, United States',
        line3: 'Attention: Invoice Processing and Shared Services',
      };
      data.shippingInfo = {
        ...(data.shippingInfo || {}),
        terms: 'FOB Destination - Freight Included - Carrier Routing per Master Vendor Schedule',
      };
      data.items = repeatRows(data.items, 9, (row, i) => ({
        ...row,
        qty: (i % 5) + 1,
        description: `${row?.description || 'Service line item'} - phase ${i + 1} - extended description for wrapping/overflow validation`,
        unitPrice: Number(row?.unitPrice || 100) + i * 17.25,
      }));
      return data;
    case 'refdoc.ap-aging.v1':
      data.companyName = longClient;
      data.rows = repeatRows(data.rows, 10, (row, i) => ({
        ...row,
        vendor: `${longVendor} ${i + 1}`,
        invoiceNumber: `INV-${String(i + 1).padStart(4, '0')}-EXTENDED-REF`,
      }));
      return data;
    case 'refdoc.ap-leadsheet.v1':
      data.clientName = longClient;
      data.subgroupName = 'Trade Payables and Accrued Vendor Liabilities - Domestic and International';
      data.lines = repeatRows(data.lines, 8, (row, i) => ({
        ...row,
        account: `21${String(i).padStart(2, '0')}`,
        description: `Accounts Payable - Trade and Services - Region ${i + 1} - Extended description`,
        ajeRef: `AJE-REF-${i + 1}-LONG-CODE`,
        rjeRef: `RJE-REF-${i + 1}-LONG-CODE`,
      }));
      return data;
    case 'refdoc.disbursement-listing.v1':
      data.companyName = longClient;
      data.rows = repeatRows(data.rows, 14, (row, i) => ({
        ...row,
        paymentId: `P-${10451 + i}-VERY-LONG`,
        payee: `${longVendor} ${i + 1}`,
        paymentType: i % 2 ? 'ACH Vendor Settlement' : 'Check',
        amount: Number(row?.amount || 1000) + i * 111.11,
      }));
      return data;
    case 'refdoc.bank-statement.v1':
      data.bankName = 'Cascade National Bank and Trust';
      data.accountName = longClient;
      data.accountAddressLine1 = '2150 Riverfront Avenue, Building 4, Accounts Payable Department';
      data.accountAddressLine2 = 'Denver, CO 80202-4567';
      data.accountAddressLine3 = 'Attn: Treasury Operations / Cash Management';
      data.rows = repeatRows(data.rows, 18, (row, i) => ({
        ...row,
        date: `20X3-01-${String((i % 28) + 1).padStart(2, '0')}`,
        description: `${row?.description || 'ACH'} - extended narrative detail ${i + 1} for layout stress`,
        amount: i % 3 === 0 ? 1500 + i * 10 : -(900 + i * 42.55),
      }));
      data.canceledChecks = repeatRows(data.canceledChecks, 4, (row, i) => ({
        ...row,
        payee: `${longVendor} ${i + 1}`,
        memo: 'Payroll and benefits settlement',
      }));
      return data;
    case 'refdoc.fa-policy.v1':
      data.clientName = 'Clearwater Outfitters and Distribution Holdings, Inc.';
      data.assetClasses = repeatRows(data.assetClasses, 8, (row, i) => ({
        ...row,
        className: `${row?.className || 'Asset'} - Extended Naming Group ${i + 1}`,
      }));
      return data;
    case 'refdoc.ppe-rollforward.v1':
      data.clientName = 'Clearwater Outfitters and Distribution Holdings, Inc.';
      data.rows = repeatRows(data.rows, 10, (row, i) => ({
        ...row,
        className: `${row?.className || 'Asset'} - Segment ${i + 1}`,
        beginningBalance: 100000 + i * 10000,
        additions: 25000 + i * 1000,
        disposals: i % 4 === 0 ? 5000 : 0,
        endingBalance: 120000 + i * 11000,
      }));
      return data;
    case 'refdoc.fa-listing.v1':
      data.clientName = 'Clearwater Outfitters and Distribution Holdings, Inc.';
      data.rows = repeatRows(data.rows, 12, (row, i) => ({
        ...row,
        assetId: `FA-${String(i + 1).padStart(4, '0')}`,
        description: `${row?.description || 'Fixed asset'} - extended description for formatting validation ${i + 1}`,
        vendorName: `${longVendor} ${i + 1}`,
        invoiceNumber: `INV-${3000 + i}-LONG`,
      }));
      return data;
    case 'refdoc.payroll-register.v1':
      data.companyNameLine1 = longClient;
      data.companyNameLine2 = 'Payroll Department and Shared Services Processing Center';
      data.reportScopeLabel = 'Hourly + Salaried + Bonus + Commission + Retro Adjustments';
      data.totals = [
        ...(Array.isArray(data.totals) ? data.totals : []),
        { label: 'Employer Payroll Taxes and Benefits Accrual', amount: '$24,987.77' },
      ];
      return data;
    case 'refdoc.remittance-bundle.v1':
      data.companyName = longClient;
      data.vendor = longVendor;
      data.invoices = repeatRows(data.invoices, 14, (row, i) => ({
        ...row,
        invoiceNumber: `SD-${2000 + i}-EXTENDED`,
        serviceDate: `20X3-01-${String((i % 28) + 1).padStart(2, '0')}`,
      }));
      return data;
    case 'refdoc.accrual-estimate.v1':
      data.companyName = longClient;
      data.vendor = longVendor;
      data.note = `${data.note || ''} Additional explanatory support describing estimate methodology, assumptions, and later settlement analysis for documentation review.`;
      return data;
    case 'refdoc.check-copy.v1':
      data.payer = {
        ...(data.payer || {}),
        name: longClient,
        addressLine: '2150 Riverfront Avenue, Building 4, Denver, CO 80202-4567',
      };
      data.payee = longVendor;
      data.memo = 'Payroll and benefits settlement';
      return data;
    default:
      return data;
  }
}

function fullHtmlFromRendererOutput({ html, css }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>${css || ''}</style>
</head>
<body>${html || ''}</body>
</html>`;
}

function safeTemplateId(templateId) {
  return String(templateId).replace(/[^\w.\-]/g, '_');
}

async function launchBrowser() {
  let executablePath;
  if (process.platform === 'darwin') {
    const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(macChrome)) {
      executablePath = macChrome;
    }
  }
  if (!executablePath) {
    executablePath = await chromiumBinary.executablePath();
  }
  return chromium.launch({
    executablePath,
    args:
      process.platform === 'darwin'
        ? ['--disable-dev-shm-usage', '--no-sandbox']
        : chromiumBinary.args,
    headless: true,
  });
}

async function renderTemplate(browser, templateId) {
  const templateDir = path.join(artifactsRoot, safeTemplateId(templateId));
  ensureDir(templateDir);

  const page = await browser.newPage({
    viewport: { width: 1400, height: 1800 },
    deviceScaleFactor: 2,
  });

  const data = applyStressVariant(templateId, buildDebugDataForTemplate(templateId));
  const renderer = getTemplateRenderer(templateId);
  const renderResult = renderer({ data, theme: {}, layout: {} });
  const docHtml = fullHtmlFromRendererOutput(renderResult);

  await page.emulateMedia({ media: 'print' });
  await page.setContent(docHtml, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());

  const pages = page.locator('.page');
  const pageCount = await pages.count();
  if (pageCount === 0) {
    throw new Error(`No .page elements found for template ${templateId}`);
  }

  const screenshots = [];
  for (let i = 0; i < pageCount; i += 1) {
    const outPath = path.join(templateDir, `page-${i + 1}.png`);
    await pages.nth(i).screenshot({ path: outPath });
    screenshots.push(path.relative(repoRoot, outPath));
  }

  const htmlPath = path.join(templateDir, 'latest.html');
  fs.writeFileSync(htmlPath, docHtml, 'utf8');

  const meta = {
    templateId,
    variant,
    pageCount,
    screenshots,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(templateDir, 'latest.json'), JSON.stringify(meta, null, 2));

  await page.close();
  return meta;
}

async function main() {
  ensureDir(artifactsRoot);
  const browser = await launchBrowser();
  const summary = [];
  const failures = [];

  try {
    for (const templateId of templateIds) {
      try {
        const meta = await renderTemplate(browser, templateId);
        summary.push(meta);
        console.log(`[document-inspector] rendered ${templateId} [${variant}] (${meta.pageCount} page(s))`);
      } catch (error) {
        failures.push({ templateId, error: error?.message || String(error) });
        console.error(`[document-inspector] failed ${templateId}:`, error?.message || error);
      }
    }
  } finally {
    await browser.close();
  }

  const summaryPath = path.join(artifactsRoot, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ summary, failures }, null, 2));
  console.log(`[document-inspector] wrote ${path.relative(repoRoot, summaryPath)}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[document-inspector] unexpected error', error);
  process.exit(1);
});
