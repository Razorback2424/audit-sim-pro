import { render, screen } from '@testing-library/react';
import TraineeSubmissionHistoryPage from '../TraineeSubmissionHistoryPage';
import AdminCaseSubmissionsPage from '../AdminCaseSubmissionsPage';
import AdminSubmissionDetailPage from '../AdminSubmissionDetailPage';
import { listUserSubmissions, fetchSubmissionsForCase, fetchSubmission } from '../../services/submissionService';
import { fetchCase } from '../../services/caseService';
import { fetchProgressForCases } from '../../services/progressService';

jest.mock('../../services/submissionService', () => ({
  listUserSubmissions: jest.fn(),
  fetchSubmissionsForCase: jest.fn(),
  fetchSubmission: jest.fn(),
}));

jest.mock('../../services/caseService', () => ({
  fetchCase: jest.fn(),
}));

jest.mock('../../services/progressService', () => ({
  fetchProgressForCases: jest.fn(),
  saveProgress: jest.fn(),
}));

jest.mock('../../services/analyticsService', () => ({
  ANALYTICS_EVENTS: {
    ATTEMPT_RESTARTED: 'attempt_restarted',
  },
  trackAnalyticsEvent: jest.fn(),
}));

const mockNavigate = jest.fn();
const mockShowModal = jest.fn();

jest.mock('../../AppCore', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  useRoute: () => ({ navigate: mockNavigate }),
  useAuth: () => ({ userId: 'u1' }),
  useModal: () => ({ showModal: mockShowModal }),
  useUser: () => ({ role: 'trainee', loadingRole: false, userProfile: { uid: 'u1' } }),
  appId: 'test-app',
  storage: {},
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('smoke: trainee completed submission is visible in trainee history and admin review surfaces', async () => {
  const sharedSubmission = {
    userId: 'u1',
    caseId: 'case-1',
    caseName: 'Case One',
    submittedAt: { toMillis: () => 1000, toDate: () => new Date('2024-01-01T00:00:00Z') },
    selectedPaymentIds: ['P-101'],
    disbursementClassifications: { 'P-101': { properlyIncluded: 100 } },
    attempts: [
      {
        submittedAt: { toMillis: () => 1000, toDate: () => new Date('2024-01-01T00:00:00Z') },
        selectedPaymentIds: ['P-101'],
        disbursementClassifications: { 'P-101': { properlyIncluded: 100 } },
        virtualSeniorFeedback: [{ paymentId: 'P-101', notes: ['Documentation Deficiency: add rationale.'] }],
      },
    ],
  };

  listUserSubmissions.mockResolvedValue([sharedSubmission]);
  fetchProgressForCases.mockResolvedValue(new Map());
  fetchSubmissionsForCase.mockResolvedValue([sharedSubmission]);
  fetchSubmission.mockResolvedValue(sharedSubmission);
  fetchCase.mockResolvedValue({
    caseName: 'Case One',
    disbursements: [{ paymentId: 'P-101', payee: 'Vendor A', amount: '100', paymentDate: '2024-01-01' }],
  });

  render(<TraineeSubmissionHistoryPage />);
  expect(await screen.findByText(/Case One/i)).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /Retake Case/i })).toBeInTheDocument();

  render(<AdminCaseSubmissionsPage params={{ caseId: 'case-1' }} />);
  expect(await screen.findByText(/Submissions for/i)).toBeInTheDocument();
  expect(await screen.findByText(/1 available/i)).toBeInTheDocument();

  render(<AdminSubmissionDetailPage params={{ caseId: 'case-1', userId: 'u1' }} />);
  expect(await screen.findByText(/Submission Detail/i)).toBeInTheDocument();
  expect(await screen.findByText(/Documentation Deficiency: add rationale\./i)).toBeInTheDocument();
});
