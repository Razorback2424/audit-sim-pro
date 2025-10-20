import { render, screen } from '@testing-library/react';
import AdminCaseOverviewPage from './AdminCaseOverviewPage';
import { fetchCase } from '../services/caseService';

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn()
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn() }),
  storage: {},
}));

test('renders admin case overview heading', async () => {
  fetchCase.mockResolvedValue({ caseName: 'Case 1', disbursements: [], invoiceMappings: [] });
  render(<AdminCaseOverviewPage params={{ caseId: 'c1' }} />);
  expect(await screen.findByText('Case 1')).toBeInTheDocument();
  expect(await screen.findByText('Invoice Documents')).toBeInTheDocument();
  expect(await screen.findByText('No invoice documents uploaded.')).toBeInTheDocument();
});
