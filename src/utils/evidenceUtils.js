export const isInlinePreviewable = (contentType, fileNameOrPath) => {
  const normalizedType = typeof contentType === 'string' ? contentType.toLowerCase() : '';
  if (normalizedType === 'application/pdf' || normalizedType === 'application/x-pdf') {
    return true;
  }
  const normalizedName = typeof fileNameOrPath === 'string' ? fileNameOrPath.toLowerCase() : '';
  const pdfPattern = /\.pdf(?:$|[?#])/;
  if (!normalizedType && pdfPattern.test(normalizedName)) {
    return true;
  }
  if (normalizedType === 'application/octet-stream' && pdfPattern.test(normalizedName)) {
    return true;
  }
  return false;
};
