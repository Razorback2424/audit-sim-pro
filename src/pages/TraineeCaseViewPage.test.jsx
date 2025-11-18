import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TraineeCaseViewPage from './TraineeCaseViewPage';
import { subscribeToCase } from '../services/caseService';
import { saveSubmission } from '../services/submissionService';
import { saveProgress, subscribeProgressForCases } from '../services/progressService';
import { getDownloadURL } from 'firebase/storage';

const mockFetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    blob: () => Promise.resolve(new Blob(['mock'], { type: 'application/octet-stream' })),
  })
);

beforeAll(() => {
  global.fetch = mockFetch;
});

afterEach(() => {
  mockFetch.mockClear();
});

afterAll(() => {
  delete global.fetch;
});

jest.mock('../services/caseService', () => ({
  subscribeToCase: jest.fn(),
}));

jest.mock('../services/submissionService', () => ({
  saveSubmission: jest.fn(),
}));

jest.mock('../services/progressService', () => ({
  saveProgress: jest.fn(),
  subscribeProgressForCases: jest.fn(() => jest.fn()),
}));

jest.mock('firebase/storage', () => ({
  getDownloadURL: jest.fn(),
  ref: jest.fn((_, path) => ({ path })),
}));

const mockModal = {
  showModal: jest.fn(),
  hideModal: jest.fn(),
};

jest.mock('../AppCore', () => {
  const navigateMock = jest.fn();
  return {
    Button: ({ children, isLoading, ...props }) => (
      <button {...props}>{isLoading ? 'Loading…' : children}</button>
    ),
    Input: (props) => <input {...props} />,
    Select: ({ options = [], children, ...props }) => (
      <select {...props}>
        {children ||
          options.map(({ value, label }) => (
            <option key={value ?? label} value={value}>
              {label}
            </option>
          ))}
      </select>
    ),
    useRoute: () => ({ navigate: navigateMock }),
    useModal: () => mockModal,
    useAuth: () => ({ userId: 'u1' }),
    storage: { app: {} },
    appId: 'test-app',
  };
});

describe('TraineeCaseViewPage', () => {
  let consoleErrorSpy;
  const flushAsync = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  const renderCase = (casePayload) => {
    subscribeToCase.mockImplementation((_id, cb) => {
      cb(casePayload);
      return jest.fn();
    });
    return render(<TraineeCaseViewPage params={{ caseId: 'case-1' }} />);
  };

  const advanceToClassification = async () => {
    await screen.findByRole('heading', { name: /Step 1 — Select Disbursements/i, level: 2 });
    const checkbox = screen.getByRole('checkbox', { name: /ID:\s*p1/i });
    await userEvent.click(checkbox);
    const continueButton = screen.getByRole('button', { name: /Continue to Classification/i });
    await userEvent.click(continueButton);
    await screen.findByRole('heading', { name: /Step 2 — Classify Results/i, level: 2 });
  };

  beforeEach(() => {
    mockModal.showModal.mockClear();
    mockModal.hideModal.mockClear();
    subscribeToCase.mockReset();
    subscribeProgressForCases.mockReset();
    saveSubmission.mockReset();
    saveProgress.mockReset();
    saveProgress.mockResolvedValue();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    getDownloadURL.mockReset();
    subscribeProgressForCases.mockImplementation((_params, onNext) => {
      if (typeof onNext === 'function') {
        onNext(new Map());
      }
      return jest.fn();
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy.mockRestore();
  });

  test('navigates to classification and exposes allocation inputs', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        { paymentId: 'p1', payee: 'Vendor', amount: '100', paymentDate: '2024-01-01', downloadURL: 'https://example.com' },
      ],
    });

    await advanceToClassification();
    await flushAsync();
    const classificationSelect = await screen.findByRole('combobox', { name: /Classification/i });
    expect(classificationSelect).toBeEnabled();
    const splitToggle = await screen.findByRole('checkbox', { name: /Split across classifications/i });
    expect(splitToggle).toBeEnabled();
    await userEvent.click(splitToggle);
    const [properlyIncluded] = await screen.findAllByLabelText(/Properly Included/i);
    const [improperlyExcluded] = await screen.findAllByLabelText(/Improperly Excluded/i);
    expect(properlyIncluded).toBeEnabled();
    expect(improperlyExcluded).toBeEnabled();
  });

  test('uses cash-specific classification copy for cash audit area', async () => {
    renderCase({
      caseName: 'Cash Case',
      auditArea: 'cash',
      disbursements: [
        { paymentId: 'p1', payee: 'Drawer', amount: '85', paymentDate: '2024-02-01', downloadURL: 'https://example.com' },
      ],
    });

    await advanceToClassification();
    await flushAsync();
    expect(screen.getByText(/Select Cash Counts/i)).toBeInTheDocument();
    expect(screen.getByText(/Reconcile Variances/i)).toBeInTheDocument();

    const classificationSelect = await screen.findByRole('combobox', { name: /Classification/i });
    await userEvent.selectOptions(classificationSelect, 'properlyIncluded');
    expect(
      within(classificationSelect).getByRole('option', { name: /Cash Count Matches/i })
    ).toBeInTheDocument();
    expect(within(classificationSelect).getByRole('option', { name: /Cash Over/i })).toBeInTheDocument();
    expect(within(classificationSelect).getByRole('option', { name: /Cash Short/i })).toBeInTheDocument();
  });

  test('fetches evidence for storage-backed documents on classification step', async () => {
    getDownloadURL.mockResolvedValue('https://example.com/doc.pdf');
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          storagePath: 'artifacts/app/case_documents/case-1/doc.pdf',
        },
      ],
    });

    await advanceToClassification();
    await flushAsync();
    await waitFor(() => expect(getDownloadURL).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /open in new tab/i })).toBeInTheDocument();
  });

  test('reuses existing download URL when provided', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          downloadURL: 'https://example.com/invoice.pdf',
          fileName: 'invoice.pdf',
        },
      ],
    });

    await advanceToClassification();
    await flushAsync();
    expect(getDownloadURL).not.toHaveBeenCalled();
    expect(screen.getByText(/Now viewing: invoice\.pdf/i)).toBeInTheDocument();
  });

  test('prevents advancing when supporting documents are missing', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          storagePath: '',
          downloadURL: '',
        },
      ],
    });

    await screen.findByText(/Step 1 — Select Disbursements/i);
    await userEvent.click(screen.getByRole('checkbox', { name: /ID:\s*p1/i }));
    await userEvent.click(screen.getByRole('button', { name: /Continue to Classification/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Step 2 — Classify Results/i)).not.toBeInTheDocument();
    });
    await flushAsync();
    await waitFor(() => {
      expect(mockModal.showModal).toHaveBeenCalled();
    });
  });

  test('shows storage error when evidence document fails to load', async () => {
    getDownloadURL.mockRejectedValue({ code: 'storage/object-not-found' });
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          storagePath: 'artifacts/app/case_documents/case-1/missing.pdf',
        },
      ],
    });

    await advanceToClassification();
    await flushAsync();
    await waitFor(() => expect(screen.getByText(/Document is missing from storage./i)).toBeInTheDocument());
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading evidence document:', expect.objectContaining({ code: 'storage/object-not-found' }));
  });

  test.skip('renders reference download banner with buttons', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '150',
          paymentDate: '2024-01-01',
          downloadURL: 'https://example.com/invoice.pdf',
        },
      ],
      referenceDocuments: [
        { id: 'ref-1', fileName: 'Reference A.xlsx', downloadURL: 'https://example.com/ref-a.xlsx' },
        { id: 'ref-2', fileName: 'Reference B.pdf', storagePath: 'artifacts/app/reference/ref-b.pdf' },
      ],
    });

    getDownloadURL.mockResolvedValueOnce('https://example.com/generated/ref-b.pdf');

    await advanceToClassification();

    expect(
      screen.getByText(/Download the necessary reference documents before you begin classifying results/i)
    ).toBeInTheDocument();

    const directDownloadButton = screen.getByRole('button', { name: /Reference A\.xlsx/i });
    await userEvent.click(directDownloadButton);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('https://example.com/ref-a.xlsx'));

    const storageDownloadButton = screen.getByRole('button', { name: /Reference B\.pdf/i });
    await userEvent.click(storageDownloadButton);
    await waitFor(() => expect(getDownloadURL).toHaveBeenCalledWith({ path: 'artifacts/app/reference/ref-b.pdf' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('https://example.com/generated/ref-b.pdf'));
  });

  test('submits allocations and all supporting documents for a multi-invoice disbursement', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '150',
          paymentDate: '2024-01-01',
          supportingDocuments: [
            { fileName: 'invoice-1.pdf', downloadURL: 'https://example.com/invoice-1.pdf' },
            { fileName: 'invoice-2.pdf', downloadURL: 'https://example.com/invoice-2.pdf' },
          ],
        },
      ],
    });

    await advanceToClassification();

    const classificationSelect = await screen.findByRole('combobox', { name: /Classification/i });
    const splitToggle = await screen.findByRole('checkbox', { name: /Split across classifications/i });
    await userEvent.click(splitToggle);

    const enterValue = async (label, value) => {
      const [input] = await screen.findAllByLabelText(new RegExp(label, 'i'));
      await userEvent.clear(input);
      await userEvent.type(input, String(value));
    };

    await enterValue('Properly Included', 100);
    await enterValue('Properly Excluded', 50);
    await enterValue('Improperly Included', 0);
    await enterValue('Improperly Excluded', 0);

    await userEvent.click(screen.getByRole('button', { name: /Submit Responses/i }));

    await waitFor(() => expect(saveSubmission).toHaveBeenCalled());
    await screen.findByRole('heading', { name: /Submission Confirmed/i });
    const [, , payload] = saveSubmission.mock.calls[0];
    expect(payload.retrievedDocuments).toHaveLength(2);
    expect(payload.disbursementClassifications.p1).toEqual({
      properlyIncluded: 100,
      properlyExcluded: 50,
      improperlyIncluded: 0,
      improperlyExcluded: 0,
    });
  });

  test.skip('displays reference documents panel and supports tab preview', async () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    try {
      renderCase({
        caseName: 'Case',
        disbursements: [
          {
            paymentId: 'p1',
            payee: 'Vendor',
            amount: '100',
            paymentDate: '2024-01-01',
            downloadURL: 'https://example.com/invoice.pdf',
          },
        ],
        referenceDocuments: [
          {
            fileName: 'AP Aging Summary.pdf',
            downloadURL: 'https://example.com/aging.pdf',
          },
        ],
      });

      await advanceToClassification();
      expect(screen.getByRole('heading', { name: /Reference Documents/i })).toBeInTheDocument();
      expect(screen.getByText(/AP Aging Summary/i)).toBeInTheDocument();
      expect(await screen.findByTitle(/Reference document/i)).toBeInTheDocument();

      const headerContainer = screen.getByRole('heading', { name: /Reference Documents/i }).parentElement?.parentElement;
      const openButton = within(headerContainer).getByRole('button', { name: /Open in new tab/i });
      await userEvent.click(openButton);
      expect(openSpy).toHaveBeenCalledWith('https://example.com/aging.pdf', '_blank');
    } finally {
      openSpy.mockRestore();
    }
  });

  test('shows fallback message when no reference documents exist', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          downloadURL: 'https://example.com/invoice.pdf',
        },
      ],
      referenceDocuments: [],
    });

    await advanceToClassification();
    expect(
      screen.getByText(/Reference materials will appear here when provided by your instructor/i)
    ).toBeInTheDocument();
  });
});
