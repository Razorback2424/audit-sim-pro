import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { Button, appId, storage } from '../../AppCore';
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
  [FLOW_STEPS.TESTING]: 'Conclude properly included/excluded based on register and 12/31 list.',
  [FLOW_STEPS.RESULTS]: 'See your recap and any exceptions.',
};

const normalizeCheckNo = (value) => (value === null || value === undefined ? '' : String(value).trim());

const parseDate = (value) => {
  if (!value) return null;
  const normalized = String(value).replace(/^20X/, '202');
  const dt = new Date(normalized);
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
  const [resolvedUrls, setResolvedUrls] = useState({ yearEnd: '', cutoff: '' });

  useEffect(() => {
    let isActive = true;
    const resolveUrls = async () => {
      const resolveOne = async (doc) => {
        if (!doc) return '';
        if (doc.downloadURL) return doc.downloadURL;
        if (doc.storagePath) {
          try {
            return await getDownloadURL(storageRef(storage, doc.storagePath));
          } catch (err) {
            console.warn('[ArtifactViewer] Failed to resolve storage path', err);
            return '';
          }
        }
        return '';
      };
      const [yearEndUrl, cutoffUrl] = await Promise.all([resolveOne(yearEnd), resolveOne(cutoff)]);
      if (isActive) {
        setResolvedUrls({ yearEnd: yearEndUrl, cutoff: cutoffUrl });
      }
    };
    resolveUrls();
    return () => {
      isActive = false;
    };
  }, [cutoff, yearEnd]);

  const renderOne = (doc, title, url) => {
    if (!doc) {
      return (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
          {title} not provided by instructor.
        </div>
      );
    }
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
      {yearEnd ? renderOne(yearEnd, 'December (Year-End) Bank Statement', resolvedUrls.yearEnd) : null}
      {renderOne(cutoff, 'January Cutoff Bank Statement', resolvedUrls.cutoff)}
    </div>
  );
}

const parseCheckNumber = (doc) => {
  if (!doc || typeof doc !== 'object') return '';
  const fromSpec = doc?.generationSpec?.data?.checkNumber;
  if (fromSpec) return String(fromSpec).trim();
  const name = String(doc.fileName || '');
  const match = name.match(/check copy\s+(\d+)/i);
  return match ? match[1] : '';
};

const CLASSIFICATION_LABELS = {
  properly_included: 'Properly Included',
  properly_excluded: 'Properly Excluded',
  improperly_included: 'Improperly Included',
  improperly_excluded: 'Improperly Excluded',
};

function CheckCopyViewer({ referenceDocuments = [], selectedCheckNos = [], activeCheckNo = '' }) {
  const [checkUrls, setCheckUrls] = useState({});

  const checkDocMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(referenceDocuments) ? referenceDocuments : []).forEach((doc) => {
      const checkNo = parseCheckNumber(doc);
      if (!checkNo) return;
      map.set(checkNo, doc);
    });
    return map;
  }, [referenceDocuments]);

  useEffect(() => {
    let isActive = true;
    const resolveUrls = async () => {
      const entries = await Promise.all(
        (selectedCheckNos || []).map(async (checkNo) => {
          const doc = checkDocMap.get(checkNo);
          if (!doc) return [checkNo, ''];
          if (doc.downloadURL) return [checkNo, doc.downloadURL];
          if (doc.storagePath) {
            try {
              const url = await getDownloadURL(storageRef(storage, doc.storagePath));
              return [checkNo, url];
            } catch (err) {
              console.warn('[CheckCopyViewer] Failed to resolve storage path', err);
              return [checkNo, ''];
            }
          }
          return [checkNo, ''];
        })
      );
      if (isActive) {
        const nextUrls = Object.fromEntries(entries);
        setCheckUrls(nextUrls);
      }
    };
    resolveUrls();
    return () => {
      isActive = false;
    };
  }, [checkDocMap, selectedCheckNos]);

  const activeUrl = activeCheckNo ? checkUrls[activeCheckNo] || '' : '';
  const activeDoc = activeCheckNo ? checkDocMap.get(activeCheckNo) : null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-800">Check Copy Preview</h3>
        <p className="text-xs text-gray-500">Click a check selection to preview its copy.</p>
      </div>
      <div className="border-t border-gray-100 bg-gray-50 min-h-[360px]">
        {activeUrl ? (
          <iframe
            title={activeDoc?.fileName || 'Check copy'}
            src={activeUrl}
            className="h-[360px] w-full"
          />
        ) : (
          <div className="px-4 py-6 text-sm text-gray-600">
            {activeCheckNo
              ? 'Preview is not ready yet. Please wait a moment.'
              : (selectedCheckNos || []).length === 0
                ? 'No checks selected yet.'
                : 'Select a check to preview the PDF.'}
          </div>
        )}
      </div>
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

  const checkCopyMap = useMemo(() => {
    const docs = Array.isArray(caseData?.referenceDocuments) ? caseData.referenceDocuments : [];
    const map = new Map();
    docs.forEach((doc) => {
      const templateId = doc?.generationSpec?.templateId;
      if (templateId && templateId !== 'refdoc.check-copy.v1') return;
      const checkNo = parseCheckNumber(doc);
      if (!checkNo) return;
      const data = doc?.generationSpec?.data || {};
      map.set(checkNo, {
        checkNo,
        writtenDate: data?.date || '',
        amount: data?.amountNumeric || data?.amount || '',
        payee: data?.payee || '',
      });
    });
    return map;
  }, [caseData]);

  const outstandingRows = useMemo(() => {
    const rows = Array.from(outstandingList.values());
    rows.sort((a, b) => String(a.checkNo || '').localeCompare(String(b.checkNo || '')));
    return rows;
  }, [outstandingList]);

  const [activeStep, setActiveStep] = useState(FLOW_STEPS.INSTRUCTION);
  const [recipeProgress, setRecipeProgress] = useState(null);
  const [selectedChecks, setSelectedChecks] = useState({});
  const [classificationByCheck, setClassificationByCheck] = useState({});
  const [isLocked, setIsLocked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [furthestStepIndex, setFurthestStepIndex] = useState(0);
  const [activeCheckNo, setActiveCheckNo] = useState('');

  const progressSaveTimeoutRef = useRef(null);
  const lastLocalChangeRef = useRef(0);
  const activeStepRef = useRef(activeStep);
  const selectionRef = useRef(selectedChecks);
  const selectedCheckNosRef = useRef([]);
  const completedCountRef = useRef(0);
  const classificationRef = useRef(classificationByCheck);
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

  useEffect(() => {
    if (selectedCheckNos.length === 0) {
      if (activeCheckNo) setActiveCheckNo('');
      return;
    }
    if (!activeCheckNo || !selectedCheckNos.includes(activeCheckNo)) {
      setActiveCheckNo(selectedCheckNos[0]);
    }
  }, [activeCheckNo, selectedCheckNos]);

  const evalForCheck = useCallback(
    (checkNo) => {
      const bankItem = bankPopulation.find((item) => item.checkNo === checkNo) || null;
      const checkCopy = checkCopyMap.get(checkNo) || null;
      const writtenDate = checkCopy ? parseDate(checkCopy.writtenDate) : null;
      const eligible =
        yearEndDate && writtenDate ? compareDatesYMD(writtenDate, yearEndDate) <= 0 : null;
      const onOutstandingList = outstandingList.has(checkNo);
      const correctClassification =
        eligible === true
          ? onOutstandingList
            ? 'properly_included'
            : 'improperly_excluded'
          : eligible === false
            ? onOutstandingList
              ? 'improperly_included'
              : 'properly_excluded'
            : '';

      const studentClassification = classificationByCheck[checkNo] || '';

      return {
        checkNo,
        bankItem,
        eligible,
        onOutstandingList,
        correctClassification,
        studentClassification,
      };
    },
    [bankPopulation, checkCopyMap, classificationByCheck, outstandingList, yearEndDate]
  );

  const completedCount = useMemo(() => {
    return selectedCheckNos.filter((checkNo) => {
      return Boolean(classificationByCheck[checkNo]);
    }).length;
  }, [
    classificationByCheck,
    selectedCheckNos,
  ]);

  const percentComplete = useMemo(
    () => computePercentComplete(activeStep, selectedCount, completedCount),
    [activeStep, selectedCount, completedCount]
  );

  const enqueueProgressSave = useCallback(
    (nextStep, overrideSelectedIds = null) => {
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
          const currentSelected = Array.isArray(overrideSelectedIds)
            ? overrideSelectedIds
            : Array.isArray(selectedCheckNosRef.current)
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
                  classifications: classificationRef.current,
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
    classificationRef.current = classificationByCheck;
  }, [classificationByCheck]);

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
          const localHasSelection = Object.keys(selectionRef.current || {}).length > 0;
          const serverHasSelection = Object.keys(nextSelection).length > 0;
          if (serverHasSelection || !localHasSelection) {
            setSelectedChecks(nextSelection);
          }
        }

        const otc =
          entry.draft?.outstandingCheckTesting && typeof entry.draft.outstandingCheckTesting === 'object'
            ? entry.draft.outstandingCheckTesting
            : {};
        const nextClassifications =
          otc.classifications && typeof otc.classifications === 'object' ? otc.classifications : {};
        if (!recentlyChanged && !shallowEqualRecord(classificationRef.current, nextClassifications)) {
          setClassificationByCheck(nextClassifications);
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
      const nextSelectedIds = Object.keys(next).filter((key) => next[key]);
      selectionRef.current = next;
      selectedCheckNosRef.current = nextSelectedIds;
      enqueueProgressSave(FLOW_STEPS.SELECTION, nextSelectedIds);
      return next;
    });
  };

  const setClassificationDecision = (checkNo, value) => {
    if (isLocked) return;
    const id = normalizeCheckNo(checkNo);
    if (!id) return;
    lastLocalChangeRef.current = Date.now();
    setClassificationByCheck((prev) => ({ ...prev, [id]: value }));
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
    classificationByCheck,
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
              classifications: {},
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
      setClassificationByCheck({});
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
      const studentClassification = classificationByCheck[checkNo] || '';
      if (!studentClassification) {
        missing.push(checkNo);
      }
      return {
        ...info,
        studentClassification,
      };
    });

    if (missing.length > 0) {
      showModal?.(
        `Select a conclusion for: ${Array.from(new Set(missing)).join(', ')}.`,
        'Incomplete Testing'
      );
      return;
    }

    const caseTitle = caseData.title || caseData.caseName || 'Audit Case';
    try {
      setIsSubmitting(true);
      const totalConsidered = results.length;
      const correctCount = results.filter(
        (row) => row.correctClassification && row.studentClassification === row.correctClassification
      ).length;
      const incorrectCount = totalConsidered - correctCount;
      const score = totalConsidered > 0 ? Math.round((correctCount / totalConsidered) * 100) : null;
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
          classifications: classificationByCheck,
          results,
        },
        attemptSummary: {
          score,
          totalConsidered,
          missedExceptionsCount: 0,
          falsePositivesCount: 0,
          eligibilityErrorsCount: 0,
          matchErrorsCount: 0,
          wrongClassificationCount: incorrectCount,
          criticalIssuesCount: incorrectCount,
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
              classifications: classificationByCheck,
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
    const correct = rows.filter(
      (r) => r.correctClassification && r.studentClassification === r.correctClassification
    );
    const incorrect = rows.filter(
      (r) => r.studentClassification && r.correctClassification && r.studentClassification !== r.correctClassification
    );
    const properlyIncluded = rows.filter((r) => r.studentClassification === 'properly_included');
    const properlyExcluded = rows.filter((r) => r.studentClassification === 'properly_excluded');
    const improperlyIncluded = rows.filter((r) => r.studentClassification === 'improperly_included');
    const improperlyExcluded = rows.filter((r) => r.studentClassification === 'improperly_excluded');
    return {
      sampleSize: rows.length,
      correctCount: correct.length,
      incorrectCount: incorrect.length,
      properlyIncludedCount: properlyIncluded.length,
      properlyExcludedCount: properlyExcluded.length,
      improperlyIncludedCount: improperlyIncluded.length,
      improperlyExcludedCount: improperlyExcluded.length,
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
    const evalRow = evalForCheck(checkNo);
    const checkCopy = checkCopyMap.get(checkNo) || null;
    const classification = classificationByCheck[checkNo] || '';
    const hasCheckCopy = Boolean(checkCopy);
    const hasWrittenDate = Boolean(checkCopy?.writtenDate);
    const hasYearEnd = Boolean(yearEndDate);
    const classificationDisabled = isLocked || !hasYearEnd || !hasCheckCopy || !hasWrittenDate;
    const isActive = activeCheckNo === checkNo;
    const options = [
      {
        value: 'properly_included',
        label: 'Properly Included',
        hint: 'Written before year-end and appears on the 12/31 list.',
      },
      {
        value: 'properly_excluded',
        label: 'Properly Excluded',
        hint: 'Written after year-end and not on the 12/31 list.',
      },
      {
        value: 'improperly_included',
        label: 'Improperly Included',
        hint: 'Written after year-end but appears on the 12/31 list.',
      },
      {
        value: 'improperly_excluded',
        label: 'Improperly Excluded',
        hint: 'Written before year-end but missing from the 12/31 list.',
      },
    ];

    return (
      <div
        key={checkNo}
        className={`rounded-lg border p-4 space-y-3 cursor-pointer ${
          isActive ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-white'
        }`}
        onClick={() => setActiveCheckNo(checkNo)}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-base font-semibold text-gray-900">Check #{checkNo}</h4>
            <p className="text-xs text-gray-500">
              Bank cleared: {bankItem?.clearingDate || '—'} · Amount: {currencyFormatter.format(Number(bankItem?.amount) || 0)}
            </p>
          </div>
        </div>

        {!hasCheckCopy || !hasWrittenDate || !hasYearEnd ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {!hasCheckCopy || !hasWrittenDate ? (
              <p>Check copy is missing or still generating for this selection.</p>
            ) : null}
            {!hasYearEnd ? (
              <p>Year-end date is missing. Ask your instructor to set it in Cash Context.</p>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-md border border-gray-100 bg-white p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Conclusion</p>
          <div className="space-y-2 text-sm text-gray-800">
            {options.map((option) => (
              <label key={option.value} className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`classification-${checkNo}`}
                  checked={classification === option.value}
                  onChange={() => setClassificationDecision(checkNo, option.value)}
                  disabled={classificationDisabled}
                />
                <span>
                  <span className="font-semibold">{option.label}</span>
                  <span className="block text-xs text-gray-500">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {classificationDisabled ? (
            <p className="text-xs text-amber-700">Fix the missing register/year-end data before concluding.</p>
          ) : null}
        </div>
      </div>
    );
  };

  const renderTestingStep = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-2">
        <h2 className="text-2xl font-semibold text-gray-800">Step 3 — Trace & Conclude</h2>
        <p className="text-sm text-gray-500">
          For each selection, review the check copy and compare it to the 12/31 outstanding list, then choose the proper inclusion/exclusion conclusion.
        </p>
        <p className="text-xs text-gray-500">Progress: {percentComplete}% complete</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <CheckCopyViewer
            referenceDocuments={Array.isArray(caseData?.referenceDocuments) ? caseData.referenceDocuments : []}
            selectedCheckNos={selectedCheckNos}
            activeCheckNo={activeCheckNo}
          />
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
          Sample size: <span className="font-semibold">{resultsSummary.sampleSize}</span> · Correct: <span className="font-semibold">{resultsSummary.correctCount}</span> · Incorrect: <span className="font-semibold">{resultsSummary.incorrectCount}</span> · Properly Included: <span className="font-semibold">{resultsSummary.properlyIncludedCount}</span> · Properly Excluded: <span className="font-semibold">{resultsSummary.properlyExcludedCount}</span> · Improperly Included: <span className="font-semibold">{resultsSummary.improperlyIncludedCount}</span> · Improperly Excluded: <span className="font-semibold">{resultsSummary.improperlyExcludedCount}</span>
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Check #</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Written</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Cleared</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">On 12/31 List</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Your Conclusion</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Expected</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-700">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {selectedCheckNos.map((checkNo) => {
              const info = evalForCheck(checkNo);
              const checkCopy = checkCopyMap.get(checkNo);
              const bank = bankPopulation.find((b) => b.checkNo === checkNo);
              const isCorrect =
                info.correctClassification &&
                info.studentClassification &&
                info.correctClassification === info.studentClassification;
              const onListLabel = info.onOutstandingList ? 'Yes' : 'No';
              const studentLabel = CLASSIFICATION_LABELS[info.studentClassification] || info.studentClassification || '—';
              const expectedLabel = CLASSIFICATION_LABELS[info.correctClassification] || info.correctClassification || '—';
              return (
                <tr key={`result-${checkNo}`}>
                  <td className="px-4 py-2 font-semibold text-gray-900">{checkNo}</td>
                  <td className="px-4 py-2 text-gray-700">{checkCopy?.writtenDate || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{bank?.clearingDate || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{onListLabel}</td>
                  <td className="px-4 py-2 text-gray-700">{studentLabel}</td>
                  <td className="px-4 py-2 text-gray-700">{expectedLabel}</td>
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
