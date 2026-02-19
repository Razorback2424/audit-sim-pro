import { createCaseFormCsvImportHandler } from './useCaseFormCsvImport';

class MockFileReader {
  readAsText(file) {
    if (typeof this.onload === 'function') {
      this.onload({ target: { result: file.__content } });
    }
  }
}

describe('createCaseFormCsvImportHandler', () => {
  const OriginalFileReader = global.FileReader;

  beforeEach(() => {
    global.FileReader = MockFileReader;
  });

  afterEach(() => {
    global.FileReader = OriginalFileReader;
  });

  test('calls onImportCompleted after successful csv import', () => {
    const setDisbursements = jest.fn();
    const showModal = jest.fn();
    const onImportCompleted = jest.fn();
    const disbursementCsvInputRef = { current: { value: 'seed' } };

    const handleCsvImport = createCaseFormCsvImportHandler({
      disbursementCsvInputRef,
      setDisbursements,
      showModal,
      onImportCompleted,
    });

    const file = { __content: 'PaymentID,Payee,Amount,PaymentDate\nP-1,Vendor A,123.45,2025-01-31' };

    handleCsvImport({
      target: {
        files: [file],
      },
    });

    expect(setDisbursements).toHaveBeenCalledTimes(1);
    expect(onImportCompleted).toHaveBeenCalledTimes(1);
    expect(onImportCompleted).toHaveBeenCalledWith({ importedCount: 1 });
    expect(showModal).toHaveBeenCalledWith('Imported 1 disbursement from CSV.', 'Import Complete');
    expect(disbursementCsvInputRef.current.value).toBe('');
  });
});
