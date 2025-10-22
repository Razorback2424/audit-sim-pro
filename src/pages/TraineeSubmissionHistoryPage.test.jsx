import { render, screen, waitFor } from '@testing-library/react';
import TraineeSubmissionHistoryPage from './TraineeSubmissionHistoryPage';
import { listUserSubmissions } from '../services/submissionService';
import { fetchCase } from '../services/caseService';

jest.mock('../services/submissionService', () => ({
  listUserSubmissions: jest.fn(),
}));

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn(),
}));

jest.mock('firebase/storage', () => ({
  ref: jest.fn(),
  getDownloadURL: jest.fn(),
}));

jest.mock('../AppCore', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useAuth: () => ({ userId: 'u1' }),
  useModal: () => ({ showModal: jest.fn() }),
  appId: 'test-app',
  storage: {},
}));

describe('TraineeSubmissionHistoryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders empty state when no submissions exist', async () => {
    listUserSubmissions.mockResolvedValueOnce([]);
    render(<TraineeSubmissionHistoryPage />);
    expect(await screen.findByText(/submission history/i)).toBeInTheDocument();
    expect(await screen.findByText(/You have not submitted any cases yet/i)).toBeInTheDocument();
  });

  it('shows previous attempts with classification summary', async () => {
    listUserSubmissions.mockResolvedValueOnce([
      {
        caseId: 'case-1',
        caseName: 'Case One',
        submittedAt: { toMillis: () => 1, toDate: () => new Date('2024-01-01T00:00:00Z') },
        attempts: [
          {
            submittedAt: { toMillis: () => 2, toDate: () => new Date('2024-01-02T00:00:00Z') },
            selectedPaymentIds: ['p1'],
            disbursementClassifications: { p1: { properlyIncluded: 100 } },
            retrievedDocuments: [{ paymentId: 'p1', fileName: 'invoice.pdf', downloadURL: 'https://example.com/doc.pdf' }],
          },
        ],
      },
    ]);

    fetchCase.mockResolvedValueOnce({
      caseName: 'Case One',
      disbursements: [{ paymentId: 'p1', payee: 'Vendor', amount: '100', paymentDate: '2024-01-01', expectedClassification: 'Properly Included' }],
    });

    render(<TraineeSubmissionHistoryPage />);

    expect(await screen.findByText(/Case One/)).toBeInTheDocument();
    await waitFor(() => expect(fetchCase).toHaveBeenCalledWith('case-1'));
    expect(screen.getByText(/Attempt 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Vendor/)).toBeInTheDocument();
    expect(screen.getAllByText(/\$100\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/invoice\.pdf/i)).toBeInTheDocument();
  });
});
