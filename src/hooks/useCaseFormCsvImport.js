import getUUID from '../utils/getUUID';
import { DEFAULT_ANSWER_KEY_CLASSIFICATION, buildSingleAnswerKey } from '../utils/caseFormHelpers';

export function createCaseFormCsvImportHandler({ disbursementCsvInputRef, setDisbursements, showModal }) {
  return function handleCsvImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const text = String(loadEvent.target?.result || '').trim();
        if (!text) {
          showModal('CSV file appears to be empty.', 'Import Error');
          return;
        }
        const rows = text.split(/\r?\n/).filter(Boolean);
        if (rows.length === 0) {
          showModal('CSV file appears to be empty.', 'Import Error');
          return;
        }
        const [headerLine, ...dataLines] = rows;
        const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
        const paymentIdIdx = headers.indexOf('paymentid');
        const payeeIdx = headers.indexOf('payee');
        const amountIdx = headers.indexOf('amount');
        const paymentDateIdx = headers.indexOf('paymentdate');

        if (paymentIdIdx === -1 || payeeIdx === -1 || amountIdx === -1 || paymentDateIdx === -1) {
          showModal('CSV must include PaymentID, Payee, Amount, PaymentDate columns.', 'Import Error');
          if (disbursementCsvInputRef.current) disbursementCsvInputRef.current.value = '';
          return;
        }

        const imported = dataLines.map((line) => {
          const cells = line.split(',');
          const amountValue = cells[amountIdx]?.trim() || '';
          const amountNumber = Number(amountValue) || 0;
          return {
            _tempId: getUUID(),
            paymentId: cells[paymentIdIdx]?.trim() || '',
            payee: cells[payeeIdx]?.trim() || '',
            amount: amountValue,
            paymentDate: cells[paymentDateIdx]?.trim() || '',
            answerKeyMode: 'single',
            answerKeySingleClassification: DEFAULT_ANSWER_KEY_CLASSIFICATION,
            answerKey: buildSingleAnswerKey(null, amountNumber, ''),
            mappings: [],
          };
        });

        if (imported.length === 0) {
          showModal('No rows found in CSV after header.', 'Import Error');
          if (disbursementCsvInputRef.current) disbursementCsvInputRef.current.value = '';
          return;
        }

        setDisbursements(imported);
        showModal(
          `Imported ${imported.length} disbursement${imported.length === 1 ? '' : 's'} from CSV.`,
          'Import Complete'
        );
      } catch (error) {
        console.error('Error parsing CSV:', error);
        showModal('Unable to read the CSV file. Please verify the format and try again.', 'Import Error');
      } finally {
        if (disbursementCsvInputRef.current) {
          disbursementCsvInputRef.current.value = '';
        }
      }
    };

    reader.onerror = () => {
      showModal('Unexpected error reading the CSV file. Please try again.', 'Import Error');
      if (disbursementCsvInputRef.current) {
        disbursementCsvInputRef.current.value = '';
      }
    };

    reader.readAsText(file);
  };
}

