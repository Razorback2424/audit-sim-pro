import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TraineeCaseViewPage from './TraineeCaseViewPage';
import { subscribeToCase } from '../services/caseService';
import { saveSubmission } from '../services/submissionService';
import { getDownloadURL } from 'firebase/storage';

jest.mock('../services/caseService', () => ({
  subscribeToCase: jest.fn(),
}));

jest.mock('../services/submissionService', () => ({
  saveSubmission: jest.fn(),
}));

jest.mock('../services/progressService', () => ({
  saveProgress: jest.fn(),
  subscribeProgressForCases: jest.fn(() => () => {}),
}));

jest.mock('firebase/storage', () => ({
  getDownloadURL: jest.fn(),
  ref: jest.fn((_, path) => ({ path })),
}));

const modalMocks = {
  showModal: jest.fn(),
  hideModal: jest.fn(),
};

jest.mock('../AppCore', () => {
  const navigateMock = jest.fn();
  return {
    Button: ({ children, ...props }) => <button {...props}>{children}</button>,
    Input: (props) => <input {...props} />,
    useRoute: () => ({ navigate: navigateMock }),
    useModal: () => modalMocks,
    useAuth: () => ({ userId: 'u1' }),
    storage: { app: {} },
    appId: 'test-app',
  };
});

describe('TraineeCaseViewPage', () => {
  const renderCase = (casePayload) => {
    subscribeToCase.mockImplementation((_id, cb) => {
      cb(casePayload);
      return jest.fn();
    });
    return render(<TraineeCaseViewPage params={{ caseId: 'case-1' }} />);
  };

  const advanceToClassification = async () => {
    await screen.findByText(/Step 1 — Select Disbursements/i);
    const checkbox = screen.getByRole('checkbox', { name: /ID:\s*p1/i });
    await userEvent.click(checkbox);
    const continueButton = screen.getByRole('button', { name: /Continue to Classification/i });
    await userEvent.click(continueButton);
    await screen.findByText(/Step 2 — Classify Results/i);
  };

  beforeEach(() => {
    modalMocks.showModal.mockClear();
    modalMocks.hideModal.mockClear();
    jest.clearAllMocks();
    getDownloadURL.mockReset();
  });

  test('navigates to classification and exposes allocation inputs', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        { paymentId: 'p1', payee: 'Vendor', amount: '100', paymentDate: '2024-01-01', downloadURL: 'https://example.com' },
      ],
    });

    await advanceToClassification();
    expect(screen.getByLabelText(/Properly Included/i)).toBeEnabled();
    expect(screen.getByLabelText(/Improperly Excluded/i)).toBeEnabled();
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
    expect(screen.queryByText(/Step 2 — Classify Results/i)).not.toBeInTheDocument();
    expect(modalMocks.showModal).toHaveBeenCalled();
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
    await waitFor(() => expect(screen.getByText(/Document is missing from storage./i)).toBeInTheDocument());
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

    const enterValue = async (label, value) => {
      const input = screen.getByLabelText(new RegExp(label, 'i'));
      await userEvent.clear(input);
      await userEvent.type(input, String(value));
    };

    await enterValue('Properly Included', 100);
    await enterValue('Properly Excluded', 50);
    await enterValue('Improperly Included', 0);
    await enterValue('Improperly Excluded', 0);

    await userEvent.click(screen.getByRole('button', { name: /Submit Responses/i }));

    await waitFor(() => expect(saveSubmission).toHaveBeenCalled());
    const [, , payload] = saveSubmission.mock.calls[0];
    expect(payload.retrievedDocuments).toHaveLength(2);
    expect(payload.disbursementClassifications.p1).toEqual({
      properlyIncluded: 100,
      properlyExcluded: 50,
      improperlyIncluded: 0,
      improperlyExcluded: 0,
    });
  });
});
