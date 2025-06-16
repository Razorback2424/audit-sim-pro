import { render, screen } from '@testing-library/react';
import AdminUserManagementPage from './AdminUserManagementPage';
import { fetchUsersWithProfiles } from '../services/userService';

jest.mock('../services/userService', () => ({
  fetchUsersWithProfiles: jest.fn()
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn() })
}));

test('renders user management heading', async () => {
  fetchUsersWithProfiles.mockResolvedValue([]);
  render(<AdminUserManagementPage />);
  expect(await screen.findByText(/user management/i)).toBeInTheDocument();
});
