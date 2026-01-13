import { render, screen } from '@testing-library/react';
import TraineeDashboardPage from './TraineeDashboardPage';
import { listStudentCases } from '../services/caseService';

jest.mock('../services/caseService', () => ({
  listStudentCases: jest.fn().mockResolvedValue({ items: [], nextCursor: null })
}));

jest.mock('../AppCore', () => ({
  Button: ({ children, ...rest }) => <button {...rest}>{children}</button>,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn(), hideModal: jest.fn() }),
  useAuth: () => ({ userId: 'u1' }),
  appId: 'test-app'
}));

jest.mock('../utils/dates', () => ({
  nullSafeDate: (value) => (value ? new Date(value) : null),
  getNow: () => ({ timestamp: { toMillis: () => Date.now() }, date: new Date('2024-01-01T00:00:00Z') })
}));

describe('TraineeDashboardPage', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders trainee dashboard empty state', async () => {
    render(<TraineeDashboardPage />);
    expect(await screen.findByText(/no activities assigned yet/i)).toBeInTheDocument();
    expect(listStudentCases).toHaveBeenCalled();
    expect(screen.getByText(/current path/i)).toBeInTheDocument();
  });
});
