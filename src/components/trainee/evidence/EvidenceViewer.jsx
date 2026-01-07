import React from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '../../../AppCore';

export default function EvidenceViewer({
  items,
  activeEvidenceId,
  viewerEnabled,
  activeEvidenceLoading,
  activeEvidenceError,
  activeEvidenceUrl,
  onOpenDocument,
}) {
  const activeEvidence = items.find((item) => item.evidenceId === activeEvidenceId);
  const title = activeEvidence
    ? activeEvidence.evidenceFileName || activeEvidence.paymentId || 'Supporting document'
    : null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col min-h-[480px]">
      <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Document Viewer</h2>
          <p className="text-xs text-gray-500">
            {items.length === 0
              ? 'Choose a disbursement to see its supporting document.'
              : activeEvidenceId
              ? `Now viewing: ${title}`
              : 'Select a disbursement to view its document.'}
          </p>
        </div>
        {viewerEnabled && activeEvidence && (activeEvidence.storagePath || activeEvidence.downloadURL) ? (
          <Button
            variant="secondary"
            className="text-xs px-3 py-1"
            onClick={() =>
              onOpenDocument({
                fileName: activeEvidence.evidenceFileName,
                storagePath: activeEvidence.storagePath,
                downloadURL: activeEvidence.downloadURL,
              })
            }
          >
            <ExternalLink size={14} className="inline mr-1" /> Open in new tab
          </Button>
        ) : null}
      </div>
      <div className="flex-1 bg-gray-100 rounded-b-lg flex items-center justify-center">
        {activeEvidenceLoading ? (
          <div className="flex flex-col items-center text-gray-500">
            <Loader2 size={32} className="animate-spin mb-2" />
            <p className="text-sm">Loading document…</p>
          </div>
        ) : activeEvidenceError ? (
          <div className="max-w-sm text-center px-6 py-4 text-sm text-amber-700 bg-amber-100 border border-amber-200 rounded-md">
            {activeEvidenceError}
          </div>
        ) : activeEvidenceUrl ? (
          <iframe
            title="Evidence document"
            src={activeEvidenceUrl}
            className="w-full h-full rounded-b-lg"
            style={{ minHeight: '480px' }}
          />
        ) : (
          <p className="text-sm text-gray-500 px-6 text-center">
            Select a disbursement with a linked document to preview it here.
          </p>
        )}
      </div>
    </div>
  );
}
