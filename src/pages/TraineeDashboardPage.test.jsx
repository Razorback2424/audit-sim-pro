import { render, screen } from '@testing-library/react';
import TraineeDashboardPage from './TraineeDashboardPage';
import { subscribeToActiveCases } from '../services/caseService';

jest.mock('../services/caseService', () => ({
  subscribeToActiveCases: jest.fn()
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn() }),
  useAuth: () => ({ userId: 'u1' })
}));

test('renders trainee dashboard heading', async () => {
  subscribeToActiveCases.mockImplementation((cb) => {
    setTimeout(() => cb([]), 0);
    return jest.fn();
  });
  render(<TraineeDashboardPage />);
  await screen.findByText(/available audit cases/i);
});
