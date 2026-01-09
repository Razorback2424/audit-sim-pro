import { useCallback, useMemo, useState } from 'react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { Button, storage } from '../AppCore';
import { Download } from 'lucide-react';

export default function useReferenceDownloads(referenceDocuments = [], showModal) {
  const [downloading, setDownloading] = useState(false);

  const triggerFileDownload = useCallback(async (url, filename) => {
    const safeName = filename || 'reference-document';
    const hasFetch = typeof fetch === 'function';
    const canStream = typeof window !== 'undefined' && window.URL && typeof window.URL.createObjectURL === 'function';

    if (!hasFetch || !canStream) {
      window.open(url, '_blank', 'noopener');
      return;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Unable to retrieve file contents.');
    }
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 2000);
  }, []);

  const downloadReferenceDocument = useCallback(
    async (doc) => {
      if (!doc) {
        throw new Error('Reference document metadata is missing.');
      }

      const displayName = (doc.fileName || 'reference-document').trim() || 'reference-document';
      let url = '';
      const fallbackUrl = (doc.downloadURL || '').trim();

      if (doc.storagePath) {
        try {
          url = await getDownloadURL(storageRef(storage, doc.storagePath));
        } catch (err) {
          if (fallbackUrl) {
            url = fallbackUrl;
          } else {
            throw err;
          }
        }
      } else if (fallbackUrl) {
        url = fallbackUrl;
      } else {
        throw new Error('Reference document is missing a download link.');
      }

      await triggerFileDownload(url, displayName);
    },
    [triggerFileDownload]
  );

  const handleDownloadAllReferences = useCallback(async () => {
    if (!referenceDocuments || referenceDocuments.length === 0) return;

    setDownloading(true);
    const errors = [];

    for (const doc of referenceDocuments) {
      try {
        await downloadReferenceDocument(doc);
      } catch (error) {
        console.error('Error downloading reference document:', error);
        errors.push(`- ${(doc?.fileName || 'Reference document').trim() || 'Reference document'}: ${error?.message || error}`);
      }
    }

    if (errors.length > 0 && typeof showModal === 'function') {
      showModal(`Some reference documents could not be downloaded:\n${errors.join('\n')}`, 'Download Errors');
    }

    setDownloading(false);
  }, [downloadReferenceDocument, referenceDocuments, showModal]);

  const renderReferenceDownloadsBanner = useMemo(() => {
    if (!referenceDocuments || referenceDocuments.length === 0) {
      return () => (
        <div className="bg-gray-50 border border-gray-200 text-gray-700 rounded-lg px-4 py-3">
          Reference materials will appear here when provided by your instructor.
        </div>
      );
    }

    return () => (
      <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg px-4 py-3 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide">Reference Materials</h3>
            <p className="text-xs sm:text-sm text-indigo-800">
              Download the necessary reference documents before you begin classifying results.
            </p>
          </div>
          <div>
            <Button
              variant="secondary"
              className="text-xs px-3 py-1 bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
              onClick={handleDownloadAllReferences}
              isLoading={downloading}
              disabled={downloading}
            >
              <Download size={14} className="inline mr-1" />
              Download All Reference Documents
            </Button>
          </div>
        </div>
      </div>
    );
  }, [downloading, handleDownloadAllReferences, referenceDocuments]);

  return {
    renderReferenceDownloadsBanner,
    handleDownloadAllReferences,
    downloadingReferences: downloading,
  };
}
