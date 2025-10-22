import React from 'react';
import { render, screen } from '@testing-library/react';
import AdminDashboardPage from './AdminDashboardPage';
import { subscribeToCases } from '../services/caseService';

jest.mock('../services/caseService', () => ({
  subscribeToCases: jest.fn()
}));

jest.mock('../AppCore', () => {
  const React = require('react');
  return {
    Button: React.forwardRef(({ children, onClick, className = '', ...props }, ref) => (
      <button ref={ref} onClick={onClick} className={className} {...props}>
        {children}
      </button>
    )),
    useRoute: () => ({ navigate: jest.fn() }),
    useModal: () => ({ showModal: jest.fn() }),
    useUser: () => ({ role: 'admin', loadingRole: false })
  };
});

test('renders admin dashboard heading', async () => {
  subscribeToCases.mockImplementation((cb) => {
    setTimeout(() => cb([]), 0);
    return jest.fn();
  });
  render(<AdminDashboardPage />);
  await screen.findByText(/admin dashboard/i);
});
