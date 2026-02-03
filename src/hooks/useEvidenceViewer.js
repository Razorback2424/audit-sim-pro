import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isInlinePreviewable } from '../utils/evidenceUtils';
import { getSignedDocumentUrl } from '../services/documentService';

export default function useEvidenceViewer({
  viewerEnabled,
  evidenceItems,
  caseId,
  activeEvidenceId: controlledEvidenceId,
  onActiveEvidenceChange,
}) {
  const [internalEvidenceId, setInternalEvidenceId] = useState(null);
  const [activeEvidenceUrl, setActiveEvidenceUrl] = useState(null);
  const [activeEvidenceError, setActiveEvidenceError] = useState('');
  const [activeEvidenceLoading, setActiveEvidenceLoading] = useState(false);

  const lastResolvedEvidenceRef = useRef({
    evidenceId: null,
    storagePath: null,
    url: null,
    inlineNotSupported: false,
  });

  const evidenceSource = useMemo(() => {
    if (!viewerEnabled) return [];
    if (!Array.isArray(evidenceItems)) return [];
    // Normalize IDs so every item can be selected even if evidenceId is missing.
    const normalized = evidenceItems.map((item, idx) => {
      const fallbackId =
        item?.evidenceId ||
        item?.id ||
        (item?.paymentId ? `${item.paymentId}::${idx}` : `evidence-${idx}`);
      return { ...item, evidenceId: String(fallbackId) };
    });

    // Deduplicate by evidenceId to avoid selection reset loops when the list reorders.
    const seen = new Set();
    return normalized.filter((item) => {
      const id = item?.evidenceId;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [viewerEnabled, evidenceItems]);

  const activeEvidenceId = controlledEvidenceId !== undefined ? controlledEvidenceId : internalEvidenceId;

  const viewerState = useMemo(
    () => ({
      isOpen: viewerEnabled && Boolean(activeEvidenceUrl),
      currentDocId: viewerEnabled ? activeEvidenceId : null,
    }),
    [viewerEnabled, activeEvidenceUrl, activeEvidenceId]
  );

  useEffect(() => {
    if (!viewerEnabled) {
      setInternalEvidenceId(null);
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = {
        evidenceId: null,
        storagePath: null,
        url: null,
        inlineNotSupported: false,
      };
      return;
    }

    if (evidenceSource.length === 0) {
      setInternalEvidenceId(null);
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = {
        evidenceId: null,
        storagePath: null,
        url: null,
        inlineNotSupported: false,
      };
      return;
    }

    if (!activeEvidenceId || !evidenceSource.some((item) => item.evidenceId === activeEvidenceId)) {
      setInternalEvidenceId(evidenceSource[0].evidenceId);
      if (onActiveEvidenceChange) onActiveEvidenceChange(evidenceSource[0].evidenceId);
    }
  }, [viewerEnabled, evidenceSource, activeEvidenceId, onActiveEvidenceChange]);

  useEffect(() => {
    if (!viewerEnabled || evidenceSource.length === 0 || !activeEvidenceId) {
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = {
        evidenceId: null,
        storagePath: null,
        url: null,
        inlineNotSupported: false,
      };
      return;
    }

    const target = evidenceSource.find((item) => item.evidenceId === activeEvidenceId);
    if (!target) {
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = {
        evidenceId: null,
        storagePath: null,
        url: null,
        inlineNotSupported: false,
      };
      return;
    }

    const inlinePreviewAllowed = isInlinePreviewable(
      target.contentType,
      target.evidenceFileName || target.storagePath || target.downloadURL
    );

    const sourceKey = target.storagePath || target.downloadURL || null;
    if (!sourceKey) {
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('Document not linked for this disbursement.');
      setActiveEvidenceLoading(false);
      lastResolvedEvidenceRef.current = {
        evidenceId: target.evidenceId,
        storagePath: null,
        url: null,
        inlineNotSupported: false,
      };
      return;
    }

    const lastResolved = lastResolvedEvidenceRef.current;
    if (
      lastResolved.evidenceId === target.evidenceId &&
      lastResolved.storagePath === sourceKey &&
      (lastResolved.url || lastResolved.inlineNotSupported)
    ) {
      if (lastResolved.inlineNotSupported) {
        setActiveEvidenceUrl(null);
        setActiveEvidenceError('Preview not available for this file type. Use "Open in new tab" to download.');
      } else {
        setActiveEvidenceUrl(lastResolved.url);
        setActiveEvidenceError('');
      }
      setActiveEvidenceLoading(false);
      return;
    }

    let cancelled = false;
    setActiveEvidenceLoading(true);
    setActiveEvidenceError('');
    setActiveEvidenceUrl(null);
    lastResolvedEvidenceRef.current = {
      evidenceId: target.evidenceId,
      storagePath: sourceKey,
      url: null,
      inlineNotSupported: false,
    };

    if (!inlinePreviewAllowed) {
      setActiveEvidenceLoading(false);
      setActiveEvidenceUrl(null);
      setActiveEvidenceError('Preview not available for this file type. Use "Open in new tab" to download.');
      lastResolvedEvidenceRef.current = {
        evidenceId: target.evidenceId,
        storagePath: target.storagePath,
        url: null,
        inlineNotSupported: true,
      };
      return () => {
        cancelled = true;
      };
    }

    getSignedDocumentUrl({
      caseId,
      storagePath: target.storagePath,
      downloadURL: target.downloadURL,
    })
      .then((url) => {
        if (cancelled) return;
        setActiveEvidenceUrl(url);
        setActiveEvidenceError('');
        lastResolvedEvidenceRef.current = {
          evidenceId: target.evidenceId,
          storagePath: sourceKey,
          url,
          inlineNotSupported: false,
        };
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Error loading evidence document:', error);
        const message = 'Unable to load document preview.';
        setActiveEvidenceUrl(null);
        setActiveEvidenceError(message);
        lastResolvedEvidenceRef.current = {
          evidenceId: target.evidenceId,
          storagePath: sourceKey,
          url: null,
          inlineNotSupported: false,
        };
      })
      .finally(() => {
        if (cancelled) return;
        setActiveEvidenceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [viewerEnabled, evidenceSource, activeEvidenceId, caseId]);

  const setActiveEvidenceId = useCallback(
    (id) => {
      if (onActiveEvidenceChange) onActiveEvidenceChange(id);
      if (controlledEvidenceId === undefined) {
        setInternalEvidenceId(id);
      }
    },
    [controlledEvidenceId, onActiveEvidenceChange]
  );

  return {
    activeEvidenceId,
    setActiveEvidenceId,
    activeEvidenceUrl,
    activeEvidenceError,
    activeEvidenceLoading,
    evidenceSource,
    viewerState,
  };
}
