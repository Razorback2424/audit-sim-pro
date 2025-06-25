import { render, screen } from '@testing-library/react';
import AdminDashboardPage from './AdminDashboardPage';
import { subscribeToCases } from '../services/caseService';

jest.mock('../services/caseService', () => ({
  subscribeToCases: jest.fn()
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn() })
}));

test('renders admin dashboard heading', async () => {
  subscribeToCases.mockImplementation((cb) => {
    setTimeout(() => cb([]), 0);
    return jest.fn();
  });
  render(<AdminDashboardPage />);
  await screen.findByText(/admin dashboard/i);
});
