import React from 'react';
import { render, screen } from '@testing-library/react';
import AdminDashboardPage from './AdminDashboardPage';
import {
  fetchCasesPage,
  subscribeToAdminCaseSummary,
  subscribeToAdminCaseAlerts,
  subscribeToRecentCaseActivity,
  DEFAULT_CASE_SORT,
} from '../services/caseService';
import { subscribeToRecentSubmissionActivity } from '../services/submissionService';
import { fetchUsersWithProfiles } from '../services/userService';
import { listCaseRecipes } from '../generation/recipeRegistry';
import { fetchRecipe } from '../services/recipeService';

const appCoreMocks = {};

jest.mock('../services/caseService', () => ({
  fetchCasesPage: jest.fn(),
  subscribeToAdminCaseSummary: jest.fn(),
  subscribeToAdminCaseAlerts: jest.fn(),
  subscribeToRecentCaseActivity: jest.fn(),
  markCaseDeleted: jest.fn(),
  repairLegacyCases: jest.fn(),
  CASE_SORT_CHOICES: [{ value: 'updated_desc', label: 'Recently updated' }],
  DEFAULT_CASE_SORT: 'updated_desc',
}));

jest.mock('../services/submissionService', () => ({
  subscribeToRecentSubmissionActivity: jest.fn(),
}));

jest.mock('../services/userService', () => ({
  fetchUsersWithProfiles: jest.fn(),
}));

jest.mock('../generation/recipeRegistry', () => ({
  listCaseRecipes: jest.fn(),
}));

jest.mock('../services/recipeService', () => ({
  fetchRecipe: jest.fn(),
}));

jest.mock('../AppCore', () => {
  const React = require('react');
  const navigateMock = jest.fn();
  const showModalMock = jest.fn();
  const setQueryMock = jest.fn();
  appCoreMocks.navigateMock = navigateMock;
  appCoreMocks.showModalMock = showModalMock;
  appCoreMocks.setQueryMock = setQueryMock;
  return {
    Button: React.forwardRef(({ children, onClick, className = '', ...props }, ref) => (
      <button ref={ref} onClick={onClick} className={className} {...props}>
        {children}
      </button>
    )),
    Input: React.forwardRef(({ onChange, ...props }, ref) => <input ref={ref} onChange={onChange} {...props} />),
    Select: React.forwardRef(({ onChange, children, ...props }, ref) => (
      <select ref={ref} onChange={onChange} {...props}>
        {children}
      </select>
    )),
    useRoute: () => ({
      navigate: navigateMock,
      setQuery: setQueryMock,
      query: {},
      route: '/',
      path: '/',
    }),
    useModal: () => ({ showModal: showModalMock }),
    useUser: () => ({ role: 'admin', loadingRole: false }),
  };
});

let mockNavigate;
let mockShowModal;
let mockSetQuery;

beforeEach(() => {
  jest.clearAllMocks();
  mockNavigate = appCoreMocks.navigateMock;
  mockShowModal = appCoreMocks.showModalMock;
  mockSetQuery = appCoreMocks.setQueryMock;
  mockNavigate?.mockReset();
  mockShowModal?.mockReset();
  mockSetQuery?.mockReset();
  fetchCasesPage.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    requestedPage: 1,
    pageSize: 12,
    hasNextPage: false,
    hasPreviousPage: false,
    sort: DEFAULT_CASE_SORT,
    search: '',
    statusFilters: [],
    visibilityFilters: [],
  });
  subscribeToAdminCaseSummary.mockImplementation((cb) => {
    cb({ activeCases: 0, totalDisbursements: 0, totalMappings: 0, privateAudiences: 0 });
    return jest.fn();
  });
  subscribeToAdminCaseAlerts.mockImplementation((cb) => {
    cb([]);
    return jest.fn();
  });
  subscribeToRecentCaseActivity.mockImplementation((cb) => {
    cb([]);
    return jest.fn();
  });
  subscribeToRecentSubmissionActivity.mockImplementation((cb) => {
    cb([]);
    return jest.fn();
  });
  fetchUsersWithProfiles.mockResolvedValue([]);
  listCaseRecipes.mockReturnValue([
    {
      id: 'case.surl.promotador.v1',
      label: 'SURL Cutoff (Generated)',
      moduleTitle: 'Basic SURL',
      pathId: 'general',
      tier: 'foundations',
      auditArea: 'payables',
      primarySkill: 'Cutoff',
      version: 1,
    },
  ]);
  fetchRecipe.mockResolvedValue(null);
});

test('renders admin dashboard heading', async () => {
  render(<AdminDashboardPage />);
  await screen.findByText(/admin dashboard/i);
});
