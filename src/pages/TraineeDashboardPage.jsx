import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button, useRoute, useModal, useAuth, useUser, appId } from '../AppCore';
import { listStudentCases, listStudentDemoCases, deleteRetakeAttempt } from '../services/caseService';
import { listRecipes } from '../services/recipeService';
import { listCaseRecipes } from '../generation/recipeRegistry';
import { subscribeProgressForCases } from '../services/progressService';
import { startCaseAttemptFromPool } from '../services/attemptService';
import { isBillingPaid } from '../services/billingService';
import { ANALYTICS_EVENTS, trackAnalyticsEvent } from '../services/analyticsService';
import {
  buildLearnerProgressView,
  DEFAULT_PATH_ID,
  DEFAULT_TIER,
  getModuleLabel,
  getPathId,
  getPathLabel,
  getSkillLabel,
  hasMeaningfulDraft,
  normalizeTier,
} from '../utils/learnerProgress';
import { toProgressModel } from '../models/progress';

/** @typedef {import('../models/case').CaseModel} CaseModel */
/** @typedef {import('../models/progress').ProgressModel} ProgressModel */

const PAGE_SIZE = 20;

const TIER_LABELS = Object.freeze({
  foundations: 'Foundations',
  core: 'Core',
  advanced: 'Expert',
});
const JOURNEY_STEPS = Object.freeze([
  { key: 'foundations', label: 'Foundations' },
  { key: 'core', label: 'Core' },
  { key: 'advanced', label: 'Expert' },
]);
const MODULE_ACCENTS = Object.freeze({
  payables: 'border-l-4 border-slate-200',
  cash: 'border-l-4 border-slate-200',
  fixed_assets: 'border-l-4 border-slate-200',
});

const formatTier = (tier) => TIER_LABELS[normalizeTier(tier)] || TIER_LABELS[DEFAULT_TIER];

const getModuleTitle = (caseData) =>
  caseData?.moduleTitle || caseData?.title || caseData?.caseName || 'Untitled module';

const formatCaseLevel = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'basic') return 'Basics';
  if (normalized === 'intermediate') return 'Intermediate';
  if (normalized === 'advanced') return 'Advanced';
  return 'Basics';
};

const getModuleSkills = (caseData) => {
  const skills = [];
  if (typeof caseData?.primarySkill === 'string' && caseData.primarySkill.trim()) {
    skills.push(caseData.primarySkill.trim());
  }
  if (Array.isArray(caseData?.secondarySkills)) {
    caseData.secondarySkills.forEach((skill) => {
      if (typeof skill === 'string' && skill.trim()) {
        skills.push(skill.trim());
      }
    });
  }
  return skills.slice(0, 3);
};

const resolveCaseLevelLabel = (caseData, codedMap) => {
  if (typeof caseData?.caseLevel === 'string' && caseData.caseLevel.trim()) {
    return formatCaseLevel(caseData.caseLevel);
  }
  const moduleId = caseData?.moduleId || caseData?.id;
  const coded = moduleId ? codedMap.get(moduleId) : null;
  if (coded?.caseLevel) {
    return formatCaseLevel(coded.caseLevel);
  }
  const tier = normalizeTier(caseData?.tier);
  if (tier === 'core') return 'Intermediate';
  if (tier === 'advanced') return 'Advanced';
  return 'Basics';
};

const isRecipeConfigured = (recipe) => {
  const instruction = recipe?.instruction || {};
  const gateOptions = Array.isArray(instruction?.gateCheck?.options)
    ? instruction.gateCheck.options
    : [];
  const hasGateQuestion = typeof instruction?.gateCheck?.question === 'string' && instruction.gateCheck.question.trim();
  const hasCorrectOption = gateOptions.some((opt) => opt && (opt.correct || opt.isCorrect));
  const hasVideo =
    typeof instruction?.visualAsset?.source_id === 'string'
      ? instruction.visualAsset.source_id.trim()
      : typeof instruction?.visualAsset?.url === 'string'
      ? instruction.visualAsset.url.trim()
      : '';
  return Boolean(hasGateQuestion && gateOptions.length > 0 && hasCorrectOption && hasVideo);
};

export default function TraineeDashboardPage() {
  const { navigate, query, setQuery } = useRoute();
  const { userId } = useAuth();
  const { billing, loadingBilling } = useUser();
  const { showModal } = useModal();
  const showModalRef = useRef(showModal);

  useEffect(() => {
    showModalRef.current = showModal;
  }, [showModal]);

  /** @type {[CaseModel[], React.Dispatch<React.SetStateAction<CaseModel[]>>]} */
  const [cases, setCases] = useState([]);
  /** @type {[Map<string, ProgressModel>, React.Dispatch<React.SetStateAction<Map<string, ProgressModel>>>]} */
  const [progress, setProgress] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState('');
  const [selectedModuleId, setSelectedModuleId] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [startingModuleId, setStartingModuleId] = useState('');
  const [deletingRetakeIds, setDeletingRetakeIds] = useState(() => new Set());
  const hasPaidAccess = isBillingPaid(billing);
  const showPaywall = !loadingBilling && !hasPaidAccess;
  const hasTrackedPaywallRef = useRef(false);
  const hasTrackedCaseListRef = useRef(false);
  const billingStatusLabel = useMemo(() => {
    if (loadingBilling) return 'Checking billing status…';
    const status = typeof billing?.status === 'string' ? billing.status.trim() : '';
    if (status) return `Billing status: ${status}`;
    return 'Billing status: not found';
  }, [billing, loadingBilling]);

  useEffect(() => {
    if (!showPaywall || hasTrackedPaywallRef.current) return;
    hasTrackedPaywallRef.current = true;
    trackAnalyticsEvent({
      eventType: ANALYTICS_EVENTS.PAYWALL_SHOWN,
      metadata: { source: 'dashboard', route: window.location.pathname },
    });
  }, [showPaywall]);

  const fetchCases = useCallback(async () => {
    if (!userId || loadingBilling) return;
    try {
      setLoading(true);
      setCases([]);
      setInitialLoad(true);

      if (process.env.NODE_ENV !== 'production') {
        console.info('[dashboard] fetch start', {
          uid: userId,
        });
      }

      let next = null;
      const collected = [];
      const seenCursors = new Set();
      let pageCount = 0;
      const maxPages = 50;

      while (pageCount < maxPages) {
        const listFn = showPaywall ? listStudentDemoCases : listStudentCases;
        const result = await listFn({
          appId,
          uid: userId,
          pageSize: PAGE_SIZE,
          cursor: next || undefined,
          sortBy: 'title',
          includeOpensAtGate: false,
        });

        if (!result || !Array.isArray(result.items)) {
          if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
            console.warn('[dashboard] unexpected listStudentCases payload', result);
          }
        }

        const items = Array.isArray(result?.items) ? result.items : [];
        collected.push(...items);

        if (!result?.nextCursor || items.length === 0) {
          next = null;
          break;
        }

        const cursorKey = JSON.stringify(result.nextCursor);
        if (seenCursors.has(cursorKey)) {
          next = null;
          break;
        }
        seenCursors.add(cursorKey);
        next = result.nextCursor;
        pageCount += 1;
      }

      if (process.env.NODE_ENV !== 'production') {
        if (pageCount >= maxPages) {
          console.warn('[dashboard] fetch reached page cap', { count: collected.length });
        } else {
          console.info('[dashboard] fetch success', { count: collected.length });
        }
      }

      setCases(collected);
      setError('');
      if (!hasTrackedCaseListRef.current) {
        hasTrackedCaseListRef.current = true;
        trackAnalyticsEvent({
          eventType: ANALYTICS_EVENTS.CASE_LIST_VIEWED,
          metadata: { source: 'dashboard', count: collected.length, route: window.location.pathname },
        });
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Error fetching cases for trainee:', err);
      }
      const message = err?.message || 'Unable to load cases.';
      setError(message);
      setCases([]);
      const modal = showModalRef.current;
      if (modal) modal(message, 'Error');
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [userId, loadingBilling, showPaywall]);

  useEffect(() => {
    if (!userId) {
      setInitialLoad(false);
      return;
    }
    fetchCases();
  }, [userId, fetchCases]);

  useEffect(() => {
    if (!userId || loadingBilling) return;
    let isActive = true;
    const loadRecipes = async () => {
      try {
        setRecipesLoading(true);
        const items = await listRecipes({ pageSize: 25 });
        if (!isActive) return;
        const active = items.filter((recipe) => recipe.isActive && isRecipeConfigured(recipe));
        setRecipes(active);
      } catch (err) {
        console.error('Error loading recipes:', err);
      } finally {
        if (isActive) setRecipesLoading(false);
      }
    };
    loadRecipes();
    return () => {
      isActive = false;
    };
  }, [userId, loadingBilling, showPaywall]);

  const caseIds = useMemo(() => cases.map((c) => c.id), [cases]);
  const poolCountByModuleId = useMemo(() => {
    const map = new Map();
    cases.forEach((caseData) => {
      const moduleId = caseData?.moduleId || caseData?.id;
      if (!moduleId) return;
      map.set(moduleId, (map.get(moduleId) || 0) + 1);
    });
    return map;
  }, [cases]);

  useEffect(() => {
    if (!userId || caseIds.length === 0) {
      setProgress(new Map());
      return;
    }

    const unsubscribe = subscribeProgressForCases(
      { appId, uid: userId, caseIds },
      (progressMap) => {
        setProgress(progressMap);
      },
      (err) => {
        console.error('Error subscribing to progress:', err);
      }
    );

    return () => unsubscribe();
  }, [userId, caseIds]);

  const recipeByModuleId = useMemo(() => {
    const map = new Map();
    recipes.forEach((recipe) => {
      const key = recipe?.moduleId || recipe?.id;
      if (!key) return;
      map.set(key, recipe);
    });
    return map;
  }, [recipes]);

  const codedRecipeById = useMemo(() => {
    const map = new Map();
    listCaseRecipes().forEach((recipe) => {
      if (!recipe?.id) return;
      map.set(recipe.id, recipe);
    });
    return map;
  }, []);

  const casesWithProgress = useMemo(() => {
    return cases.map((caseData) => {
      const recipeMeta = caseData?.moduleId ? recipeByModuleId.get(caseData.moduleId) : null;
      const fallbackPathId =
        caseData?.auditArea && String(caseData.auditArea).trim().toLowerCase() !== 'general'
          ? 'foundations'
          : '';
      const resolvedCase = recipeMeta
        ? {
            ...caseData,
            pathId:
              (typeof recipeMeta?.pathId === 'string' && recipeMeta.pathId.trim()) ||
              (typeof caseData?.pathId === 'string' && caseData.pathId.trim()) ||
              caseData?.pathId,
            pathTitle:
              (typeof recipeMeta?.pathTitle === 'string' && recipeMeta.pathTitle.trim()) ||
              (typeof caseData?.pathTitle === 'string' && caseData.pathTitle.trim()) ||
              caseData?.pathTitle ||
              '',
            pathDescription:
              (typeof recipeMeta?.pathDescription === 'string' && recipeMeta.pathDescription.trim()) ||
              (typeof caseData?.pathDescription === 'string' && caseData.pathDescription.trim()) ||
              caseData?.pathDescription ||
              '',
            tier:
              (typeof recipeMeta?.tier === 'string' && recipeMeta.tier.trim()) ||
              (typeof caseData?.tier === 'string' && caseData.tier.trim()) ||
              caseData?.tier,
            moduleTitle:
              (typeof recipeMeta?.moduleTitle === 'string' && recipeMeta.moduleTitle.trim()) ||
              (typeof recipeMeta?.title === 'string' && recipeMeta.title.trim()) ||
              (typeof caseData?.moduleTitle === 'string' && caseData.moduleTitle.trim()) ||
              caseData?.moduleTitle ||
              '',
            primarySkill:
              (typeof recipeMeta?.primarySkill === 'string' && recipeMeta.primarySkill.trim()) ||
              (typeof caseData?.primarySkill === 'string' && caseData.primarySkill.trim()) ||
              caseData?.primarySkill ||
              '',
            caseLevel:
              (typeof recipeMeta?.caseLevel === 'string' && recipeMeta.caseLevel.trim()) ||
              (typeof caseData?.caseLevel === 'string' && caseData.caseLevel.trim()) ||
              caseData?.caseLevel ||
              '',
            secondarySkills:
              Array.isArray(recipeMeta?.secondarySkills) && recipeMeta.secondarySkills.length > 0
                ? recipeMeta.secondarySkills
                : Array.isArray(caseData?.secondarySkills) && caseData.secondarySkills.length > 0
                ? caseData.secondarySkills
                : caseData?.secondarySkills || [],
          }
        : caseData;

      const normalizedCase = {
        ...resolvedCase,
        pathId:
          (typeof resolvedCase?.pathId === 'string' && resolvedCase.pathId.trim() && resolvedCase.pathId.trim() !== 'general')
            ? resolvedCase.pathId.trim()
            : fallbackPathId || resolvedCase?.pathId || DEFAULT_PATH_ID,
        pathTitle:
          (typeof resolvedCase?.pathTitle === 'string' && resolvedCase.pathTitle.trim())
            ? resolvedCase.pathTitle.trim()
            : fallbackPathId
            ? 'Foundations'
            : resolvedCase?.pathTitle || '',
        tier:
          (typeof resolvedCase?.tier === 'string' && resolvedCase.tier.trim())
            ? resolvedCase.tier.trim().toLowerCase()
            : DEFAULT_TIER,
      };

      return {
        ...normalizedCase,
        progress: progress.get(caseData.id) || toProgressModel(null, caseData.id),
      };
    });
  }, [cases, progress, recipeByModuleId]);

  const learnerProgress = useMemo(
    () =>
      buildLearnerProgressView({
        cases: casesWithProgress,
        recipes,
        selectedModuleId,
      }),
    [casesWithProgress, recipes, selectedModuleId]
  );

  const {
    retakeCases,
    heroCase,
    heroRecipe,
    currentAction,
    activeModuleId,
    moduleOptions,
    programPath,
    moduleJourney,
    availableModules,
  } = learnerProgress;

  const heroSkills = heroCase ? getModuleSkills(heroCase) : [];
  const heroSkillLabel = heroCase
    ? getSkillLabel(heroCase)
    : heroRecipe
    ? heroRecipe.primarySkill || heroRecipe.moduleTitle || heroRecipe.title || 'Skill'
    : currentAction?.type === 'emptyModule'
    ? 'No skill set up yet'
    : '';
  const heroDepthLabel = heroCase
    ? resolveCaseLevelLabel(heroCase, codedRecipeById)
    : heroRecipe
    ? resolveCaseLevelLabel(heroRecipe, codedRecipeById)
    : '';
  const heroActionLabel =
    currentAction?.type === 'resumeDraft'
      ? 'Continue'
      : currentAction?.type === 'assigned'
      ? 'Start assigned'
      : currentAction?.type === 'emptyModule'
      ? 'Select another module'
      : currentAction?.type === 'startModule'
      ? 'Start next'
      : 'Start next';
  const heroMetaLine = heroDepthLabel ? `Depth: ${heroDepthLabel}` : '';
  const heroModuleId = heroRecipe?.moduleId || heroRecipe?.id || '';
  const heroHasPool = heroModuleId ? (poolCountByModuleId.get(heroModuleId) || 0) > 0 : true;

  const currentFocusCase = heroCase;
  const selectedModuleLabel = selectedModuleId
    ? moduleJourney.find((module) => module.moduleId === selectedModuleId)?.label
    : '';
  const moduleLabelFromOptions =
    selectedModuleLabel ||
    moduleOptions.find((option) => option.value === selectedModuleId)?.label ||
    moduleOptions[0]?.label ||
    'General';
  const currentModuleLabel = currentFocusCase
    ? getModuleLabel(currentFocusCase) === 'General'
      ? moduleLabelFromOptions
      : getModuleLabel(currentFocusCase)
    : moduleLabelFromOptions;

  const shouldShowFocusSkills = heroSkills.length > 1 && Boolean(heroCase);
  const programTierStates = programPath?.tierStates || {};
  const getJourneyStepState = (stepKey) =>
    programTierStates[stepKey]?.completed ? 'completed' : 'upcoming';
  const availableModule = availableModules[0] || null;
  const contextLabel =
    currentAction?.type === 'resumeDraft'
      ? 'In progress'
      : currentAction?.type === 'assigned'
      ? 'Assigned'
      : 'Self-guided';
  const contextModuleLabel =
    currentModuleLabel !== 'General'
      ? currentModuleLabel
      : availableModule?.moduleTitle || availableModule?.title || currentModuleLabel;
  const contextText = `${contextModuleLabel} • ${contextLabel}`;
  const handleSelectModule = (moduleId) => {
    if (!moduleId) return;
    setSelectedModuleId(moduleId);
  };

  const availableLevelLabel = availableModule
    ? resolveCaseLevelLabel(availableModule, codedRecipeById)
    : '';
  const availableModuleKey = (availableModule?.auditArea || '').toLowerCase();
  const availableJourney = moduleJourney.find((module) => module.moduleId === availableModuleKey);
  const availableProgressLabel =
    availableJourney && availableJourney.totalSkills > 0
      ? `${availableJourney.completedSkills} of ${availableJourney.totalSkills} skills complete`
      : '';
  const availableMetaLine = [
    availableLevelLabel ? `Depth: ${availableLevelLabel}` : '',
    availableProgressLabel,
  ]
    .filter(Boolean)
    .join(' • ');
  const availableModuleId = availableModules[0]?.moduleId || availableModules[0]?.id || '';
  const availableHasPool = availableModuleId ? (poolCountByModuleId.get(availableModuleId) || 0) > 0 : true;

  const handleStartModule = useCallback(async (moduleId) => {
    if (!moduleId || !userId) return;
    if (startingModuleId) return;
    try {
      setStartingModuleId(moduleId);
      const caseId = await startCaseAttemptFromPool({ moduleId });
      trackAnalyticsEvent({
        eventType: ANALYTICS_EVENTS.CASE_STARTED,
        metadata: { source: 'dashboard', moduleId, caseId, route: window.location.pathname },
      });
      navigate(`/cases/${caseId}`);
    } catch (err) {
      console.error('Failed to start module:', err);
      const modal = showModalRef.current;
      if (modal) modal(err?.message || 'Unable to start module. Please try again.', 'Error');
    } finally {
      setStartingModuleId('');
    }
  }, [userId, startingModuleId, navigate]);

  useEffect(() => {
    const autostartRequested = query?.autostart === '1';
    if (!autostartRequested || !hasPaidAccess || startingModuleId) return;
    const targetModuleId = availableModules[0]?.moduleId || availableModules[0]?.id || '';
    if (!targetModuleId) return;
    handleStartModule(targetModuleId);
    if (typeof setQuery === 'function') {
      setQuery(
        (prev) => {
          const next = { ...prev };
          delete next.autostart;
          return next;
        },
        { replace: true }
      );
    }
  }, [query, hasPaidAccess, startingModuleId, availableModules, handleStartModule, setQuery]);

  const handleDeleteRetake = useCallback(
    (caseData) => {
      if (!caseData?.id || !userId) return;
      const modal = showModalRef.current;
      if (!modal) return;
      modal(
        <div className="space-y-3">
          <p className="text-gray-700">
            This will permanently remove the retake attempt and its generated documents.
          </p>
          <p className="text-sm text-gray-500">This can’t be undone.</p>
        </div>,
        'Delete retake attempt?',
        (close) => (
          <>
            <Button variant="secondary" onClick={close}>
              Keep retake
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                close();
                try {
                  setDeletingRetakeIds((prev) => {
                    const next = new Set(prev);
                    next.add(caseData.id);
                    return next;
                  });
                  await deleteRetakeAttempt({ caseId: caseData.id });
                  await fetchCases();
                } catch (err) {
                  const errorMessage = err?.message || 'Unable to delete the retake attempt.';
                  const fallbackModal = showModalRef.current;
                  if (fallbackModal) fallbackModal(errorMessage, 'Error');
                } finally {
                  setDeletingRetakeIds((prev) => {
                    const next = new Set(prev);
                    next.delete(caseData.id);
                    return next;
                  });
                }
              }}
            >
              Delete retake
            </Button>
          </>
        )
      );
    },
    [fetchCases, userId]
  );

  if (!userId && initialLoad) {
    return <div className="p-4 text-center">Authenticating user, please wait...</div>;
  }

  if (showPaywall) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="mx-auto w-full max-w-3xl px-6 py-16">
          <div className="bg-white rounded-xl shadow-md border border-gray-100 p-8 text-center space-y-4">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Demo access only</div>
            <h1 className="text-3xl font-semibold text-gray-900">Unlock the full simulator</h1>
            <p className="text-sm text-gray-600">
              Your account can run the demo SURL case. Upgrade to access all modules and save mastery.
            </p>
            <div className="text-xs text-gray-500">{billingStatusLabel}</div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={() => {
                  trackAnalyticsEvent({ eventType: 'upgrade_clicked', metadata: { source: 'dashboard_paywall' } });
                  navigate('/checkout?plan=individual');
                }}
              >
                Unlock full access
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  trackAnalyticsEvent({ eventType: 'demo_started', metadata: { source: 'dashboard_paywall' } });
                  navigate('/demo/surl');
                }}
              >
                Play the demo
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto w-full max-w-[1400px] px-6 py-8 space-y-6 sm:px-8 lg:px-10">
        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-4">
            {error}
          </div>
        ) : null}
        <div className="text-xs text-gray-500">{billingStatusLabel}</div>

        {initialLoad && loading ? (
          <div className="text-center py-16 bg-white rounded-lg shadow-sm">
            <Loader2 size={32} className="animate-spin text-gray-500 mx-auto mb-3" />
            <p className="text-gray-600">Loading your dashboard…</p>
          </div>
        ) : heroCase || currentAction?.type === 'startModule' || currentAction?.type === 'emptyModule' ? (
          <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold text-gray-900">
                  {heroSkillLabel || getModuleTitle(heroCase)}
                </h1>
                {currentAction?.type === 'emptyModule' ? (
                  <div className="text-sm text-gray-600">
                    No skills are set up in this module yet. Pick another module to continue.
                  </div>
                ) : currentAction?.type === 'startModule' && !heroHasPool ? (
                  <div className="text-sm text-gray-600">
                    No cases are available for this module yet. Ask an admin to seed the case pool.
                  </div>
                ) : heroMetaLine ? (
                  <div className="text-sm text-gray-600">{heroMetaLine}</div>
                ) : null}
              </div>
              <Button
                onClick={() => {
                  if (currentAction?.type === 'startModule' && heroRecipe) {
                    if (!heroHasPool) {
                      showModalRef.current?.(
                        'No cases are available for this module yet. Ask an admin to seed the case pool.',
                        'No cases available'
                      );
                      return;
                    }
                    const moduleId = heroRecipe.moduleId || heroRecipe.id;
                    if (moduleId) handleStartModule(moduleId);
                    return;
                  }
                  if (currentAction?.type === 'emptyModule') {
                    return;
                  }
                  if (heroCase?.id) navigate(`/cases/${heroCase.id}`);
                }}
                className="sm:w-auto w-full"
                isLoading={
                  currentAction?.type === 'startModule' &&
                  heroRecipe &&
                  startingModuleId === (heroRecipe.moduleId || heroRecipe.id)
                }
                disabled={
                  currentAction?.type === 'emptyModule' ||
                  (currentAction?.type === 'startModule' && !heroHasPool) ||
                  (
                    currentAction?.type === 'startModule' &&
                    heroRecipe &&
                    startingModuleId !== '' &&
                    startingModuleId !== (heroRecipe.moduleId || heroRecipe.id)
                  )
                }
              >
                {heroActionLabel}
              </Button>
            </div>
          </div>
        ) : availableModules.length > 0 ? (
          <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold text-gray-900">
                  {availableModules[0]?.primarySkill ||
                    availableModules[0]?.moduleTitle ||
                    availableModules[0]?.title ||
                    'Module'}
                </h1>
                {availableMetaLine ? (
                  <div className="text-sm text-gray-600">{availableMetaLine}</div>
                ) : null}
                {!availableHasPool ? (
                  <div className="text-sm text-gray-600">
                    No cases are available for this module yet. Ask an admin to seed the case pool.
                  </div>
                ) : null}
              </div>
              <Button
                onClick={() => {
                  if (!availableHasPool) {
                    showModalRef.current?.(
                      'No cases are available for this module yet. Ask an admin to seed the case pool.',
                      'No cases available'
                    );
                    return;
                  }
                  handleStartModule(availableModules[0]?.moduleId || availableModules[0]?.id);
                }}
                className="sm:w-auto w-full"
                isLoading={startingModuleId === (availableModules[0]?.moduleId || availableModules[0]?.id)}
                disabled={
                  !availableHasPool ||
                  (
                    startingModuleId !== '' &&
                    startingModuleId !== (availableModules[0]?.moduleId || availableModules[0]?.id)
                  )
                }
              >
                Next
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center space-y-3">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500">All clear</div>
            <h1 className="text-2xl font-semibold text-gray-900">No activities assigned yet.</h1>
            <p className="text-sm text-gray-600">
              {recipesLoading
                ? 'Loading modules…'
                : 'Browse modules below or contact your instructor for access.'}
            </p>
          </div>
        )}

        {heroCase || availableModules.length > 0 || moduleOptions.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-gray-500">
            <div className="text-gray-600">{contextText}</div>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => navigate('/trainee/submission-history')}
                className="hover:text-gray-700 transition-colors"
              >
                Completed cases
              </button>
            </div>
          </div>
        ) : null}

        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <div className="text-base font-semibold text-gray-800">Module journey</div>
            <div className="text-sm text-gray-600">
              Browse modules and track progress inside each area.
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {moduleJourney.map((module) => {
              const progressTone =
                module.totalSkills === 0
                  ? 'bg-slate-200'
                  : module.completedSkills >= module.totalSkills
                  ? 'bg-emerald-500'
                  : 'bg-slate-400';
              const moduleAccent = MODULE_ACCENTS[module.moduleId] || 'border-l-4 border-slate-200';
              const selectedKey =
                typeof selectedModuleId === 'string' ? selectedModuleId.trim().toLowerCase() : '';
              const isActiveModule = (selectedKey || activeModuleId) === module.moduleId;
              return (
                <button
                  key={module.moduleId}
                  type="button"
                  onClick={() => handleSelectModule(module.moduleId)}
                  className={`rounded-xl border bg-white p-4 pl-3 text-left space-y-3 transition-colors ${moduleAccent} ${
                    isActiveModule
                      ? 'border-emerald-300 bg-emerald-50/40'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  aria-pressed={isActiveModule}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-gray-900">{module.label}</div>
                      <div className="mt-2 text-xs text-gray-500">
                        {module.totalSkills > 0
                          ? `${module.completedSkills}/${module.totalSkills} skills complete`
                          : 'No skills available yet'}
                      </div>
                    </div>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full ${progressTone}`}
                      style={{ width: `${module.progressPercent}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500">
                    {module.nextSkillLabel ? `Next skill: ${module.nextSkillLabel}` : 'Explore skills'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-1">
          <div className="text-sm font-semibold text-gray-700 mb-2">Program path</div>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            {JOURNEY_STEPS.map((step, index) => {
              const state = getJourneyStepState(step.key);
              return (
                <div key={step.key} className="flex items-center">
                  <div className="flex items-center gap-2">
                    {state === 'completed' ? (
                      <CheckCircle2 size={20} className="text-emerald-600" />
                    ) : (
                      <span className="h-2.5 w-2.5 rounded-full bg-gray-300" aria-hidden="true" />
                    )}
                    <span
                      className={`text-sm font-semibold ${
                        state === 'completed' ? 'text-emerald-700' : 'text-gray-500'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {index < JOURNEY_STEPS.length - 1 ? (
                    <div className="mx-3 h-px w-12 bg-gray-200" aria-hidden="true" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {shouldShowFocusSkills ? (
          <div className="bg-white rounded-lg border border-gray-100 p-5 space-y-3">
            <div className="text-sm font-semibold text-gray-800">Skills in this module</div>
            <div className="space-y-2 text-sm text-gray-700">
              {heroSkills.map((skill) => (
                <div key={skill}>{skill}</div>
              ))}
            </div>
          </div>
        ) : null}

        {retakeCases.length > 0 ? (
          <div className="bg-white rounded-lg border border-gray-100 p-5 space-y-3">
            <div className="text-sm font-semibold text-gray-800">Practice attempts</div>
            <p className="text-sm text-gray-600">
              These are optional retakes. Your main path continues above.
            </p>
            <div className="space-y-3">
              {retakeCases.map((caseData) => {
                const retakeHasDraft = hasMeaningfulDraft(caseData.progress);
                const isDeleting = deletingRetakeIds.has(caseData.id);
                return (
                  <div
                    key={caseData.id}
                    className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {getModuleTitle(caseData)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {getPathLabel(getPathId(caseData), caseData?.pathTitle)} · {formatTier(caseData?.tier)}
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <Button
                        variant="secondary"
                        onClick={() => navigate(`/cases/${caseData.id}`)}
                        className="sm:w-auto w-full"
                        disabled={isDeleting}
                      >
                        {retakeHasDraft ? 'Resume retake' : 'Start retake'}
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => handleDeleteRetake(caseData)}
                        className="sm:w-auto w-full"
                        disabled={isDeleting}
                        isLoading={isDeleting}
                      >
                        {isDeleting ? 'Deleting...' : 'Delete retake'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

      </main>
    </div>
  );
}
