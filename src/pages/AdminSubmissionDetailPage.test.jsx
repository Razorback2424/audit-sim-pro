import { render, screen } from '@testing-library/react';
import AdminSubmissionDetailPage from './AdminSubmissionDetailPage';
import { fetchCase } from '../services/caseService';
import { fetchSubmission } from '../services/submissionService';

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn(),
}));
jest.mock('../services/submissionService', () => ({
  fetchSubmission: jest.fn(),
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn() }),
}));

test('renders submission detail heading', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Case A' });
  fetchSubmission.mockResolvedValue({ selectedPaymentIds: [], attempts: [] });
  render(<AdminSubmissionDetailPage params={{ caseId: 'c1', userId: 'u1' }} />);
  expect(await screen.findByText('Submission Detail')).toBeInTheDocument();
});
