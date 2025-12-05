const SUPPORTED_FILE_TYPES = [
  { mime: 'application/pdf', extensions: ['.pdf'], label: 'PDF' },
  { mime: 'application/x-pdf', extensions: ['.pdf'], label: 'PDF' },
  { mime: 'text/csv', extensions: ['.csv'], label: 'CSV' },
  { mime: 'application/csv', extensions: ['.csv'], label: 'CSV' },
  { mime: 'application/vnd.ms-excel', extensions: ['.xls'], label: 'Excel (.xls)' },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extensions: ['.xlsx'], label: 'Excel (.xlsx)' },
  { mime: 'application/vnd.ms-excel.sheet.macroenabled.12', extensions: ['.xlsm'], label: 'Excel (.xlsm)' },
];

const SUPPORTED_MIME_TYPES = new Set(SUPPORTED_FILE_TYPES.map((entry) => entry.mime.toLowerCase()));
const SUPPORTED_EXTENSIONS = new Set(
  SUPPORTED_FILE_TYPES.flatMap((entry) => entry.extensions.map((ext) => ext.toLowerCase()))
);
const UNSAFE_STORAGE_CHARS = new RegExp('[\\\\/#?\\[\\]*<>:"|]+', 'g');

export const prettySupportedLabels = Array.from(new Set(SUPPORTED_FILE_TYPES.map((entry) => entry.label))).join(', ');

export const FILE_INPUT_ACCEPT = Array.from(
  new Set([
    ...Array.from(SUPPORTED_EXTENSIONS),
    ...Array.from(SUPPORTED_MIME_TYPES),
  ])
).join(',');

export const getFileExtension = (name) => {
  if (!name || typeof name !== 'string') return '';
  const match = name.trim().toLowerCase().match(/(\.[a-z0-9]{1,8})$/i);
  return match ? match[0].toLowerCase() : '';
};

export const pickContentType = (file) => {
  const declaredType = (file?.type || '').toLowerCase();
  if (declaredType && SUPPORTED_MIME_TYPES.has(declaredType)) {
    if (declaredType === 'application/x-pdf') return 'application/pdf';
    return declaredType;
  }
  const ext = getFileExtension(file?.name || '');
  if (ext && SUPPORTED_EXTENSIONS.has(ext)) {
    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.csv') return 'text/csv';
    if (ext === '.xls') return 'application/vnd.ms-excel';
    if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (ext === '.xlsm') return 'application/vnd.ms-excel.sheet.macroenabled.12';
  }
  return declaredType || 'application/octet-stream';
};

export const isSupportedFile = (file) => {
  if (!file) return false;
  const normalizedType = (file.type || '').toLowerCase();
  const ext = getFileExtension(file.name || '');
  if (SUPPORTED_MIME_TYPES.has(normalizedType)) return true;
  if (SUPPORTED_EXTENSIONS.has(ext)) return true;
  if (normalizedType === 'application/octet-stream' && SUPPORTED_EXTENSIONS.has(ext)) return true;
  return false;
};

export const ensureSafeStorageName = (rawName, desiredContentType) => {
  const sanitized = (rawName || 'artifact')
    .replace(UNSAFE_STORAGE_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const baseName = sanitized || 'artifact';
  const currentExt = getFileExtension(baseName);

  const extensionForType = (() => {
    switch (desiredContentType) {
      case 'text/csv':
        return '.csv';
      case 'application/vnd.ms-excel':
        return '.xls';
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        return '.xlsx';
      case 'application/vnd.ms-excel.sheet.macroenabled.12':
        return '.xlsm';
      default:
        return '.pdf';
    }
  })();

  if (currentExt) {
    return baseName;
  }
  return `${baseName}${extensionForType}`;
};

export { SUPPORTED_FILE_TYPES, SUPPORTED_MIME_TYPES, SUPPORTED_EXTENSIONS };
