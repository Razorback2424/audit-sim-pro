import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CaseFormPage, { mergeDisbursementDocuments } from './CaseFormPage';
import { fetchCase, createCase, updateCase } from '../services/caseService';
import { fetchUserRosterOptions } from '../services/userService';
import { DEFAULT_AUDIT_AREA } from '../models/caseConstants';

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn(),
  createCase: jest.fn(),
  updateCase: jest.fn()
}));

jest.mock('../services/userService', () => ({
  fetchUserRosterOptions: jest.fn()
}));

const mockNavigate = jest.fn();
const mockShowModal = jest.fn();

jest.mock('../AppCore', () => ({
  Button: ({ children, isLoading, ...props }) => <button {...props}>{isLoading ? 'Loading…' : children}</button>,
  Input: (props) => <input {...props} />,
  Textarea: (props) => <textarea {...props} />,
  Select: (props) => <select {...props} />,
  useRoute: () => ({ navigate: mockNavigate }),
  useModal: () => ({ showModal: mockShowModal }),
  useAuth: () => ({ userId: 'u1' }),
  appId: 'app',
  storage: { app: {} }
}));

const flushRosterEffect = () =>
  act(async () => {
    await Promise.resolve();
  });

test.skip('renders create case heading', async () => {
  fetchCase.mockResolvedValue(null);
  render(<CaseFormPage params={{}} />);
  expect(await screen.findByText(/create new audit case/i)).toBeInTheDocument();
});

beforeEach(() => {
  fetchCase.mockReset();
  fetchUserRosterOptions.mockReset();
  fetchUserRosterOptions.mockResolvedValue([]);
  createCase.mockReset();
  updateCase.mockReset();
  mockShowModal.mockReset();
  mockNavigate.mockReset();
});

describe('mergeDisbursementDocuments', () => {
  it('clears stale document metadata when mapping removed', () => {
    const disbursements = [
      {
        _tempId: '1',
        paymentId: 'p1',
        storagePath: 'artifacts/app/case_documents/case/old.pdf',
        fileName: 'old.pdf',
        downloadURL: 'https://example.com/old.pdf'
      }
    ];
    const result = mergeDisbursementDocuments(disbursements, []);
    expect(result[0].storagePath).toBeUndefined();
    expect(result[0].fileName).toBeUndefined();
    expect(result[0].downloadURL).toBeUndefined();
    expect(result[0].supportingDocuments).toBeUndefined();
  });

  it('applies latest mapping metadata to matching disbursement', () => {
    const disbursements = [
      {
        _tempId: '1',
        paymentId: 'p1',
        payee: 'Vendor',
        amount: '100',
        paymentDate: '2024-01-01'
      }
    ];
    const invoiceMappings = [
      {
        paymentId: 'p1',
        storagePath: 'artifacts/app/case_documents/case/new.pdf',
        fileName: 'new.pdf',
        downloadURL: 'https://example.com/new.pdf'
      }
    ];
    const result = mergeDisbursementDocuments(disbursements, invoiceMappings);
    expect(result[0].storagePath).toBe('artifacts/app/case_documents/case/new.pdf');
    expect(result[0].fileName).toBe('new.pdf');
    expect(result[0].downloadURL).toBe('https://example.com/new.pdf');
    expect(result[0].supportingDocuments).toEqual([
      {
        storagePath: 'artifacts/app/case_documents/case/new.pdf',
        fileName: 'new.pdf',
        downloadURL: 'https://example.com/new.pdf',
        contentType: ''
      }
    ]);
  });

  it('merges multiple documents for the same disbursement', () => {
    const disbursements = [
      {
        _tempId: '1',
        paymentId: 'p1',
        payee: 'Vendor',
        amount: '100',
        paymentDate: '2024-01-01',
        supportingDocuments: [
          {
            storagePath: 'artifacts/app/case_documents/case/original.pdf',
            fileName: 'original.pdf',
            downloadURL: 'https://example.com/original.pdf'
          }
        ]
      }
    ];
    const invoiceMappings = [
      {
        paymentId: 'p1',
        storagePath: 'artifacts/app/case_documents/case/new.pdf',
        fileName: 'new.pdf',
        downloadURL: 'https://example.com/new.pdf'
      },
      {
        paymentId: 'p1',
        storagePath: 'artifacts/app/case_documents/case/extra.pdf',
        fileName: 'extra.pdf',
        downloadURL: 'https://example.com/extra.pdf'
      }
    ];
    const result = mergeDisbursementDocuments(disbursements, invoiceMappings);
    expect(result[0].supportingDocuments).toHaveLength(3);
    expect(result[0].supportingDocuments.map((doc) => doc.fileName)).toEqual([
      'original.pdf',
      'new.pdf',
      'extra.pdf'
    ]);
  });
});

describe('answer key validation', () => {
  beforeEach(() => {
    createCase.mockResolvedValue('case-123');
    updateCase.mockResolvedValue();
  });

  it('blocks submission when answer key totals do not match the disbursement amount', async () => {
    render(<CaseFormPage params={{}} />);

    await flushRosterEffect();

    await userEvent.type(screen.getByLabelText(/Case Name/i), 'Mismatch Case');
    await userEvent.type(screen.getByPlaceholderText(/Payment ID/i), 'P-100');
    await userEvent.type(screen.getByPlaceholderText(/Payee/i), 'Vendor Mismatch');
    await userEvent.type(screen.getByPlaceholderText(/Amount \(e\.g\., 123\.45\)/i), '150');
    const paymentDateInput = screen.getByPlaceholderText(/Payment Date/i);
    fireEvent.change(paymentDateInput, { target: { value: '2024-03-01' } });

    const answerKeySection = screen.getByText('Answer Key (Correct Allocation) — optional').closest('div');
    const properlyIncluded = within(answerKeySection).getByLabelText('Properly Included');
    await userEvent.type(properlyIncluded, '100');
    const properlyExcluded = within(answerKeySection).getByLabelText('Properly Excluded');
    await userEvent.type(properlyExcluded, '25');
    const improperlyIncluded = screen.getByLabelText(/Improperly Included/i);
    await userEvent.type(improperlyIncluded, '10');

    const submitButton = screen.getByRole('button', { name: /Create Case/i });
    await userEvent.click(submitButton);

    await waitFor(() => expect(mockShowModal).toHaveBeenCalled());
    const [message, title] = mockShowModal.mock.calls[0];
    expect(title).toBe('Answer Key Validation');
    expect(message).toMatch(/must equal the disbursement amount/i);
    expect(createCase).not.toHaveBeenCalled();
    expect(updateCase).not.toHaveBeenCalled();
  });
});

describe('reference documents', () => {
  beforeEach(() => {
    fetchCase.mockReset();
  });

  it('renders reference documents section for new case', async () => {
    render(<CaseFormPage params={{}} />);
    await flushRosterEffect();
    expect(screen.getByText(/Reference Documents/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Reference Document/i })).toBeInTheDocument();
  });

  it('preloads existing reference documents when editing', async () => {
    fetchCase.mockResolvedValue({
      caseName: 'Sample Case',
      disbursements: [],
      invoiceMappings: [],
      referenceDocuments: [
        { fileName: 'AP Aging Summary.pdf', storagePath: '', downloadURL: 'https://example.com/aging.pdf' }
      ]
    });

    render(<CaseFormPage params={{ caseId: 'case-1' }} />);

    await flushRosterEffect();
    await waitFor(() => expect(fetchCase).toHaveBeenCalledWith('case-1'));
    expect(await screen.findByDisplayValue('AP Aging Summary.pdf')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com/aging.pdf')).toBeInTheDocument();
  });
});

describe('audience selection', () => {
  it('disables roster selector while case is public', async () => {
    fetchUserRosterOptions.mockResolvedValue([
      { id: 'user-1', label: 'User One', email: 'one@example.com' },
    ]);

    render(<CaseFormPage params={{}} />);

    await flushRosterEffect();
    await waitFor(() => expect(fetchUserRosterOptions).toHaveBeenCalled());
    const rosterInput = await screen.findByLabelText(/search roster/i);
    expect(rosterInput).toBeDisabled();
  });

  it('submits selected roster IDs for private cases', async () => {
    fetchUserRosterOptions.mockResolvedValue([
      { id: 'user-1', label: 'User One', email: 'one@example.com' },
      { id: 'user-2', label: 'User Two', email: 'two@example.com' },
    ]);
    createCase.mockResolvedValue('case-123');
    updateCase.mockResolvedValue();

    render(<CaseFormPage params={{}} />);

    await flushRosterEffect();
    await waitFor(() => expect(fetchUserRosterOptions).toHaveBeenCalled());

    const visibilityToggle = await screen.findByLabelText(/Visible to all signed-in trainees/i);
    await userEvent.click(visibilityToggle);

    const rosterInput = await screen.findByLabelText(/search roster/i);
    expect(rosterInput).not.toBeDisabled();

    await userEvent.type(rosterInput, 'User Two');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: /Remove User Two/i })).toBeInTheDocument());
    expect(rosterInput).toHaveValue('');

    await userEvent.type(screen.getByLabelText(/Case Name/i), 'Case Title');
    await userEvent.type(screen.getByPlaceholderText(/Payment ID/i), 'P-1');
    await userEvent.type(screen.getByPlaceholderText(/Payee/i), 'Vendor Inc');
    await userEvent.type(screen.getByPlaceholderText(/Amount \(e\.g\., 123\.45\)/i), '125.50');
    const paymentDateInput = screen.getByPlaceholderText(/Payment Date/i);
    fireEvent.change(paymentDateInput, { target: { value: '2024-01-01' } });

    const submitButton = screen.getByRole('button', { name: /Create Case/i });
    await userEvent.click(submitButton);

    await waitFor(() => expect(updateCase).toHaveBeenCalled());
    const [, payload] = updateCase.mock.calls[0];
    expect(payload.visibleToUserIds).toEqual(['user-2']);
    expect(payload.auditArea).toBe(DEFAULT_AUDIT_AREA);
    expect(payload.caseGroupId).toBeNull();
    expect(createCase).toHaveBeenCalled();
    const [createPayload] = createCase.mock.calls[0];
    expect(createPayload.auditArea).toBe(DEFAULT_AUDIT_AREA);
    expect(createPayload.caseGroupId).toBeNull();
  });

  it('allows manual ID entry when roster lookup fails', async () => {
    fetchUserRosterOptions.mockRejectedValue(new Error('permission-denied'));
    createCase.mockResolvedValue('case-789');
    updateCase.mockResolvedValue();

    render(<CaseFormPage params={{}} />);

    await flushRosterEffect();
    await waitFor(() => expect(fetchUserRosterOptions).toHaveBeenCalled());
    expect(
      await screen.findByText(/Unable to load roster options\. Try refreshing or contact support\./i)
    ).toBeInTheDocument();

    const visibilityToggle = await screen.findByLabelText(/Visible to all signed-in trainees/i);
    await userEvent.click(visibilityToggle);

    const rosterInput = await screen.findByLabelText(/search roster/i);
    await userEvent.type(rosterInput, 'manual-user');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(rosterInput).toHaveValue(''));
    expect(screen.getByText(/manual-user/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Case Name/i), 'Manual Case');
    await userEvent.type(screen.getByPlaceholderText(/Payment ID/i), 'P-2');
    await userEvent.type(screen.getByPlaceholderText(/Payee/i), 'Vendor B');
    await userEvent.type(screen.getByPlaceholderText(/Amount \(e\.g\., 123\.45\)/i), '99.00');
    const paymentDateInput = screen.getByPlaceholderText(/Payment Date/i);
    fireEvent.change(paymentDateInput, { target: { value: '2024-02-02' } });

    const submitButton = screen.getByRole('button', { name: /Create Case/i });
    await userEvent.click(submitButton);

    await waitFor(() => expect(updateCase).toHaveBeenCalled());
    const [, payload] = updateCase.mock.calls[0];
    expect(payload.visibleToUserIds).toEqual(['manual-user']);
    expect(payload.auditArea).toBe(DEFAULT_AUDIT_AREA);
    expect(payload.caseGroupId).toBeNull();
    expect(createCase).toHaveBeenCalled();
    const [createPayload] = createCase.mock.calls[0];
    expect(createPayload.auditArea).toBe(DEFAULT_AUDIT_AREA);
    expect(createPayload.caseGroupId).toBeNull();
  });
});
