import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { getSignedDocumentUrl } from '../../services/documentService';

export default function EvidenceRevealModal({
  isOpen,
  onClose,
  cleanDocument,
  highlightedDocument,
  caseId,
  setupCaption = 'Start with the clean document, then toggle to the highlighted version to see the exact evidence that makes this an exception.',
  revealCaption = 'This highlighted version shows the specific evidence that makes this an exception.',
  title = 'Evidence Reveal',
}) {
  const [cleanUrl, setCleanUrl] = useState('');
  const [highlightUrl, setHighlightUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState('clean');

  const resolveDocumentUrl = useCallback(
    async (doc) => {
      if (!doc || (!doc.storagePath && !doc.downloadURL)) return '';
      if (!caseId) throw new Error('Case ID is required to open documents.');
      return getSignedDocumentUrl({
        caseId,
        storagePath: doc.storagePath,
        downloadURL: doc.downloadURL,
      });
    },
    [caseId]
  );

  useEffect(() => {
    if (!isOpen) {
      setCleanUrl('');
      setHighlightUrl('');
      setError('');
      setActiveView('clean');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    setActiveView('clean');

    const loadUrls = async () => {
      try {
        const [clean, highlight] = await Promise.all([resolveDocumentUrl(cleanDocument), resolveDocumentUrl(highlightedDocument)]);
        if (cancelled) return;
        const fallback = highlight || clean || '';
        setCleanUrl(clean || fallback);
        setHighlightUrl(highlight || fallback);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[EvidenceRevealModal] Failed to load documents', err);
        setError('Unable to load the evidence reveal. Please try again.');
        setLoading(false);
      }
    };

    loadUrls();
    return () => {
      cancelled = true;
    };
  }, [isOpen, cleanDocument, highlightedDocument, resolveDocumentUrl]);

  const viewerCaption = useMemo(
    () => (activeView === 'highlighted' ? revealCaption : setupCaption),
    [activeView, revealCaption, setupCaption]
  );
  const canDisplay = !!cleanUrl || !!highlightUrl;
  const hasClean = !!cleanUrl;
  const hasHighlighted = !!highlightUrl;
  const activeUrl = activeView === 'highlighted' ? highlightUrl : cleanUrl;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Evidence Reveal</p>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full bg-gray-100 p-1 text-base font-semibold text-gray-700 ring-2 ring-blue-100">
              <button
                type="button"
                className={`rounded-full px-7 py-2.5 transition ${
                  activeView === 'clean' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-700 hover:bg-white/60'
                }`}
                disabled={!hasClean || loading}
                onClick={() => setActiveView('clean')}
              >
                Clean
              </button>
              <button
                type="button"
                className={`rounded-full px-7 py-2.5 transition ${
                  activeView === 'highlighted'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : hasHighlighted
                    ? 'text-gray-700 hover:bg-white/60'
                    : 'text-gray-400'
                }`}
                disabled={!hasHighlighted || loading}
                onClick={() => setActiveView('highlighted')}
                title={!hasHighlighted ? 'Highlighted version not available for this item.' : 'Highlighted document'}
              >
                Highlighted
              </button>
            </div>
            <button
              type="button"
              className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
              aria-label="Close reveal"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold text-amber-800">
              Tip: toggle between <span className="font-bold">Clean</span> and <span className="font-bold">Highlighted</span> to see the
              specific evidence that makes this an exception.
            </div>
            {hasHighlighted ? null : (
              <div className="text-xs font-semibold text-gray-500">
                No highlighted version is available for this item.
              </div>
            )}
          </div>

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
            {loading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                <Loader2 className="mb-2 h-8 w-8 animate-spin" />
                <p className="text-sm">Loading documents…</p>
              </div>
            ) : canDisplay ? (
              activeUrl ? (
                <iframe
                  title={activeView === 'highlighted' ? 'Highlighted document' : 'Clean document'}
                  src={activeUrl}
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  No document available to display.
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">
                {error || 'No documents available to display.'}
              </div>
            )}
          </div>
          <p className="mt-3 text-sm text-gray-700">{error || viewerCaption}</p>
        </div>
      </div>
    </div>
  );
}
