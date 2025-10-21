import { render, screen, waitFor } from '@testing-library/react';
import CaseFormPage, { mergeDisbursementDocuments } from './CaseFormPage';
import { fetchCase } from '../services/caseService';

jest.mock('../services/caseService', () => ({
  fetchCase: jest.fn(),
  createCase: jest.fn(),
  updateCase: jest.fn()
}));

jest.mock('../AppCore', () => ({
  Button: ({ children }) => <button>{children}</button>,
  Input: (props) => <input {...props} />,
  Textarea: (props) => <textarea {...props} />,
  Select: (props) => <select {...props} />,
  useRoute: () => ({ navigate: jest.fn() }),
  useModal: () => ({ showModal: jest.fn() }),
  useAuth: () => ({ userId: 'u1' }),
  appId: 'app'
}));

test.skip('renders create case heading', async () => {
  fetchCase.mockResolvedValue(null);
  render(<CaseFormPage params={{}} />);
  expect(await screen.findByText(/create new audit case/i)).toBeInTheDocument();
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
        downloadURL: 'https://example.com/new.pdf'
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

describe('reference documents', () => {
  beforeEach(() => {
    fetchCase.mockReset();
  });

  it('renders reference documents section for new case', () => {
    render(<CaseFormPage params={{}} />);
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

    await waitFor(() => expect(fetchCase).toHaveBeenCalledWith('case-1'));
    expect(await screen.findByDisplayValue('AP Aging Summary.pdf')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com/aging.pdf')).toBeInTheDocument();
  });
});
