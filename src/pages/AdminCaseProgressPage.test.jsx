import { render, screen } from '@testing-library/react';
import AdminCaseProgressPage from './AdminCaseProgressPage';
import { fetchCase } from '../services/caseService';
import { fetchProgressRosterForCase } from '../services/progressService';
import { fetchSubmissionsForCase } from '../services/submissionService';

const mockShowModal = jest.fn();

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn(),
}));

jest.mock('../services/progressService', () => ({
  fetchProgressRosterForCase: jest.fn(),
}));

jest.mock('../services/submissionService', () => ({
  fetchSubmissionsForCase: jest.fn(),
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: mockShowModal }),
  appId: 'test-app',
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders readiness rollup with attempts, pass/fail, and top review note categories', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Case A' });
  fetchProgressRosterForCase.mockResolvedValue([
    {
      userId: 'u1',
      progress: {
        percentComplete: 100,
        step: 'results',
        updatedAt: { toMillis: () => 1000, toDate: () => new Date('2024-01-01T00:00:00Z') },
      },
    },
  ]);
  fetchSubmissionsForCase.mockResolvedValue([
    {
      userId: 'u1',
      attempts: [
        {
          submittedAt: { toMillis: () => 2000 },
          attemptSummary: { criticalIssuesCount: 0 },
          virtualSeniorFeedback: [
            {
              paymentId: 'p1',
              notes: ['Documentation Deficiency: Add rationale in the workpaper note.'],
            },
          ],
        },
      ],
    },
  ]);

  render(<AdminCaseProgressPage params={{ caseId: 'case-1' }} />);

  expect(await screen.findByText(/Top Review Note Categories/i)).toBeInTheDocument();
  expect(screen.getByText(/Documentation Deficiency/i)).toBeInTheDocument();
  expect(screen.getByText(/Documentation Deficiency/i).closest('li')).toHaveTextContent(': 1');
  expect(screen.getByText(/Pass/i)).toBeInTheDocument();
});

test('renders empty state when no roster exists', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Case A' });
  fetchProgressRosterForCase.mockResolvedValue([]);
  fetchSubmissionsForCase.mockResolvedValue([]);

  render(<AdminCaseProgressPage params={{ caseId: 'case-1' }} />);

  expect(await screen.findByText(/No progress recorded yet/i)).toBeInTheDocument();
});

test('shows modal when progress roster request fails', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Case A' });
  fetchProgressRosterForCase.mockRejectedValue(new Error('roster failed'));
  fetchSubmissionsForCase.mockResolvedValue([]);

  render(<AdminCaseProgressPage params={{ caseId: 'case-1' }} />);

  expect(await screen.findByText(/Case Progress/i)).toBeInTheDocument();
  expect(mockShowModal).toHaveBeenCalledWith(
    'Could not load progress roster. Please try again later.',
    'Error'
  );
});
