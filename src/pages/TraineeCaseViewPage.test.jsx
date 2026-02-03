import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TraineeCaseViewPage from './TraineeCaseViewPage';
import { subscribeToCase } from '../services/caseService';
import { saveSubmission, subscribeToSubmission } from '../services/submissionService';
import { saveProgress, subscribeProgressForCases } from '../services/progressService';
import { fetchRecipeProgress, saveRecipeProgress } from '../services/recipeProgressService';
import { getSignedDocumentUrl } from '../services/documentService';

const mockFetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    blob: () => Promise.resolve(new Blob(['mock'], { type: 'application/octet-stream' })),
  })
);

jest.setTimeout(20000);

beforeAll(() => {
  global.fetch = mockFetch;
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = jest.fn();
  }
  if (!window.scrollTo) {
    window.scrollTo = jest.fn();
  }
});

afterEach(() => {
  mockFetch.mockClear();
});

afterAll(() => {
  delete global.fetch;
});

jest.mock('../services/caseService', () => ({
  subscribeToCase: jest.fn(),
}));

jest.mock('../services/submissionService', () => ({
  saveSubmission: jest.fn(),
  subscribeToSubmission: jest.fn(() => jest.fn()),
}));

jest.mock('../services/progressService', () => ({
  saveProgress: jest.fn(),
  subscribeProgressForCases: jest.fn(() => jest.fn()),
}));

jest.mock('../services/recipeProgressService', () => ({
  fetchRecipeProgress: jest.fn(),
  saveRecipeProgress: jest.fn(),
}));

jest.mock('../components/trainee/AuditItemCardFactory', () => {
  const React = require('react');

  return function MockAuditItemCardFactory({
    item,
    allocation,
    classificationFields = [],
    onSplitToggle,
    onClassificationChange,
    onSplitAmountChange,
    onRationaleChange,
    onNoteChange,
    isLocked,
  }) {
    const [isSplit, setIsSplit] = React.useState(false);
    const paymentId = item?.paymentId || item?.id || 'unknown';

    return (
      <div>
        <div>
          <button
            type="button"
            onClick={() => {
              if (typeof onRationaleChange === 'function') {
                onRationaleChange(paymentId, 'isException', false);
              }
            }}
          >
            Pass
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof onRationaleChange === 'function') {
                onRationaleChange(paymentId, 'isException', true);
              }
            }}
          >
            Exception
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            aria-label="Split across classifications"
            checked={isSplit}
            disabled={!!isLocked}
            onChange={(e) => {
              setIsSplit(e.target.checked);
              if (typeof onSplitToggle === 'function') {
                onSplitToggle(paymentId, e.target.checked);
              }
            }}
          />
          Split across classifications
        </label>

        {!isSplit ? (
          <label>
            Classification
            <select
              value={allocation?.singleClassification || ''}
              disabled={!!isLocked}
              onChange={(e) => {
                if (typeof onClassificationChange === 'function') {
                  onClassificationChange(paymentId, e.target.value);
                }
              }}
            >
              <option value="">Choose…</option>
              {classificationFields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div>
            {classificationFields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  aria-label={field.label}
                  value={allocation?.[field.key] ?? ''}
                  disabled={!!isLocked}
                  onChange={(e) => {
                    if (typeof onSplitAmountChange === 'function') {
                      onSplitAmountChange(paymentId, field.key, e.target.value);
                    }
                  }}
                />
              </label>
            ))}
          </div>
        )}

        {allocation?.isException === true ? (
          <label>
            Workpaper note
            <textarea
              aria-label="Workpaper note"
              value={allocation?.workpaperNote || ''}
              disabled={!!isLocked}
              onChange={(e) => {
                if (typeof onNoteChange === 'function') {
                  onNoteChange(paymentId, e.target.value);
                }
              }}
            />
          </label>
        ) : null}
      </div>
    );
  };
});

beforeEach(() => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  window.confirm?.mockRestore?.();
});

jest.mock('../services/documentService', () => ({
  getSignedDocumentUrl: jest.fn(),
}));

const mockModal = {
  showModal: jest.fn(),
  hideModal: jest.fn(),
};

jest.mock('../AppCore', () => {
  const navigateMock = jest.fn();
  return {
    Button: ({ children, isLoading, ...props }) => (
      <button {...props}>{isLoading ? 'Loading…' : children}</button>
    ),
    Input: (props) => <input {...props} />,
    Textarea: (props) => <textarea {...props} />,
    Select: ({ options = [], children, ...props }) => (
      <select {...props}>
        {children ||
          options.map(({ value, label }) => (
            <option key={value ?? label} value={value}>
              {label}
            </option>
          ))}
      </select>
    ),
    useRoute: () => ({ navigate: navigateMock }),
    useModal: () => mockModal,
    useAuth: () => ({ userId: 'u1' }),
    useUser: () => ({
      role: 'trainee',
      loadingRole: false,
      userProfile: { uid: 'u1' },
      billing: { status: 'paid' },
      loadingBilling: false,
    }),
    storage: { app: {} },
    appId: 'test-app',
  };
});

describe('TraineeCaseViewPage', () => {
  let consoleErrorSpy;
  const flushAsync = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  const baseInstruction = {
    title: 'Mission Briefing',
    moduleCode: 'SURL-101',
    hook: {
      headline: 'Confirm liabilities are recorded in the correct period.',
      risk: 'Cutoff errors misstate expenses.',
      body: 'Review the evidence and apply the cutoff rule before selecting items.',
    },
    visualAsset: { type: 'VIDEO', source_id: '' },
    heuristic: { rule_text: 'Expenses follow the work, not the paper.' },
    gateCheck: {
      question: 'What is the golden rule for cutoff?',
      options: [
        { id: 'opt-a', text: 'Expenses follow the work, not the paper.', correct: true },
        { id: 'opt-b', text: 'Use the invoice date every time.', correct: false },
      ],
    },
  };

  const renderCase = (casePayload) => {
    subscribeToCase.mockImplementation((_id, cb) => {
      cb({
        ...casePayload,
        instruction: casePayload?.instruction || baseInstruction,
      });
      return jest.fn();
    });
    return render(<TraineeCaseViewPage params={{ caseId: 'case-1' }} />);
  };

  const advanceToClassification = async () => {
    await screen.findByRole('heading', { name: /Step 1 — Instruction/i, level: 2 });
    await userEvent.click(screen.getByRole('radio', { name: /Expenses follow the work/i }));
    await userEvent.click(screen.getByRole('button', { name: /Enter the Simulation/i }));
    await screen.findByRole('heading', { name: /Step 2 — Select Disbursements/i, level: 2 });
    const [checkbox] = screen.getAllByRole('checkbox');
    await userEvent.click(checkbox);
    const continueButton = screen.getByRole('button', { name: /Continue to Classification/i });
    await userEvent.click(continueButton);
    await screen.findByRole('heading', { name: /Step 3 — Classify Results/i, level: 2 });
  };

  beforeEach(() => {
    mockModal.showModal.mockClear();
    mockModal.hideModal.mockClear();
    subscribeToCase.mockReset();
    subscribeProgressForCases.mockReset();
    saveSubmission.mockReset();
    subscribeToSubmission.mockReset();
    saveProgress.mockReset();
    fetchRecipeProgress.mockReset();
    saveRecipeProgress.mockReset();
    saveProgress.mockResolvedValue();
    fetchRecipeProgress.mockResolvedValue({ recipeId: 'case-1', passedVersion: 0, passedAt: null });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    getSignedDocumentUrl.mockReset();
    subscribeProgressForCases.mockImplementation((_params, onNext) => {
      if (typeof onNext === 'function') {
        onNext(new Map());
      }
      return jest.fn();
    });
    subscribeToSubmission.mockImplementation((_userId, _caseId, onData) => {
      if (typeof onData === 'function') {
        onData(null);
      }
      return jest.fn();
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    consoleErrorSpy.mockRestore();
  });

  test('navigates to classification and exposes allocation inputs', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        { paymentId: 'p1', payee: 'Vendor', amount: '100', paymentDate: '2024-01-01', downloadURL: 'https://example.com' },
      ],
    });

    await advanceToClassification();
    await flushAsync();
    const classificationSelect = await screen.findByRole('combobox', { name: /Classification/i });
    expect(classificationSelect).toBeEnabled();
    const splitToggle = await screen.findByRole('checkbox', { name: /Split across classifications/i });
    expect(splitToggle).toBeEnabled();
    await userEvent.click(splitToggle);
    const [properlyIncluded] = await screen.findAllByLabelText(/Properly Included/i);
    const [improperlyExcluded] = await screen.findAllByLabelText(/Improperly Excluded/i);
    expect(properlyIncluded).toBeEnabled();
    expect(improperlyExcluded).toBeEnabled();
  });

  test('skips gate when recipe progress is already passed', async () => {
    fetchRecipeProgress.mockResolvedValue({ recipeId: 'mod-1', passedVersion: 2, passedAt: null });

    renderCase({
      caseName: 'Case',
      moduleId: 'mod-1',
      instruction: { ...baseInstruction, version: 2 },
      disbursements: [
        { paymentId: 'p1', payee: 'Vendor', amount: '100', paymentDate: '2024-01-01', downloadURL: 'https://example.com' },
      ],
    });

    await screen.findByRole('heading', { name: /Step 1 — Instruction/i, level: 2 });
    await userEvent.click(screen.getByRole('button', { name: /Return to Simulation/i }));
    await screen.findByRole('heading', { name: /Step 2 — Select Disbursements/i, level: 2 });
  });

  test('uses cash-specific classification copy for cash audit area', async () => {
    renderCase({
      caseName: 'Cash Case',
      auditArea: 'cash',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Bank',
          amount: '500',
          paymentDate: '2024-01-01',
          downloadURL: 'https://example.com/bank.pdf',
        },
      ],
      cashContext: { bookBalance: '1000', bankBalance: '1000' },
      cashOutstandingItems: [
        { _tempId: 'o1', reference: 'Chk1045', payee: 'Drawer', issueDate: '2023-12-29', amount: '500' },
      ],
      cashCutoffItems: [{ _tempId: 'b1', reference: 'Chk1045', clearDate: '2024-01-03', amount: '500' }],
      cashArtifacts: [{ type: 'cash_year_end_statement', downloadURL: 'https://example.com/yearend.pdf', fileName: 'Year End' }],
    });

    await advanceToClassification();
    await flushAsync();
    expect(screen.getByRole('heading', { name: /Cash Case/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Step 3 — Classify Results/i })).toBeInTheDocument();
  });

  test('fetches evidence for storage-backed documents on classification step', async () => {
    getSignedDocumentUrl.mockResolvedValue('https://example.com/doc.pdf');
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          storagePath: 'artifacts/app/case_documents/case-1/doc.pdf',
        },
      ],
    });

    await advanceToClassification();
    await flushAsync();
    await waitFor(() => expect(getSignedDocumentUrl).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /open in new tab/i })).toBeInTheDocument();
  });

  test('reuses existing download URL when provided', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          downloadURL: 'https://example.com/invoice.pdf',
          fileName: 'invoice.pdf',
        },
      ],
    });

    await advanceToClassification();
    await flushAsync();
    expect(getSignedDocumentUrl).not.toHaveBeenCalled();
    expect(screen.getByText(/Now viewing: invoice\.pdf/i)).toBeInTheDocument();
  });

  test('prevents advancing when supporting documents are missing', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          storagePath: '',
          downloadURL: '',
        },
      ],
    });

    await screen.findByText(/Step 2 — Select Disbursements/i);
    await userEvent.click(screen.getByRole('checkbox', { name: /ID:\s*p1/i }));
    await userEvent.click(screen.getByRole('button', { name: /Continue to Classification/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Step 3 — Classify Results/i)).not.toBeInTheDocument();
    });
    await flushAsync();
    await waitFor(() => {
      expect(mockModal.showModal).toHaveBeenCalled();
    });
  });

  test('shows storage error when evidence document fails to load', async () => {
    getSignedDocumentUrl.mockRejectedValue({ code: 'storage/object-not-found' });
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          storagePath: 'artifacts/app/case_documents/case-1/missing.pdf',
        },
      ],
    });

    await advanceToClassification();
    await flushAsync();
    await waitFor(() => expect(screen.getByText(/Document is missing from storage./i)).toBeInTheDocument());
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading evidence document:', expect.objectContaining({ code: 'storage/object-not-found' }));
  });

  test.skip('renders reference download banner with buttons', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '150',
          paymentDate: '2024-01-01',
          downloadURL: 'https://example.com/invoice.pdf',
        },
      ],
      referenceDocuments: [
        { id: 'ref-1', fileName: 'Reference A.xlsx', downloadURL: 'https://example.com/ref-a.xlsx' },
        { id: 'ref-2', fileName: 'Reference B.pdf', storagePath: 'artifacts/app/reference/ref-b.pdf' },
      ],
    });

    getSignedDocumentUrl.mockResolvedValueOnce('https://example.com/generated/ref-b.pdf');

    await advanceToClassification();

    expect(
      screen.getByText(/Download the necessary reference documents before you begin classifying results/i)
    ).toBeInTheDocument();

    const directDownloadButton = screen.getByRole('button', { name: /Reference A\.xlsx/i });
    await userEvent.click(directDownloadButton);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('https://example.com/ref-a.xlsx'));

    const storageDownloadButton = screen.getByRole('button', { name: /Reference B\.pdf/i });
    await userEvent.click(storageDownloadButton);
    await waitFor(() =>
      expect(getSignedDocumentUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'case-123',
          storagePath: 'artifacts/app/reference/ref-b.pdf',
        })
      )
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('https://example.com/generated/ref-b.pdf'));
  });

  test('submits allocations and all supporting documents for a multi-invoice disbursement', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '150',
          paymentDate: '2024-01-01',
          supportingDocuments: [
            { fileName: 'invoice-1.pdf', downloadURL: 'https://example.com/invoice-1.pdf' },
            { fileName: 'invoice-2.pdf', downloadURL: 'https://example.com/invoice-2.pdf' },
          ],
        },
      ],
    });

    await advanceToClassification();

    const classificationSelect = await screen.findByRole('combobox', { name: /Classification/i });
    const splitToggle = await screen.findByRole('checkbox', { name: /Split across classifications/i });
    await userEvent.click(splitToggle);

    const enterValue = async (label, value) => {
      const [input] = await screen.findAllByLabelText(new RegExp(label, 'i'));
      await userEvent.clear(input);
      await userEvent.type(input, String(value));
    };

    await enterValue('Properly Included', 100);
    await enterValue('Properly Excluded', 50);
    await enterValue('Improperly Included', 0);
    await enterValue('Improperly Excluded', 0);

    await userEvent.click(screen.getByRole('button', { name: /^Pass$/i }));
    await userEvent.click(screen.getByRole('button', { name: /Submit Responses/i }));

    await waitFor(() => expect(saveSubmission).toHaveBeenCalled());
    await screen.findByRole('heading', { name: /Audit Completion Report/i });
    const [, , payload] = saveSubmission.mock.calls[0];
    expect(payload.retrievedDocuments).toHaveLength(2);
    expect(payload.disbursementClassifications.p1).toMatchObject({
      properlyIncluded: 100,
      properlyExcluded: 50,
      improperlyIncluded: 0,
      improperlyExcluded: 0,
    });
  });

  test('flags a missed exception on the results screen when a trap is passed', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Seed Alpha',
          amount: '125892.57',
          paymentDate: '2024-01-01',
          downloadURL: 'https://example.com/invoice.pdf',
          shouldFlag: true,
          expectedClassification: 'Improperly Excluded',
          requiredAssertions: ['Completeness'],
        },
      ],
    });

    await advanceToClassification();

    // Fill amounts for a pass decision (properly included) so the workflow is submit-ready.
    await userEvent.click(screen.getByRole('checkbox', { name: /Split across classifications/i }));
    const [properlyIncludedInput] = await screen.findAllByLabelText(/Properly Included/i);
    await userEvent.clear(properlyIncludedInput);
    await userEvent.type(properlyIncludedInput, '125892.57');

    await userEvent.click(screen.getByRole('button', { name: /^Pass$/i }));
    await userEvent.click(screen.getByRole('button', { name: /Submit Responses/i }));

    await screen.findByRole('heading', { name: /Audit Completion Report/i });
    expect(screen.getByText(/You missed 1 critical item/i)).toBeInTheDocument();
    expect(screen.getByText(/Seed Alpha/i)).toBeInTheDocument();
    expect(screen.getByText(/\$125,892\.57/)).toBeInTheDocument();
    expect(screen.getByText(/Your decision/i)).toBeInTheDocument();
    expect(screen.getByText(/Properly Included/i)).toBeInTheDocument();
    expect(screen.getByText(/Correct call/i)).toBeInTheDocument();
    expect(screen.getByText(/Improperly Excluded/i)).toBeInTheDocument();
  });

  test('shows retake + dashboard actions when all critical items are caught', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Seed Alpha',
          amount: '100',
          paymentDate: '2024-01-01',
          downloadURL: 'https://example.com/invoice.pdf',
          shouldFlag: true,
          expectedClassification: 'Improperly Excluded',
        },
      ],
    });

    await advanceToClassification();

    await userEvent.click(screen.getByRole('checkbox', { name: /Split across classifications/i }));
    const [improperlyExcludedInput] = await screen.findAllByLabelText(/Improperly Excluded/i);
    await userEvent.clear(improperlyExcludedInput);
    await userEvent.type(improperlyExcludedInput, '100');

    await userEvent.click(screen.getByRole('button', { name: /^Exception$/i }));
    await userEvent.type(screen.getByLabelText(/Workpaper note/i), 'Invoice dated after year-end; service performed before year-end.');
    await userEvent.click(screen.getByRole('button', { name: /Submit Responses/i }));

    await screen.findByRole('heading', { name: /Audit Completion Report/i });
    expect(screen.getByRole('button', { name: /Back to Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retake Case/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try Again/i })).not.toBeInTheDocument();
  });

  test.skip('displays reference documents panel and supports tab preview', async () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    try {
      renderCase({
        caseName: 'Case',
        disbursements: [
          {
            paymentId: 'p1',
            payee: 'Vendor',
            amount: '100',
            paymentDate: '2024-01-01',
            downloadURL: 'https://example.com/invoice.pdf',
          },
        ],
        referenceDocuments: [
          {
            fileName: 'AP Aging Summary.pdf',
            downloadURL: 'https://example.com/aging.pdf',
          },
        ],
      });

      await advanceToClassification();
      expect(screen.getByRole('heading', { name: /Reference Documents/i })).toBeInTheDocument();
      expect(screen.getByText(/AP Aging Summary/i)).toBeInTheDocument();
      expect(await screen.findByTitle(/Reference document/i)).toBeInTheDocument();

      const headerContainer = screen.getByRole('heading', { name: /Reference Documents/i }).parentElement?.parentElement;
      const openButton = within(headerContainer).getByRole('button', { name: /Open in new tab/i });
      await userEvent.click(openButton);
      expect(openSpy).toHaveBeenCalledWith('https://example.com/aging.pdf', '_blank');
    } finally {
      openSpy.mockRestore();
    }
  });

  test('shows fallback message when no reference documents exist', async () => {
    renderCase({
      caseName: 'Case',
      disbursements: [
        {
          paymentId: 'p1',
          payee: 'Vendor',
          amount: '100',
          paymentDate: '2024-01-01',
          downloadURL: 'https://example.com/invoice.pdf',
        },
      ],
      referenceDocuments: [],
    });

    await advanceToClassification();
    expect(
      screen.getByText(/Reference materials will appear here when provided by your instructor/i)
    ).toBeInTheDocument();
  });
});
