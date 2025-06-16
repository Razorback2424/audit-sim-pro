import React, { useEffect, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { storage, appId } from '../AppCore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { useAuth, Input, Textarea, Button, useRoute, useModal } from '../AppCore';
import { fetchCase, createCase, updateCase } from '../services/caseService';
import getUUID from '../utils/getUUID';
import { PlusCircle, Trash2, Paperclip, CheckCircle2, AlertTriangle, UploadCloud } from 'lucide-react';

export default function CaseFormPage({ params }) {
  const { caseId: editingCaseId } = params || {};
  const isEditing = !!editingCaseId;
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { showModal } = useModal();

  const initialDisbursement = () => ({ _tempId: getUUID(), paymentId: '', payee: '', amount: '', paymentDate: '' });
  const initialMapping = () => ({ _tempId: getUUID(), paymentId: '', fileName: '', storagePath: '', clientSideFile: null, uploadProgress: undefined, uploadError: null, downloadURL: '' });

  const [caseName, setCaseName] = useState('');
  const [visibleToUserIdsStr, setVisibleToUserIdsStr] = useState('');
  const [disbursements, setDisbursements] = useState([initialDisbursement()]);
  const [invoiceMappings, setInvoiceMappings] = useState([initialMapping()]);
  const [loading, setLoading] = useState(false);
  const [originalCaseData, setOriginalCaseData] = useState(null);
  const disbursementCsvInputRef = React.useRef(null);

  useEffect(() => {
    if (isEditing && editingCaseId) {
      setLoading(true);
      fetchCase(editingCaseId)
        .then((data) => {
          if (data) {
            setOriginalCaseData(data);
            setCaseName(data.caseName || '');
            setVisibleToUserIdsStr((data.visibleToUserIds || []).join(', '));
            setDisbursements(data.disbursements?.map((d) => ({ ...d, _tempId: d._tempId || getUUID() })) || [initialDisbursement()]);
            setInvoiceMappings(
              data.invoiceMappings?.map((m) => ({ ...m, _tempId: m._tempId || getUUID(), clientSideFile: null, uploadProgress: m.storagePath ? 100 : undefined, uploadError: null })) || [initialMapping()]
            );
          } else {
            showModal('Case not found.', 'Error');
            navigate('/admin');
          }
          setLoading(false);
        })
        .catch((error) => {
          console.error('Error fetching case for editing:', error);
          showModal('Error fetching case: ' + error.message, 'Error');
          setLoading(false);
          navigate('/admin');
        });
    } else {
      setCaseName('');
      setVisibleToUserIdsStr('');
      setDisbursements([initialDisbursement()]);
      setInvoiceMappings([initialMapping()]);
      setOriginalCaseData(null);
    }
  }, [isEditing, editingCaseId, navigate, showModal]);

  const handleDisbursementChange = (index, updatedItem) => {
    const newDisbursements = [...disbursements];
    newDisbursements[index] = updatedItem;
    setDisbursements(newDisbursements);
  };
  const addDisbursement = () => setDisbursements([...disbursements, initialDisbursement()]);
  const removeDisbursement = (index) => setDisbursements(disbursements.filter((_, i) => i !== index));

  const handleMappingChange = (index, updatedItem) => {
    const newMappings = [...invoiceMappings];
    newMappings[index] = updatedItem;
    setInvoiceMappings(newMappings);
  };

  const handleMappingFileSelect = (index, file) => {
    setInvoiceMappings((prevMappings) =>
      prevMappings.map((m, i) =>
        i === index ? { ...m, clientSideFile: file, fileName: file.name, storagePath: '', uploadProgress: 0, uploadError: null, downloadURL: '' } : m
      )
    );
    console.log(`File selected: ${file.name}. It will be uploaded on save.`);
  };

  const addMapping = () => {
    setInvoiceMappings([...invoiceMappings, initialMapping()]);
  };
  const removeMapping = (index) => setInvoiceMappings(invoiceMappings.filter((_, i) => i !== index));

  const availablePaymentIdsForMapping = disbursements.map((d) => d.paymentId).filter((id) => id);

  const handleCsvImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (!text || text.trim() === '') {
        showModal('CSV file is empty or contains no processable content.', 'CSV Import Error');
        return;
      }
      try {
        const lines = text.split(/\r\n|\n/);
        if (lines.length <= 1 && !(lines.length === 1 && lines[0].trim() !== '')) {
          showModal('CSV file is empty or contains only a header row.', 'CSV Import Error');
          if (disbursementCsvInputRef.current) disbursementCsvInputRef.current.value = '';
          return;
        }
        const importedDisbursements = lines
          .slice(1)
          .map((line) => {
            const parts = line.split(',');
            if (parts.length >= 4) {
              const [paymentId, payee, amount, paymentDate] = parts;
              if (paymentId && payee && amount && paymentDate) {
                return {
                  _tempId: getUUID(),
                  paymentId: paymentId.trim(),
                  payee: payee.trim(),
                  amount: amount.trim(),
                  paymentDate: paymentDate.trim(),
                };
              }
            }
            return null;
          })
          .filter((d) => d !== null);

        if (importedDisbursements.length > 0) {
          setDisbursements(importedDisbursements);
          showModal(`${importedDisbursements.length} disbursements imported successfully. Please review. Existing manual entries were replaced.`, 'CSV Import');
        } else {
          showModal('No valid disbursements found in CSV or CSV format is incorrect. Expected columns: PaymentID,Payee,Amount,PaymentDate', 'CSV Import Error');
        }
      } catch (error) {
        console.error('Error parsing CSV:', error);
        showModal('Error parsing CSV file: ' + error.message, 'CSV Import Error');
      }
      if (disbursementCsvInputRef.current) {
        disbursementCsvInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const uploadFileAndGetMetadata = async (mappingItem, caseIdForUpload) => {
    if (!mappingItem.clientSideFile) {
      const { clientSideFile, uploadProgress, uploadError, _tempId, ...restOfMapping } = mappingItem;
      return restOfMapping.fileName ? restOfMapping : null;
    }

    const file = mappingItem.clientSideFile;
    if (!caseIdForUpload) {
      const errorMsg = 'Cannot upload file: Case ID is not yet finalized for new case.';
      console.error(errorMsg, mappingItem);
      setInvoiceMappings((prev) => prev.map((m) => (m._tempId === mappingItem._tempId ? { ...m, uploadError: errorMsg, uploadProgress: undefined } : m)));
      throw new Error(errorMsg);
    }
    const finalStoragePath = `artifacts/${appId}/case_documents/${caseIdForUpload}/${file.name}`;

    setInvoiceMappings((prev) => prev.map((m) => (m._tempId === mappingItem._tempId ? { ...m, storagePath: finalStoragePath, uploadProgress: 0, uploadError: null } : m)));

    const fileRef = storageRef(storage, finalStoragePath);
    const uploadTask = uploadBytesResumable(fileRef, file);

    return new Promise((resolve) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setInvoiceMappings((prev) => prev.map((m) => (m._tempId === mappingItem._tempId ? { ...m, uploadProgress: progress } : m)));
        },
        (error) => {
          console.error(`Upload failed for ${file.name}:`, error);
          setInvoiceMappings((prev) => prev.map((m) => (m._tempId === mappingItem._tempId ? { ...m, uploadError: error.message, uploadProgress: undefined } : m)));
          resolve({ ...mappingItem, uploadError: error.message, storagePath: finalStoragePath });
        },
        async () => {
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            console.log(`Upload successful for ${file.name}, URL: ${downloadURL}`);
            resolve({ paymentId: mappingItem.paymentId, fileName: file.name, storagePath: finalStoragePath, downloadURL });
          } catch (error) {
            console.error(`Failed to get download URL for ${file.name}:`, error);
            resolve({
              ...mappingItem,
              paymentId: mappingItem.paymentId,
              fileName: file.name,
              uploadError: 'Upload Succeeded, but failed to get download URL.',
              storagePath: finalStoragePath,
              downloadURL: '',
            });
          }
        }
      );
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!userId) {
      showModal('You must be logged in to create/edit a case.', 'Authentication Error');
      return;
    }

    if (!caseName.trim()) {
      showModal('Case name is required.', 'Validation Error');
      return;
    }
    if (disbursements.some((d) => !d.paymentId || !d.payee || !d.amount || !d.paymentDate)) {
      showModal('All disbursement fields (Payment ID, Payee, Amount, Payment Date) are required.', 'Validation Error');
      return;
    }
    const currentDisbursementIds = new Set(disbursements.map((d) => d.paymentId).filter(Boolean));
    if (currentDisbursementIds.size !== disbursements.filter((d) => d.paymentId).length) {
      showModal('Disbursement Payment IDs must be unique within this case.', 'Validation Error');
      return;
    }

    const activeMappings = invoiceMappings.filter((m) => m.paymentId || m.clientSideFile || m.fileName);
    if (activeMappings.some((m) => !m.paymentId || (!m.fileName && !m.clientSideFile))) {
      showModal('Each active invoice mapping must have both a Payment ID selected and a PDF file associated.', 'Validation Error');
      return;
    }
    if (activeMappings.some((m) => m.paymentId && !currentDisbursementIds.has(m.paymentId))) {
      showModal('One or more invoice mappings reference a Payment ID that no longer exists in the disbursements list. Please correct the mappings or remove them.', 'Invalid Payment ID in Mapping');
      return;
    }

    setLoading(true);
    const visibleToUserIdsArray = visibleToUserIdsStr.split(',').map((id) => id.trim()).filter((id) => id);
    let currentCaseId = editingCaseId;
    let isNewCaseCreation = !isEditing;

    try {
      if (isNewCaseCreation) {
        const tempCaseData = {
          caseName,
          disbursements: disbursements.map(({ _tempId, ...rest }) => rest),
          invoiceMappings: [],
          visibleToUserIds: visibleToUserIdsArray,
          createdBy: userId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          _deleted: false,
        };
        currentCaseId = await createCase(tempCaseData);
        showModal(`Case structure created (ID: ${currentCaseId}). Uploading files... This may take a moment. Please do not navigate away.`, 'Processing', null);
      } else if (editingCaseId) {
        currentCaseId = editingCaseId;
        showModal(`Updating case (ID: ${currentCaseId}). Uploading any new/changed files... Please do not navigate away.`, 'Processing', null);
      }

      if (!currentCaseId) throw new Error('Case ID is missing. Cannot proceed with file uploads.');

      const uploadResults = await Promise.all(
        invoiceMappings
          .filter((m) => m.paymentId && (m.clientSideFile || m.fileName))
          .map((mapping) => uploadFileAndGetMetadata(mapping, currentCaseId))
      );

      const failedUploads = uploadResults.filter((result) => result && result.uploadError);
      if (failedUploads.length > 0) {
        const errorMessages = failedUploads.map((f) => `- ${f.fileName || 'A file'} for Payment ID ${f.paymentId}: ${f.uploadError}`).join('\n');
        showModal(`Some file uploads failed:\n${errorMessages}\n\nPlease correct the issues by re-selecting files or removing problematic mappings, then try saving again. Case data has not been fully saved.`, 'Upload Errors');
        setLoading(false);
        return;
      }

      const finalInvoiceMappings = uploadResults.filter((r) => r && !r.uploadError).map(({ clientSideFile, uploadProgress, _tempId, ...rest }) => rest);

      const caseDataPayload = {
        caseName,
        disbursements: disbursements.map(({ _tempId, ...rest }) => rest),
        invoiceMappings: finalInvoiceMappings,
        visibleToUserIds: visibleToUserIdsArray,
        updatedAt: Timestamp.now(),
        createdBy: isNewCaseCreation || !originalCaseData?.createdBy ? userId : originalCaseData.createdBy,
        createdAt: isNewCaseCreation || !originalCaseData?.createdAt ? Timestamp.now() : originalCaseData.createdAt,
        _deleted: originalCaseData?._deleted ?? false,
      };

      await updateCase(currentCaseId, caseDataPayload);

      showModal(`Case ${isNewCaseCreation ? 'created' : 'updated'} successfully!`, 'Success');
      navigate('/admin');
    } catch (error) {
      console.error('Error saving case:', error);
      let detailedErrorMsg = 'Error saving case: ' + error.message;
      if (error.cause) detailedErrorMsg += `\nCause: ${error.cause.message || error.cause}`;
      showModal(detailedErrorMsg, 'Error');
    } finally {
      setLoading(false);
    }
  };

  if (loading && isEditing) return <div className="p-4 text-center">Loading case details...</div>;

  const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow-xl">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">{isEditing ? 'Edit Audit Case' : 'Create New Audit Case'}</h1>
        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <label htmlFor="caseName" className="block text-sm font-medium text-gray-700 mb-1">
              Case Name
            </label>
            <Input id="caseName" value={caseName} onChange={(e) => setCaseName(e.target.value)} placeholder="e.g., Q1 Unrecorded Liabilities Review" required />
          </div>
          <div>
            <label htmlFor="visibleToUserIds" className="block text-sm font-medium text-gray-700 mb-1">
              Visible to User IDs (Optional)
            </label>
            <Textarea id="visibleToUserIds" value={visibleToUserIdsStr} onChange={(e) => setVisibleToUserIdsStr(e.target.value)} placeholder="Enter comma-separated User IDs. Leave blank for all users." />
            <p className="text-xs text-gray-500 mt-1">If blank, the case will be visible to all trainees.</p>
          </div>

          <section>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-700">Disbursements</h2>
              <div>
                <label htmlFor="csvImportDisbursements" className="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-md text-sm font-semibold cursor-pointer inline-flex items-center">
                  <UploadCloud size={16} className="inline mr-2" /> Import CSV
                </label>
                <Input id="csvImportDisbursements" type="file" accept=".csv" onChange={handleCsvImport} className="hidden" ref={disbursementCsvInputRef} />
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-2">CSV format: PaymentID,Payee,Amount,PaymentDate (with header row). Dates should be YYYY-MM-DD.</p>
            <div className="space-y-4">
              {disbursements.map((item, index) => (
                <DisbursementItem key={item._tempId} item={item} index={index} onChange={handleDisbursementChange} onRemove={removeDisbursement} />
              ))}
            </div>
            <Button onClick={addDisbursement} variant="secondary" className="mt-4 text-sm" type="button">
              <PlusCircle size={16} className="inline mr-1" /> Add Disbursement Manually
            </Button>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-700 mb-4">Invoice PDF Mappings</h2>
            <p className="text-sm text-gray-500 mb-3">Map Payment IDs to their invoice PDFs. Select a PDF for each mapping. Files will be uploaded to Firebase Storage on save.</p>
            <div className="space-y-4">
              {invoiceMappings.map((item, index) => (
                <InvoiceMappingItem key={item._tempId} item={item} index={index} onChange={handleMappingChange} onRemove={removeMapping} availablePaymentIds={availablePaymentIdsForMapping} onFileSelect={handleMappingFileSelect} caseIdForPath={editingCaseId} />
              ))}
            </div>
            <Button onClick={addMapping} variant="secondary" className="mt-4 text-sm" type="button">
              <PlusCircle size={16} className="inline mr-1" /> Add Mapping
            </Button>
          </section>

          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
            <Button onClick={() => navigate('/admin')} variant="secondary" type="button" disabled={loading} isLoading={loading && !isEditing}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={loading} isLoading={loading}>
              {isEditing ? 'Save Changes' : 'Create Case'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const DisbursementItem = ({ item, index, onChange, onRemove }) => {
  const handleChange = (e) => {
    onChange(index, { ...item, [e.target.name]: e.target.value });
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center p-3 border border-gray-200 rounded-md">
      <Input name="paymentId" value={item.paymentId} onChange={handleChange} placeholder="Payment ID" required />
      <Input name="payee" value={item.payee} onChange={handleChange} placeholder="Payee" required />
      <Input name="amount" type="number" value={item.amount} onChange={handleChange} placeholder="Amount (e.g., 123.45)" required />
      <Input name="paymentDate" type="date" value={item.paymentDate} onChange={handleChange} placeholder="Payment Date" required />
      <Button onClick={() => onRemove(index)} variant="danger" className="h-10">
        <Trash2 size={18} />
      </Button>
    </div>
  );
};

const InvoiceMappingItem = ({ item, index, onChange, onRemove, availablePaymentIds, onFileSelect, caseIdForPath }) => {
  const fileInputId = `pdfFile-${item._tempId}`;

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      onFileSelect(index, file);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start p-3 border border-gray-200 rounded-md">
      <div>
        <label htmlFor={`paymentId-${item._tempId}`} className="block text-xs font-medium text-gray-700">
          Payment ID
        </label>
        <select id={`paymentId-${item._tempId}`} name="paymentId" value={item.paymentId} onChange={(e) => onChange(index, { ...item, paymentId: e.target.value, clientSideFile: item.clientSideFile, fileName: item.fileName, storagePath: item.storagePath, uploadProgress: item.uploadProgress, uploadError: item.uploadError, downloadURL: item.downloadURL })} required className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm">
          <option value="">Select Payment ID</option>
          {availablePaymentIds.map((pid) => (
            <option key={pid} value={pid}>
              {pid}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label htmlFor={fileInputId} className="block text-xs font-medium text-gray-700">
          Invoice PDF
        </label>
        <Input id={fileInputId} type="file" accept=".pdf" onChange={handleFileChange} className="mt-1" />
        {item.fileName && (
          <div className="mt-1 text-xs text-gray-600 flex items-center">
            <Paperclip size={12} className="mr-1 flex-shrink-0" />
            <span className="truncate" title={item.fileName}>
              {item.fileName}
            </span>
          </div>
        )}
        {item.uploadProgress !== undefined && item.uploadProgress >= 0 && item.uploadProgress < 100 && !item.uploadError && (
          <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2 dark:bg-gray-700">
            <div className="bg-blue-600 h-2.5 rounded-full text-xs text-white text-center leading-none" style={{ width: `${item.uploadProgress}%` }}>
              {item.uploadProgress > 10 ? `${Math.round(item.uploadProgress)}%` : ''}
            </div>
          </div>
        )}
        {item.uploadProgress === 100 && !item.uploadError && (
          <p className="text-xs text-green-600 mt-1 flex items-center">
            <CheckCircle2 size={14} className="mr-1" />Uploaded
          </p>
        )}
        {item.uploadError && (
          <p className="text-xs text-red-500 mt-1 flex items-center">
            <AlertTriangle size={14} className="mr-1" />{item.uploadError}
          </p>
        )}
      </div>
      <Button onClick={() => onRemove(index)} variant="danger" className="h-10 self-end">
        <Trash2 size={18} />
      </Button>
    </div>
  );
};

