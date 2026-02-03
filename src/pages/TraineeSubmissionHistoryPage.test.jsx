import { render, screen, waitFor, within } from '@testing-library/react';
import TraineeSubmissionHistoryPage from './TraineeSubmissionHistoryPage';
import { listUserSubmissions } from '../services/submissionService';
import { fetchCase } from '../services/caseService';
import { fetchProgressForCases } from '../services/progressService';

jest.mock('../services/submissionService', () => ({
  listUserSubmissions: jest.fn(),
}));

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn(),
}));

jest.mock('../services/progressService', () => ({
  fetchProgressForCases: jest.fn(),
  saveProgress: jest.fn(),
}));


const mockNavigate = jest.fn();
const mockShowModal = jest.fn();

jest.mock('../AppCore', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  useRoute: () => ({ navigate: mockNavigate }),
  useAuth: () => ({ userId: 'u1' }),
  useModal: () => ({ showModal: mockShowModal }),
  useUser: () => ({ role: 'trainee', loadingRole: false, userProfile: { uid: 'u1' } }),
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
    expect(await screen.findByText(/Completed Cases/i)).toBeInTheDocument();
    expect(await screen.findByText(/You haven't completed any cases yet/i)).toBeInTheDocument();
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
            retrievedDocuments: [{ paymentId: 'p1', fileName: 'invoice.pdf', storagePath: 'artifacts/app/case-1/invoice.pdf' }],
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
    const timesCompletedCard = screen.getByText(/Times Completed/i).closest('div');
    expect(timesCompletedCard).not.toBeNull();
    if (timesCompletedCard) {
      expect(within(timesCompletedCard).getByText(/1/)).toBeInTheDocument();
    }
    const latestGradeCard = screen.getByText(/Latest Grade/i).closest('div');
    expect(latestGradeCard).not.toBeNull();
    if (latestGradeCard) {
      expect(within(latestGradeCard).getByText(/—/)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/Retake Case/i).length).toBeGreaterThan(0);
  });

  it('prompts to continue or restart when a newer draft exists', async () => {
    listUserSubmissions.mockResolvedValueOnce([
      {
        caseId: 'case-1',
        caseName: 'Case One',
        submittedAt: { toMillis: () => 1000 },
        attempts: [
          {
            submittedAt: { toMillis: () => 1000 },
            selectedPaymentIds: ['p1'],
          },
        ],
      },
    ]);
    fetchCase.mockResolvedValueOnce({ caseName: 'Case One', disbursements: [] });

    const progress = {
      caseId: 'case-1',
      state: 'in_progress',
      percentComplete: 25,
      step: 'testing',
      updatedAt: { toMillis: () => 2000 },
      draft: { selectedPaymentIds: ['p1'], classificationDraft: {} },
    };
    fetchProgressForCases.mockResolvedValueOnce(new Map([['case-1', progress]]));

    render(<TraineeSubmissionHistoryPage />);

    const button = await screen.findByRole('button', { name: /Retake Case/i });
    button.click();

    await waitFor(() => expect(fetchProgressForCases).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockShowModal).toHaveBeenCalledWith(
      expect.stringMatching(/draft in progress/i),
      expect.stringMatching(/draft in progress/i),
      expect.any(Function)
    );

    const customActions = mockShowModal.mock.calls[0][2];
    const close = jest.fn();
    const { getByRole } = render(customActions(close));
    getByRole('button', { name: /Return to draft/i }).click();

    expect(close).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/trainee/case/case-1');
  });

  it('restarts the case when choosing restart with an in-progress draft', async () => {
    listUserSubmissions.mockResolvedValueOnce([
      {
        caseId: 'case-1',
        caseName: 'Case One',
        submittedAt: { toMillis: () => 1000 },
        attempts: [
          {
            submittedAt: { toMillis: () => 1000 },
            selectedPaymentIds: ['p1'],
          },
        ],
      },
    ]);
    fetchCase.mockResolvedValueOnce({ caseName: 'Case One', disbursements: [] });

    const progress = {
      caseId: 'case-1',
      state: 'in_progress',
      percentComplete: 25,
      step: 'testing',
      updatedAt: { toMillis: () => 2000 },
      draft: { selectedPaymentIds: ['p1'], classificationDraft: {} },
    };
    fetchProgressForCases.mockResolvedValueOnce(new Map([['case-1', progress]]));
    const { saveProgress } = require('../services/progressService');
    saveProgress.mockResolvedValueOnce();

    render(<TraineeSubmissionHistoryPage />);

    const button = await screen.findByRole('button', { name: /Retake Case/i });
    button.click();

    await waitFor(() => expect(mockShowModal).toHaveBeenCalled());

    const firstActions = mockShowModal.mock.calls[0][2];
    const closeFirst = jest.fn();
    const { getByRole } = render(firstActions(closeFirst));
    getByRole('button', { name: /Restart case/i }).click();

    expect(closeFirst).toHaveBeenCalled();
    await waitFor(() => expect(saveProgress).toHaveBeenCalled());
    expect(mockShowModal).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/trainee/case/case-1');
  });

  it('starts a fresh retake when no newer draft exists', async () => {
    listUserSubmissions.mockResolvedValueOnce([
      {
        caseId: 'case-1',
        caseName: 'Case One',
        submittedAt: { toMillis: () => 2000 },
        attempts: [
          {
            submittedAt: { toMillis: () => 2000 },
            selectedPaymentIds: ['p1'],
          },
        ],
      },
    ]);
    fetchCase.mockResolvedValueOnce({ caseName: 'Case One', disbursements: [] });

    const progress = {
      caseId: 'case-1',
      state: 'submitted',
      percentComplete: 100,
      step: 'results',
      updatedAt: { toMillis: () => 1500 },
      draft: { selectedPaymentIds: ['p1'], classificationDraft: {} },
    };
    fetchProgressForCases.mockResolvedValueOnce(new Map([['case-1', progress]]));
    const { saveProgress } = require('../services/progressService');
    saveProgress.mockResolvedValueOnce();

    render(<TraineeSubmissionHistoryPage />);

    const button = await screen.findByRole('button', { name: /Retake Case/i });
    button.click();

    await waitFor(() => expect(fetchProgressForCases).toHaveBeenCalled());
    expect(mockShowModal).not.toHaveBeenCalled();
    expect(saveProgress).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/trainee/case/case-1');
  });

  it('does not prompt when no draft exists', async () => {
    listUserSubmissions.mockResolvedValueOnce([
      {
        caseId: 'case-1',
        caseName: 'Case One',
        submittedAt: { toMillis: () => 2000 },
        attempts: [
          {
            submittedAt: { toMillis: () => 2000 },
            selectedPaymentIds: ['p1'],
          },
        ],
      },
    ]);
    fetchCase.mockResolvedValueOnce({ caseName: 'Case One', disbursements: [] });

    const progress = {
      caseId: 'case-1',
      state: 'not_started',
      percentComplete: 0,
      step: 'selection',
      updatedAt: { toMillis: () => 0 },
      draft: { selectedPaymentIds: [], classificationDraft: {} },
    };
    fetchProgressForCases.mockResolvedValueOnce(new Map([['case-1', progress]]));
    const { saveProgress } = require('../services/progressService');
    saveProgress.mockResolvedValueOnce();

    render(<TraineeSubmissionHistoryPage />);

    const button = await screen.findByRole('button', { name: /Retake Case/i });
    button.click();

    await waitFor(() => expect(fetchProgressForCases).toHaveBeenCalled());
    expect(mockShowModal).not.toHaveBeenCalled();
    expect(saveProgress).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/trainee/case/case-1');
  });

  it('does not prompt when progress is submitted but has a non-empty percentComplete', async () => {
    listUserSubmissions.mockResolvedValueOnce([
      {
        caseId: 'case-1',
        caseName: 'Case One',
        submittedAt: { toMillis: () => 2000 },
        attempts: [
          {
            submittedAt: { toMillis: () => 2000 },
            selectedPaymentIds: ['p1'],
          },
        ],
      },
    ]);
    fetchCase.mockResolvedValueOnce({ caseName: 'Case One', disbursements: [] });

    const progress = {
      caseId: 'case-1',
      state: 'submitted',
      percentComplete: 100,
      step: 'results',
      updatedAt: { toMillis: () => 5000 },
      draft: { selectedPaymentIds: ['p1'], classificationDraft: { p1: { properlyIncluded: '100' } } },
    };
    fetchProgressForCases.mockResolvedValueOnce(new Map([['case-1', progress]]));
    const { saveProgress } = require('../services/progressService');
    saveProgress.mockResolvedValueOnce();

    render(<TraineeSubmissionHistoryPage />);

    const button = await screen.findByRole('button', { name: /Retake Case/i });
    button.click();

    await waitFor(() => expect(fetchProgressForCases).toHaveBeenCalled());
    expect(mockShowModal).not.toHaveBeenCalled();
    expect(saveProgress).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/trainee/case/case-1');
  });
});
