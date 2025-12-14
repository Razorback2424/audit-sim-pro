export const mergeDisbursementDocuments = (disbursementList, invoiceMappings) => {
  const baseDisbursements = (disbursementList || []).map(({ _tempId, ...rest }) => rest);
  const mappingGroups = new Map();
  const normalizePaymentId = (value) => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  };

  (invoiceMappings || [])
    .filter((m) => m && normalizePaymentId(m.paymentId))
    .forEach((m) => {
      const key = normalizePaymentId(m.paymentId);
      if (!mappingGroups.has(key)) {
        mappingGroups.set(key, []);
      }
      mappingGroups.get(key).push({
        paymentId: normalizePaymentId(m.paymentId),
        storagePath: m.storagePath || '',
        fileName: m.fileName || '',
        downloadURL: m.downloadURL || '',
        contentType: m.contentType || '',
      });
    });

  return baseDisbursements.map((item) => {
    const next = { ...item };
    const linkedDocs = normalizePaymentId(item.paymentId) ? mappingGroups.get(normalizePaymentId(item.paymentId)) || [] : [];
    const existingDocs = Array.isArray(item.supportingDocuments) ? item.supportingDocuments : [];

    const combinedDocs = [...existingDocs, ...linkedDocs].map((doc) => ({
      storagePath: doc.storagePath || '',
      fileName: doc.fileName || '',
      downloadURL: doc.downloadURL || '',
      contentType: doc.contentType || '',
    }));

    const dedupedDocs = [];
    const seen = new Set();
    combinedDocs.forEach((doc) => {
      const key = `${doc.storagePath}|${doc.downloadURL}|${doc.fileName}|${doc.contentType}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (doc.storagePath || doc.downloadURL || doc.fileName) {
        dedupedDocs.push(doc);
      }
    });

    if (dedupedDocs.length > 0) {
      const [primaryDoc, ...additionalDocs] = dedupedDocs;

      if (primaryDoc.storagePath) next.storagePath = primaryDoc.storagePath;
      else delete next.storagePath;

      if (primaryDoc.fileName) next.fileName = primaryDoc.fileName;
      else delete next.fileName;

      if (primaryDoc.downloadURL) next.downloadURL = primaryDoc.downloadURL;
      else delete next.downloadURL;

      if (primaryDoc.contentType) next.contentType = primaryDoc.contentType;
      else delete next.contentType;

      next.supportingDocuments = [
        {
          storagePath: primaryDoc.storagePath || '',
          fileName: primaryDoc.fileName || '',
          downloadURL: primaryDoc.downloadURL || '',
          contentType: primaryDoc.contentType || '',
        },
        ...additionalDocs.map((doc) => ({
          storagePath: doc.storagePath || '',
          fileName: doc.fileName || '',
          downloadURL: doc.downloadURL || '',
          contentType: doc.contentType || '',
        })),
      ];
    } else {
      delete next.storagePath;
      delete next.fileName;
      delete next.downloadURL;
      delete next.contentType;
      delete next.supportingDocuments;
    }

    return next;
  });
};
