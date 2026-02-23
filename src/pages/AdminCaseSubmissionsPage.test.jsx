import { render, screen } from '@testing-library/react';
import AdminCaseSubmissionsPage from './AdminCaseSubmissionsPage';
import { fetchCase } from '../services/caseService';
import { fetchSubmissionsForCase } from '../services/submissionService';

const mockShowModal = jest.fn();

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn()
}));
jest.mock('../services/submissionService', () => ({
  fetchSubmissionsForCase: jest.fn()
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: mockShowModal })
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders case submissions heading', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Test Case' });
  fetchSubmissionsForCase.mockResolvedValue([]);
  render(<AdminCaseSubmissionsPage params={{ caseId: 'c1' }} />);
  expect(await screen.findByText(/submissions for/i)).toBeInTheDocument();
});

test('shows review note availability in submissions list', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Test Case' });
  fetchSubmissionsForCase.mockResolvedValue([
    {
      userId: 'u1',
      attempts: [
        {
          virtualSeniorFeedback: [
            { paymentId: 'P-1', notes: ['Review note A'] },
          ],
        },
      ],
      selectedPaymentIds: [],
      retrievedDocuments: [],
    },
  ]);

  render(<AdminCaseSubmissionsPage params={{ caseId: 'c1' }} />);

  expect(await screen.findByText(/Review Notes:/i)).toBeInTheDocument();
  expect(screen.getByText(/1 available/i)).toBeInTheDocument();
});

test('renders empty state and surfaces error modal when fetch fails', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Test Case' });
  fetchSubmissionsForCase.mockRejectedValue(new Error('network failed'));

  render(<AdminCaseSubmissionsPage params={{ caseId: 'c1' }} />);

  expect(await screen.findByText(/No submissions found for this case/i)).toBeInTheDocument();
  expect(mockShowModal).toHaveBeenCalledWith(
    expect.stringMatching(/Error fetching submissions:/i),
    'Error'
  );
});
