import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CaseFormPage, { mergeDisbursementDocuments } from './CaseFormPage';
import { fetchCase, createCase, updateCase } from '../services/caseService';
import { fetchUserRosterOptions, getCurrentUserOrgId } from '../services/userService';
import { DEFAULT_AUDIT_AREA } from '../models/caseConstants';
import { fetchGlobalTags, addGlobalTag } from '../services/tagService';

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn(),
  createCase: jest.fn(),
  updateCase: jest.fn()
}));

jest.mock('../services/tagService', () => ({
  fetchGlobalTags: jest.fn(async () => ({ skillCategories: [], errorReasons: [] })),
  addGlobalTag: jest.fn(async () => null),
  TAG_FIELDS: { SKILL_CATEGORIES: 'skillCategories', ERROR_REASONS: 'errorReasons' },
  DEFAULT_SKILL_CATEGORIES: [],
  DEFAULT_ERROR_REASONS: [],
}));

jest.mock('../services/userService', () => ({
  fetchUserRosterOptions: jest.fn(),
  getCurrentUserOrgId: jest.fn()
}));

const mockNavigate = jest.fn();
const mockShowModal = jest.fn();

jest.mock('../AppCore', () => ({
  Button: ({ children, isLoading, ...props }) => <button {...props}>{isLoading ? 'Loading…' : children}</button>,
  Input: (props) => <input {...props} />,
  Textarea: (props) => <textarea {...props} />,
  Select: ({ options = [], ...props }) => (
    <select {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  useRoute: () => ({ navigate: mockNavigate }),
  useModal: () => ({ showModal: mockShowModal }),
  useAuth: () => ({ userId: 'u1' }),
  useUser: () => ({ userProfile: {}, role: 'admin', loadingRole: false }),
  appId: 'app',
  storage: { app: {} }
}));

const flushRosterEffect = () =>
  act(async () => {
    await Promise.resolve();
  });

const clickNext = async (times = 1) => {
  for (let i = 0; i < times; i += 1) {
    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
  }
};

test.skip('renders create case heading', async () => {
  fetchCase.mockResolvedValue(null);
  render(<CaseFormPage params={{}} />);
  expect(await screen.findByText(/create new audit case/i)).toBeInTheDocument();
});

beforeEach(() => {
  fetchCase.mockReset();
  fetchUserRosterOptions.mockReset();
  fetchUserRosterOptions.mockResolvedValue([]);
  getCurrentUserOrgId.mockReset();
  getCurrentUserOrgId.mockResolvedValue('org-1');
  fetchGlobalTags.mockReset();
  fetchGlobalTags.mockResolvedValue({ skillCategories: [], errorReasons: [] });
  addGlobalTag.mockReset();
  addGlobalTag.mockResolvedValue(null);
  createCase.mockReset();
  updateCase.mockReset();
  mockShowModal.mockReset();
  mockNavigate.mockReset();
  window.confirm = jest.fn(() => true);
  window.localStorage?.clear?.();
});

describe('mergeDisbursementDocuments', () => {
  it('clears stale document metadata when mapping removed', () => {
    const disbursements = [
      {
        _tempId: '1',
        paymentId: 'p1',
        storagePath: 'artifacts/app/case_documents/case/old.pdf',
        fileName: 'old.pdf'
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
        fileName: 'new.pdf'
      }
    ];
    const result = mergeDisbursementDocuments(disbursements, invoiceMappings);
    expect(result[0].storagePath).toBe('artifacts/app/case_documents/case/new.pdf');
    expect(result[0].fileName).toBe('new.pdf');
    expect(result[0].supportingDocuments).toEqual([
      {
        storagePath: 'artifacts/app/case_documents/case/new.pdf',
        fileName: 'new.pdf',
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
            fileName: 'original.pdf'
          }
        ]
      }
    ];
    const invoiceMappings = [
      {
        paymentId: 'p1',
        storagePath: 'artifacts/app/case_documents/case/new.pdf',
        fileName: 'new.pdf'
      },
      {
        paymentId: 'p1',
        storagePath: 'artifacts/app/case_documents/case/extra.pdf',
        fileName: 'extra.pdf'
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

describe.skip('answer key validation', () => {
  beforeEach(() => {
    createCase.mockResolvedValue('case-123');
    updateCase.mockResolvedValue();
  });

  it('blocks submission when answer key totals do not match the disbursement amount', async () => {
    render(<CaseFormPage params={{}} />);

    await flushRosterEffect();

    await userEvent.type(screen.getByLabelText(/Year-End Date/i), '12/31/20X3');

    await clickNext(2);

    const opensAtInput = screen.getByLabelText(/Opens At \(UTC\)/i);
    fireEvent.change(opensAtInput, { target: { value: '2024-03-01T00:00' } });
    const dueAtInput = screen.getByLabelText(/Due At \(UTC\)/i);
    fireEvent.change(dueAtInput, { target: { value: '2024-03-05T00:00' } });

    await clickNext();

    await userEvent.type(screen.getByPlaceholderText(/Payment ID/i), 'P-100');
    await userEvent.type(screen.getByPlaceholderText(/Payee/i), 'Vendor Mismatch');
    await userEvent.type(screen.getByPlaceholderText(/Amount \(e\.g\., 123\.45\)/i), '150');
    const paymentDateInput = screen.getByPlaceholderText(/Payment Date/i);
    fireEvent.change(paymentDateInput, { target: { value: '2024-03-01' } });

    await clickNext(2);

    await userEvent.click(await screen.findByRole('button', { name: /Edit details/i }));
    await userEvent.click(screen.getByLabelText(/Split disbursement across classifications/i));
    const properlyIncluded = screen.getByLabelText('Properly Included');
    await userEvent.type(properlyIncluded, '100');
    const properlyExcluded = screen.getByLabelText('Properly Excluded');
    await userEvent.type(properlyExcluded, '25');
    const improperlyIncluded = screen.getByLabelText(/Improperly Included/i);
    await userEvent.type(improperlyIncluded, '10');
    const improperlyExcluded = screen.getByLabelText(/Improperly Excluded/i);
    await userEvent.type(improperlyExcluded, '0');
    const explanation = screen.getByLabelText(/Explanation shown to trainees/i);
    await userEvent.type(explanation, 'Intentional mismatch to trigger validation.');

    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    const submitButton = screen.getByRole('button', { name: /Create Case/i });
    expect(submitButton).toBeDisabled();
    expect(
      screen.getByText(/Complete the submission checklist before submitting\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Answer key incomplete for disbursement #1/i)
    ).toBeInTheDocument();
    await userEvent.click(submitButton);
    expect(mockShowModal).not.toHaveBeenCalled();
    expect(createCase).not.toHaveBeenCalled();
    expect(updateCase).not.toHaveBeenCalled();
  });
});

describe.skip('reference documents', () => {
  beforeEach(() => {
    fetchCase.mockReset();
  });

  it('renders reference documents section for new case', async () => {
    render(<CaseFormPage params={{}} />);
    await flushRosterEffect();
    await clickNext(4);
    expect(screen.getByRole('heading', { name: /Reference Documents/i })).toBeInTheDocument();
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
    await clickNext(4);
    expect(await screen.findByDisplayValue('AP Aging Summary.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Advanced options/i }));
    expect(screen.getByDisplayValue('https://example.com/aging.pdf')).toBeInTheDocument();
  });
});

describe.skip('audience selection', () => {
  it('disables roster selector while case is public', async () => {
    fetchUserRosterOptions.mockResolvedValue([
      { id: 'user-1', label: 'User One', email: 'one@example.com' },
    ]);

    render(<CaseFormPage params={{}} />);

    await flushRosterEffect();
    await waitFor(() => expect(fetchUserRosterOptions).toHaveBeenCalled());
    await clickNext(2);
    expect(screen.queryByLabelText(/search roster/i)).not.toBeInTheDocument();
    expect(screen.getByText(/This case is currently visible to all trainees./i)).toBeInTheDocument();
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

    await userEvent.type(screen.getByLabelText(/Year-End Date/i), '12/31/20X3');
    await clickNext(2);
    const visibilityToggle = await screen.findByLabelText(/Visible to all signed-in trainees/i);
    await userEvent.click(visibilityToggle);

    const rosterInput = await screen.findByLabelText(/search roster/i);
    expect(rosterInput).not.toBeDisabled();

    await userEvent.type(rosterInput, 'User Two');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: /Remove User Two/i })).toBeInTheDocument());
    expect(rosterInput).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await userEvent.type(screen.getByPlaceholderText(/Payment ID/i), 'P-1');
    await userEvent.type(screen.getByPlaceholderText(/Payee/i), 'Vendor Inc');
    await userEvent.type(screen.getByPlaceholderText(/Amount \(e\.g\., 123\.45\)/i), '125.50');
    const paymentDateInput = screen.getByPlaceholderText(/Payment Date/i);
    fireEvent.change(paymentDateInput, { target: { value: '2024-01-01' } });

    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    await userEvent.click(await screen.findByRole('button', { name: /Edit details/i }));
    const classificationSelect = await screen.findByRole('combobox', { name: /^Classification$/i });
    fireEvent.change(classificationSelect, { target: { value: 'properlyIncluded' } });
    await waitFor(() => expect(classificationSelect.value).toBe('properlyIncluded'));
    await userEvent.type(screen.getByLabelText(/Explanation shown to trainees/i), 'All allocated to properly included.');
    await userEvent.click(screen.getByRole('button', { name: /Hide details/i }));

    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await screen.findByText(/Case Summary/);

    const submitButton = screen.getByRole('button', { name: /Create Case/i });
    await userEvent.click(submitButton);

    expect(mockShowModal).not.toHaveBeenCalled();

    await waitFor(() => expect(createCase).toHaveBeenCalled());
    const [createPayload] = createCase.mock.calls[0];
    expect(createPayload.visibleToUserIds).toEqual(['user-2']);
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
    await userEvent.type(screen.getByLabelText(/Year-End Date/i), '12/31/20X3');
    await clickNext(2);
    const visibilityToggle = await screen.findByLabelText(/Visible to all signed-in trainees/i);
    await userEvent.click(visibilityToggle);

    const rosterInput = await screen.findByLabelText(/search roster/i);
    await userEvent.type(rosterInput, 'manual-user');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(rosterInput).toHaveValue(''));
    expect(screen.getAllByText(/manual-user/i).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await userEvent.type(screen.getByPlaceholderText(/Payment ID/i), 'P-2');
    await userEvent.type(screen.getByPlaceholderText(/Payee/i), 'Vendor B');
    await userEvent.type(screen.getByPlaceholderText(/Amount \(e\.g\., 123\.45\)/i), '99.00');
    const paymentDateInput = screen.getByPlaceholderText(/Payment Date/i);
    fireEvent.change(paymentDateInput, { target: { value: '2024-02-02' } });

    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    await userEvent.click(await screen.findByRole('button', { name: /Edit details/i }));
    const classificationSelect = await screen.findByRole('combobox', { name: /^Classification$/i });
    fireEvent.change(classificationSelect, { target: { value: 'properlyIncluded' } });
    await waitFor(() => expect(classificationSelect.value).toBe('properlyIncluded'));
    await userEvent.type(screen.getByLabelText(/Explanation shown to trainees/i), 'All properly included.');
    await userEvent.click(screen.getByRole('button', { name: /Hide details/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await screen.findByText(/Case Summary/);

    const submitButton = screen.getByRole('button', { name: /Create Case/i });
    await userEvent.click(submitButton);

    await waitFor(() => expect(createCase).toHaveBeenCalled());
    const [createPayload] = createCase.mock.calls[0];
    expect(createPayload.visibleToUserIds).toEqual(['manual-user']);
    expect(createPayload.auditArea).toBe(DEFAULT_AUDIT_AREA);
    expect(createPayload.caseGroupId).toBeNull();
  });
});
