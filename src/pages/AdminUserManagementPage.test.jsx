import { render, screen } from '@testing-library/react';
import AdminUserManagementPage from './AdminUserManagementPage';
import { fetchUsersWithProfiles } from '../services/userService';

jest.mock('../services/userService', () => ({
  fetchUsersWithProfiles: jest.fn(),
  adminUpdateUserRole: jest.fn()
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  Select: ({ options = [] }) => (
    <select>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn() }),
  useAuth: () => ({ currentUser: { uid: 'admin-user' } })
}));

test('renders user management heading', async () => {
  fetchUsersWithProfiles.mockResolvedValue([]);
  render(<AdminUserManagementPage />);
  expect(await screen.findByText(/user management/i)).toBeInTheDocument();
});
