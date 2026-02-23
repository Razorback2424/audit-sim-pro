import { render, screen } from '@testing-library/react';
import AdminSubmissionDetailPage from './AdminSubmissionDetailPage';
import { fetchCase } from '../services/caseService';
import { fetchSubmission } from '../services/submissionService';

const mockShowModal = jest.fn();

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn(),
}));
jest.mock('../services/submissionService', () => ({
  fetchSubmission: jest.fn(),
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: mockShowModal }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders submission detail heading', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Case A' });
  fetchSubmission.mockResolvedValue({ selectedPaymentIds: [], attempts: [] });
  render(<AdminSubmissionDetailPage params={{ caseId: 'c1', userId: 'u1' }} />);
  expect(await screen.findByText('Submission Detail')).toBeInTheDocument();
});

test('renders senior review notes for attempts', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Case A' });
  fetchSubmission.mockResolvedValue({
    attempts: [
      {
        selectedPaymentIds: [],
        disbursementClassifications: {},
        virtualSeniorFeedback: [
          {
            paymentId: 'P-101',
            payee: 'Vendor A',
            notes: ['Missing rationale for exception classification.'],
          },
        ],
      },
    ],
  });

  render(<AdminSubmissionDetailPage params={{ caseId: 'c1', userId: 'u1' }} />);

  expect(await screen.findByText(/Senior Review Notes:/i)).toBeInTheDocument();
  expect(screen.getByText(/P-101/i)).toBeInTheDocument();
  expect(screen.getByText(/Missing rationale for exception classification\./i)).toBeInTheDocument();
});

test('shows not found state and error modal when submission fetch fails', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Case A' });
  fetchSubmission.mockRejectedValue(new Error('no submission'));

  render(<AdminSubmissionDetailPage params={{ caseId: 'c1', userId: 'u1' }} />);

  expect(await screen.findByText(/Submission not found/i)).toBeInTheDocument();
  expect(mockShowModal).toHaveBeenCalledWith(
    expect.stringMatching(/Error fetching submission:/i),
    'Error'
  );
});
