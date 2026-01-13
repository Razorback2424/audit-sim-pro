import { chromium } from 'playwright';

const defaultPdfOptions = {
  printBackground: true,
  preferCSSPageSize: true,
};

export async function renderPdfFromHtml(html, pdfOptions = {}) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
    return await page.pdf({ ...defaultPdfOptions, ...pdfOptions });
  } finally {
    await browser.close();
  }
}
