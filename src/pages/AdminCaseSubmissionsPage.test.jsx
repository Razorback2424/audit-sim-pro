import { render, screen } from '@testing-library/react';
import AdminCaseSubmissionsPage from './AdminCaseSubmissionsPage';
import { fetchCase } from '../services/caseService';
import { fetchSubmissionsForCase } from '../services/submissionService';

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn()
}));
jest.mock('../services/submissionService', () => ({
  fetchSubmissionsForCase: jest.fn()
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn() })
}));

test('renders case submissions heading', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Test Case' });
  fetchSubmissionsForCase.mockResolvedValue([]);
  render(<AdminCaseSubmissionsPage params={{ caseId: 'c1' }} />);
  expect(await screen.findByText(/submissions for/i)).toBeInTheDocument();
});
