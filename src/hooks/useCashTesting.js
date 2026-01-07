import { useCallback, useEffect, useMemo } from 'react';
import { Timestamp } from 'firebase/firestore';
import { saveSubmission } from '../services/submissionService';
import { saveProgress } from '../services/progressService';

export default function useCashTesting({
  caseData,
  caseId,
  userId,
  disbursementById,
  classificationAmounts,
  setClassificationAmounts,
  workspaceNotes,
  setWorkspaceNotes,
  createEmptyAllocation,
  computeAllocationTotals,
  selectedIds,
  fixedAssetDraft,
  resultsWorkflowStep,
  cancelPendingSave,
  showModal,
  setIsLocked,
  setActiveStep,
  appId,
  isCashLayout,
  cashCanSubmit,
  setCashCanSubmit,
  cashLinkMap,
  setCashLinkMap,
  cashAdjustments,
  setCashAdjustments,
  cashSummaryDraft,
  setCashSummaryDraft,
  getDisbursementList,
}) {
  useEffect(() => {
    if (isCashLayout) {
      setCashCanSubmit(false);
    } else {
      setCashCanSubmit(true);
    }
  }, [isCashLayout, setCashCanSubmit]);

  const mapCashStatusToClassification = useCallback((status) => {
    if (status === 'cleared') return 'properlyIncluded';
    if (status === 'outstanding') return 'properlyExcluded';
    if (status === 'void') return 'improperlyIncluded';
    if (status === 'adjustment') return 'improperlyExcluded';
    return '';
  }, []);

  const handleCashStatusUpdate = useCallback(
    (ledgerId, status, bankId = '') => {
      if (!ledgerId) return;
      const classification = mapCashStatusToClassification(status);

      setClassificationAmounts((prev) => {
        const next = { ...prev };
        if (!next[ledgerId]) {
          next[ledgerId] = createEmptyAllocation();
        }
        next[ledgerId] = {
          ...next[ledgerId],
          status,
          mode: 'single',
          singleClassification: classification,
          linkedBankItemId: bankId,
        };
        return next;
      });

      setWorkspaceNotes((prev) => {
        const current = prev[ledgerId] || {};
        return {
          ...prev,
          [ledgerId]: { ...current, status },
        };
      });
    },
    [createEmptyAllocation, mapCashStatusToClassification, setClassificationAmounts, setWorkspaceNotes]
  );

  const handleCashLinkChange = useCallback(
    (bankId, ledgerId) => {
      if (!bankId) return;
      setCashLinkMap((prev) => {
        const next = { ...prev };
        const currentLinkedLedgerId = prev[bankId];
        if (currentLinkedLedgerId === ledgerId) {
          return prev;
        }
        if (currentLinkedLedgerId) {
          setClassificationAmounts((prevAmounts) => {
            const existing = prevAmounts[currentLinkedLedgerId] || {};
            return {
              ...prevAmounts,
              [currentLinkedLedgerId]: { ...existing, linkedBankItemId: '' },
            };
          });
        }

        if (ledgerId) {
          const existingLedger = disbursementById.get(ledgerId);
          if (!existingLedger) {
            return prev;
          }
          setClassificationAmounts((prevAmounts) => {
            const current = prevAmounts[ledgerId] || {};
            return {
              ...prevAmounts,
              [ledgerId]: { ...current, linkedBankItemId: bankId, status: current.status || 'cleared' },
            };
          });
          return { ...next, [bankId]: ledgerId };
        }
        delete next[bankId];
        return next;
      });
    },
    [disbursementById, setCashLinkMap, setClassificationAmounts]
  );

  const handleCashAdjustmentCreation = useCallback(
    (bankItem) => {
      const baseId = (bankItem?.reference || bankItem?.bankId || 'cash-adjustment').replace(/\s+/g, '-').toLowerCase();
      let candidateId = baseId;
      let suffix = 2;
      while (disbursementById.has(candidateId)) {
        candidateId = `${baseId}-${suffix}`;
        suffix += 1;
      }
      const noteText = `Unrecorded item from cutoff: ${bankItem.reference || bankItem.bankId || candidateId}`;
      const adjustment = {
        paymentId: candidateId,
        reference: bankItem.reference || candidateId,
        payee: bankItem.payee || bankItem.description || bankItem.reference || '',
        amount: bankItem.amount || 0,
        paymentDate: bankItem.clearDate || bankItem.date || '',
        _sourceBankId: bankItem.bankId || bankItem._tempId || bankItem.reference || '',
      };
      setCashAdjustments((prev) => [...prev, adjustment]);
      setClassificationAmounts((prev) => ({
        ...prev,
        [candidateId]: {
          ...createEmptyAllocation(),
          mode: 'single',
          singleClassification: 'improperlyExcluded',
          status: 'adjustment',
          note: noteText,
          notes: noteText,
          linkedBankItemId: bankItem.bankId || bankItem._tempId || bankItem.reference || '',
        },
      }));
      setWorkspaceNotes((prev) => ({
        ...prev,
        [candidateId]: { ...(prev[candidateId] || {}), workpaperNote: noteText, status: 'adjustment' },
      }));
      setCashLinkMap((prev) => ({
        ...prev,
        [bankItem.bankId || bankItem._tempId || bankItem.reference || candidateId]: candidateId,
      }));
    },
    [createEmptyAllocation, disbursementById, setCashAdjustments, setCashLinkMap, setClassificationAmounts, setWorkspaceNotes]
  );

  const handleCashSummaryChange = useCallback(
    (summary) => {
      if (!summary || typeof summary !== 'object') return;
      setCashSummaryDraft(summary);
    },
    [setCashSummaryDraft]
  );

  const handleSubmitCash = useCallback(async () => {
    if (!caseData || !userId) return;
    const cashContext = caseData.cashContext || {};
    const effectiveCaseId = caseData.caseId || caseData.id || caseId;
    const statusRequiresNote = (status) => status === 'outstanding' || status === 'void' || status === 'adjustment';
    const ledgerStatuses = {};
    const missing = [];

    const disbursementList = (typeof getDisbursementList === 'function' && getDisbursementList()) || [];
    disbursementList.forEach((item) => {
      const entry = classificationAmounts[item.paymentId] || {};
      const status = entry.status || '';
      const linkedBankItemId =
        entry.linkedBankItemId ||
        (cashLinkMap && Object.entries(cashLinkMap).find(([, ledgerId]) => ledgerId === item.paymentId)?.[0]) ||
        '';
      const note =
        entry.note ||
        entry.notes ||
        entry.workpaperNote ||
        workspaceNotes[item.paymentId]?.workpaperNote ||
        workspaceNotes[item.paymentId]?.notes ||
        '';
      if (!status) {
        missing.push(item.paymentId);
      }
      if (status === 'cleared' && !linkedBankItemId) {
        missing.push(item.paymentId);
      }
      if (statusRequiresNote(status) && !note.trim()) {
        missing.push(item.paymentId);
      }
      ledgerStatuses[item.paymentId] = { status, note, linkedBankItemId };
    });

    if (!cashCanSubmit) {
      showModal(
        'Variance must be zero before you can submit. Link items and adjust statuses until the reconciliation balances.',
        'Reconciliation Not Balanced'
      );
      return;
    }

    if (missing.length > 0) {
      const unique = Array.from(new Set(missing.filter(Boolean)));
      showModal(`Add required statuses, links, or notes for: ${unique.join(', ')}.`, 'Cash Items Incomplete');
      return;
    }

    const allocationPayload = {};
    disbursementList.forEach((disbursement) => {
      const allocation = classificationAmounts[disbursement.paymentId];
      if (!allocation) return;
      allocationPayload[disbursement.paymentId] = computeAllocationTotals(disbursement, allocation);
    });

    const documents = [];
    const workspacePayload = disbursementList.reduce((acc, item) => {
      const existing = workspaceNotes[item.paymentId] || {};
      const note = classificationAmounts[item.paymentId]?.note;
      if (note && !existing.workpaperNote) {
        acc[item.paymentId] = { ...existing, workpaperNote: note };
      } else {
        acc[item.paymentId] = existing;
      }
      return acc;
    }, {});

    const cashSummaryPayload = {
      ...(cashSummaryDraft || {}),
      bookBalance: cashContext.bookBalance ?? '',
      bankBalance: cashContext.bankBalance ?? cashContext.confirmedBalance ?? '',
    };

    const caseTitle = caseData.title || caseData.caseName || 'Audit Case';

    try {
      cancelPendingSave();

      await saveSubmission(userId, effectiveCaseId, {
        caseId: effectiveCaseId,
        caseName: caseTitle,
        selectedPaymentIds: selectedIds,
        retrievedDocuments: documents,
        disbursementClassifications: allocationPayload,
        expectedClassifications: {},
        workspaceNotes: workspacePayload,
        status: 'submitted',
        submittedAt: Timestamp.now(),
        cashLinkMap,
        cashAdjustments,
        cashSummary: cashSummaryPayload,
        cashLedgerStatuses: ledgerStatuses,
      });

      await saveProgress({
        appId,
        uid: userId,
        caseId: effectiveCaseId,
        patch: {
          percentComplete: 100,
          state: 'submitted',
          step: resultsWorkflowStep,
          draft: {
            selectedPaymentIds: selectedIds,
            classificationDraft: classificationAmounts,
            fixedAssetDraft,
            cashLinkMap,
            cashAdjustments,
            cashSummary: cashSummaryDraft,
          },
        },
      });

      setIsLocked(true);
      setActiveStep(resultsWorkflowStep);
    } catch (error) {
      console.error('Error saving cash submission:', error);
      showModal('Error saving submission: ' + error.message, 'Error');
    }
  }, [
    appId,
    cancelPendingSave,
    caseData,
    caseId,
    cashAdjustments,
    cashCanSubmit,
    cashLinkMap,
    cashSummaryDraft,
    classificationAmounts,
    computeAllocationTotals,
    fixedAssetDraft,
    getDisbursementList,
    resultsWorkflowStep,
    selectedIds,
    setActiveStep,
    setIsLocked,
    showModal,
    userId,
    workspaceNotes,
  ]);

  const cashState = useMemo(
    () => ({
      cashCanSubmit,
      cashLinkMap,
      cashAdjustments,
      cashSummaryDraft,
    }),
    [cashAdjustments, cashCanSubmit, cashLinkMap, cashSummaryDraft]
  );

  return {
    ...cashState,
    setCashCanSubmit,
    setCashAdjustments,
    setCashLinkMap,
    handleCashStatusUpdate,
    handleCashLinkChange,
    handleCashAdjustmentCreation,
    handleCashSummaryChange,
    handleSubmitCash,
  };
}
