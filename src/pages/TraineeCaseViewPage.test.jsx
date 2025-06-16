import { render, screen } from '@testing-library/react';
import TraineeCaseViewPage from './TraineeCaseViewPage';
import { subscribeToCase } from '../services/caseService';

jest.mock('../services/caseService', () => ({
  subscribeToCase: jest.fn()
}));

jest.mock('../services/submissionService', () => ({
  saveSubmission: jest.fn()
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn(), hideModal: jest.fn() }),
  useAuth: () => ({ userId: 'u1' }),
  storage: {}
}));

test('renders case view after load', async () => {
  subscribeToCase.mockImplementation((id, cb) => {
    setTimeout(() => cb({ caseName: 'Case', disbursements: [] }), 0);
    return jest.fn();
  });
  render(<TraineeCaseViewPage params={{ caseId: 'c1' }} />);
  await screen.findByText(/select the disbursements/i);
});
