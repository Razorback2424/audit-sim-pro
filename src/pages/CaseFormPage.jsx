import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, useModal } from '../AppCore';
import { CaseFormStepNav, ReviewStep } from '../components/caseForm/CaseFormNavigation';
import CaseBasicsStep from '../components/caseForm/CaseBasicsStep';
import InstructionStep from '../components/caseForm/InstructionStep';
import useCaseForm from '../hooks/useCaseForm';
import { AUDIT_AREAS, AUDIT_AREA_LABELS } from '../models/caseConstants';
export { mergeDisbursementDocuments } from '../utils/caseFormTransforms';

export default function CaseFormPage({ params }) {
  const caseId = params?.caseId || '';
  const {
    meta: { isEditing },
    status: { loading },
    basics,
    instructionData,
    transactions,
    attachments,
    generation,
    actions: { handleSubmit, goBack },
  } = useCaseForm({ params });
  const { showModal } = useModal();

  const [activeStep, setActiveStep] = useState(0);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [pendingAutoQueue, setPendingAutoQueue] = useState(false);
  const recipeOptions = useMemo(() => generation?.recipes || [], [generation?.recipes]);
  const [selectedRecipeId, setSelectedRecipeId] = useState(recipeOptions[0]?.id || '');
  const generationPlan = generation?.generationPlan;
  const hasGeneratedDraft = Boolean(generation?.hasGeneratedDraft || generationPlan);
  const withTimeout = (promise, ms, label = 'operation') => {
    const parsedMs = Number(ms);
    const safeMs = Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : 30000;

    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('timeout');
        err.code = 'timeout';
        err.label = label;
        reject(err);
      }, safeMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };

  const [queueBusy, setQueueBusy] = useState(false);
  const handleQueueGenerationJob = useCallback(async () => {
    if (!generation?.queueGenerationJob || queueBusy) return;

    // Allow React to paint the loading state before starting the network call.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    setQueueBusy(true);
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    console.info('[CaseFormPage] Queue doc generation started');

    try {
      // Wrap in Promise.resolve().then(...) so any synchronous throws inside the function
      // are caught by this try/catch instead of hard-freezing the event handler.
      await withTimeout(
        Promise.resolve().then(() => generation.queueGenerationJob()),
        30000,
        'queueGenerationJob'
      );

      const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      console.info('[CaseFormPage] Queue doc generation finished', {
        ms: Math.round(endedAt - startedAt),
      });
    } catch (err) {
      const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      console.error('[CaseFormPage] Manual queue generation failed', {
        err,
        ms: Math.round(endedAt - startedAt),
      });

      if (err?.code === 'timeout' || err?.message === 'timeout') {
        showModal(
          'Queueing document generation is taking too long (timed out). Check the console and try again.',
          'Generation'
        );
      } else {
        showModal('Unable to queue document generation. Check the console.', 'Generation');
      }
    } finally {
      setQueueBusy(false);
    }
  }, [generation, queueBusy, showModal]);

  useEffect(() => {
    if (pendingAutoQueue && generationPlan && !queueBusy && !generationBusy) {
      setPendingAutoQueue(false);
      handleQueueGenerationJob();
    }
  }, [pendingAutoQueue, generationPlan, queueBusy, generationBusy, handleQueueGenerationJob]);

  const normalizeOverrideCount = (value, min, max) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return null;
    const clamped = Math.min(Math.max(parsed, min), max);
    return clamped;
  };

  const handleGenerateDraft = useCallback(async () => {
    if (generationBusy) return;
    console.info('[CaseFormPage] Generate draft clicked');
    if (!selectedRecipeId) {
      showModal('Select a recipe before generating a draft.', 'Generation');
      return;
    }
    if (basics.yearEndError || !basics.yearEndValue) {
      showModal('Enter a valid year-end date before generating a draft.', 'Generation');
      return;
    }
    if (basics.auditArea !== AUDIT_AREAS.PAYABLES) {
      showModal('No generator is available for this case type yet.', 'Generation');
      return;
    }
    if (hasGeneratedDraft) {
      setActiveStep(1);
      return;
    }
    setGenerationBusy(true);
    setPendingAutoQueue(true);
    console.info('[CaseFormPage] Starting draft generation', {
      recipeId: selectedRecipeId,
      auditArea: basics.auditArea,
      yearEnd: basics.yearEndValue,
      caseLevel: basics.caseLevel,
      overridesEnabled: basics.overrideDefaults,
    });
    const overrides = {
      yearEnd: basics.yearEndValue,
      caseLevel: basics.caseLevel,
      caseType: basics.auditArea,
    };
    if (basics.overrideDefaults) {
      const disbursementCount = normalizeOverrideCount(basics.overrideDisbursementCount, 1, 30);
      const vendorCount = normalizeOverrideCount(basics.overrideVendorCount, 1, 30);
      const invoicesPerVendor = normalizeOverrideCount(basics.overrideInvoicesPerVendor, 1, 6);
      if (disbursementCount) overrides.disbursementCount = disbursementCount;
      if (vendorCount) overrides.vendorCount = vendorCount;
      if (invoicesPerVendor) overrides.invoicesPerVendor = invoicesPerVendor;
    }
    try {
      const generated = await withTimeout(
        generation?.generateCaseDraft(selectedRecipeId, overrides),
        60000
      );
      console.info('[CaseFormPage] Draft generation result', { generated });
      if (generated) {
        setActiveStep(1);
      } else {
        setPendingAutoQueue(false);
        showModal('Draft generation did not complete. Please try again.', 'Generation');
      }
    } catch (err) {
      setPendingAutoQueue(false);
      console.error('[CaseFormPage] Draft generation failed', err);
      if (err?.code === 'timeout' || err?.message === 'timeout') {
        showModal('Draft generation is taking too long. Please try again.', 'Generation');
      } else {
        showModal('Draft generation failed. Check the console for details.', 'Generation');
      }
    } finally {
      setGenerationBusy(false);
    }
  }, [
    basics.auditArea,
    basics.caseLevel,
    basics.overrideDefaults,
    basics.overrideDisbursementCount,
    basics.overrideInvoicesPerVendor,
    basics.overrideVendorCount,
    basics.yearEndError,
    basics.yearEndValue,
    generation,
    generationBusy,
    hasGeneratedDraft,
    selectedRecipeId,
    showModal,
  ]);

  useEffect(() => {
    if (!selectedRecipeId && recipeOptions.length > 0) {
      setSelectedRecipeId(recipeOptions[0].id);
    }
  }, [recipeOptions, selectedRecipeId]);

  const steps = useMemo(
    () => [
      { id: 'basics', label: 'Basics', description: 'Case type, year-end, and level' },
      { id: 'instruction', label: 'Instruction', description: 'Video and gate check' },
      { id: 'review', label: 'Review & Submit', description: 'Final summary before publishing' },
    ],
    []
  );

  const summaryData = useMemo(() => {
    const isCashCase = basics.auditArea === AUDIT_AREAS.CASH;
    const caseTypeLabel =
      basics.auditArea === AUDIT_AREAS.PAYABLES
        ? 'SURL'
        : AUDIT_AREA_LABELS[basics.auditArea] || basics.auditArea;
    const disbursementCount = transactions.disbursements.filter((item) => {
      if (!item) return false;
      return Boolean(item.paymentId || item.payee || item.amount || item.paymentDate);
    }).length;
    const mappingCount = transactions.disbursements.reduce(
      (sum, disbursement) =>
        sum + (disbursement.mappings || []).filter((mapping) => mapping && mapping.paymentId).length,
      0
    );
    const referenceDocs = Array.isArray(attachments.referenceDocuments)
      ? attachments.referenceDocuments
      : [];
    const cashDocs = Array.isArray(attachments.cashArtifacts) ? attachments.cashArtifacts : [];
    const attachmentCount = [...referenceDocs, ...(isCashCase ? cashDocs : [])].filter((item) => {
      if (!item) return false;
      return Boolean(
        item.fileName ||
          item.clientSideFile ||
          item.downloadURL ||
          item.storagePath ||
          (item.generationSpec && typeof item.generationSpec === 'object')
      );
    }).length;
    const planSpecCount = Array.isArray(generationPlan?.referenceDocumentSpecs)
      ? generationPlan.referenceDocumentSpecs.length
      : 0;
    const generatedDocCount = referenceDocs.filter(
      (doc) => doc && doc.generationSpec && typeof doc.generationSpec === 'object'
    ).length;
    const generationReadyCount = referenceDocs.filter(
      (doc) =>
        doc &&
        doc.generationSpec &&
        !doc.clientSideFile &&
        (doc.downloadURL || doc.storagePath)
    ).length;
    const generationTotalCount = Math.max(generatedDocCount, planSpecCount);
    const generationPendingCount = Math.max(0, generationTotalCount - generationReadyCount);

    return {
      caseName: basics.caseName,
      status: basics.status,
      auditArea: basics.auditArea,
      caseTypeLabel,
      yearEnd: basics.yearEndValue || basics.yearEndInput || '',
      caseLevel: basics.caseLevel,
      disbursementCount,
      mappingCount,
      attachmentCount,
      generationTotalCount,
      generationPendingCount,
    };
  }, [
    basics.caseName,
    basics.status,
    transactions.disbursements,
    attachments.referenceDocuments,
    attachments.cashArtifacts,
    basics.auditArea,
    basics.yearEndValue,
    basics.yearEndInput,
    basics.caseLevel,
    generationPlan,
  ]);

  const generationReview = useMemo(() => {
    const disbursements = Array.isArray(transactions.disbursements) ? transactions.disbursements : [];
    const referenceDocs = Array.isArray(attachments.referenceDocuments)
      ? attachments.referenceDocuments
      : [];
    const yearEnd = generation?.generationPlan?.yearEnd || basics.yearEndValue || '20X2-12-31';
    const parsePseudoDate = (value) => {
      if (!value) return null;
      const text = String(value).trim();
      const match = text.match(/^(20X\d|\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return null;
      const [, yearToken, monthRaw, dayRaw] = match;
      const year = yearToken.startsWith('20X') ? 2000 + Number(yearToken.slice(-1)) : Number(yearToken);
      const month = Number(monthRaw);
      const day = Number(dayRaw);
      if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
      return new Date(Date.UTC(year, month - 1, day));
    };
    const parseHumanDate = (value) => {
      if (!value) return null;
      const text = String(value).trim();
      const match = text.match(
        /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,)?\s+(20X\d|\d{4})$/i
      );
      if (!match) return null;
      const monthLookup = {
        january: 0,
        february: 1,
        march: 2,
        april: 3,
        may: 4,
        june: 5,
        july: 6,
        august: 7,
        september: 8,
        october: 9,
        november: 10,
        december: 11,
      };
      const monthIndex = monthLookup[match[1].toLowerCase()];
      const day = Number(match[2]);
      const yearToken = match[3];
      if (monthIndex === undefined || !day) return null;
      const year = yearToken.startsWith('20X') ? 2000 + Number(yearToken.slice(-1)) : Number(yearToken);
      if (!year) return null;
      return new Date(Date.UTC(year, monthIndex, day));
    };
    const parseCutoffDate = (value) => parsePseudoDate(value) || parseHumanDate(value);
    const yearEndDate = parseCutoffDate(yearEnd);
    const computeInvoiceTotal = (data) => {
      const items = Array.isArray(data?.items) ? data.items : [];
      const subtotal = items.reduce(
        (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
        0
      );
      const tax = subtotal * Number(data?.taxRate || 0);
      const shipping = Number(data?.shipping || 0);
      return subtotal + tax + shipping;
    };

    const isInvoiceTemplate = (doc) => {
      const templateId =
        typeof doc?.generationSpec?.templateId === 'string'
          ? doc.generationSpec.templateId.toLowerCase()
          : '';
      return templateId.startsWith('invoice.');
    };

    const invoices = referenceDocs
      .filter((doc) => isInvoiceTemplate(doc))
      .map((doc) => {
        const serviceDate = doc.generationSpec?.serviceDate || '';
        const shippingDate = doc.generationSpec?.shippingDate || '';
        const paymentId = (doc.generationSpec?.linkToPaymentId || '').trim();
        const shouldBeInAging = (() => {
          if (!yearEndDate) return false;
          const parsedService = parseCutoffDate(serviceDate);
          const parsedShipping = parseCutoffDate(shippingDate);
          if (!parsedService && !parsedShipping) return false;
          if (parsedService && parsedService.getTime() > yearEndDate.getTime()) return false;
          if (parsedShipping && parsedShipping.getTime() > yearEndDate.getTime()) return false;
          return true;
        })();
        return {
          id: doc.generationSpecId || doc._tempId || doc.fileName,
          fileName: doc.fileName,
          templateId: doc.generationSpec?.templateId || '',
          paymentId,
          serviceDate,
          shippingDate,
          amount: Number(
            doc.generationSpec?.invoiceTotal ??
              computeInvoiceTotal(doc.generationSpec?.data) ??
              0
          ),
          isRecorded: doc.generationSpec?.isRecorded !== false,
          shouldBeInAging,
          downloadURL: doc.downloadURL,
          storagePath: doc.storagePath,
        };
      });

    const apAgingDoc = referenceDocs.find(
      (doc) => doc?.generationSpec?.templateId === 'refdoc.ap-aging.v1'
    );

    const invoicesByPayment = new Map();
    invoices.forEach((invoice) => {
      if (!invoice.paymentId) return;
      const list = invoicesByPayment.get(invoice.paymentId) || [];
      list.push(invoice);
      invoicesByPayment.set(invoice.paymentId, list);
    });

    const disbursementRows = disbursements.map((disbursement) => {
      const paymentId = (disbursement.paymentId || '').trim();
      const linked = paymentId ? invoicesByPayment.get(paymentId) || [] : [];
      const invoiceTotal = linked.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
      const hasTrap = linked.some((invoice) => invoice.shouldBeInAging && !invoice.isRecorded);
      return {
        paymentId: disbursement.paymentId,
        payee: disbursement.payee,
        paymentDate: disbursement.paymentDate,
        amount: Number(disbursement.amount || 0),
        classification: disbursement.answerKeySingleClassification || '',
        explanation: disbursement.answerKey?.explanation || '',
        invoiceCount: linked.length,
        invoiceTotal,
        hasTrap,
        invoiceLinks: linked
          .filter((invoice) => invoice.downloadURL)
          .map((invoice) => ({ fileName: invoice.fileName, url: invoice.downloadURL })),
      };
    });

    const allInvoicesReady = invoices.length > 0 && invoices.every((doc) => doc.downloadURL || doc.storagePath);
    const rawJobStatus = generation?.generationPlan?.lastJob || null;
    const patchedJobStatus =
      allInvoicesReady && (rawJobStatus?.status === 'queued' || rawJobStatus?.status === 'processing')
        ? { ...rawJobStatus, status: 'completed' }
        : rawJobStatus;

    return {
      disbursements: disbursementRows,
      invoices,
      apAgingDoc: apAgingDoc
        ? {
            fileName: apAgingDoc.fileName,
            downloadURL: apAgingDoc.downloadURL,
            storagePath: apAgingDoc.storagePath,
          }
        : null,
      yearEnd,
      jobStatus: patchedJobStatus,
    };
  }, [
    attachments.referenceDocuments,
    generation?.generationPlan?.lastJob,
    generation?.generationPlan?.yearEnd,
    basics.yearEndValue,
    transactions.disbursements,
  ]);

  const reviewChecklist = useMemo(() => {
    const entries = [];

    const yearEndReady = Boolean(basics.yearEndValue) && !basics.yearEndError;
    entries.push({
      id: 'year-end',
      label: 'Year-end date set',
      isReady: yearEndReady,
      detail: yearEndReady
        ? `Using ${basics.yearEndValue}.`
        : basics.yearEndError || 'Add a year-end date for generation.',
    });

    const levelReady = Boolean(basics.caseLevel);
    const levelLabel = basics.caseLevel
      ? basics.caseLevel.charAt(0).toUpperCase() + basics.caseLevel.slice(1)
      : '';
    entries.push({
      id: 'case-level',
      label: 'Case level selected',
      isReady: levelReady,
      detail: levelReady ? `Level: ${levelLabel}.` : 'Select a course level.',
    });

    const caseTypeReady = Boolean(basics.auditArea);
    const caseTypeLabel =
      basics.auditArea === AUDIT_AREAS.PAYABLES
        ? 'SURL'
        : AUDIT_AREA_LABELS[basics.auditArea] || basics.auditArea;
    entries.push({
      id: 'case-type',
      label: 'Case type selected',
      isReady: caseTypeReady,
      detail: caseTypeReady
        ? `Type: ${caseTypeLabel}.`
        : 'Select a case type to drive generation.',
    });

    const needsGeneration = basics.auditArea === AUDIT_AREAS.PAYABLES && recipeOptions.length > 0;
    entries.push({
      id: 'generation',
      label: 'Case draft generated',
      isReady: !needsGeneration || hasGeneratedDraft,
      detail: !needsGeneration
        ? 'No generator is required for this case type.'
        : hasGeneratedDraft
        ? 'Generation plan stored for this case.'
        : 'Generate the case draft to populate workpapers and reference documents.',
    });

    const referenceDocs = Array.isArray(attachments.referenceDocuments)
      ? attachments.referenceDocuments
      : [];
    const generatedDocs = referenceDocs.filter(
      (doc) => doc && doc.generationSpec && typeof doc.generationSpec === 'object'
    );
    entries.push({
      id: 'reference-documents',
      label: 'Reference documents ready',
      isReady: generatedDocs.length > 0,
      detail:
        generatedDocs.length > 0
          ? `${generatedDocs.length} generated reference document${generatedDocs.length === 1 ? '' : 's'} attached.`
          : 'Generate the case draft to attach reference documents.',
    });

    const videoSource =
      instructionData?.instruction?.visualAsset?.source_id ||
      instructionData?.instruction?.visualAsset?.url ||
      '';
    entries.push({
      id: 'instruction-video',
      label: 'Instruction video linked',
      isReady: Boolean(String(videoSource || '').trim()),
      detail: videoSource ? 'Video link added.' : 'Paste the instruction video link or ID.',
    });

    const gateCheck = instructionData?.instruction?.gateCheck || {};
    const gateQuestion = String(gateCheck.question || '').trim();
    const gateOptions = Array.isArray(gateCheck.options) ? gateCheck.options : [];
    const validOptions = gateOptions.filter((opt) => opt && String(opt.text || '').trim());
    const hasCorrect = validOptions.some((opt) => opt.correct);
    const gateReady = gateQuestion.length > 0 && validOptions.length >= 2 && hasCorrect;
    entries.push({
      id: 'gate-check',
      label: 'Gate check question ready',
      isReady: gateReady,
      detail: gateReady
        ? 'Gate check includes a question and a correct answer.'
        : 'Add a question with at least two options and mark the correct one.',
    });

    return entries;
  }, [
    attachments.referenceDocuments,
    basics.auditArea,
    basics.yearEndValue,
    basics.yearEndError,
    basics.caseLevel,
    hasGeneratedDraft,
    instructionData,
    recipeOptions.length,
  ]);

  const allChecklistItemsReady = useMemo(
    () => (Array.isArray(reviewChecklist) ? reviewChecklist.every((item) => item.isReady) : false),
    [reviewChecklist]
  );

  const isLastStep = activeStep === steps.length - 1;

  const handleNext = () => {
    setActiveStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const handleBackStep = () => {
    setActiveStep((prev) => Math.max(prev - 1, 0));
  };

  if (loading && isEditing) {
    return <div className="p-4 text-center">Loading case details...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-3xl bg-white p-6 shadow-xl">
          <h1 className="text-3xl font-bold text-gray-800">
            {isEditing ? 'Edit Audit Case' : 'Create New Audit Case'}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Move through each step to update the case. Your progress is saved only when you finish the final review.
          </p>

          <CaseFormStepNav steps={steps} activeStep={activeStep} onStepChange={setActiveStep} disabled={loading} />

          <form
            onSubmit={(e) => {
              handleSubmit(e);
            }}
            className="space-y-10"
          >
            {activeStep === 0 ? <CaseBasicsStep basics={basics} /> : null}
            {activeStep === 1 ? <InstructionStep instructionData={instructionData} /> : null}
            {activeStep === 2 ? (
              <ReviewStep
                summaryData={summaryData}
                reviewChecklist={reviewChecklist}
                allChecklistItemsReady={allChecklistItemsReady}
                generationReview={generationReview}
                onQueueGeneration={generationPlan ? handleQueueGenerationJob : null}
                isQueueing={queueBusy}
                caseId={caseId}
              />
            ) : null}

            <div className="flex flex-col gap-3 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {activeStep > 0 ? (
                  <Button onClick={handleBackStep} variant="secondary" type="button" disabled={loading}>
                    Back
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <Button
                  onClick={() => {
                    goBack();
                  }}
                  variant="secondary"
                  type="button"
                  disabled={loading}
                  className="justify-center"
                >
                  Cancel
                </Button>
                {isLastStep ? (
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={loading || !allChecklistItemsReady}
                    isLoading={loading}
                    className="justify-center"
                  >
                    {isEditing ? 'Save Changes' : 'Create Case'}
                  </Button>
                ) : activeStep === 0 && !isEditing ? (
                  <Button
                    onClick={handleGenerateDraft}
                    variant="primary"
                    type="button"
                    disabled={loading || generationBusy || recipeOptions.length === 0}
                    isLoading={generationBusy}
                    className="justify-center"
                  >
                    Generate Case Draft
                  </Button>
                ) : (
                  <Button onClick={handleNext} variant="primary" type="button" disabled={loading} className="justify-center">
                    Next
                  </Button>
                )}
                {isLastStep && !allChecklistItemsReady ? (
                  <p className="text-sm text-amber-600 sm:text-right">
                    Complete the submission checklist before submitting.
                  </p>
                ) : null}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
