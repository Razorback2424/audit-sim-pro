import React from 'react';
import { render, screen } from '@testing-library/react';
import AdminDashboardPage from './AdminDashboardPage';
import {
  subscribeToCases,
  subscribeToAdminCaseSummary,
  subscribeToAdminCaseAlerts,
  subscribeToRecentCaseActivity,
} from '../services/caseService';
import { subscribeToRecentSubmissionActivity } from '../services/submissionService';

const appCoreMocks = {};

jest.mock('../services/caseService', () => ({
  subscribeToCases: jest.fn(),
  subscribeToAdminCaseSummary: jest.fn(),
  subscribeToAdminCaseAlerts: jest.fn(),
  subscribeToRecentCaseActivity: jest.fn(),
  markCaseDeleted: jest.fn(),
  repairLegacyCases: jest.fn(),
}));

jest.mock('../services/submissionService', () => ({
  subscribeToRecentSubmissionActivity: jest.fn(),
}));

jest.mock('../AppCore', () => {
  const React = require('react');
  const navigateMock = jest.fn();
  const showModalMock = jest.fn();
  appCoreMocks.navigateMock = navigateMock;
  appCoreMocks.showModalMock = showModalMock;
  return {
    Button: React.forwardRef(({ children, onClick, className = '', ...props }, ref) => (
      <button ref={ref} onClick={onClick} className={className} {...props}>
        {children}
      </button>
    )),
    useRoute: () => ({ navigate: navigateMock }),
    useModal: () => ({ showModal: showModalMock }),
    useUser: () => ({ role: 'admin', loadingRole: false }),
  };
});

let mockNavigate;
let mockShowModal;

beforeEach(() => {
  jest.clearAllMocks();
  mockNavigate = appCoreMocks.navigateMock;
  mockShowModal = appCoreMocks.showModalMock;
  mockNavigate?.mockReset();
  mockShowModal?.mockReset();
  subscribeToCases.mockImplementation((cb) => {
    setTimeout(() => cb([]), 0);
    return jest.fn();
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
});

test('renders admin dashboard heading', async () => {
  render(<AdminDashboardPage />);
  await screen.findByText(/admin dashboard/i);
});
