import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../AppCore';
import { AnswerKeyStep } from '../components/caseForm/AnswerKeyCard';
import { CaseFormStepNav, ReviewStep } from '../components/caseForm/CaseFormNavigation';
import CaseBasicsStep from '../components/caseForm/CaseBasicsStep';
import InstructionStep from '../components/caseForm/InstructionStep';
import AudienceScheduleStep from '../components/caseForm/AudienceScheduleStep';
import TransactionsStep from '../components/caseForm/TransactionsStep';
import AttachmentsStep from '../components/caseForm/AttachmentsStep';
import useCaseForm from '../hooks/useCaseForm';
import { isAnswerKeyReady } from '../utils/caseFormHelpers';
import {
  addGlobalTag,
  fetchGlobalTags,
  TAG_FIELDS,
  DEFAULT_SKILL_CATEGORIES,
  DEFAULT_ERROR_REASONS,
} from '../services/tagService';
export { mergeDisbursementDocuments } from '../utils/caseFormTransforms';

export default function CaseFormPage({ params }) {
  const {
    meta: { isEditing },
    status: { loading },
    basics,
    instructionData,
    audience,
    transactions,
    attachments,
    answerKey,
    files,
    actions: { handleSubmit, goBack },
  } = useCaseForm({ params });

  const [activeStep, setActiveStep] = useState(0);
  const [availableSkillTags, setAvailableSkillTags] = useState(DEFAULT_SKILL_CATEGORIES);
  const [availableErrorReasons, setAvailableErrorReasons] = useState(DEFAULT_ERROR_REASONS);

  useEffect(() => {
    let isMounted = true;
    const loadTags = async () => {
      try {
        const tags = await fetchGlobalTags();
        if (!isMounted) return;
        setAvailableSkillTags(tags[TAG_FIELDS.SKILL_CATEGORIES] || []);
        setAvailableErrorReasons(tags[TAG_FIELDS.ERROR_REASONS] || []);
      } catch (err) {
        // If permissions block the settings doc, fall back to defaults and keep UI usable.
        if (err?.code !== 'permission-denied') {
          console.error('[CaseFormPage] Failed to load global tags', err);
        }
      }
    };
    loadTags();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleAddGlobalTag = useCallback(async ({ field, value }) => {
    try {
      const result = await addGlobalTag({ field, value });
      if (!result) return null;
      if (field === TAG_FIELDS.SKILL_CATEGORIES || field === 'skillCategories') {
        setAvailableSkillTags(result.list || []);
      } else if (field === TAG_FIELDS.ERROR_REASONS || field === 'errorReasons') {
        setAvailableErrorReasons(result.list || []);
      }
      return result.tag || value;
    } catch (err) {
      console.error('[CaseFormPage] Failed to add global tag', err);
      return null;
    }
  }, []);

  const steps = useMemo(
    () => [
      { id: 'basics', label: 'Basics', description: 'Name, status, audit area, and grouping' },
      { id: 'instruction', label: 'Instruction', description: 'Briefing, Video, and Gate Check' },
      { id: 'audience', label: 'Audience & Schedule', description: 'Visibility controls and timing' },
      { id: 'transactions', label: 'Data Entry', description: 'Balances, transactions, and mappings' },
      { id: 'attachments', label: 'Attachments', description: 'Invoice and reference files' },
      { id: 'answerKey', label: 'Answer Key', description: 'Correct classifications and rationale' },
      { id: 'review', label: 'Review & Submit', description: 'Final summary before publishing' },
    ],
    []
  );

  const summaryData = useMemo(() => {
    const disbursementCount = transactions.disbursements.filter((item) => {
      if (!item) return false;
      return Boolean(item.paymentId || item.payee || item.amount || item.paymentDate);
    }).length;
    const mappingCount = transactions.disbursements.reduce(
      (sum, disbursement) =>
        sum + (disbursement.mappings || []).filter((mapping) => mapping && mapping.paymentId).length,
      0
    );
    const attachmentCount = attachments.referenceDocuments.filter((item) => {
      if (!item) return false;
      return Boolean(item.fileName || item.clientSideFile || item.downloadURL || item.storagePath);
    }).length;

    return {
      caseName: basics.caseName,
      status: basics.status,
      publicVisible: audience.publicVisible,
      selectedUserIds: audience.selectedUserIds,
      opensAtStr: audience.opensAtStr,
      dueAtStr: audience.dueAtStr,
      disbursementCount,
      mappingCount,
      attachmentCount,
    };
  }, [
    basics.caseName,
    basics.status,
    audience.publicVisible,
    audience.selectedUserIds,
    audience.opensAtStr,
    audience.dueAtStr,
    transactions.disbursements,
    attachments.referenceDocuments,
  ]);

  const reviewChecklist = useMemo(() => {
    const entries = [];

    const trimmedCaseName = (basics.caseName || '').trim();
    entries.push({
      id: 'case-name',
      label: 'Case name provided',
      isReady: trimmedCaseName.length > 0,
      detail:
        trimmedCaseName.length > 0
          ? `Using “${trimmedCaseName}”.`
          : 'Enter a descriptive case name trainees will recognize.',
    });

    const disbursementList = Array.isArray(transactions.disbursements)
      ? transactions.disbursements
      : [];
    const disbursementKeyFields = [
      { key: 'paymentId', label: 'Payment ID' },
      { key: 'payee', label: 'Payee' },
      { key: 'amount', label: 'Amount' },
      { key: 'paymentDate', label: 'Payment Date' },
    ];
    const disbursementFieldIssues = [];
    if (disbursementList.length === 0) {
      disbursementFieldIssues.push(
        'Add at least one disbursement with a payment ID, payee, amount, and payment date.'
      );
    }
    disbursementList.forEach((disbursement, index) => {
      if (!disbursement) return;
      const missingFields = disbursementKeyFields
        .filter(({ key }) => !disbursement[key])
        .map(({ label }) => label);
      if (missingFields.length > 0) {
        disbursementFieldIssues.push(
          `Disbursement #${index + 1} is missing ${missingFields.join(', ')}.`
        );
      }
    });

    entries.push({
      id: 'disbursement-fields',
      label: 'Disbursement details complete',
      isReady: disbursementFieldIssues.length === 0,
      detail:
        disbursementFieldIssues.length === 0
          ? `All ${disbursementList.length} disbursement${
              disbursementList.length === 1 ? '' : 's'
            } include the required fields.`
          : disbursementFieldIssues.join(' '),
    });

    const incompleteAnswerKeys = [];
    disbursementList.forEach((disbursement, index) => {
      if (!disbursement) return;
      if (!isAnswerKeyReady(disbursement)) {
        const identifier = disbursement.paymentId || disbursement.payee || 'unnamed disbursement';
        incompleteAnswerKeys.push(
          `Answer key incomplete for disbursement #${index + 1} (${identifier}).`
        );
      }
    });

    entries.push({
      id: 'answer-key',
      label: 'Answer keys ready',
      isReady: disbursementList.length > 0 && incompleteAnswerKeys.length === 0,
      detail:
        disbursementList.length === 0
          ? 'Add disbursements to build corresponding answer keys.'
          : incompleteAnswerKeys.length === 0
          ? 'Answer keys include classifications, explanations, and matching totals.'
          : incompleteAnswerKeys.join(' '),
    });

    const uniqueSelectedUserIds = Array.isArray(audience.selectedUserIds)
      ? Array.from(new Set(audience.selectedUserIds))
      : [];
    const privateAudienceReady = audience.publicVisible || uniqueSelectedUserIds.length > 0;
    entries.push({
      id: 'audience',
      label: 'Audience visibility configured',
      isReady: privateAudienceReady,
      detail: audience.publicVisible
        ? 'Case is visible to all trainees.'
        : uniqueSelectedUserIds.length > 0
        ? `Private case with ${uniqueSelectedUserIds.length} authorized user${
            uniqueSelectedUserIds.length === 1 ? '' : 's'
          }.`
        : 'Add at least one authorized user for a private case.',
    });

    const referenceDocs = Array.isArray(attachments.referenceDocuments)
      ? attachments.referenceDocuments
      : [];
    const cashDocs = [];
    const referenceIssues = [];
    [...referenceDocs, ...cashDocs].forEach((doc, index) => {
      if (!doc) return;
      const hasAnyContent = Boolean(
        doc.clientSideFile || doc.fileName || doc.downloadURL || doc.storagePath
      );
      if (!hasAnyContent) return;
      const trimmedName = (doc.fileName || '').trim();
      const hasDisplayName = trimmedName.length > 0;
      const hasSource = Boolean(doc.clientSideFile || doc.downloadURL || doc.storagePath);
      if (!hasDisplayName) {
        referenceIssues.push(`Reference document #${index + 1} is missing a display name.`);
      }
      if (!hasSource) {
        const label = trimmedName || `Reference document #${index + 1}`;
        referenceIssues.push(
          `${label} needs an uploaded file, download URL, or storage path before submission.`
        );
      }
    });

    entries.push({
      id: 'reference-documents',
      label: 'Reference materials complete',
      isReady: referenceIssues.length === 0,
      detail:
        referenceIssues.length === 0
          ? referenceDocs.some(
              (doc) =>
                doc &&
                (doc.clientSideFile || doc.fileName || doc.downloadURL || doc.storagePath)
            )
            ? 'All reference documents include names and accessible files or links.'
            : 'No reference documents have been added yet.'
          : referenceIssues.join(' '),
    });

    const parseForChecklist = (value, label) => {
      if (!value) {
        return { timestamp: null };
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return { error: `${label} must be a valid date/time.` };
      }
      return { timestamp: parsed };
    };

    const opensResult = parseForChecklist(audience.opensAtStr, 'Opens At');
    const dueResult = parseForChecklist(audience.dueAtStr, 'Due At');

    let scheduleReady = true;
    let scheduleDetails = 'Schedule dates look good.';
    if (opensResult.error) {
      scheduleReady = false;
      scheduleDetails = opensResult.error;
    } else if (dueResult.error) {
      scheduleReady = false;
      scheduleDetails = dueResult.error;
    } else if (
      opensResult.timestamp &&
      dueResult.timestamp &&
      dueResult.timestamp.getTime() < opensResult.timestamp.getTime()
    ) {
      scheduleReady = false;
      scheduleDetails = 'Due At must be after Opens At.';
    } else if (opensResult.timestamp && dueResult.timestamp) {
      const formatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      scheduleDetails = `Runs from ${formatter.format(opensResult.timestamp)} to ${formatter.format(
        dueResult.timestamp
      )}.`;
    }

    entries.push({
      id: 'schedule',
      label: 'Schedule validated',
      isReady: scheduleReady,
      detail: scheduleDetails,
    });

    return entries;
  }, [
    attachments.referenceDocuments,
    audience.dueAtStr,
    audience.opensAtStr,
    audience.publicVisible,
    audience.selectedUserIds,
    basics.caseName,
    transactions.disbursements,
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
              console.info('[case-form] onSubmit fired', { activeStep, isEditing, allChecklistItemsReady });
              handleSubmit(e);
            }}
            className="space-y-10"
          >
            {activeStep === 0 ? <CaseBasicsStep basics={basics} /> : null}
            {activeStep === 1 ? <InstructionStep instructionData={instructionData} /> : null}
            {activeStep === 2 ? <AudienceScheduleStep audience={audience} /> : null}
            {activeStep === 3 ? (
              <TransactionsStep
                transactions={transactions}
                files={files}
                availableSkillTags={availableSkillTags}
                availableErrorReasons={availableErrorReasons}
                onAddGlobalTag={handleAddGlobalTag}
              />
            ) : null}
            {activeStep === 4 ? <AttachmentsStep attachments={attachments} files={files} /> : null}
            {activeStep === 5 ? (
              <AnswerKeyStep
                disbursements={answerKey.disbursements}
                onUpdate={answerKey.updateAnswerKeyForDisbursement}
                classificationFields={answerKey.classificationFields}
                answerKeyLabels={answerKey.answerKeyLabels}
                classificationOptions={answerKey.answerKeyClassificationOptions}
              />
            ) : null}
            {activeStep === 6 ? (
              <ReviewStep
                summaryData={summaryData}
                reviewChecklist={reviewChecklist}
                allChecklistItemsReady={allChecklistItemsReady}
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
