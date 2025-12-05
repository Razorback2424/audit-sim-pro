import { useCallback, useEffect, useRef, useState } from 'react';
import { appId } from '../AppCore';
import { saveProgress, subscribeProgressForCases } from '../services/progressService';

const computePercentComplete = (step, selectedCount, classifiedCount, workflowResultsStep) => {
  if (step === workflowResultsStep) return 100;
  if (selectedCount <= 0) return 0;
  if (step === 'selection') return 25;
  if (step === 'testing') {
    const ratio = selectedCount === 0 ? 0 : Math.min(1, classifiedCount / selectedCount);
    return Math.min(95, 25 + Math.round(ratio * 70));
  }
  return 0;
};

const deriveStateFromProgress = (step, percentComplete, workflowResultsStep) => {
  if (step === workflowResultsStep || percentComplete >= 100) return 'submitted';
  if (percentComplete > 0) return 'in_progress';
  return 'not_started';
};

export default function useCaseProgress({
  caseId,
  userId,
  workflow,
  firstWorkflowStep,
  resultsWorkflowStep,
  activeStep,
  selectedIds,
  classifiedCount,
  classificationDraft,
  fixedAssetDraft,
  cashLinkMap,
  cashAdjustments,
  cashSummaryDraft,
  setActiveStep,
  setSelectedDisbursements,
  setClassificationAmounts,
  setFixedAssetDraft,
  setCashLinkMap,
  setCashAdjustments,
  setCashSummaryDraft,
  setCashCanSubmit,
  setIsLocked,
  isLocked,
  normalizeAllocationShape,
  isSameClassificationMap,
  isSameSelectionMap,
  areFixedAssetDraftsEqual,
  normalizeFixedAssetDraft,
  buildEmptyFixedAssetDraft,
  showModal,
  query,
  setQuery,
}) {
  const [isRetakeResetting, setIsRetakeResetting] = useState(false);

  const progressSaveTimeoutRef = useRef(null);
  const lastLocalChangeRef = useRef(0);
  const lastStepChangeRef = useRef(0);
  const activeStepRef = useRef(activeStep);
  const selectionRef = useRef({});
  const classificationRef = useRef({});
  const fixedAssetDraftRef = useRef(fixedAssetDraft);
  const isLockedRef = useRef(false);
  const retakeHandledRef = useRef(false);
  const retakeResettingRef = useRef(false);

  useEffect(() => {
    activeStepRef.current = activeStep;
    lastStepChangeRef.current = Date.now();
  }, [activeStep]);

  useEffect(() => {
    selectionRef.current = selectedIds.reduce((acc, id) => ({ ...acc, [id]: true }), {});
  }, [selectedIds]);

  useEffect(() => {
    classificationRef.current = classificationDraft;
  }, [classificationDraft]);

  useEffect(() => {
    fixedAssetDraftRef.current = fixedAssetDraft;
  }, [fixedAssetDraft]);

  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  useEffect(() => {
    retakeResettingRef.current = isRetakeResetting;
  }, [isRetakeResetting]);

  useEffect(() => {
    if (!caseId || !userId) return;
    const retakeValue = query?.retake;
    const retakeRequested =
      typeof retakeValue === 'string' ? retakeValue.toLowerCase() === 'true' : Boolean(retakeValue);
    if (!retakeRequested || retakeHandledRef.current) return;

    retakeHandledRef.current = true;
    setIsRetakeResetting(true);
    setIsLocked(false);
    setCashLinkMap({});
    setCashAdjustments([]);
    setCashSummaryDraft({});
    setCashCanSubmit(false);
    setActiveStep(firstWorkflowStep);
    setSelectedDisbursements({});
    setClassificationAmounts({});
    setFixedAssetDraft(buildEmptyFixedAssetDraft());

    const resetProgress = async () => {
      try {
        if (progressSaveTimeoutRef.current) {
          clearTimeout(progressSaveTimeoutRef.current);
        }

        await saveProgress({
          appId,
          uid: userId,
          caseId,
          patch: {
            percentComplete: 0,
            state: 'not_started',
            step: firstWorkflowStep,
            draft: {
              selectedPaymentIds: [],
              classificationDraft: {},
              fixedAssetDraft: buildEmptyFixedAssetDraft(),
              cashLinkMap: {},
              cashAdjustments: [],
              cashSummary: {},
            },
          },
          forceOverwrite: true,
        });
      } catch (err) {
        console.error('Failed to reset progress for retake:', err);
        showModal('We ran into an issue preparing your retake. Please try again.', 'Retake Error');
      } finally {
        setIsRetakeResetting(false);
        setQuery((prev) => {
          const next = { ...prev };
          delete next.retake;
          return next;
        }, { replace: true });
      }
    };

    resetProgress();
  }, [
    caseId,
    userId,
    query,
    setQuery,
    firstWorkflowStep,
    buildEmptyFixedAssetDraft,
    setActiveStep,
    setSelectedDisbursements,
    setClassificationAmounts,
    setFixedAssetDraft,
    setIsLocked,
    setCashLinkMap,
    setCashAdjustments,
    setCashSummaryDraft,
    setCashCanSubmit,
    showModal,
  ]);

  useEffect(() => {
    if (!caseId || !userId) return undefined;

    const unsubscribe = subscribeProgressForCases(
      { appId, uid: userId, caseIds: [caseId] },
      (progressMap) => {
        if (retakeResettingRef.current) return;
        const entry = progressMap.get(caseId);
        if (!entry) return;

        const nextStep = workflow.includes(entry.step) ? entry.step : firstWorkflowStep;
        if (nextStep && activeStepRef.current !== nextStep) {
          const currentIndex = workflow.indexOf(activeStepRef.current);
          const nextIndex = workflow.indexOf(nextStep);
          const isRegression = currentIndex !== -1 && nextIndex !== -1 && nextIndex < currentIndex;
          const recentlyChangedStep = Date.now() - lastStepChangeRef.current < 800;

          // Ignore stale progress snapshots that would drag the user backwards or override a very recent local step change.
          if ((!isRegression && !recentlyChangedStep) || isLockedRef.current) {
            setActiveStep(nextStep);
          }
        }

        const nextSelection = {};
        (entry.draft?.selectedPaymentIds || []).forEach((id) => {
          if (id) nextSelection[id] = true;
        });
        const recentlyChanged = Date.now() - lastLocalChangeRef.current < 800;
        if (!recentlyChanged && !isSameSelectionMap(selectionRef.current, nextSelection)) {
          setSelectedDisbursements(nextSelection);
        }

        const rawClassifications = entry.draft?.classificationDraft || {};
        const normalizedClassifications = Object.keys(rawClassifications).reduce((acc, key) => {
          acc[key] = normalizeAllocationShape(rawClassifications[key]);
          return acc;
        }, {});
        if (!isSameClassificationMap(classificationRef.current, normalizedClassifications)) {
          setClassificationAmounts(normalizedClassifications);
        }

        const nextFixedAssetDraft = normalizeFixedAssetDraft(entry.draft?.fixedAssetDraft);
        if (!areFixedAssetDraftsEqual(fixedAssetDraftRef.current, nextFixedAssetDraft)) {
          setFixedAssetDraft(nextFixedAssetDraft);
        }

        const nextCashLinks =
          entry.draft?.cashLinkMap && typeof entry.draft.cashLinkMap === 'object'
            ? entry.draft.cashLinkMap
            : {};
        setCashLinkMap(nextCashLinks);

        const nextCashAdjustments = Array.isArray(entry.draft?.cashAdjustments)
          ? entry.draft.cashAdjustments
          : [];
        setCashAdjustments(nextCashAdjustments);

        const nextCashSummary =
          entry.draft?.cashSummary && typeof entry.draft.cashSummary === 'object'
            ? entry.draft.cashSummary
            : {};
        setCashSummaryDraft(nextCashSummary);

        const shouldLock = entry.state === 'submitted' || nextStep === resultsWorkflowStep;
        if (isLockedRef.current !== shouldLock) {
          setIsLocked(shouldLock);
          isLockedRef.current = shouldLock;
        }
      },
      (error) => {
        console.error('Error subscribing to progress:', error);
      }
    );

    return () => unsubscribe();
  }, [
    caseId,
    userId,
    workflow,
    firstWorkflowStep,
    resultsWorkflowStep,
    isSameSelectionMap,
    normalizeAllocationShape,
    isSameClassificationMap,
    areFixedAssetDraftsEqual,
    normalizeFixedAssetDraft,
    setActiveStep,
    setSelectedDisbursements,
    setClassificationAmounts,
    setFixedAssetDraft,
    setCashLinkMap,
    setCashAdjustments,
    setCashSummaryDraft,
    setIsLocked,
  ]);

  const enqueueProgressSave = useCallback(
    (stepOverride) => {
      if (!userId || !caseId) return;
      const step = stepOverride || activeStepRef.current || firstWorkflowStep;
      const selectedCount = selectedIds.length;
      const percentComplete = computePercentComplete(step, selectedCount, classifiedCount, resultsWorkflowStep);

      const patch = {
        percentComplete,
        state: deriveStateFromProgress(step, percentComplete, resultsWorkflowStep),
        step,
        draft: {
          selectedPaymentIds: selectedIds,
          classificationDraft,
          fixedAssetDraft,
          cashLinkMap,
          cashAdjustments,
          cashSummary: cashSummaryDraft,
        },
      };

      lastLocalChangeRef.current = Date.now();

      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }
      progressSaveTimeoutRef.current = setTimeout(() => {
        saveProgress({
          appId,
          uid: userId,
          caseId,
          patch,
        }).catch((error) => {
          console.error('Error saving progress: ', error);
        });
      }, 300);
    },
    [
      caseId,
      userId,
      selectedIds,
      classifiedCount,
      classificationDraft,
      fixedAssetDraft,
      cashLinkMap,
      cashAdjustments,
      cashSummaryDraft,
      firstWorkflowStep,
      resultsWorkflowStep,
    ]
  );

  const cancelPendingSave = useCallback(() => {
    if (progressSaveTimeoutRef.current) {
      clearTimeout(progressSaveTimeoutRef.current);
      progressSaveTimeoutRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      cancelPendingSave();
    },
    [cancelPendingSave]
  );

  return { enqueueProgressSave, cancelPendingSave, isRetakeResetting };
}
