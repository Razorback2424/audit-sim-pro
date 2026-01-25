import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { Button, appId } from '../../AppCore';
import { saveSubmission } from '../../services/submissionService';
import { saveProgress, subscribeProgressForCases } from '../../services/progressService';
import { fetchRecipeProgress, saveRecipeProgress } from '../../services/recipeProgressService';
import { currencyFormatter } from '../../utils/formatters';
import InstructionView from '../InstructionView';

const FLOW_STEPS = Object.freeze({
  INSTRUCTION: 'instruction',
  SELECTION: 'selection',
  TESTING: 'testing',
  RESULTS: 'results',
});

const STEP_SEQUENCE = [
  FLOW_STEPS.INSTRUCTION,
  FLOW_STEPS.SELECTION,
  FLOW_STEPS.TESTING,
  FLOW_STEPS.RESULTS,
];

const STEP_LABELS = {
  [FLOW_STEPS.INSTRUCTION]: 'Instruction',
  [FLOW_STEPS.SELECTION]: 'Select Sample',
  [FLOW_STEPS.TESTING]: 'Trace & Conclude',
  [FLOW_STEPS.RESULTS]: 'Review Outcome',
};

const STEP_DESCRIPTIONS = {
  [FLOW_STEPS.INSTRUCTION]: 'Review the materials and successfully answer the knowledge check questions to access the simulation.',
  [FLOW_STEPS.SELECTION]: 'Pick the checks you will test from January clearings.',
  [FLOW_STEPS.TESTING]: 'Trace each selection to the register and the 12/31 outstanding list.',
  [FLOW_STEPS.RESULTS]: 'See your recap and any exceptions.',
};

const normalizeCheckNo = (value) => (value === null || value === undefined ? '' : String(value).trim());

const parseDate = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const formatShortDate = (value) => {
  if (!value) return '';
  return value.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
};

const coerceToMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return null;
};

const compareDatesYMD = (a, b) => {
  if (!a || !b) return null;
  const aY = a.getFullYear();
  const aM = a.getMonth();
  const aD = a.getDate();
  const bY = b.getFullYear();
  const bM = b.getMonth();
  const bD = b.getDate();
  if (aY !== bY) return aY - bY;
  if (aM !== bM) return aM - bM;
  return aD - bD;
};

const computePercentComplete = (step, selectedCount, completedCount) => {
  if (step === FLOW_STEPS.INSTRUCTION) return 0;
  if (step === FLOW_STEPS.RESULTS) return 100;
  if (selectedCount <= 0) return 0;
  if (step === FLOW_STEPS.SELECTION) return 25;
  if (step === FLOW_STEPS.TESTING) {
    const ratio = selectedCount === 0 ? 0 : Math.min(1, completedCount / selectedCount);
    return Math.min(95, 25 + Math.round(ratio * 70));
  }
  return 0;
};

const deriveStateFromProgress = (step, percentComplete) => {
  if (step === FLOW_STEPS.RESULTS || percentComplete >= 100) return 'submitted';
  if (percentComplete > 0) return 'in_progress';
  return 'not_started';
};

const getRecipeId = (caseData) =>
  caseData?.moduleId || caseData?.recipeId || caseData?.id || '';

const normalizeRecipeVersion = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.floor(parsed);
};

const getRecipeVersion = (caseData) => {
  if (!caseData) return 1;
  return normalizeRecipeVersion(
    caseData?.instruction?.version ??
      caseData?.recipeVersion ??
      caseData?.moduleVersion ??
      1
  );
};

const isSameSelectionMap = (currentMap, nextMap) => {
  const currentKeys = Object.keys(currentMap);
  const nextKeys = Object.keys(nextMap);
  if (currentKeys.length !== nextKeys.length) return false;
  return currentKeys.every((key) => !!nextMap[key]);
};

const shallowEqualRecord = (a, b) => {
  const aObj = a && typeof a === 'object' ? a : {};
  const bObj = b && typeof b === 'object' ? b : {};
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => aObj[key] === bObj[key]);
};

function ArtifactViewer({ artifacts = [] }) {
  const yearEnd = artifacts.find((doc) => doc?.type === 'cash_year_end_statement') || null;
  const cutoff = artifacts.find((doc) => doc?.type === 'cash_cutoff_statement') || null;

  const renderOne = (doc, title) => {
    if (!doc) {
      return (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
          {title} not provided by instructor.
        </div>
      );
    }
    const url = doc.downloadURL || '';
    return (
      <div className="rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
          <div>
            <p className="text-sm font-semibold text-gray-800">{title}</p>
            <p className="text-xs text-gray-500">{doc.fileName || 'File'}</p>
          </div>
          {url ? (
            <Button variant="secondary" className="text-xs px-3 py-1" onClick={() => window.open(url, '_blank')}>
              Open PDF
            </Button>
          ) : null}
        </div>
        <div className="min-h-[320px] bg-gray-50">
          {url ? (
            <iframe title={title} src={url} className="h-[320px] w-full rounded-b-md" />
          ) : (
            <div className="px-4 py-6 text-sm text-gray-600">No download URL provided.</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {renderOne(yearEnd, 'December (Year-End) Bank Statement')}
      {renderOne(cutoff, 'January Cutoff Bank Statement')}
    </div>
  );
}

export default function OutstandingCheckTestingModule({ caseId, caseData, userId, navigate, showModal }) {
  const firstPostInstructionStep = FLOW_STEPS.SELECTION;

  const yearEndDateRaw = caseData?.cashContext?.reconciliationDate || '';
  const yearEndDate = useMemo(() => parseDate(yearEndDateRaw), [yearEndDateRaw]);
  const yearEndDateMissing = !yearEndDateRaw || !yearEndDate;
  const cutoffWindowDaysRaw = caseData?.cashContext?.cutoffWindowDays ?? '';
  const cutoffWindowDays = Number(cutoffWindowDaysRaw);
  const cutoffWindowValid = Number.isFinite(cutoffWindowDays) && cutoffWindowDays > 0;
  const cutoffEndDate = useMemo(() => {
    if (!yearEndDate || !cutoffWindowValid) return null;
    const end = new Date(yearEndDate);
    end.setDate(end.getDate() + cutoffWindowDays);
    return end;
  }, [cutoffWindowDays, cutoffWindowValid, yearEndDate]);
  const cutoffWindowLabel = cutoffWindowValid ? `${cutoffWindowDays} day${cutoffWindowDays === 1 ? '' : 's'}` : '';

  const bankPopulation = useMemo(() => {
    const raw = Array.isArray(caseData?.cashCutoffItems) ? caseData.cashCutoffItems : [];
    return raw
      .map((row, index) => {
        const checkNo = normalizeCheckNo(row?.reference);
        if (!checkNo) return null;
        return {
          id: checkNo,
          checkNo,
          clearingDate: row?.clearDate || '',
          amount: row?.amount ?? '',
          __index: index,
        };
      })
      .filter(Boolean);
  }, [caseData]);

  const outstandingList = useMemo(() => {
    const raw = Array.isArray(caseData?.cashOutstandingItems) ? caseData.cashOutstandingItems : [];
    const map = new Map();
    raw.forEach((row, index) => {
      const checkNo = normalizeCheckNo(row?.reference);
      if (!checkNo) return;
      map.set(checkNo, {
        id: checkNo,
        checkNo,
        amount: row?.amount ?? '',
        payee: row?.payee || '',
        checkDate: row?.issueDate || '',
        __index: index,
      });
    });
    return map;
  }, [caseData]);

  const registerMap = useMemo(() => {
    const raw = Array.isArray(caseData?.cashRegisterItems) ? caseData.cashRegisterItems : [];
    const map = new Map();
    raw.forEach((row, index) => {
      const checkNo = normalizeCheckNo(row?.checkNo);
      if (!checkNo) return;
      map.set(checkNo, {
        id: checkNo,
        checkNo,
        writtenDate: row?.writtenDate || '',
        amount: row?.amount ?? '',
        payee: row?.payee || '',
        __index: index,
      });
    });
    return map;
  }, [caseData]);

  const registerRows = useMemo(() => {
    const rows = Array.from(registerMap.values());
    rows.sort((a, b) => String(a.checkNo || '').localeCompare(String(b.checkNo || '')));
    return rows;
  }, [registerMap]);

  const outstandingRows = useMemo(() => {
    const rows = Array.from(outstandingList.values());
    rows.sort((a, b) => String(a.checkNo || '').localeCompare(String(b.checkNo || '')));
    return rows;
  }, [outstandingList]);

  const [activeStep, setActiveStep] = useState(FLOW_STEPS.INSTRUCTION);
  const [recipeProgress, setRecipeProgress] = useState(null);
  const [selectedChecks, setSelectedChecks] = useState({});
  const [registerConfirmed, setRegisterConfirmed] = useState({});
  const [registerEligibility, setRegisterEligibility] = useState({});
  const [registerAmountMatch, setRegisterAmountMatch] = useState({});
  const [decisions, setDecisions] = useState({});
  const [outstandingAmountMatch, setOutstandingAmountMatch] = useState({});
  const [outstandingPayeeMatch, setOutstandingPayeeMatch] = useState({});
  const [exceptionNotes, setExceptionNotes] = useState({});
  const [exceptionCauses, setExceptionCauses] = useState({});
  const [isLocked, setIsLocked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [furthestStepIndex, setFurthestStepIndex] = useState(0);

  const progressSaveTimeoutRef = useRef(null);
  const lastLocalChangeRef = useRef(0);
  const activeStepRef = useRef(activeStep);
  const selectionRef = useRef(selectedChecks);
  const selectedCheckNosRef = useRef([]);
  const completedCountRef = useRef(0);
  const registerConfirmedRef = useRef(registerConfirmed);
  const registerEligibilityRef = useRef(registerEligibility);
  const registerAmountMatchRef = useRef(registerAmountMatch);
  const decisionsRef = useRef(decisions);
  const outstandingAmountMatchRef = useRef(outstandingAmountMatch);
  const outstandingPayeeMatchRef = useRef(outstandingPayeeMatch);
  const exceptionNotesRef = useRef(exceptionNotes);
  const exceptionCausesRef = useRef(exceptionCauses);
  const isLockedRef = useRef(isLocked);
  const attemptStartedAtRef = useRef(null);
  const hasProgressRef = useRef(false);

  const recipeId = useMemo(() => getRecipeId(caseData), [caseData]);
  const recipeGateId = useMemo(() => {
    const base = recipeId || '';
    const level = typeof caseData?.caseLevel === 'string' ? caseData.caseLevel.trim().toLowerCase() : '';
    return level ? `${base}::${level}` : base;
  }, [caseData, recipeId]);
  const recipeVersion = useMemo(() => getRecipeVersion(caseData), [caseData]);
  const gateScope = useMemo(() => {
    const scope = caseData?.workflow?.gateScope;
    return scope === 'per_attempt' ? 'per_attempt' : 'once';
  }, [caseData]);
  const gatePassed = useMemo(
    () => Boolean(recipeProgress && recipeProgress.passedVersion >= recipeVersion),
    [recipeProgress, recipeVersion]
  );
  const gateRequired = gateScope === 'per_attempt' ? true : !gatePassed;

  const selectedCheckNos = useMemo(
    () =>
      bankPopulation
        .map((item) => item.checkNo)
        .filter((checkNo) => selectedChecks[checkNo]),
    [bankPopulation, selectedChecks]
  );

  const selectedCount = selectedCheckNos.length;
  const bankPopulationMissing = bankPopulation.length === 0;
  const registerMissingForSelected = useMemo(
    () => selectedCheckNos.filter((checkNo) => !registerMap.has(checkNo)),
    [registerMap, selectedCheckNos]
  );

  const evalForCheck = useCallback(
    (checkNo) => {
      const bankItem = bankPopulation.find((item) => item.checkNo === checkNo) || null;
      const reg = registerMap.get(checkNo) || null;
      const writtenDate = reg ? parseDate(reg.writtenDate) : null;
      const eligible =
        yearEndDate && writtenDate ? compareDatesYMD(writtenDate, yearEndDate) <= 0 : null;
      const onOutstandingList = outstandingList.has(checkNo);
      const correctDecision =
        eligible === false ? 'out_of_scope' : eligible === true ? (onOutstandingList ? 'found' : 'missing') : '';

      const registerAmountMatches =
        reg && bankItem ? Math.abs(Number(reg.amount || 0) - Number(bankItem.amount || 0)) <= 0.01 : null;
      const outstandingItem = outstandingList.get(checkNo) || null;
      const outstandingAmountMatches =
        outstandingItem && bankItem
          ? Math.abs(Number(outstandingItem.amount || 0) - Number(bankItem.amount || 0)) <= 0.01
          : null;
      const outstandingPayeeMatches =
        outstandingItem && outstandingItem.payee && reg && reg.payee
          ? outstandingItem.payee === reg.payee
          : null;

      const studentEligibility = registerEligibility[checkNo] || '';
      const studentRegisterAmountMatch = registerAmountMatch[checkNo] || '';
      const studentDecision = decisions[checkNo] || '';
      const studentOutstandingAmountMatch = outstandingAmountMatch[checkNo] || '';
      const studentOutstandingPayeeMatch = outstandingPayeeMatch[checkNo] || '';
      const studentCause = exceptionCauses[checkNo] || '';

      return {
        checkNo,
        bankItem,
        registerItem: reg,
        eligible,
        onOutstandingList,
        correctDecision,
        registerAmountMatches,
        outstandingItem,
        outstandingAmountMatches,
        outstandingPayeeMatches,
        studentEligibility,
        studentRegisterAmountMatch,
        studentDecision,
        studentOutstandingAmountMatch,
        studentOutstandingPayeeMatch,
        studentCause,
      };
    },
    [
      bankPopulation,
      decisions,
      exceptionCauses,
      outstandingAmountMatch,
      outstandingList,
      outstandingPayeeMatch,
      registerAmountMatch,
      registerEligibility,
      registerMap,
      yearEndDate,
    ]
  );

  const completedCount = useMemo(() => {
    return selectedCheckNos.filter((checkNo) => {
      if (!registerConfirmed[checkNo]) return false;
      const eligibilityDecision = registerEligibility[checkNo];
      const registerAmountDecision = registerAmountMatch[checkNo];
      if (!eligibilityDecision) return false;
      if (!registerAmountDecision) return false;
      if (eligibilityDecision === 'ineligible') return true;
      if (eligibilityDecision === 'eligible') {
        const decision = decisions[checkNo];
        if (decision !== 'found' && decision !== 'missing') return false;
        if (decision === 'found') {
          const amountMatchDecision = outstandingAmountMatch[checkNo];
          if (!amountMatchDecision) return false;
          const outstandingItem = outstandingList.get(checkNo);
          if (outstandingItem?.payee) {
            const payeeMatchDecision = outstandingPayeeMatch[checkNo];
            if (!payeeMatchDecision) return false;
          }
          return true;
        }
        const note = (exceptionNotes[checkNo] || '').trim();
        const cause = exceptionCauses[checkNo] || '';
        return note.length > 0 && Boolean(cause);
      }
      return false;
    }).length;
  }, [
    decisions,
    exceptionCauses,
    exceptionNotes,
    outstandingAmountMatch,
    outstandingList,
    outstandingPayeeMatch,
    registerAmountMatch,
    registerConfirmed,
    registerEligibility,
    selectedCheckNos,
  ]);

  const percentComplete = useMemo(
    () => computePercentComplete(activeStep, selectedCount, completedCount),
    [activeStep, selectedCount, completedCount]
  );

  const enqueueProgressSave = useCallback(
    (nextStep) => {
      if (!caseId || !userId) return;
      if (!attemptStartedAtRef.current) {
        attemptStartedAtRef.current = Date.now();
      }
      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }
      const targetStep = nextStep || activeStepRef.current;
      progressSaveTimeoutRef.current = setTimeout(async () => {
        try {
          const currentSelected = Array.isArray(selectedCheckNosRef.current)
            ? selectedCheckNosRef.current
            : [];
          const currentSelectedCount = currentSelected.length;
          const currentCompletedCount = Number(completedCountRef.current || 0);
          const currentPercent = computePercentComplete(
            targetStep,
            currentSelectedCount,
            currentCompletedCount
          );
          await saveProgress({
            appId,
            uid: userId,
            caseId,
            patch: {
              percentComplete: currentPercent,
              state: deriveStateFromProgress(targetStep, currentPercent),
              step: targetStep,
              draft: {
                selectedPaymentIds: currentSelected,
                outstandingCheckTesting: {
                  registerConfirmed: registerConfirmedRef.current,
                  registerEligibility: registerEligibilityRef.current,
                  registerAmountMatch: registerAmountMatchRef.current,
                  decisions: decisionsRef.current,
                  outstandingAmountMatch: outstandingAmountMatchRef.current,
                  outstandingPayeeMatch: outstandingPayeeMatchRef.current,
                  exceptionNotes: exceptionNotesRef.current,
                  exceptionCauses: exceptionCausesRef.current,
                },
              },
            },
          });
        } catch (err) {
          console.error('[OutstandingCheckTesting] Failed to save progress', err);
        }
      }, 600);
    },
    [caseId, userId]
  );

  useEffect(() => {
    activeStepRef.current = activeStep;
    const currentIndex = STEP_SEQUENCE.indexOf(activeStep);
    if (currentIndex >= 0) {
      setFurthestStepIndex((prev) => Math.max(prev, currentIndex));
    }
  }, [activeStep]);

  useEffect(() => {
    if (!caseData || !userId || !recipeGateId) return;
    let isActive = true;

    fetchRecipeProgress({ appId, uid: userId, recipeId: recipeGateId })
      .then((progress) => {
        if (!isActive) return;
        setRecipeProgress(progress);
      })
      .catch((error) => {
        console.error('Error fetching recipe progress:', error);
        if (isActive) {
          setRecipeProgress(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [caseData, userId, recipeGateId]);

  useEffect(() => {
    if (isLocked) return;
    if (hasProgressRef.current) return;
    if (gateScope !== 'once' || !gatePassed) return;
    if (activeStepRef.current !== FLOW_STEPS.INSTRUCTION) return;
    setActiveStep(firstPostInstructionStep);
  }, [gateScope, gatePassed, isLocked, firstPostInstructionStep]);

  useEffect(() => {
    selectionRef.current = selectedChecks;
  }, [selectedChecks]);

  useEffect(() => {
    selectedCheckNosRef.current = selectedCheckNos;
  }, [selectedCheckNos]);

  useEffect(() => {
    completedCountRef.current = completedCount;
  }, [completedCount]);

  useEffect(() => {
    registerConfirmedRef.current = registerConfirmed;
  }, [registerConfirmed]);

  useEffect(() => {
    registerEligibilityRef.current = registerEligibility;
  }, [registerEligibility]);

  useEffect(() => {
    registerAmountMatchRef.current = registerAmountMatch;
  }, [registerAmountMatch]);

  useEffect(() => {
    decisionsRef.current = decisions;
  }, [decisions]);

  useEffect(() => {
    outstandingAmountMatchRef.current = outstandingAmountMatch;
  }, [outstandingAmountMatch]);

  useEffect(() => {
    outstandingPayeeMatchRef.current = outstandingPayeeMatch;
  }, [outstandingPayeeMatch]);

  useEffect(() => {
    exceptionNotesRef.current = exceptionNotes;
  }, [exceptionNotes]);

  useEffect(() => {
    exceptionCausesRef.current = exceptionCauses;
  }, [exceptionCauses]);

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
        hasProgressRef.current = true;

        const startedAtMs = coerceToMillis(entry.activeAttempt?.startedAt);
        if (startedAtMs && !attemptStartedAtRef.current) {
          attemptStartedAtRef.current = startedAtMs;
        }

        const nextStep = STEP_SEQUENCE.includes(entry.step) ? entry.step : FLOW_STEPS.INSTRUCTION;
        const recentlyChanged = Date.now() - lastLocalChangeRef.current < 900;
        if (!recentlyChanged && activeStepRef.current !== nextStep) {
          setActiveStep(nextStep);
        }

        const nextSelection = {};
        (Array.isArray(entry.draft?.selectedPaymentIds) ? entry.draft.selectedPaymentIds : []).forEach((id) => {
          const checkNo = normalizeCheckNo(id);
          if (checkNo) nextSelection[checkNo] = true;
        });
        if (!recentlyChanged && !isSameSelectionMap(selectionRef.current, nextSelection)) {
          setSelectedChecks(nextSelection);
        }

        const otc = entry.draft?.outstandingCheckTesting && typeof entry.draft.outstandingCheckTesting === 'object'
          ? entry.draft.outstandingCheckTesting
          : {};
        const nextRegisterConfirmed =
          otc.registerConfirmed && typeof otc.registerConfirmed === 'object' ? otc.registerConfirmed : {};
        const nextRegisterEligibility =
          otc.registerEligibility && typeof otc.registerEligibility === 'object' ? otc.registerEligibility : {};
        const nextRegisterAmountMatch =
          otc.registerAmountMatch && typeof otc.registerAmountMatch === 'object' ? otc.registerAmountMatch : {};
        const nextDecisions = otc.decisions && typeof otc.decisions === 'object' ? otc.decisions : {};
        const nextOutstandingAmountMatch =
          otc.outstandingAmountMatch && typeof otc.outstandingAmountMatch === 'object' ? otc.outstandingAmountMatch : {};
        const nextOutstandingPayeeMatch =
          otc.outstandingPayeeMatch && typeof otc.outstandingPayeeMatch === 'object' ? otc.outstandingPayeeMatch : {};
        const nextNotes = otc.exceptionNotes && typeof otc.exceptionNotes === 'object' ? otc.exceptionNotes : {};
        const nextCauses = otc.exceptionCauses && typeof otc.exceptionCauses === 'object' ? otc.exceptionCauses : {};

        if (!recentlyChanged && !shallowEqualRecord(registerConfirmedRef.current, nextRegisterConfirmed)) {
          setRegisterConfirmed(nextRegisterConfirmed);
        }
        if (!recentlyChanged && !shallowEqualRecord(registerEligibilityRef.current, nextRegisterEligibility)) {
          setRegisterEligibility(nextRegisterEligibility);
        }
        if (!recentlyChanged && !shallowEqualRecord(registerAmountMatchRef.current, nextRegisterAmountMatch)) {
          setRegisterAmountMatch(nextRegisterAmountMatch);
        }
        if (!recentlyChanged && !shallowEqualRecord(decisionsRef.current, nextDecisions)) {
          setDecisions(nextDecisions);
        }
        if (!recentlyChanged && !shallowEqualRecord(outstandingAmountMatchRef.current, nextOutstandingAmountMatch)) {
          setOutstandingAmountMatch(nextOutstandingAmountMatch);
        }
        if (!recentlyChanged && !shallowEqualRecord(outstandingPayeeMatchRef.current, nextOutstandingPayeeMatch)) {
          setOutstandingPayeeMatch(nextOutstandingPayeeMatch);
        }
        if (!recentlyChanged && !shallowEqualRecord(exceptionNotesRef.current, nextNotes)) {
          setExceptionNotes(nextNotes);
        }
        if (!recentlyChanged && !shallowEqualRecord(exceptionCausesRef.current, nextCauses)) {
          setExceptionCauses(nextCauses);
        }

        const shouldLock = entry.state === 'submitted' || nextStep === FLOW_STEPS.RESULTS;
        if (isLockedRef.current !== shouldLock) {
          setIsLocked(shouldLock);
          isLockedRef.current = shouldLock;
        }
      },
      (error) => {
        console.error('[OutstandingCheckTesting] Failed to subscribe to progress', error);
      }
    );
    return () => unsubscribe();
  }, [caseId, userId]);

  useEffect(() => {
    return () => {
      if (progressSaveTimeoutRef.current) {
        clearTimeout(progressSaveTimeoutRef.current);
      }
    };
  }, []);

  const handleEnterSimulation = useCallback(() => {
    if (isLocked) return;
    if (!gatePassed && recipeGateId && userId) {
      setRecipeProgress({ recipeId: recipeGateId, passedVersion: recipeVersion, passedAt: null });
      saveRecipeProgress({ appId, uid: userId, recipeId: recipeGateId, passedVersion: recipeVersion }).catch((error) => {
        console.error('Failed to save recipe progress:', error);
      });
    }
    if (!attemptStartedAtRef.current) {
      attemptStartedAtRef.current = Date.now();
    }
    enqueueProgressSave(firstPostInstructionStep);
    setActiveStep(firstPostInstructionStep);
  }, [gatePassed, recipeGateId, recipeVersion, userId, isLocked, enqueueProgressSave, firstPostInstructionStep]);

  const toggleSelection = (checkNo) => {
    if (isLocked) return;
    const id = normalizeCheckNo(checkNo);
    if (!id) return;
    lastLocalChangeRef.current = Date.now();
    setSelectedChecks((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return next;
    });
  };

  const confirmRegisterForCheck = (checkNo) => {
    if (isLocked) return;
    const id = normalizeCheckNo(checkNo);
    if (!id) return;
    const reg = registerMap.get(id);
    if (!reg) {
      showModal?.(`No matching check register entry found for check #${id}. Ask your instructor to add it.`, 'Register Missing');
      return;
    }
    if (!yearEndDate) {
      showModal?.('Year-end date (reconciliation date) is missing. Ask your instructor to set it in Cash Context.', 'Missing Year-End Date');
      return;
    }
    const writtenDate = parseDate(reg.writtenDate);
    if (!writtenDate) {
      showModal?.(`Register written date is missing/invalid for check #${id}.`, 'Register Date Missing');
      return;
    }

    lastLocalChangeRef.current = Date.now();
    setRegisterConfirmed((prev) => ({ ...prev, [id]: true }));
    enqueueProgressSave(FLOW_STEPS.TESTING);
  };

  const setEligibilityDecision = (checkNo, value) => {
    if (isLocked) return;
    const id = normalizeCheckNo(checkNo);
    if (!id) return;
    lastLocalChangeRef.current = Date.now();
    setRegisterEligibility((prev) => ({ ...prev, [id]: value }));
    if (value !== 'eligible') {
      setDecisions((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setOutstandingAmountMatch((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setOutstandingPayeeMatch((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setExceptionNotes((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setExceptionCauses((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    enqueueProgressSave(FLOW_STEPS.TESTING);
  };

  const setRegisterAmountDecision = (checkNo, value) => {
    if (isLocked) return;
    const id = normalizeCheckNo(checkNo);
    if (!id) return;
    lastLocalChangeRef.current = Date.now();
    setRegisterAmountMatch((prev) => ({ ...prev, [id]: value }));
    enqueueProgressSave(FLOW_STEPS.TESTING);
  };

  const setOutstandingAmountDecision = (checkNo, value) => {
    if (isLocked) return;
    const id = normalizeCheckNo(checkNo);
    if (!id) return;
    lastLocalChangeRef.current = Date.now();
    setOutstandingAmountMatch((prev) => ({ ...prev, [id]: value }));
    enqueueProgressSave(FLOW_STEPS.TESTING);
  };

  const setOutstandingPayeeDecision = (checkNo, value) => {
    if (isLocked) return;
    const id = normalizeCheckNo(checkNo);
    if (!id) return;
    lastLocalChangeRef.current = Date.now();
    setOutstandingPayeeMatch((prev) => ({ ...prev, [id]: value }));
    enqueueProgressSave(FLOW_STEPS.TESTING);
  };

  const setExceptionCause = (checkNo, value) => {
    if (isLocked) return;
    const id = normalizeCheckNo(checkNo);
    if (!id) return;
    lastLocalChangeRef.current = Date.now();
    setExceptionCauses((prev) => ({ ...prev, [id]: value }));
    enqueueProgressSave(FLOW_STEPS.TESTING);
  };

  const setDecision = (checkNo, value) => {
    if (isLocked) return;
    const id = normalizeCheckNo(checkNo);
    if (!id) return;
    if (!registerConfirmed[id]) {
      showModal?.('Confirm the check register written date before concluding.', 'Confirm Register First');
      return;
    }
    if (registerEligibility[id] !== 'eligible') {
      showModal?.('Confirm the check was written on or before year-end before concluding.', 'Eligibility Required');
      return;
    }
    lastLocalChangeRef.current = Date.now();
    setDecisions((prev) => ({ ...prev, [id]: value }));
    if (value === 'found') {
      setExceptionNotes((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setExceptionCauses((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    if (value === 'missing') {
      setOutstandingAmountMatch((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setOutstandingPayeeMatch((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    enqueueProgressSave(FLOW_STEPS.TESTING);
  };

  const setNote = (checkNo, value) => {
    if (isLocked) return;
    const id = normalizeCheckNo(checkNo);
    if (!id) return;
    lastLocalChangeRef.current = Date.now();
    setExceptionNotes((prev) => ({ ...prev, [id]: value }));
    enqueueProgressSave(FLOW_STEPS.TESTING);
  };

  const goToTesting = () => {
    if (isLocked) return;
    if (selectedCheckNos.length === 0) {
      showModal?.('Select at least one January-clearing check to test.', 'No Sample Selected');
      return;
    }
    if (yearEndDateMissing) {
      showModal?.(
        'Year-end date (reconciliation date) is missing. Ask your instructor to set it in Cash Context before testing.',
        'Missing Year-End Date'
      );
      return;
    }
    if (registerMissingForSelected.length > 0) {
      showModal?.(
        `The check register is missing entries for: ${registerMissingForSelected.join(
          ', '
        )}. Ask your instructor to add them before continuing.`,
        'Register Missing'
      );
      return;
    }
    setActiveStep(FLOW_STEPS.TESTING);
    enqueueProgressSave(FLOW_STEPS.TESTING);
  };

  useEffect(() => {
    if (isLocked) return;
    if (!caseId || !userId) return;
    if (Date.now() - lastLocalChangeRef.current < 200) return;
    enqueueProgressSave(activeStepRef.current);
  }, [
    activeStep,
    selectedChecks,
    registerConfirmed,
    registerEligibility,
    registerAmountMatch,
    decisions,
    outstandingAmountMatch,
    outstandingPayeeMatch,
    exceptionNotes,
    exceptionCauses,
    enqueueProgressSave,
    isLocked,
    caseId,
    userId,
  ]);

  const resetForRetake = async () => {
    if (!caseId || !userId) return;
    if (isSubmitting) return;
    const initialStep =
      gateScope === 'once' ? firstPostInstructionStep : FLOW_STEPS.INSTRUCTION;
    try {
      if (progressSaveTimeoutRef.current) clearTimeout(progressSaveTimeoutRef.current);
      await saveProgress({
        appId,
        uid: userId,
        caseId,
        patch: {
          percentComplete: 0,
          state: 'not_started',
          step: initialStep,
          draft: {
            selectedPaymentIds: [],
            outstandingCheckTesting: {
              registerConfirmed: {},
              registerEligibility: {},
              registerAmountMatch: {},
              decisions: {},
              outstandingAmountMatch: {},
              outstandingPayeeMatch: {},
              exceptionNotes: {},
              exceptionCauses: {},
            },
          },
          hasSuccessfulAttempt: false,
        },
        forceOverwrite: true,
        clearActiveAttempt: true,
      });
      setIsLocked(false);
      setActiveStep(initialStep);
      setFurthestStepIndex(0);
      setSelectedChecks({});
      setRegisterConfirmed({});
      setRegisterEligibility({});
      setRegisterAmountMatch({});
      setDecisions({});
      setOutstandingAmountMatch({});
      setOutstandingPayeeMatch({});
      setExceptionNotes({});
      setExceptionCauses({});
      attemptStartedAtRef.current = null;
    } catch (err) {
      console.error('[OutstandingCheckTesting] Failed to reset retake', err);
      showModal?.('We ran into an issue preparing your retake. Please try again.', 'Retake Error');
    }
  };

  const handleSubmit = async () => {
    if (!caseId || !caseData || !userId) return;
    if (isLocked) return;
    if (selectedCheckNos.length === 0) return;

    const missing = [];
    const results = selectedCheckNos.map((checkNo) => {
      const info = evalForCheck(checkNo);
      const regConfirmed = !!registerConfirmed[checkNo];
      const eligibilityDecision = registerEligibility[checkNo] || '';
      const registerAmountDecision = registerAmountMatch[checkNo] || '';
      const decision = decisions[checkNo] || '';
      const note = (exceptionNotes[checkNo] || '').trim();
      const cause = exceptionCauses[checkNo] || '';
      const amountMatchDecision = outstandingAmountMatch[checkNo] || '';
      const payeeMatchDecision = outstandingPayeeMatch[checkNo] || '';
      if (!regConfirmed) {
        missing.push(checkNo);
        return {
          ...info,
          decision,
          note,
          regConfirmed,
          eligibilityDecision,
          registerAmountDecision,
          cause,
          amountMatchDecision,
          payeeMatchDecision,
        };
      }
      if (!eligibilityDecision || !registerAmountDecision) {
        missing.push(checkNo);
      } else if (eligibilityDecision === 'eligible') {
        if (decision !== 'found' && decision !== 'missing') {
          missing.push(checkNo);
        } else if (decision === 'found') {
          if (!amountMatchDecision) {
            missing.push(checkNo);
          } else if (info.outstandingItem?.payee && !payeeMatchDecision) {
            missing.push(checkNo);
          }
        } else if (decision === 'missing' && (!note || !cause)) {
          missing.push(checkNo);
        }
      }
      return {
        ...info,
        decision,
        note,
        regConfirmed,
        eligibilityDecision,
        registerAmountDecision,
        cause,
        amountMatchDecision,
        payeeMatchDecision,
      };
    });

    if (missing.length > 0) {
      showModal?.(
        `Complete the register and outstanding list trace for: ${Array.from(new Set(missing)).join(', ')}.`,
        'Incomplete Testing'
      );
      return;
    }

    const caseTitle = caseData.title || caseData.caseName || 'Audit Case';
    try {
      setIsSubmitting(true);
      const selectedSet = new Set(selectedCheckNos);
      let trapsCount = 0;
      let selectedRoutineCount = 0;
      let missedExceptionsCount = 0;
      let falsePositivesCount = 0;
      let eligibilityErrorsCount = 0;
      let matchErrorsCount = 0;

      bankPopulation.forEach((item) => {
        const checkNo = normalizeCheckNo(item?.checkNo);
        if (!checkNo) return;
        const reg = registerMap.get(checkNo) || null;
        const writtenDate = reg ? parseDate(reg.writtenDate) : null;
        const eligible = yearEndDate && writtenDate ? compareDatesYMD(writtenDate, yearEndDate) <= 0 : null;
        const studentEligibility = registerEligibility[checkNo] || '';
        const studentRegisterAmountMatch = registerAmountMatch[checkNo] || '';
        const registerAmountMatches =
          reg ? Math.abs(Number(reg.amount || 0) - Number(item.amount || 0)) <= 0.01 : null;
        if (selectedSet.has(checkNo)) {
          if (eligible === true && studentEligibility && studentEligibility !== 'eligible') {
            eligibilityErrorsCount += 1;
          }
          if (eligible === false && studentEligibility && studentEligibility !== 'ineligible') {
            eligibilityErrorsCount += 1;
          }
          if (registerAmountMatches !== null && studentRegisterAmountMatch) {
            const registerMatchExpected = registerAmountMatches ? 'match' : 'mismatch';
            if (studentRegisterAmountMatch !== registerMatchExpected) {
              matchErrorsCount += 1;
            }
          }
        }
        if (eligible !== true) return;

        const onOutstandingList = outstandingList.has(checkNo);
        const decision = decisions[checkNo] || '';
        if (!onOutstandingList) {
          trapsCount += 1;
          if (decision !== 'missing') {
            missedExceptionsCount += 1;
          }
          return;
        }

        if (!selectedSet.has(checkNo)) return;
        selectedRoutineCount += 1;
        if (decision === 'missing') {
          falsePositivesCount += 1;
          return;
        }
        if (decision === 'found') {
          const outstandingItem = outstandingList.get(checkNo);
          const outstandingAmountMatches =
            outstandingItem ? Math.abs(Number(outstandingItem.amount || 0) - Number(item.amount || 0)) <= 0.01 : null;
          const studentOutstandingAmountMatch = outstandingAmountMatch[checkNo] || '';
          if (outstandingAmountMatches !== null && studentOutstandingAmountMatch) {
            const outstandingMatchExpected = outstandingAmountMatches ? 'match' : 'mismatch';
            if (studentOutstandingAmountMatch !== outstandingMatchExpected) {
              matchErrorsCount += 1;
            }
          }
          const outstandingPayeeMatches =
            outstandingItem && outstandingItem.payee && reg && reg.payee ? outstandingItem.payee === reg.payee : null;
          const studentOutstandingPayeeMatch = outstandingPayeeMatch[checkNo] || '';
          if (outstandingPayeeMatches !== null && studentOutstandingPayeeMatch) {
            const outstandingPayeeExpected = outstandingPayeeMatches ? 'match' : 'mismatch';
            if (studentOutstandingPayeeMatch !== outstandingPayeeExpected) {
              matchErrorsCount += 1;
            }
          }
        }
      });

      const totalConsidered = trapsCount + selectedRoutineCount;
      const score =
        totalConsidered > 0
          ? Math.round(
              ((totalConsidered - missedExceptionsCount - falsePositivesCount - eligibilityErrorsCount - matchErrorsCount) /
                totalConsidered) *
                100
            )
          : null;
      const startedAtMs = attemptStartedAtRef.current;
      const timeToCompleteSeconds =
        startedAtMs ? Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)) : null;

      await saveSubmission(userId, caseId, {
        caseId,
        caseName: caseTitle,
        submittedAt: Timestamp.now(),
        outstandingCheckTesting: {
          yearEndDate: yearEndDateRaw,
          selectedCheckNos,
          registerConfirmed,
          registerEligibility,
          registerAmountMatch,
          decisions,
          outstandingAmountMatch,
          outstandingPayeeMatch,
          exceptionNotes,
          exceptionCauses,
          results,
        },
        attemptSummary: {
          score,
          totalConsidered,
          missedExceptionsCount,
          falsePositivesCount,
          eligibilityErrorsCount,
          matchErrorsCount,
          wrongClassificationCount: 0,
          criticalIssuesCount: missedExceptionsCount,
          requiredDocsOpened: null,
          timeToCompleteSeconds,
        },
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
            selectedPaymentIds: selectedCheckNos,
            outstandingCheckTesting: {
              registerConfirmed,
              registerEligibility,
              registerAmountMatch,
              decisions,
              outstandingAmountMatch,
              outstandingPayeeMatch,
              exceptionNotes,
              exceptionCauses,
            },
          },
          hasSuccessfulAttempt: true,
        },
        clearActiveAttempt: true,
      });

      setIsLocked(true);
      setActiveStep(FLOW_STEPS.RESULTS);
    } catch (err) {
      console.error('[OutstandingCheckTesting] Failed to submit', err);
      showModal?.(`Error saving submission: ${err?.message || 'Unknown error'}`, 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resultsSummary = useMemo(() => {
    const rows = selectedCheckNos.map((checkNo) => evalForCheck(checkNo));
    const eligible = rows.filter((r) => r.eligible === true);
    const exceptions = rows.filter((r) => r.correctDecision === 'missing');
    const missed = rows.filter((r) => r.correctDecision === 'missing' && r.studentDecision !== 'missing');
    const falsePositives = rows.filter((r) => r.correctDecision !== 'missing' && r.studentDecision === 'missing');
    const eligibilityErrors = rows.filter((r) => {
      if (r.eligible === null || !r.studentEligibility) return false;
      if (r.eligible === true) return r.studentEligibility !== 'eligible';
      if (r.eligible === false) return r.studentEligibility !== 'ineligible';
      return false;
    });
    const registerAmountErrors = rows.filter((r) => {
      if (r.registerAmountMatches === null || !r.studentRegisterAmountMatch) return false;
      return r.registerAmountMatches ? r.studentRegisterAmountMatch !== 'match' : r.studentRegisterAmountMatch !== 'mismatch';
    });
    const outstandingMatchErrors = rows.filter((r) => {
      if (r.correctDecision !== 'found' || r.studentDecision !== 'found') return false;
      const amountMismatch =
        r.outstandingAmountMatches === null || !r.studentOutstandingAmountMatch
          ? false
          : r.outstandingAmountMatches
          ? r.studentOutstandingAmountMatch !== 'match'
          : r.studentOutstandingAmountMatch !== 'mismatch';
      const payeeMismatch =
        r.outstandingPayeeMatches === null || !r.studentOutstandingPayeeMatch
          ? false
          : r.outstandingPayeeMatches
          ? r.studentOutstandingPayeeMatch !== 'match'
          : r.studentOutstandingPayeeMatch !== 'mismatch';
      return amountMismatch || payeeMismatch;
    });
    return {
      sampleSize: rows.length,
      eligibleCount: eligible.length,
      exceptionCount: exceptions.length,
      missedCount: missed.length,
      falsePositiveCount: falsePositives.length,
      eligibilityErrorCount: eligibilityErrors.length,
      registerAmountErrorCount: registerAmountErrors.length,
      outstandingMatchErrorCount: outstandingMatchErrors.length,
    };
  }, [evalForCheck, selectedCheckNos]);

  const stepIndex = STEP_SEQUENCE.indexOf(activeStep);

  const renderStepper = () => (
    <ol className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-white rounded-lg shadow px-4 py-4">
      {STEP_SEQUENCE.map((stepKey, idx) => {
        const isCompleted = furthestStepIndex > idx;
        const isActive = stepIndex === idx;
        const canNavigate = idx <= furthestStepIndex;
        return (
          <li key={stepKey} className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => {
                if (!canNavigate) return;
                if (activeStep === stepKey) return;
                setActiveStep(stepKey);
              }}
              className={`flex items-center space-x-3 text-left ${
                canNavigate ? 'cursor-pointer' : 'cursor-not-allowed'
              }`}
              disabled={!canNavigate}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : isCompleted
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {isCompleted ? '✓' : idx + 1}
              </span>
              <div>
                <p className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>
                  {STEP_LABELS[stepKey]}
                </p>
                <p className="text-xs text-gray-500 hidden sm:block">{STEP_DESCRIPTIONS[stepKey]}</p>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );

  const renderInstructionStep = () => {
    if (!caseData?.instruction) {
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-2">
          <h2 className="text-2xl font-semibold text-gray-800">Step 1 — Instruction</h2>
          <p className="text-sm text-gray-500">
            Instructional material is missing for this case. Ask your instructor to add a briefing and gate check before continuing.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">Step 1 — Instruction</h2>
          <p className="text-sm text-gray-500">
            {gateScope === 'per_attempt'
              ? 'Review the materials and successfully answer the knowledge check questions to access the simulation.'
              : gatePassed
              ? 'Review the materials. The gate check is optional because you already cleared it.'
              : 'Review the materials and successfully answer the knowledge check questions to access the simulation.'}
          </p>
          <div className="text-xs text-gray-500 mt-2">
            Year-end date: {yearEndDate ? formatShortDate(yearEndDate) : 'Not set'}{' '}
            {cutoffWindowValid ? `• Cutoff window: ${cutoffWindowLabel}` : ''}
            {cutoffEndDate ? ` (through ${formatShortDate(cutoffEndDate)})` : ''}
          </div>
        </div>
        <InstructionView
          instructionData={caseData.instruction}
          ctaLabel="Enter the Simulation"
          gateRequired={gateRequired}
          onStartSimulation={handleEnterSimulation}
        />
      </div>
    );
  };

  const renderSelectionStep = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-2">
        <h2 className="text-2xl font-semibold text-gray-800">Step 2 — Select Sample</h2>
        <p className="text-sm text-gray-500">
          Select the January-clearing checks you will test (sampling is trainee-driven in this module).
        </p>
        <p className="text-xs text-gray-500">
          Year-end date: {yearEndDate ? formatShortDate(yearEndDate) : 'Not set'}
          {cutoffWindowValid ? ` • Cutoff window: ${cutoffWindowLabel}` : ''}
          {cutoffEndDate ? ` (through ${formatShortDate(cutoffEndDate)})` : ''}
        </p>
        {yearEndDateMissing ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Year-end date is missing. Ask your instructor to set the Cash Context reconciliation date.
          </div>
        ) : null}
        {bankPopulationMissing ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No January cutoff cleared-check items are configured for this case.
          </div>
        ) : null}
        <p className="text-xs text-gray-500">
          Progress: {percentComplete}% complete
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ArtifactViewer artifacts={Array.isArray(caseData?.cashArtifacts) ? caseData.cashArtifacts : []} />
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="border-b border-gray-200 px-4 py-3">
            <h3 className="text-lg font-semibold text-gray-800">January Cutoff Statement — Cleared Checks</h3>
            <p className="text-xs text-gray-500">Pick the items you will trace.</p>
          </div>
          <div className="max-h-[720px] overflow-y-auto divide-y divide-gray-100">
            {bankPopulation.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">No bank cutoff items are configured for this case.</p>
            ) : (
              bankPopulation.map((item) => (
                <label key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={!!selectedChecks[item.checkNo]}
                    onChange={() => {
                      toggleSelection(item.checkNo);
                      enqueueProgressSave(FLOW_STEPS.SELECTION);
                    }}
                    disabled={isLocked}
                    className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-800">
                      <span className="font-semibold">Check #{item.checkNo}</span>
                      <span className="text-gray-500">Cleared: {item.clearingDate || '—'}</span>
                      <span className="text-gray-500">Amount: {currencyFormatter.format(Number(item.amount) || 0)}</span>
                    </div>
                    {!registerMap.has(item.checkNo) ? (
                      <p className="mt-1 text-xs text-amber-700">
                        Missing register entry for this check number (ask instructor to add it).
                      </p>
                    ) : null}
                  </div>
                </label>
              ))
            )}
          </div>
          <div className="px-4 py-4 flex items-center justify-between">
            <Button variant="secondary" onClick={() => navigate?.('/trainee')}>
              Back to Cases
            </Button>
            <Button onClick={goToTesting} disabled={isLocked || selectedCheckNos.length === 0}>
              Continue to Testing
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderTestingRow = (checkNo) => {
    const bankItem = bankPopulation.find((b) => b.checkNo === checkNo) || null;
    const confirmed = !!registerConfirmed[checkNo];
    const evalRow = evalForCheck(checkNo);
    const eligibilityDecision = registerEligibility[checkNo] || '';
    const registerAmountDecision = registerAmountMatch[checkNo] || '';
    const decision = decisions[checkNo] || '';
    const amountMatchDecision = outstandingAmountMatch[checkNo] || '';
    const payeeMatchDecision = outstandingPayeeMatch[checkNo] || '';
    const causeDecision = exceptionCauses[checkNo] || '';
    const requiresPayeeMatch = Boolean(evalRow.outstandingItem?.payee);
    const hasRegisterEntry = registerMap.has(checkNo);

    return (
      <div key={checkNo} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-base font-semibold text-gray-900">Check #{checkNo}</h4>
            <p className="text-xs text-gray-500">
              Bank cleared: {bankItem?.clearingDate || '—'} · Amount: {currencyFormatter.format(Number(bankItem?.amount) || 0)}
            </p>
          </div>
          <div className="text-xs text-gray-500">
            {confirmed ? (
              eligibilityDecision === 'ineligible' ? (
                <span className="rounded-full bg-gray-100 px-2 py-1 font-semibold text-gray-700">Marked ineligible</span>
              ) : eligibilityDecision === 'eligible' ? (
                <span className="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-700">Marked eligible</span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">Eligibility pending</span>
              )
            ) : (
              <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">Confirm register first</span>
            )}
          </div>
        </div>

        <div className="rounded-md border border-gray-100 bg-gray-50 p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Register Trace (Manual)</p>
          <p className="text-xs text-gray-500">
            Use the register table to confirm the written date and whether the amount matches the bank statement.
          </p>
          {!hasRegisterEntry ? (
            <p className="text-xs text-amber-700">
              No register entry found for this check number. Ask your instructor to add it.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-4 text-sm text-gray-800">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name={`eligibility-${checkNo}`}
                checked={eligibilityDecision === 'eligible'}
                onChange={() => setEligibilityDecision(checkNo, 'eligible')}
                disabled={isLocked}
              />
              Written on/before year-end
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name={`eligibility-${checkNo}`}
                checked={eligibilityDecision === 'ineligible'}
                onChange={() => setEligibilityDecision(checkNo, 'ineligible')}
                disabled={isLocked}
              />
              Written after year-end
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-800">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name={`register-amount-${checkNo}`}
                checked={registerAmountDecision === 'match'}
                onChange={() => setRegisterAmountDecision(checkNo, 'match')}
                disabled={isLocked}
              />
              Register amount matches bank
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name={`register-amount-${checkNo}`}
                checked={registerAmountDecision === 'mismatch'}
                onChange={() => setRegisterAmountDecision(checkNo, 'mismatch')}
                disabled={isLocked}
              />
              Register amount does not match
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => confirmRegisterForCheck(checkNo)}
              disabled={isLocked || confirmed || !hasRegisterEntry}
            >
              {confirmed ? 'Register Trace Confirmed' : 'Mark Register Trace Complete'}
            </Button>
            <span className="text-xs text-gray-500">
              Required before you can conclude whether it should appear on the 12/31 outstanding list.
            </span>
          </div>
        </div>

        {confirmed && eligibilityDecision === 'eligible' ? (
          <div className="rounded-md border border-gray-100 bg-white p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Trace To 12/31 Outstanding List</p>
            <p className="text-xs text-gray-500">
              Use the outstanding check list to confirm whether this check appears and whether amount/payee agree.
            </p>
            <div className="flex flex-wrap gap-4 items-center">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`decision-${checkNo}`}
                  checked={decision === 'found'}
                  onChange={() => setDecision(checkNo, 'found')}
                  disabled={isLocked}
                />
                Found on list
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`decision-${checkNo}`}
                  checked={decision === 'missing'}
                  onChange={() => setDecision(checkNo, 'missing')}
                  disabled={isLocked}
                />
                Not found (exception)
              </label>
            </div>

            {decision === 'found' ? (
              <div className="flex flex-wrap gap-4 items-center text-sm text-gray-800">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name={`outstanding-amount-${checkNo}`}
                    checked={amountMatchDecision === 'match'}
                    onChange={() => setOutstandingAmountDecision(checkNo, 'match')}
                    disabled={isLocked}
                  />
                  Amount agrees with list
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name={`outstanding-amount-${checkNo}`}
                    checked={amountMatchDecision === 'mismatch'}
                    onChange={() => setOutstandingAmountDecision(checkNo, 'mismatch')}
                    disabled={isLocked}
                  />
                  Amount does not agree
                </label>
                {requiresPayeeMatch ? (
                  <>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name={`outstanding-payee-${checkNo}`}
                        checked={payeeMatchDecision === 'match'}
                        onChange={() => setOutstandingPayeeDecision(checkNo, 'match')}
                        disabled={isLocked}
                      />
                      Payee agrees with list
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name={`outstanding-payee-${checkNo}`}
                        checked={payeeMatchDecision === 'mismatch'}
                        onChange={() => setOutstandingPayeeDecision(checkNo, 'mismatch')}
                        disabled={isLocked}
                      />
                      Payee does not agree
                    </label>
                  </>
                ) : null}
              </div>
            ) : null}

            {decision === 'missing' ? (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Exception Cause (required)</label>
                <div className="mt-2 space-y-2 text-sm text-gray-800">
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`cause-${checkNo}`}
                      checked={causeDecision === 'recorded_late'}
                      onChange={() => setExceptionCause(checkNo, 'recorded_late')}
                      disabled={isLocked}
                    />
                    <span>Recorded after year-end (cutoff error)</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`cause-${checkNo}`}
                      checked={causeDecision === 'voided_reissued'}
                      onChange={() => setExceptionCause(checkNo, 'voided_reissued')}
                      disabled={isLocked}
                    />
                    <span>Voided / reissued check chain</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`cause-${checkNo}`}
                      checked={causeDecision === 'list_incomplete'}
                      onChange={() => setExceptionCause(checkNo, 'list_incomplete')}
                      disabled={isLocked}
                    />
                    <span>Outstanding list appears incomplete</span>
                  </label>
                </div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mt-4">Exception Note (required)</label>
                <textarea
                  rows={3}
                  value={exceptionNotes[checkNo] || ''}
                  onChange={(e) => setNote(checkNo, e.target.value)}
                  disabled={isLocked}
                  className="mt-2 w-full rounded-md border border-gray-200 p-2 text-sm"
                  placeholder="What did you observe? What’s the likely explanation (recorded late, void/reissue, incomplete listing)?"
                />
              </div>
            ) : null}
          </div>
        ) : confirmed && eligibilityDecision === 'ineligible' ? (
          <div className="rounded-md border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
            Marked ineligible (written after year-end). No outstanding list trace required.
          </div>
        ) : null}
      </div>
    );
  };

  const renderTestingStep = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-2">
        <h2 className="text-2xl font-semibold text-gray-800">Step 3 — Trace & Conclude</h2>
        <p className="text-sm text-gray-500">
          For each selection, trace to the register to confirm the written date and amount, then verify whether eligible items appear on the 12/31 outstanding list (amount/payee agreement).
        </p>
        <p className="text-xs text-gray-500">Progress: {percentComplete}% complete</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <ArtifactViewer artifacts={Array.isArray(caseData?.cashArtifacts) ? caseData.cashArtifacts : []} />
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Check Register (Late Dec–Jan)</h3>
              <p className="text-xs text-gray-500">Use to confirm written dates and amounts.</p>
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {registerRows.length === 0 ? (
                <p className="px-4 py-4 text-xs text-gray-500">No register items provided.</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-100 text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Check #</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Written</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Payee</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {registerRows.map((row) => (
                      <tr key={`register-${row.id || row.checkNo}`}>
                        <td className="px-3 py-2 font-semibold text-gray-800">{row.checkNo || '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{row.writtenDate || '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{row.payee || '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{currencyFormatter.format(Number(row.amount) || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">12/31 Outstanding Check Listing</h3>
              <p className="text-xs text-gray-500">Use to confirm list inclusion, amount, and payee.</p>
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {outstandingRows.length === 0 ? (
                <p className="px-4 py-4 text-xs text-gray-500">No outstanding checks provided.</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-100 text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Check #</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Payee</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {outstandingRows.map((row) => (
                      <tr key={`outstanding-${row.id || row.checkNo}`}>
                        <td className="px-3 py-2 font-semibold text-gray-800">{row.checkNo || '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{row.payee || '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{currencyFormatter.format(Number(row.amount) || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          {selectedCheckNos.map(renderTestingRow)}
          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={() => setActiveStep(FLOW_STEPS.SELECTION)} disabled={isLocked}>
              Back to Selection
            </Button>
            <Button onClick={handleSubmit} disabled={isLocked || isSubmitting || selectedCheckNos.length === 0}>
              Submit Responses
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderResultsStep = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-2">
        <h2 className="text-2xl font-semibold text-gray-900">Results — Outstanding Check Testing</h2>
        <p className="text-sm text-gray-600">
          Sample size: <span className="font-semibold">{resultsSummary.sampleSize}</span> · Eligible: <span className="font-semibold">{resultsSummary.eligibleCount}</span> · Exceptions (true): <span className="font-semibold">{resultsSummary.exceptionCount}</span> · Missed: <span className="font-semibold">{resultsSummary.missedCount}</span> · False positives: <span className="font-semibold">{resultsSummary.falsePositiveCount}</span> · Eligibility errors: <span className="font-semibold">{resultsSummary.eligibilityErrorCount}</span> · Match errors: <span className="font-semibold">{resultsSummary.registerAmountErrorCount + resultsSummary.outstandingMatchErrorCount}</span>
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Check #</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Written</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Cleared</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Eligibility (You)</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Eligibility (Expected)</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Your Call</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Expected</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Match (You)</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {selectedCheckNos.map((checkNo) => {
              const info = evalForCheck(checkNo);
              const reg = registerMap.get(checkNo);
              const bank = bankPopulation.find((b) => b.checkNo === checkNo);
              const eligibilityExpected =
                info.eligible === true ? 'eligible' : info.eligible === false ? 'ineligible' : '';
              const eligibilityCorrect =
                eligibilityExpected && info.studentEligibility
                  ? eligibilityExpected === info.studentEligibility
                  : true;
              const registerMatchExpected =
                info.registerAmountMatches === true ? 'match' : info.registerAmountMatches === false ? 'mismatch' : '';
              const registerMatchCorrect =
                registerMatchExpected && info.studentRegisterAmountMatch
                  ? registerMatchExpected === info.studentRegisterAmountMatch
                  : true;
              const decisionCorrect =
                info.correctDecision === 'out_of_scope'
                  ? info.studentDecision === '' || info.studentDecision === 'out_of_scope'
                  : info.correctDecision && info.studentDecision
                  ? info.correctDecision === info.studentDecision
                  : false;
              const outstandingAmountExpected =
                info.outstandingAmountMatches === true
                  ? 'match'
                  : info.outstandingAmountMatches === false
                  ? 'mismatch'
                  : '';
              const outstandingAmountCorrect =
                outstandingAmountExpected && info.studentOutstandingAmountMatch
                  ? outstandingAmountExpected === info.studentOutstandingAmountMatch
                  : true;
              const outstandingPayeeExpected =
                info.outstandingPayeeMatches === true
                  ? 'match'
                  : info.outstandingPayeeMatches === false
                  ? 'mismatch'
                  : '';
              const outstandingPayeeCorrect =
                outstandingPayeeExpected && info.studentOutstandingPayeeMatch
                  ? outstandingPayeeExpected === info.studentOutstandingPayeeMatch
                  : true;
              const outstandingMatchCorrect =
                info.correctDecision === 'found' && info.studentDecision === 'found'
                  ? outstandingAmountCorrect && outstandingPayeeCorrect
                  : true;
              const isCorrect = decisionCorrect && eligibilityCorrect && registerMatchCorrect && outstandingMatchCorrect;
              const matchSummary = [
                info.studentRegisterAmountMatch ? `Reg: ${info.studentRegisterAmountMatch}` : 'Reg: —',
                info.studentOutstandingAmountMatch ? `List amt: ${info.studentOutstandingAmountMatch}` : 'List amt: —',
                info.studentOutstandingPayeeMatch ? `Payee: ${info.studentOutstandingPayeeMatch}` : 'Payee: —',
              ].join(' · ');
              return (
                <tr key={`result-${checkNo}`}>
                  <td className="px-4 py-2 font-semibold text-gray-900">{checkNo}</td>
                  <td className="px-4 py-2 text-gray-700">{reg?.writtenDate || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{bank?.clearingDate || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{info.studentEligibility || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{eligibilityExpected || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{info.studentDecision || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{info.correctDecision || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{matchSummary}</td>
                  <td className={`px-4 py-2 font-semibold ${isCorrect ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {isCorrect ? 'Correct' : 'Review'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => navigate?.('/trainee')}>
          Return to Dashboard
        </Button>
        <Button onClick={resetForRetake} disabled={isSubmitting}>
          Retake
        </Button>
      </div>
    </div>
  );

  let stepContent = null;
  if (activeStep === FLOW_STEPS.INSTRUCTION) stepContent = renderInstructionStep();
  else if (activeStep === FLOW_STEPS.SELECTION) stepContent = renderSelectionStep();
  else if (activeStep === FLOW_STEPS.TESTING) stepContent = renderTestingStep();
  else stepContent = renderResultsStep();

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">{caseData?.title || caseData?.caseName || 'Cash Case'}</h1>
            <p className="text-sm text-gray-500">
              Outstanding check testing (reverse direction) · Year-end: {yearEndDateRaw || '—'}
            </p>
          </div>
        </div>
        {renderStepper()}
        {stepContent}
      </div>
    </div>
  );
}
