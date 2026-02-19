import getUUID from '../utils/getUUID';
import { DEFAULT_ANSWER_KEY_CLASSIFICATION, buildSingleAnswerKey } from '../utils/caseFormHelpers';

export function createCaseFormCsvImportHandler({
  disbursementCsvInputRef,
  setDisbursements,
  showModal,
  onImportCompleted,
}) {
  return function handleCsvImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const isValidIsoDate = (value) => {
      if (!value) return false;
      const trimmed = String(value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
      const [year, month, day] = trimmed.split('-').map((part) => Number(part));
      if (!year || !month || !day) return false;
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    };

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

        const errors = [];
        const imported = dataLines.map((line, index) => {
          const cells = line.split(',');
          const rowNumber = index + 2;
          const amountValue = cells[amountIdx]?.trim() || '';
          const amountNumber = Number(amountValue);
          const paymentId = cells[paymentIdIdx]?.trim() || '';
          const paymentDate = cells[paymentDateIdx]?.trim() || '';

          if (!paymentId) {
            errors.push(`Row ${rowNumber}: missing PaymentID.`);
          }
          if (!amountValue || Number.isNaN(amountNumber)) {
            errors.push(`Row ${rowNumber}: invalid Amount "${amountValue || 'blank'}".`);
          }
          if (!isValidIsoDate(paymentDate)) {
            errors.push(`Row ${rowNumber}: invalid PaymentDate "${paymentDate || 'blank'}" (expected YYYY-MM-DD).`);
          }

          if (!paymentId || !amountValue || Number.isNaN(amountNumber) || !isValidIsoDate(paymentDate)) {
            return null;
          }

          return {
            _tempId: getUUID(),
            paymentId,
            payee: cells[payeeIdx]?.trim() || '',
            amount: amountValue,
            paymentDate,
            answerKeyMode: 'single',
            answerKeySingleClassification: DEFAULT_ANSWER_KEY_CLASSIFICATION,
            answerKey: buildSingleAnswerKey(null, amountNumber, ''),
            mappings: [],
          };
        }).filter(Boolean);

        if (errors.length > 0) {
          const preview = errors.slice(0, 5).join(' ');
          const suffix = errors.length > 5 ? ` (+${errors.length - 5} more).` : '';
          showModal(`CSV import failed. ${preview}${suffix}`, 'Import Error');
          if (disbursementCsvInputRef.current) disbursementCsvInputRef.current.value = '';
          return;
        }

        if (imported.length === 0) {
          showModal('No rows found in CSV after header.', 'Import Error');
          if (disbursementCsvInputRef.current) disbursementCsvInputRef.current.value = '';
          return;
        }

        setDisbursements(imported);
        if (typeof onImportCompleted === 'function') {
          onImportCompleted({
            importedCount: imported.length,
          });
        }
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
