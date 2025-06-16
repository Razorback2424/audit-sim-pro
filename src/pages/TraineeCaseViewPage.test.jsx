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
  Select: (props) => <select {...props} />,
  CLASSIFICATION_OPTIONS: [
    { value: '', label: 'Select Classification…', disabled: true },
    { value: 'Properly Included', label: 'Properly Included' }
  ],
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn(), hideModal: jest.fn() }),
  useAuth: () => ({ userId: 'u1' }),
  storage: {}
}));

test('renders classification select', async () => {
  subscribeToCase.mockImplementation((id, cb) => {
    cb({ caseName: 'Case', disbursements: [{ paymentId: 'p1', payee: 'A', amount: '1', paymentDate: '2024-01-01' }] });
    return jest.fn();
  });
  render(<TraineeCaseViewPage params={{ caseId: 'c1' }} />);
  await screen.findByText(/select the disbursements/i);
  expect(screen.getByRole('combobox')).toBeInTheDocument();
});
