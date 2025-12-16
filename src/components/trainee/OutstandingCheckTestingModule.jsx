import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { Button, appId } from '../../AppCore';
import { saveSubmission } from '../../services/submissionService';
import { saveProgress, subscribeProgressForCases } from '../../services/progressService';
import { currencyFormatter } from '../../utils/formatters';

const FLOW_STEPS = Object.freeze({
  SELECTION: 'selection',
  TESTING: 'testing',
  RESULTS: 'results',
});

const STEP_SEQUENCE = [FLOW_STEPS.SELECTION, FLOW_STEPS.TESTING, FLOW_STEPS.RESULTS];

const STEP_LABELS = {
  [FLOW_STEPS.SELECTION]: 'Select Sample',
  [FLOW_STEPS.TESTING]: 'Trace & Conclude',
  [FLOW_STEPS.RESULTS]: 'Review Outcome',
};

const STEP_DESCRIPTIONS = {
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
  const yearEndDateRaw = caseData?.cashContext?.reconciliationDate || '';
  const yearEndDate = useMemo(() => parseDate(yearEndDateRaw), [yearEndDateRaw]);
  const yearEndDateMissing = !yearEndDateRaw || !yearEndDate;

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

  const [activeStep, setActiveStep] = useState(FLOW_STEPS.SELECTION);
  const [selectedChecks, setSelectedChecks] = useState({});
  const [registerConfirmed, setRegisterConfirmed] = useState({});
  const [decisions, setDecisions] = useState({});
  const [exceptionNotes, setExceptionNotes] = useState({});
  const [isLocked, setIsLocked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const progressSaveTimeoutRef = useRef(null);
  const lastLocalChangeRef = useRef(0);
  const activeStepRef = useRef(activeStep);
  const selectionRef = useRef(selectedChecks);
  const selectedCheckNosRef = useRef([]);
  const completedCountRef = useRef(0);
  const registerConfirmedRef = useRef(registerConfirmed);
  const decisionsRef = useRef(decisions);
  const exceptionNotesRef = useRef(exceptionNotes);
  const isLockedRef = useRef(isLocked);

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
      const reg = registerMap.get(checkNo) || null;
      const writtenDate = reg ? parseDate(reg.writtenDate) : null;
      const eligible =
        yearEndDate && writtenDate ? compareDatesYMD(writtenDate, yearEndDate) <= 0 : null;
      const onOutstandingList = outstandingList.has(checkNo);
      const correctDecision =
        eligible === false ? 'out_of_scope' : eligible === true ? (onOutstandingList ? 'found' : 'missing') : '';

      const studentDecision = decisions[checkNo] || '';
      return {
        checkNo,
        registerItem: reg,
        eligible,
        onOutstandingList,
        correctDecision,
        studentDecision,
        isCorrect: correctDecision && studentDecision ? correctDecision === studentDecision : false,
      };
    },
    [decisions, outstandingList, registerMap, yearEndDate]
  );

  const completedCount = useMemo(() => {
    return selectedCheckNos.filter((checkNo) => {
      if (!registerConfirmed[checkNo]) return false;
      const info = evalForCheck(checkNo);
      if (info.eligible === false) return true;
      if (info.eligible === true) {
        const decision = decisions[checkNo];
        if (decision !== 'found' && decision !== 'missing') return false;
        if (decision === 'missing') {
          const note = (exceptionNotes[checkNo] || '').trim();
          return note.length > 0;
        }
        return true;
      }
      return false;
    }).length;
  }, [decisions, evalForCheck, exceptionNotes, registerConfirmed, selectedCheckNos]);

  const percentComplete = useMemo(
    () => computePercentComplete(activeStep, selectedCount, completedCount),
    [activeStep, selectedCount, completedCount]
  );

  const enqueueProgressSave = useCallback(
    (nextStep) => {
      if (!caseId || !userId) return;
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
                  decisions: decisionsRef.current,
                  exceptionNotes: exceptionNotesRef.current,
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
  }, [activeStep]);

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
    decisionsRef.current = decisions;
  }, [decisions]);

  useEffect(() => {
    exceptionNotesRef.current = exceptionNotes;
  }, [exceptionNotes]);

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

        const nextStep = STEP_SEQUENCE.includes(entry.step) ? entry.step : FLOW_STEPS.SELECTION;
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
        const nextDecisions = otc.decisions && typeof otc.decisions === 'object' ? otc.decisions : {};
        const nextNotes = otc.exceptionNotes && typeof otc.exceptionNotes === 'object' ? otc.exceptionNotes : {};

        if (!recentlyChanged && !shallowEqualRecord(registerConfirmedRef.current, nextRegisterConfirmed)) {
          setRegisterConfirmed(nextRegisterConfirmed);
        }
        if (!recentlyChanged && !shallowEqualRecord(decisionsRef.current, nextDecisions)) {
          setDecisions(nextDecisions);
        }
        if (!recentlyChanged && !shallowEqualRecord(exceptionNotesRef.current, nextNotes)) {
          setExceptionNotes(nextNotes);
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
    const eligible = compareDatesYMD(writtenDate, yearEndDate) <= 0;
    setDecisions((prev) => {
      if (!eligible) {
        return { ...prev, [id]: 'out_of_scope' };
      }
      if (prev[id] === 'out_of_scope') {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return prev;
    });
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
    lastLocalChangeRef.current = Date.now();
    setDecisions((prev) => ({ ...prev, [id]: value }));
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
  }, [activeStep, selectedChecks, registerConfirmed, decisions, exceptionNotes, enqueueProgressSave, isLocked, caseId, userId]);

  const resetForRetake = async () => {
    if (!caseId || !userId) return;
    if (isSubmitting) return;
    try {
      if (progressSaveTimeoutRef.current) clearTimeout(progressSaveTimeoutRef.current);
      await saveProgress({
        appId,
        uid: userId,
        caseId,
        patch: {
          percentComplete: 0,
          state: 'not_started',
          step: FLOW_STEPS.SELECTION,
          draft: {
            selectedPaymentIds: [],
            outstandingCheckTesting: {
              registerConfirmed: {},
              decisions: {},
              exceptionNotes: {},
            },
          },
        },
        forceOverwrite: true,
      });
      setIsLocked(false);
      setActiveStep(FLOW_STEPS.SELECTION);
      setSelectedChecks({});
      setRegisterConfirmed({});
      setDecisions({});
      setExceptionNotes({});
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
      const decision = decisions[checkNo] || '';
      const note = (exceptionNotes[checkNo] || '').trim();
      if (!regConfirmed) {
        missing.push(checkNo);
        return { ...info, decision, note, regConfirmed };
      }
      if (info.eligible === true) {
        if (decision !== 'found' && decision !== 'missing') {
          missing.push(checkNo);
        } else if (decision === 'missing' && !note) {
          missing.push(checkNo);
        }
      }
      return { ...info, decision, note, regConfirmed };
    });

    if (missing.length > 0) {
      showModal?.(
        `Complete register confirmation and conclusions for: ${Array.from(new Set(missing)).join(', ')}.`,
        'Incomplete Testing'
      );
      return;
    }

    const caseTitle = caseData.title || caseData.caseName || 'Audit Case';
    try {
      setIsSubmitting(true);
      await saveSubmission(userId, caseId, {
        caseId,
        caseName: caseTitle,
        submittedAt: Timestamp.now(),
        outstandingCheckTesting: {
          yearEndDate: yearEndDateRaw,
          selectedCheckNos,
          registerConfirmed,
          decisions,
          exceptionNotes,
          results,
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
              decisions,
              exceptionNotes,
            },
          },
        },
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
    return {
      sampleSize: rows.length,
      eligibleCount: eligible.length,
      exceptionCount: exceptions.length,
      missedCount: missed.length,
      falsePositiveCount: falsePositives.length,
    };
  }, [evalForCheck, selectedCheckNos]);

  const stepIndex = STEP_SEQUENCE.indexOf(activeStep);

  const renderStepper = () => (
    <ol className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-white rounded-lg shadow px-4 py-4">
      {STEP_SEQUENCE.map((stepKey, idx) => {
        const isCompleted = stepIndex > idx;
        const isActive = stepIndex === idx;
        return (
          <li key={stepKey} className="flex items-center space-x-3">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                isActive ? 'bg-blue-600 text-white' : isCompleted ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'
              }`}
            >
              {isCompleted ? '✓' : idx + 1}
            </span>
            <div>
              <p className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{STEP_LABELS[stepKey]}</p>
              <p className="text-xs text-gray-500 hidden sm:block">{STEP_DESCRIPTIONS[stepKey]}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );

  const renderSelectionStep = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-2">
        <h2 className="text-2xl font-semibold text-gray-800">Step 1 — Select Sample</h2>
        <p className="text-sm text-gray-500">
          Select the January-clearing checks you will test (sampling is trainee-driven in this module).
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
    const registerItem = registerMap.get(checkNo) || null;
    const outstandingItem = outstandingList.get(checkNo) || null;
    const confirmed = !!registerConfirmed[checkNo];
    const evalRow = evalForCheck(checkNo);
    const eligible = evalRow.eligible === true;
    const ineligible = evalRow.eligible === false;
    const decision = decisions[checkNo] || '';

    const amountMismatch =
      registerItem && bankItem ? Math.abs(Number(registerItem.amount || 0) - Number(bankItem.amount || 0)) > 0.01 : false;

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
              ineligible ? (
                <span className="rounded-full bg-gray-100 px-2 py-1 font-semibold text-gray-700">Out of scope (written after YE)</span>
              ) : eligible ? (
                <span className="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-700">Eligible (written ≤ YE)</span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">Eligibility unknown</span>
              )
            ) : (
              <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">Confirm register first</span>
            )}
          </div>
        </div>

        <div className="rounded-md border border-gray-100 bg-gray-50 p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Register Trace (Written Date)</p>
          {registerItem ? (
            <div className="text-sm text-gray-800 flex flex-wrap gap-x-4 gap-y-1">
              <span>Written: {registerItem.writtenDate || '—'}</span>
              <span>Payee: {registerItem.payee || '—'}</span>
              <span>Amount: {currencyFormatter.format(Number(registerItem.amount) || 0)}</span>
              {amountMismatch ? (
                <span className="text-amber-700 font-semibold">Amount mismatch vs bank</span>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-red-700">No register entry found for this check number.</p>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => confirmRegisterForCheck(checkNo)}
              disabled={isLocked || !registerItem || confirmed}
            >
              {confirmed ? 'Register Confirmed' : 'Confirm Register Trace'}
            </Button>
            <span className="text-xs text-gray-500">
              Required before you can conclude whether it should appear on the 12/31 outstanding list.
            </span>
          </div>
        </div>

        {confirmed && eligible ? (
          <div className="rounded-md border border-gray-100 bg-white p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Trace To 12/31 Outstanding List</p>
            <div className="text-sm text-gray-800">
              {outstandingItem ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="font-semibold text-emerald-700">Client list contains check #{checkNo}</span>
                  <span>Amount: {currencyFormatter.format(Number(outstandingItem.amount) || 0)}</span>
                  <span>Payee: {outstandingItem.payee || '—'}</span>
                </div>
              ) : (
                <span className="font-semibold text-amber-700">Not found on client list (based on check number)</span>
              )}
            </div>

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

            {decision === 'missing' ? (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Exception Note (required)</label>
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
        ) : null}
      </div>
    );
  };

  const renderTestingStep = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-2">
        <h2 className="text-2xl font-semibold text-gray-800">Step 2 — Trace & Conclude</h2>
        <p className="text-sm text-gray-500">
          For each selection, confirm the written date from the check register. Only checks written on or before year-end are eligible to be on the 12/31 outstanding list.
        </p>
        <p className="text-xs text-gray-500">Progress: {percentComplete}% complete</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ArtifactViewer artifacts={Array.isArray(caseData?.cashArtifacts) ? caseData.cashArtifacts : []} />
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
          Sample size: <span className="font-semibold">{resultsSummary.sampleSize}</span> · Eligible: <span className="font-semibold">{resultsSummary.eligibleCount}</span> · Exceptions (true): <span className="font-semibold">{resultsSummary.exceptionCount}</span> · Missed: <span className="font-semibold">{resultsSummary.missedCount}</span> · False positives: <span className="font-semibold">{resultsSummary.falsePositiveCount}</span>
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Check #</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Written</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Cleared</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Your Call</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Expected</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {selectedCheckNos.map((checkNo) => {
              const info = evalForCheck(checkNo);
              const reg = registerMap.get(checkNo);
              const bank = bankPopulation.find((b) => b.checkNo === checkNo);
              const isCorrect =
                info.correctDecision && info.studentDecision ? info.correctDecision === info.studentDecision : false;
              return (
                <tr key={`result-${checkNo}`}>
                  <td className="px-4 py-2 font-semibold text-gray-900">{checkNo}</td>
                  <td className="px-4 py-2 text-gray-700">{reg?.writtenDate || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{bank?.clearingDate || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{info.studentDecision || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{info.correctDecision || '—'}</td>
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
  if (activeStep === FLOW_STEPS.SELECTION) stepContent = renderSelectionStep();
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
