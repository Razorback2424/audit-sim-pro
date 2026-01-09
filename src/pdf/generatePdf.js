import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderPdfFromHtml } from './renderPdf.js';
import { getTemplate } from './templates/index.js';

export async function generatePdf({ templateId, data, theme, layout, pdfOptions }) {
  const tpl = getTemplate(templateId);
  const { Component, css, page } = tpl;

  const body = renderToStaticMarkup(<Component data={data} theme={theme} layout={layout} />);
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>${css({ theme, layout, page })}</style>
</head>
<body>${body}</body>
</html>`;

  return renderPdfFromHtml(html, { ...(page?.pdfOptions || {}), ...pdfOptions });
}
