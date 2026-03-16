import { renderHook, waitFor } from '@testing-library/react';
import useEvidenceViewer from './useEvidenceViewer';
import { getSignedDocumentUrl } from '../services/documentService';

jest.mock('../services/documentService', () => ({
  getSignedDocumentUrl: jest.fn(),
}));

const evidenceItems = [
  {
    evidenceId: 'doc-1',
    evidenceFileName: 'invoice.pdf',
    storagePath: 'artifacts/test/case_documents/case-1/invoice.pdf',
    contentType: 'application/pdf',
  },
];

describe('useEvidenceViewer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reuses a cached signed URL before expiry', async () => {
    getSignedDocumentUrl.mockResolvedValue('https://example.com/doc-1');

    const { result, rerender } = renderHook((props) => useEvidenceViewer(props), {
      initialProps: {
        viewerEnabled: true,
        evidenceItems,
        caseId: 'case-1',
      },
    });

    await waitFor(() => expect(result.current.activeEvidenceUrl).toBe('https://example.com/doc-1'));
    expect(getSignedDocumentUrl).toHaveBeenCalledTimes(1);

    Date.now.mockReturnValue(60_000);
    rerender({
      viewerEnabled: true,
      evidenceItems: [...evidenceItems],
      caseId: 'case-1',
    });

    await waitFor(() => expect(result.current.activeEvidenceUrl).toBe('https://example.com/doc-1'));
    expect(getSignedDocumentUrl).toHaveBeenCalledTimes(1);
  });

  test('refreshes an expired signed URL on rerender', async () => {
    getSignedDocumentUrl
      .mockResolvedValueOnce('https://example.com/doc-1')
      .mockResolvedValueOnce('https://example.com/doc-1-fresh');

    const { result, rerender } = renderHook((props) => useEvidenceViewer(props), {
      initialProps: {
        viewerEnabled: true,
        evidenceItems,
        caseId: 'case-1',
      },
    });

    await waitFor(() => expect(result.current.activeEvidenceUrl).toBe('https://example.com/doc-1'));
    expect(getSignedDocumentUrl).toHaveBeenCalledTimes(1);

    Date.now.mockReturnValue(10 * 60 * 1000);
    rerender({
      viewerEnabled: true,
      evidenceItems: [...evidenceItems],
      caseId: 'case-1',
    });

    await waitFor(() =>
      expect(result.current.activeEvidenceUrl).toBe('https://example.com/doc-1-fresh')
    );
    expect(getSignedDocumentUrl).toHaveBeenCalledTimes(2);
  });

  test('surfaces a graceful error when signed URL resolution fails', async () => {
    getSignedDocumentUrl.mockRejectedValue(new Error('expired'));

    const { result } = renderHook((props) => useEvidenceViewer(props), {
      initialProps: {
        viewerEnabled: true,
        evidenceItems,
        caseId: 'case-1',
      },
    });

    await waitFor(() =>
      expect(result.current.activeEvidenceError).toBe('Unable to load document preview.')
    );
    expect(result.current.activeEvidenceUrl).toBe(null);
  });
});
