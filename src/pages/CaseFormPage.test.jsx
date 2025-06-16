import { render, screen } from '@testing-library/react';
import CaseFormPage from './CaseFormPage';
import { fetchCase } from '../services/caseService';

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn(),
  createCase: jest.fn(),
  updateCase: jest.fn()
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  Input: (props) => <input {...props} />,
  Textarea: (props) => <textarea {...props} />,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn() }),
  useAuth: () => ({ userId: 'u1' }),
  appId: 'app'
}));

test.skip('renders create case heading', async () => {
  fetchCase.mockResolvedValue(null);
  render(<CaseFormPage params={{}} />);
  expect(await screen.findByText(/create new audit case/i)).toBeInTheDocument();
});
