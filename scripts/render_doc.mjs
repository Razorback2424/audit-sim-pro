// Render ONE template with YOUR data to PDF/PNG/HTML, locally. No Firebase needed.
//   node scripts/render_doc.mjs <templateId> <data.json> [outDir]
// Falls back to the repo's built-in debug data when <data.json> is "debug".
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../functions/node_modules/playwright-core');
const chromiumBinary = require('../functions/node_modules/@sparticuz/chromium');
const { getTemplateRenderer } = require('../functions/pdfTemplates');

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [templateId, dataArg, outArg] = process.argv.slice(2);

if (!templateId || !dataArg) {
  console.error('usage: node scripts/render_doc.mjs <templateId> <data.json|debug> [outDir]');
  console.error('templates:', JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'functions/shared/pdfTemplateIds.json'), 'utf8')
  ).join('\n           '));
  process.exit(1);
}

function loadDebugData(id) {
  const source = fs.readFileSync(path.join(repoRoot, 'functions/src/cases/index.js'), 'utf8');
  const match = source.match(
    /const buildDebugDataForTemplate = \(templateId\) => \{[\s\S]*?\n\};\n\nconst normalizeStoragePath/
  );
  if (!match) throw new Error('Unable to locate buildDebugDataForTemplate.');
  const fnSource = match[0].replace(/\n\nconst normalizeStoragePath$/, '\n');
  return new vm.Script(`${fnSource}\nbuildDebugDataForTemplate;`).runInNewContext({})(id);
}

const input = dataArg === 'debug' ? {} : JSON.parse(fs.readFileSync(path.resolve(dataArg), 'utf8'));
// A data file may be either the bare `data` object, or { data, theme, layout }.
const hasEnvelope = input && (input.data || input.theme || input.layout);
const data = dataArg === 'debug' ? loadDebugData(templateId) : (hasEnvelope ? input.data || {} : input);
const theme = hasEnvelope ? input.theme || {} : {};
const layout = hasEnvelope ? input.layout || {} : {};

const outDir = path.resolve(
  outArg || path.join(repoRoot, 'artifacts/render-doc', String(templateId).replace(/[^\w.\-]/g, '_'))
);
fs.mkdirSync(outDir, { recursive: true });

const { html, css, pdfOptions } = getTemplateRenderer(templateId)({ data, theme, layout });
const fullHtml = `<!doctype html>
<html><head><meta charset="utf-8" /><style>${css || ''}</style></head><body>${html || ''}</body></html>`;
fs.writeFileSync(path.join(outDir, 'latest.html'), fullHtml, 'utf8');

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath =
  process.platform === 'darwin' && fs.existsSync(macChrome)
    ? macChrome
    : await chromiumBinary.executablePath();

const browser = await chromium.launch({
  executablePath,
  args: process.platform === 'darwin' ? ['--disable-dev-shm-usage', '--no-sandbox'] : chromiumBinary.args,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1800 }, deviceScaleFactor: 2 });
await page.emulateMedia({ media: 'print' });
await page.setContent(fullHtml, { waitUntil: 'load' });
await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());

// Same PDF options the callable passes to renderPdfFromHtml.
await page.pdf({
  path: path.join(outDir, 'latest.pdf'),
  printBackground: true,
  format: pdfOptions?.format || 'Letter',
  ...(pdfOptions?.landscape ? { landscape: true } : {}),
  ...(pdfOptions?.margin ? { margin: pdfOptions.margin } : {}),
});

const pages = page.locator('.page');
const pageCount = await pages.count();
for (let i = 0; i < pageCount; i += 1) {
  await pages.nth(i).screenshot({ path: path.join(outDir, `page-${i + 1}.png`) });
}
await browser.close();

fs.writeFileSync(
  path.join(outDir, 'latest.json'),
  JSON.stringify({ templateId, pageCount, source: dataArg, generatedAt: new Date().toISOString() }, null, 2)
);
console.log(`[render-doc] ${templateId}: ${pageCount} page(s) -> ${path.relative(repoRoot, outDir)}`);
