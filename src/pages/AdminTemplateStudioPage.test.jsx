import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminTemplateStudioPage from './AdminTemplateStudioPage';
import { generateTemplateDoc } from '../services/templateDocService';

const appCoreMocks = { role: 'admin' };

jest.mock('../services/templateDocService', () => ({
  generateTemplateDoc: jest.fn(),
}));

jest.mock('../AppCore', () => {
  const React = require('react');
  return {
    Button: React.forwardRef(({ children, onClick, className = '', isLoading = false, ...props }, ref) => (
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
    Textarea: React.forwardRef(({ onChange, ...props }, ref) => <textarea ref={ref} onChange={onChange} {...props} />),
    appId: 'studio-test-app',
    useRoute: () => ({ navigate: jest.fn() }),
    useUser: () => ({ role: appCoreMocks.role, loadingRole: false }),
  };
});

beforeEach(() => {
  appCoreMocks.role = 'admin';
  jest.clearAllMocks();
  global.URL.createObjectURL = jest.fn(() => 'blob:studio');
  global.URL.revokeObjectURL = jest.fn();
  window.open = jest.fn();
  HTMLAnchorElement.prototype.click = jest.fn();
  generateTemplateDoc.mockResolvedValue({
    templateId: 'invoice.seed.alpha.v1',
    fileName: 'invoice.pdf',
    contentType: 'application/pdf',
    pdfBase64: window.btoa('PDF'),
  });
});

test('non-admins see the blocked state and cannot generate', () => {
  appCoreMocks.role = 'trainee';
  render(<AdminTemplateStudioPage />);
  expect(screen.getByText('Loading…')).toBeInTheDocument();
  expect(generateTemplateDoc).not.toHaveBeenCalled();
});

test('selecting AP Aging exposes the nine rendered columns', () => {
  render(<AdminTemplateStudioPage />);
  fireEvent.change(screen.getByLabelText('Template'), {
    target: { value: 'refdoc.ap-aging.v1' },
  });
  expect(screen.getByText('Aging rows')).toBeInTheDocument();
  ['Vendor', 'Invoice #', 'Invoice date', 'Due date', 'Amount', 'Current', '1-30', '31-60', '90+'].forEach(
    (label) => expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  );
});

test('row identity survives removing the first row', () => {
  render(<AdminTemplateStudioPage />);
  fireEvent.change(screen.getByLabelText('Template'), {
    target: { value: 'refdoc.ap-aging.v1' },
  });
  expect(screen.getByDisplayValue('LogoForge Plastics')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
  expect(screen.getByDisplayValue('LogoForge Plastics')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('SummitDrinkware Supply')).not.toBeInTheDocument();
});

test('aging warnings stay visible without disabling Generate', async () => {
  render(<AdminTemplateStudioPage />);
  fireEvent.change(screen.getByLabelText('Template'), {
    target: { value: 'refdoc.ap-aging.v1' },
  });
  fireEvent.change(screen.getByLabelText('Row 1 Current'), { target: { value: '100' } });
  expect(await screen.findByText(/Row 1 bucket total does not equal/i)).toBeInTheDocument();
  const generateButton = screen.getByRole('button', { name: /Generate and download/i });
  expect(generateButton).not.toBeDisabled();
  fireEvent.click(generateButton);
  await waitFor(() => expect(generateTemplateDoc).toHaveBeenCalled());
});

test('successful generation exposes a download affordance', async () => {
  render(<AdminTemplateStudioPage />);
  fireEvent.click(screen.getByRole('button', { name: /Generate and download/i }));
  await waitFor(() => expect(screen.getByText('Download again')).toBeInTheDocument());
  expect(generateTemplateDoc).toHaveBeenCalledWith(
    expect.objectContaining({ appId: 'studio-test-app', templateId: 'invoice.seed.alpha.v1' })
  );
});
