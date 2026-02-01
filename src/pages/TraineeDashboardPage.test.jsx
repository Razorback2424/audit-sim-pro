import { render, screen } from '@testing-library/react';
import TraineeDashboardPage from './TraineeDashboardPage';
import { listStudentCases } from '../services/caseService';
import { listRecipes } from '../services/recipeService';
import { fetchRecipeProgress } from '../services/recipeProgressService';
import { startCaseAttemptFromPool } from '../services/attemptService';

jest.mock('../services/caseService', () => ({
  listStudentCases: jest.fn().mockResolvedValue({ items: [], nextCursor: null })
}));

jest.mock('../services/recipeService', () => ({
  listRecipes: jest.fn().mockResolvedValue([])
}));

jest.mock('../services/recipeProgressService', () => ({
  fetchRecipeProgress: jest.fn().mockResolvedValue({ recipeId: 'case.surl.seed.alpha.v1', passedVersion: 0 })
}));

jest.mock('../services/attemptService', () => ({
  startCaseAttemptFromPool: jest.fn()
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
    expect(listRecipes).toHaveBeenCalled();
    expect(screen.getByText(/program path/i)).toBeInTheDocument();
    expect(fetchRecipeProgress).not.toHaveBeenCalled();
    expect(startCaseAttemptFromPool).not.toHaveBeenCalled();
  });
});
