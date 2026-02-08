import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { appId } from '../../AppCore';
import { saveSubmission, subscribeToSubmission } from '../../services/submissionService';
import { saveProgress, subscribeProgressForCases } from '../../services/progressService';
import { getSignedDocumentUrl } from '../../services/documentService';
import InstructionView from '../InstructionView';
import FixedAssetSelectionStep from './steps/FixedAssetSelectionStep';
import FixedAssetScopingStep from './steps/FixedAssetScopingStep';
import FixedAssetTestingStep from './steps/FixedAssetTestingStep';
import ResultsStep from './steps/ResultsStep';

const FLOW_STEPS = Object.freeze({
  INSTRUCTION: 'instruction',
  SELECTION: 'selection',
  ROLLFORWARD: 'rollforward',
  SCOPING: 'scoping',
  TESTING: 'testing',
  ADDITIONS: 'additions',
  DISPOSALS: 'disposals',
  ANALYTICS: 'analytics',
  RESULTS: 'results',
});

const DEFAULT_WORKFLOW = {
  steps: [FLOW_STEPS.INSTRUCTION, FLOW_STEPS.SELECTION, FLOW_STEPS.TESTING, FLOW_STEPS.RESULTS],
  labels: {
  [FLOW_STEPS.INSTRUCTION]: 'Instruction',
  [FLOW_STEPS.SELECTION]: 'Rollforward',
  [FLOW_STEPS.ROLLFORWARD]: 'Rollforward',
  [FLOW_STEPS.SCOPING]: 'Scoping',
  [FLOW_STEPS.TESTING]: 'Testing',
  [FLOW_STEPS.ADDITIONS]: 'Additions Testing',
  [FLOW_STEPS.DISPOSALS]: 'Disposals Testing',
  [FLOW_STEPS.ANALYTICS]: 'Depreciation Analytics',
  [FLOW_STEPS.RESULTS]: 'Review Outcome',
  },
  descriptions: {
  [FLOW_STEPS.INSTRUCTION]: 'Review the briefing and clear the gate check before entering the workpaper.',
  [FLOW_STEPS.SELECTION]: 'Tick and tie the rollforward, then lock your testing strategy.',
  [FLOW_STEPS.ROLLFORWARD]: 'Tick and tie the rollforward to validate the population.',
  [FLOW_STEPS.SCOPING]: 'Define your testing strategy based on materiality and risk.',
  [FLOW_STEPS.TESTING]: 'Document additions, disposals, and depreciation analytics.',
  [FLOW_STEPS.ADDITIONS]: 'Vouch current-year additions to vendor support.',
  [FLOW_STEPS.DISPOSALS]: 'Validate disposals and gain/loss calculations.',
  [FLOW_STEPS.ANALYTICS]: 'Perform depreciation and accumulated depreciation analytics.',
  [FLOW_STEPS.RESULTS]: 'Review your fixed asset conclusions and notes.',
  },
  submitLabels: {
    [FLOW_STEPS.SELECTION]: 'Submit Rollforward',
    [FLOW_STEPS.ROLLFORWARD]: 'Submit Rollforward',
    [FLOW_STEPS.SCOPING]: 'Submit Scoping Decision',
    [FLOW_STEPS.TESTING]: 'Submit Fixed Asset Testing',
    [FLOW_STEPS.ADDITIONS]: 'Submit Additions Testing',
    [FLOW_STEPS.DISPOSALS]: 'Submit Disposals Testing',
    [FLOW_STEPS.ANALYTICS]: 'Submit Analytics',
  },
  progressByStep: {
    [FLOW_STEPS.INSTRUCTION]: 0,
    [FLOW_STEPS.SELECTION]: 30,
    [FLOW_STEPS.TESTING]: 75,
    [FLOW_STEPS.RESULTS]: 100,
  },
  stepConfig: {
    [FLOW_STEPS.SELECTION]: {
      showScoping: true,
      showSubmit: false,
      submitLabel: 'Submit Rollforward',
    },
    [FLOW_STEPS.ROLLFORWARD]: {
      showScoping: false,
      showSubmit: true,
      submitLabel: 'Submit Rollforward',
    },
    [FLOW_STEPS.TESTING]: {
      visibleSections: {
        scopingSummary: true,
        leadSchedule: true,
        strategy: true,
        policy: true,
        evidence: true,
        additions: true,
        disposals: true,
        analytics: true,
        submit: true,
      },
    },
    [FLOW_STEPS.ADDITIONS]: {
      submitLabel: 'Submit Additions Testing',
      visibleSections: {
        scopingSummary: false,
        leadSchedule: false,
        strategy: false,
        policy: true,
        evidence: true,
        additions: true,
        disposals: false,
        analytics: false,
        submit: true,
      },
    },
    [FLOW_STEPS.DISPOSALS]: {
      submitLabel: 'Submit Disposals Testing',
      visibleSections: {
        scopingSummary: false,
        leadSchedule: false,
        strategy: false,
        policy: true,
        evidence: true,
        additions: false,
        disposals: true,
        analytics: false,
        submit: true,
      },
    },
    [FLOW_STEPS.ANALYTICS]: {
      submitLabel: 'Submit Analytics',
      visibleSections: {
        scopingSummary: false,
        leadSchedule: false,
        strategy: false,
        policy: false,
        evidence: false,
        additions: false,
        disposals: false,
        analytics: true,
        submit: true,
      },
    },
  },
};

const resolveStepKey = (stepKey, steps) => {
  if (!Array.isArray(steps) || steps.length === 0) return FLOW_STEPS.INSTRUCTION;
  if (steps.includes(stepKey)) return stepKey;
  if (stepKey === FLOW_STEPS.SELECTION && steps.includes(FLOW_STEPS.ROLLFORWARD)) return FLOW_STEPS.ROLLFORWARD;
  if (stepKey === FLOW_STEPS.ROLLFORWARD && steps.includes(FLOW_STEPS.SELECTION)) return FLOW_STEPS.SELECTION;
  return steps[0];
};

const buildWorkflow = (caseData) => {
  const workflow = caseData?.fixedAssetWorkflow || {};
  const steps =
    Array.isArray(workflow.steps) && workflow.steps.length > 0 ? workflow.steps : DEFAULT_WORKFLOW.steps;
  const labels = { ...DEFAULT_WORKFLOW.labels, ...(workflow.labels || {}) };
  const descriptions = { ...DEFAULT_WORKFLOW.descriptions, ...(workflow.descriptions || {}) };
  const submitLabels = { ...DEFAULT_WORKFLOW.submitLabels, ...(workflow.submitLabels || {}) };
  const progressByStep = { ...DEFAULT_WORKFLOW.progressByStep, ...(workflow.progressByStep || {}) };
  const stepConfig = { ...DEFAULT_WORKFLOW.stepConfig, ...(workflow.stepConfig || {}) };
  return {
    steps,
    labels,
    descriptions,
    submitLabels,
    progressByStep,
    stepConfig,
  };
};

const buildEmptyFixedAssetDraft = () => ({
  leadScheduleTicks: {},
  scopingDecision: {},
  additionResponses: {},
  disposalResponses: {},
  analyticsResponse: {},
});

const normalizeFixedAssetDraft = (draft) => {
  if (!draft || typeof draft !== 'object') return buildEmptyFixedAssetDraft();
  return {
    leadScheduleTicks: draft.leadScheduleTicks && typeof draft.leadScheduleTicks === 'object' ? draft.leadScheduleTicks : {},
    scopingDecision: draft.scopingDecision && typeof draft.scopingDecision === 'object' ? draft.scopingDecision : {},
    additionResponses: draft.additionResponses && typeof draft.additionResponses === 'object' ? draft.additionResponses : {},
    disposalResponses: draft.disposalResponses && typeof draft.disposalResponses === 'object' ? draft.disposalResponses : {},
    analyticsResponse: draft.analyticsResponse && typeof draft.analyticsResponse === 'object' ? draft.analyticsResponse : {},
  };
};

const areDraftsEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

const computeTotals = (summary) =>
  summary.reduce(
    (acc, row) => {
      acc.beginningBalance += Number(row.beginningBalance) || 0;
      acc.additions += Number(row.additions) || 0;
      acc.disposals += Number(row.disposals) || 0;
      acc.endingBalance += Number(row.endingBalance) || 0;
      return acc;
    },
    {
      beginningBalance: 0,
      additions: 0,
      disposals: 0,
      endingBalance: 0,
    }
  );

const computePercentComplete = (step, steps, progressByStep) => {
  const resolved = resolveStepKey(step, steps);
  if (progressByStep && progressByStep[resolved] !== undefined) {
    return progressByStep[resolved];
  }
  const idx = steps.indexOf(resolved);
  if (idx <= 0) return 0;
  if (idx >= steps.length - 1) return 100;
  return Math.round((idx / (steps.length - 1)) * 100);
};

const deriveStateFromProgress = (step, percentComplete) => {
  if (step === FLOW_STEPS.RESULTS || percentComplete >= 100) return 'submitted';
  if (percentComplete > 0) return 'in_progress';
  return 'not_started';
};

export default function FixedAssetTestingModule({ caseId, caseData, userId, navigate, showModal }) {
  const workflow = useMemo(() => buildWorkflow(caseData), [caseData]);
  const workflowSteps = workflow.steps;
  const [activeStep, setActiveStep] = useState(FLOW_STEPS.INSTRUCTION);
  const [furthestStepIndex, setFurthestStepIndex] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [fixedAssetDraft, setFixedAssetDraft] = useState(buildEmptyFixedAssetDraft());
  const [isScopingModalOpen, setIsScopingModalOpen] = useState(false);
  const [scopingModalError, setScopingModalError] = useState('');
  const [submission, setSubmission] = useState(null);

  const [selectedEvidenceItems, setSelectedEvidenceItems] = useState([]);
  const [activeEvidenceId, setActiveEvidenceId] = useState(null);
  const [activeEvidenceUrl, setActiveEvidenceUrl] = useState('');
  const [activeEvidenceLoading, setActiveEvidenceLoading] = useState(false);
  const [activeEvidenceError, setActiveEvidenceError] = useState('');

  const activeStepRef = useRef(activeStep);
  const draftRef = useRef(fixedAssetDraft);
  const isLockedRef = useRef(false);
  const lastLocalChangeRef = useRef(0);
  const progressSaveTimeoutRef = useRef(null);

  const requestSignedUrl = useCallback(
    async ({ storagePath, downloadURL }) => {
      if (!caseId) throw new Error('Case ID is required to open documents.');
      return getSignedDocumentUrl({ caseId, storagePath, downloadURL, requireStoragePath: true });
    },
    [caseId]
  );

  const fixedAssetSummary = useMemo(
    () => (Array.isArray(caseData?.faSummary) ? caseData.faSummary : []),
    [caseData]
  );
  const fixedAssetTotals = useMemo(() => computeTotals(fixedAssetSummary), [fixedAssetSummary]);
  const fixedAssetRisk = caseData?.faRisk || {};
  const fixedAssetAdditions = Array.isArray(caseData?.faAdditions) ? caseData.faAdditions : [];
  const fixedAssetDisposals = Array.isArray(caseData?.faDisposals) ? caseData.faDisposals : [];
  const referenceDocuments = Array.isArray(caseData?.referenceDocuments) ? caseData.referenceDocuments : [];

  const viewerEvidenceItems = selectedEvidenceItems;
  const viewerEnabled = selectedEvidenceItems.length > 0;

  useEffect(() => {
    if (!workflowSteps.includes(activeStep)) {
      setActiveStep(resolveStepKey(activeStep, workflowSteps));
    }
  }, [activeStep, workflowSteps]);

  const enqueueProgressSave = useCallback(
    (nextStep) => {
      if (!caseId || !userId) return;
      if (progressSaveTimeoutRef.current) clearTimeout(progressSaveTimeoutRef.current);
      const targetStep = nextStep || activeStepRef.current;
      progressSaveTimeoutRef.current = setTimeout(async () => {
        try {
          const percentComplete = computePercentComplete(targetStep, workflowSteps, workflow.progressByStep);
          await saveProgress({
            appId,
            uid: userId,
            caseId,
            patch: {
              percentComplete,
              state: deriveStateFromProgress(targetStep, percentComplete),
              step: targetStep,
              draft: {
                fixedAssetDraft: draftRef.current,
                selectedPaymentIds: [],
              },
            },
          });
        } catch (error) {
          console.error('[FixedAssetTesting] Failed to save progress', error);
        }
      }, 600);
    },
    [caseId, userId, workflowSteps, workflow.progressByStep]
  );

  useEffect(() => {
    activeStepRef.current = activeStep;
    const nextIndex = workflowSteps.indexOf(activeStep);
    if (nextIndex >= 0) {
      setFurthestStepIndex((prev) => Math.max(prev, nextIndex));
    }
  }, [activeStep, workflowSteps]);

  useEffect(() => {
    draftRef.current = fixedAssetDraft;
  }, [fixedAssetDraft]);

  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  useEffect(() => {
    if (!caseId || !userId) return;
    const unsubscribe = subscribeProgressForCases(
      { appId, uid: userId, caseIds: [caseId] },
      (progressMap) => {
        const entry = progressMap.get(caseId);
        if (!entry) return;
        const recentlyChanged = Date.now() - lastLocalChangeRef.current < 800;
        const nextStep = resolveStepKey(entry.step, workflowSteps);
        if (!recentlyChanged && activeStepRef.current !== nextStep) {
          setActiveStep(nextStep);
        }
        const nextDraft = normalizeFixedAssetDraft(entry.draft?.fixedAssetDraft);
        if (!recentlyChanged && !areDraftsEqual(draftRef.current, nextDraft)) {
          setFixedAssetDraft(nextDraft);
        }
    const shouldLock = entry.state === 'submitted' || nextStep === FLOW_STEPS.RESULTS;
        if (isLockedRef.current !== shouldLock) {
          setIsLocked(shouldLock);
          isLockedRef.current = shouldLock;
        }
      },
      (error) => {
        console.error('[FixedAssetTesting] Failed to subscribe to progress', error);
      }
    );
    return () => unsubscribe();
  }, [caseId, userId, workflowSteps]);

  useEffect(() => {
    if (!userId || !caseId) return;
    const unsubscribe = subscribeToSubmission(
      userId,
      caseId,
      (data) => {
        setSubmission(data);
      },
      (error) => {
        console.error('[FixedAssetTesting] Failed to subscribe to submission', error);
      }
    );
    return () => unsubscribe();
  }, [caseId, userId]);

  useEffect(() => {
    if (!caseData) return;
    const templateLabelMap = {
      'refdoc.fa-policy.v1': 'Capitalization Policy',
      'refdoc.ppe-rollforward.v1': 'PP&E Rollforward',
      'refdoc.fa-listing.v1': 'Fixed Asset Listing',
      'refdoc.check-copy.v1': 'Check Copy',
    };
    const keyPriority = {
      capitalization_policy: 0,
      ppe_rollforward: 1,
      fixed_asset_listing: 2,
      fa_invoice: 3,
      fa_payment: 4,
    };
    const resolveLabel = (doc, fallback) => {
      if (doc?.key && keyPriority[doc.key] !== undefined) {
        if (doc.key === 'capitalization_policy') return 'Capitalization Policy';
        if (doc.key === 'ppe_rollforward') return 'PP&E Rollforward';
        if (doc.key === 'fixed_asset_listing') return 'Fixed Asset Listing';
        if (doc.key === 'fa_invoice') return 'Vendor Invoice';
        if (doc.key === 'fa_payment') return 'Check Copy';
      }
      const templateId = doc?.generationSpec?.templateId;
      if (templateId && templateLabelMap[templateId]) return templateLabelMap[templateId];
      return fallback;
    };
    const sortedDocs = [...referenceDocuments].sort((a, b) => {
      const aKey = a?.key;
      const bKey = b?.key;
      const aPriority = aKey && keyPriority[aKey] !== undefined ? keyPriority[aKey] : 99;
      const bPriority = bKey && keyPriority[bKey] !== undefined ? keyPriority[bKey] : 99;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return String(a?.fileName || '').localeCompare(String(b?.fileName || ''));
    });
    const evidenceItems = sortedDocs.map((doc, index) => {
      const fallbackLabel = doc.fileName || `Reference ${index + 1}`;
      let label = resolveLabel(doc, fallbackLabel);
      if (doc?.key === 'fa_invoice') {
        label = `Vendor Invoice - ${doc.fileName || `Invoice ${index + 1}`}`;
      }
      if (doc?.key === 'fa_payment') {
        label = `Check Copy - ${doc.fileName || `Payment ${index + 1}`}`;
      }
      return {
        evidenceId: doc.id || doc._tempId || doc.fileName || `ref-${index + 1}`,
        evidenceFileName: label,
        documentLabel: label,
        paymentId: label,
        payee: caseData?.clientName || 'Client document',
        storagePath: doc.storagePath,
        downloadURL: doc.downloadURL,
        hasLinkedDocument: Boolean(doc.storagePath || doc.downloadURL),
      };
    });
    setSelectedEvidenceItems(evidenceItems);
  }, [caseData, referenceDocuments]);

  useEffect(() => {
    if (!activeEvidenceId) {
      setActiveEvidenceUrl('');
      setActiveEvidenceError('');
      return;
    }
    const selected = selectedEvidenceItems.find((item) => item.evidenceId === activeEvidenceId);
    if (!selected) return;

    const resolveEvidence = async () => {
      setActiveEvidenceLoading(true);
      setActiveEvidenceError('');
      try {
        if (!selected.storagePath && !selected.downloadURL) {
          setActiveEvidenceUrl('');
          return;
        }
        const url = await requestSignedUrl({
          storagePath: selected.storagePath,
          downloadURL: selected.downloadURL,
        });
        setActiveEvidenceUrl(url);
      } catch (error) {
        console.error('[FixedAssetTesting] Failed to resolve evidence URL', error);
        setActiveEvidenceUrl('');
        setActiveEvidenceError('Unable to load document preview.');
      } finally {
        setActiveEvidenceLoading(false);
      }
    };

    resolveEvidence();
  }, [activeEvidenceId, selectedEvidenceItems, requestSignedUrl]);

  useEffect(() => {
    if (isLocked) return;
    if (!caseId || !userId) return;
    if (Date.now() - lastLocalChangeRef.current < 200) return;
    enqueueProgressSave(activeStepRef.current);
  }, [fixedAssetDraft, activeStep, enqueueProgressSave, isLocked, caseId, userId]);

  useEffect(() => () => {
    if (progressSaveTimeoutRef.current) {
      clearTimeout(progressSaveTimeoutRef.current);
    }
  }, []);

  const handleEnterSimulation = () => {
    if (isLocked) return;
    const nextStep = workflowSteps[1] || FLOW_STEPS.RESULTS;
    setActiveStep(nextStep);
    enqueueProgressSave(nextStep);
  };

  const goToStep = (stepKey) => {
    if (!workflowSteps.includes(stepKey)) return;
    setActiveStep(stepKey);
    enqueueProgressSave(stepKey);
  };

  const goToNextStep = (stepKey) => {
    const idx = workflowSteps.indexOf(stepKey);
    if (idx >= 0 && idx < workflowSteps.length - 1) {
      goToStep(workflowSteps[idx + 1]);
    }
  };

  const goToPreviousStep = (stepKey) => {
    const idx = workflowSteps.indexOf(stepKey);
    if (idx > 0) {
      goToStep(workflowSteps[idx - 1]);
    }
  };

  const toggleLeadScheduleTick = (cellKey) => {
    if (isLocked) return;
    if (!cellKey) return;
    lastLocalChangeRef.current = Date.now();
    setFixedAssetDraft((prev) => {
      const next = { ...prev, leadScheduleTicks: { ...(prev.leadScheduleTicks || {}) } };
      const current = next.leadScheduleTicks[cellKey];
      if (!current) {
        next.leadScheduleTicks[cellKey] = 'verified';
      } else if (current === 'verified') {
        next.leadScheduleTicks[cellKey] = 'exception';
      } else {
        delete next.leadScheduleTicks[cellKey];
      }
      return next;
    });
    enqueueProgressSave(activeStepRef.current);
  };

  const updateScopingDecision = (patch) => {
    if (isLocked) return;
    lastLocalChangeRef.current = Date.now();
    setFixedAssetDraft((prev) => ({
      ...prev,
      scopingDecision: { ...(prev.scopingDecision || {}), ...(patch || {}) },
    }));
    enqueueProgressSave(activeStepRef.current);
  };

  const updateAdditionResponse = (additionId, patch) => {
    if (isLocked) return;
    if (!additionId) return;
    lastLocalChangeRef.current = Date.now();
    setFixedAssetDraft((prev) => ({
      ...prev,
      additionResponses: {
        ...(prev.additionResponses || {}),
        [additionId]: {
          ...(prev.additionResponses || {})[additionId],
          ...(patch || {}),
        },
      },
    }));
    enqueueProgressSave(activeStepRef.current);
  };

  const updateDisposalResponse = (disposalId, patch) => {
    if (isLocked) return;
    if (!disposalId) return;
    lastLocalChangeRef.current = Date.now();
    setFixedAssetDraft((prev) => ({
      ...prev,
      disposalResponses: {
        ...(prev.disposalResponses || {}),
        [disposalId]: {
          ...(prev.disposalResponses || {})[disposalId],
          ...(patch || {}),
        },
      },
    }));
    enqueueProgressSave(activeStepRef.current);
  };

  const updateAnalyticsResponse = (patch) => {
    if (isLocked) return;
    lastLocalChangeRef.current = Date.now();
    setFixedAssetDraft((prev) => ({
      ...prev,
      analyticsResponse: { ...(prev.analyticsResponse || {}), ...(patch || {}) },
    }));
    enqueueProgressSave(activeStepRef.current);
  };

  const handleViewDocument = async (docInfo) => {
    if (!docInfo || (!docInfo.storagePath && !docInfo.downloadURL)) {
      showModal?.('Document unavailable—re-upload required by an admin.', 'Error');
      return;
    }

    try {
      const url = await requestSignedUrl({
        storagePath: docInfo.storagePath,
        downloadURL: docInfo.downloadURL,
        docLabel: docInfo.fileName || docInfo.id || '',
      });
      window.open(url, '_blank');
    } catch (error) {
      console.error('Error getting signed URL:', error);
      showModal?.('Unable to open the document. Please try again.', 'Error');
    }
  };

  const handleDownloadAllReferences = () => {
    referenceDocuments.forEach((doc) => {
      if (!doc) return;
      handleViewDocument({
        fileName: doc.fileName,
        storagePath: doc.storagePath,
        downloadURL: doc.downloadURL,
      });
    });
  };

  const handleSubmitFixedAsset = async () => {
    if (!caseId || !userId || !caseData) return;
    if (isLocked) return;
    const caseTitle = caseData.title || caseData.caseName || 'Audit Case';
    const fixedAssetResponses = {
      leadScheduleTicks: fixedAssetDraft.leadScheduleTicks || {},
      scopingDecision: fixedAssetDraft.scopingDecision || {},
      additionResponses: fixedAssetDraft.additionResponses || {},
      disposalResponses: fixedAssetDraft.disposalResponses || {},
      analyticsResponse: fixedAssetDraft.analyticsResponse || {},
      summaryTotals: fixedAssetTotals,
    };

    try {
      await saveSubmission(userId, caseId, {
        caseId,
        caseName: caseTitle,
        submittedAt: Timestamp.now(),
        fixedAssetResponses,
        status: 'submitted',
      });

      await saveProgress({
        appId,
        uid: userId,
        caseId,
        patch: {
          percentComplete: 100,
          state: 'submitted',
          step: FLOW_STEPS.RESULTS,
          draft: {
            fixedAssetDraft,
            selectedPaymentIds: [],
          },
          hasSuccessfulAttempt: true,
        },
        clearActiveAttempt: true,
      });

      setSubmission((prev) => ({
        ...(prev || {}),
        fixedAssetResponses,
      }));
      setIsLocked(true);
      setActiveStep(FLOW_STEPS.RESULTS);
    } catch (error) {
      console.error('[FixedAssetTesting] Failed to submit', error);
      showModal?.(`Error saving submission: ${error?.message || 'Unknown error'}`, 'Error');
    }
  };

  const renderStepper = () => {
    const stepIndex = workflowSteps.indexOf(activeStep);
    return (
      <ol className="flex flex-col gap-3 md:flex-row md:items-stretch md:justify-between rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-4 py-4 shadow-sm">
        {workflowSteps.map((stepKey, idx) => {
          const isCompleted = furthestStepIndex > idx;
          const isActive = stepIndex === idx;
          const canNavigate = idx <= furthestStepIndex;
          return (
            <li key={stepKey} className="flex items-center space-x-3 md:flex-1">
              <button
                type="button"
                onClick={() => {
                  if (!canNavigate) return;
                  if (activeStep === stepKey) return;
                  goToStep(stepKey);
                }}
                className={`flex items-center space-x-3 text-left ${
                  canNavigate ? 'cursor-pointer' : 'cursor-not-allowed'
                }`}
                disabled={!canNavigate}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : isCompleted
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {isCompleted ? 'OK' : idx + 1}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-slate-800'}`}>
                    {workflow.labels[stepKey] || stepKey}
                  </p>
                  <p className="text-xs text-slate-500 hidden sm:block">
                    {workflow.descriptions[stepKey] || ''}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    );
  };

  const renderInstructionStep = () => (
    <InstructionView
      instructionData={caseData?.instruction}
      onStartSimulation={handleEnterSimulation}
      gateRequired={activeStep === FLOW_STEPS.INSTRUCTION}
      onGateAttempt={() => {
        lastLocalChangeRef.current = Date.now();
      }}
    />
  );

  const renderSelectionStep = (stepKey) => {
    const config = workflow.stepConfig[stepKey] || {};
    return (
    <FixedAssetSelectionStep
      fixedAssetDraft={fixedAssetDraft}
      fixedAssetTotals={fixedAssetTotals}
      fixedAssetSummary={fixedAssetSummary}
      fixedAssetRisk={fixedAssetRisk}
      isLocked={isLocked}
      navigate={navigate}
      toggleLeadScheduleTick={toggleLeadScheduleTick}
      updateScopingDecision={updateScopingDecision}
      setIsScopingModalOpen={setIsScopingModalOpen}
      scopingModalError={scopingModalError}
      setScopingModalError={setScopingModalError}
      isScopingModalOpen={isScopingModalOpen}
      showScoping={config.showScoping}
      showSubmit={config.showSubmit}
      submitLabel={config.submitLabel || workflow.submitLabels[stepKey] || 'Submit Rollforward'}
      onSubmit={handleSubmitFixedAsset}
      onStrategyLocked={() => {
        goToNextStep(stepKey);
      }}
    />
  );
  };

  const renderTestingStep = (stepKey) => {
    const config = workflow.stepConfig[stepKey] || {};
    return (
    <FixedAssetTestingStep
      fixedAssetDraft={fixedAssetDraft}
      fixedAssetRisk={fixedAssetRisk}
      fixedAssetTotals={fixedAssetTotals}
      fixedAssetSummary={fixedAssetSummary}
      fixedAssetAdditions={fixedAssetAdditions}
      fixedAssetDisposals={fixedAssetDisposals}
      referenceDocuments={referenceDocuments}
      selectedEvidenceItems={selectedEvidenceItems}
      viewerEvidenceItems={viewerEvidenceItems}
      onSelectEvidence={setActiveEvidenceId}
      activeEvidenceId={activeEvidenceId}
      viewerEnabled={viewerEnabled}
      activeEvidenceLoading={activeEvidenceLoading}
      activeEvidenceError={activeEvidenceError}
      activeEvidenceUrl={activeEvidenceUrl}
      handleViewDocument={handleViewDocument}
      handleDownloadAllReferences={handleDownloadAllReferences}
      isEvidenceWorkflowLinked={() => true}
      pdfViewerState={{}}
      toggleLeadScheduleTick={toggleLeadScheduleTick}
      updateScopingDecision={updateScopingDecision}
      updateAdditionResponse={updateAdditionResponse}
      updateDisposalResponse={updateDisposalResponse}
      updateAnalyticsResponse={updateAnalyticsResponse}
      handleSubmitFixedAsset={handleSubmitFixedAsset}
      setActiveStep={setActiveStep}
      firstWorkflowStep={workflowSteps[1] || FLOW_STEPS.SELECTION}
      onBackToSelection={() => goToPreviousStep(stepKey)}
      visibleSections={config.visibleSections}
      submitLabel={config.submitLabel || workflow.submitLabels[stepKey] || 'Submit Fixed Asset Testing'}
      isLocked={isLocked}
      isScopingModalOpen={isScopingModalOpen}
      setIsScopingModalOpen={setIsScopingModalOpen}
      scopingModalError={scopingModalError}
      setScopingModalError={setScopingModalError}
    />
  );
  };

  const renderScopingStep = (stepKey) => (
    <FixedAssetScopingStep
      fixedAssetDraft={fixedAssetDraft}
      fixedAssetRisk={fixedAssetRisk}
      fixedAssetTotals={fixedAssetTotals}
      isLocked={isLocked}
      updateScopingDecision={updateScopingDecision}
      isScopingModalOpen={isScopingModalOpen}
      setIsScopingModalOpen={setIsScopingModalOpen}
      scopingModalError={scopingModalError}
      setScopingModalError={setScopingModalError}
      submitLabel={workflow.submitLabels[stepKey] || 'Submit Scoping Decision'}
      onSubmit={handleSubmitFixedAsset}
    />
  );

  const renderResultsStep = () => (
    <ResultsStep
      isFixedAssetLayout
      submission={submission}
      fixedAssetDraft={fixedAssetDraft}
      fixedAssetRisk={fixedAssetRisk}
      fixedAssetTotals={fixedAssetTotals}
      fixedAssetAdditions={fixedAssetAdditions}
      fixedAssetDisposals={fixedAssetDisposals}
      navigate={navigate}
      classificationFields={[]}
      selectedDisbursementDetails={[]}
      caseTitle={caseData?.title || caseData?.caseName || 'Audit Case'}
    />
  );

  let stepContent = null;
  if (activeStep === FLOW_STEPS.INSTRUCTION) stepContent = renderInstructionStep();
  else if (activeStep === FLOW_STEPS.SELECTION || activeStep === FLOW_STEPS.ROLLFORWARD)
    stepContent = renderSelectionStep(activeStep);
  else if (activeStep === FLOW_STEPS.SCOPING) stepContent = renderScopingStep(activeStep);
  else if (
    activeStep === FLOW_STEPS.TESTING ||
    activeStep === FLOW_STEPS.ADDITIONS ||
    activeStep === FLOW_STEPS.DISPOSALS ||
    activeStep === FLOW_STEPS.ANALYTICS
  )
    stepContent = renderTestingStep(activeStep);
  else stepContent = renderResultsStep();

  return (
    <div className="bg-gray-50 min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="w-full max-w-[1600px] 2xl:max-w-[1800px] mx-auto space-y-6">
        {renderStepper()}
        {stepContent}
      </div>
    </div>
  );
}
