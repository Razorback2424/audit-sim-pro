import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, UserCircle2 } from 'lucide-react';
import { Button, useRoute, useModal, useAuth, appId } from '../AppCore';
import { listStudentCases } from '../services/caseService';
import { listRecipes } from '../services/recipeService';
import { subscribeProgressForCases, saveProgress } from '../services/progressService';
import { fetchRecipeProgress } from '../services/recipeProgressService';
import { generateAttemptFromRecipe } from '../services/attemptService';
import { nullSafeDate, getNow } from '../utils/dates';
import { toProgressModel } from '../models/progress';

/** @typedef {import('../models/case').CaseModel} CaseModel */
/** @typedef {import('../models/progress').ProgressModel} ProgressModel */

const PAGE_SIZE = 20;

const TIER_ORDER = Object.freeze(['foundations', 'core', 'advanced']);
const TIER_LABELS = Object.freeze({
  foundations: 'Basics',
  core: 'Core',
  advanced: 'Advanced',
});
const DEFAULT_PATH_ID = 'general';
const DEFAULT_TIER = 'foundations';

const humanizeToken = (value = '') =>
  value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const normalizeTier = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return TIER_ORDER.includes(normalized) ? normalized : DEFAULT_TIER;
};

const formatTier = (tier) => TIER_LABELS[normalizeTier(tier)] || TIER_LABELS[DEFAULT_TIER];

const getPathId = (caseData) =>
  (typeof caseData?.pathId === 'string' && caseData.pathId.trim()) ||
  (typeof caseData?.auditArea === 'string' && caseData.auditArea.trim()) ||
  DEFAULT_PATH_ID;

const getPathLabel = (pathId, pathTitle) => {
  if (typeof pathTitle === 'string' && pathTitle.trim()) return pathTitle.trim();
  return humanizeToken(pathId || DEFAULT_PATH_ID) || 'General';
};

const getModuleTitle = (caseData) =>
  caseData?.moduleTitle || caseData?.title || caseData?.caseName || 'Untitled module';

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

const getProgressUpdatedAtMs = (caseData) => {
  const progress = caseData?.progress;
  const activeAttemptUpdatedAt = nullSafeDate(progress?.activeAttempt?.updatedAt);
  const lastAttemptAt = nullSafeDate(progress?.lastAttemptAt);
  const updatedAt = nullSafeDate(progress?.updatedAt);
  const fallback = nullSafeDate(caseData?.updatedAt) || nullSafeDate(caseData?.createdAt);
  const date = activeAttemptUpdatedAt || lastAttemptAt || updatedAt || fallback;
  return date ? date.getTime() : 0;
};

const formatRelativeDate = (date, now) => {
  if (!date) return 'Unknown';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday - startOfDate) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatMinutes = (minutes) => {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${Math.round(value)} min`;
};

const hasMeaningfulDraft = (progress) => {
  if (!progress || typeof progress !== 'object') return false;
  if (progress.hasSuccessfulAttempt) return false;
  const activeAttempt = progress.activeAttempt;
  if (!activeAttempt || typeof activeAttempt !== 'object') return false;
  const draft = activeAttempt.draft;
  const hasDraftPayload =
    draft && typeof draft === 'object' && Object.keys(draft).length > 0;
  const hasStep = typeof activeAttempt.step === 'string' && activeAttempt.step.trim();
  const hasStartedAt = Boolean(activeAttempt.startedAt || activeAttempt.updatedAt);
  return hasDraftPayload || hasStep || hasStartedAt;
};

const isModuleCompleted = (progress) => {
  if (typeof progress?.hasSuccessfulAttempt === 'boolean') {
    return progress.hasSuccessfulAttempt;
  }
  const percentComplete = Number(progress?.percentComplete || 0);
  const state = typeof progress?.state === 'string' ? progress.state.toLowerCase() : '';
  return state === 'submitted' || percentComplete >= 100;
};

export default function TraineeDashboardPage() {
  const { navigate } = useRoute();
  const { userId } = useAuth();
  const { showModal, hideModal } = useModal();
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
  const [selectedPathId, setSelectedPathId] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipeProgress, setRecipeProgress] = useState(new Map());
  const [startingModuleId, setStartingModuleId] = useState('');

  const fetchCases = useCallback(async () => {
    if (!userId) return;
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
        const result = await listStudentCases({
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
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setInitialLoad(false);
      return;
    }
    fetchCases();
  }, [userId, fetchCases]);

  useEffect(() => {
    if (!userId) return;
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
  }, [userId]);

  useEffect(() => {
    if (!userId || recipes.length === 0) {
      setRecipeProgress(new Map());
      return;
    }
    let isActive = true;
    const loadRecipeProgress = async () => {
      try {
        const entries = await Promise.all(
          recipes.map((recipe) =>
            fetchRecipeProgress({ appId, uid: userId, recipeId: recipe.moduleId || recipe.id })
          )
        );
        if (!isActive) return;
        const map = new Map();
        entries.forEach((entry) => {
          if (entry?.recipeId) {
            map.set(entry.recipeId, entry);
          }
        });
        setRecipeProgress(map);
      } catch (err) {
        console.error('Error loading recipe progress:', err);
      }
    };
    loadRecipeProgress();
    return () => {
      isActive = false;
    };
  }, [recipes, userId]);

  const caseIds = useMemo(() => cases.map((c) => c.id), [cases]);

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

  const casesWithProgress = useMemo(() => {
    return cases.map((caseData) => ({
      ...caseData,
      progress: progress.get(caseData.id) || toProgressModel(null, caseData.id),
    }));
  }, [cases, progress]);

  const completionByPathTier = useMemo(() => {
    const summary = new Map();
    casesWithProgress.forEach((caseData) => {
      const pathId = getPathId(caseData);
      const tier = normalizeTier(caseData?.tier);
      const entry = summary.get(pathId) || {
        foundations: { done: 0, total: 0 },
        core: { done: 0, total: 0 },
        advanced: { done: 0, total: 0 },
      };
      entry[tier].total += 1;
      if (isModuleCompleted(caseData.progress)) {
        entry[tier].done += 1;
      }
      summary.set(pathId, entry);
    });
    return summary;
  }, [casesWithProgress]);

  const now = useMemo(() => getNow().date, []);

  const getTierStatsForPath = useCallback(
    (pathId) =>
      completionByPathTier.get(pathId) || {
        foundations: { done: 0, total: 0 },
        core: { done: 0, total: 0 },
        advanced: { done: 0, total: 0 },
      },
    [completionByPathTier]
  );

  const isTierComplete = useCallback((stats, tier) => {
    const entry = stats[tier];
    if (!entry) return false;
    if (entry.total === 0) return false;
    return entry.done >= entry.total;
  }, []);

  const isTierUnlocked = useCallback(
    (pathId, tier) => {
      if (tier === 'foundations') return true;
      const stats = getTierStatsForPath(pathId);
      if (tier === 'core') return isTierComplete(stats, 'foundations');
      if (tier === 'advanced') return isTierComplete(stats, 'core');
      return false;
    },
    [getTierStatsForPath, isTierComplete]
  );

  const getCurrentTierForPath = useCallback(
    (pathId) => {
      const stats = getTierStatsForPath(pathId);
      const unlocked = TIER_ORDER.filter((tier) => isTierUnlocked(pathId, tier));
      for (const tier of unlocked) {
        const entry = stats[tier];
        if (entry.total > 0 && entry.done < entry.total) {
          return tier;
        }
      }
      if (unlocked.includes('advanced')) return 'advanced';
      if (unlocked.includes('core')) return 'core';
      return 'foundations';
    },
    [getTierStatsForPath, isTierUnlocked]
  );

  const eligibleModules = useMemo(() => {
    return casesWithProgress.filter((caseData) => {
      if (isModuleCompleted(caseData.progress)) return false;
      const pathId = getPathId(caseData);
      const tier = normalizeTier(caseData?.tier);
      return isTierUnlocked(pathId, tier);
    });
  }, [casesWithProgress, isTierUnlocked]);

  const draftCase = useMemo(() => {
    const candidates = casesWithProgress.filter((caseData) => {
      if (!caseData?.progress) return false;
      if (isModuleCompleted(caseData.progress)) return false;
      return hasMeaningfulDraft(caseData.progress);
    });
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, current) => {
      if (!latest) return current;
      return getProgressUpdatedAtMs(current) > getProgressUpdatedAtMs(latest) ? current : latest;
    }, null);
  }, [casesWithProgress]);


  const pathOptions = useMemo(() => {
    const sourceModules =
      eligibleModules.length > 0
        ? eligibleModules
        : casesWithProgress.filter((caseData) => !isModuleCompleted(caseData.progress));
    const pathMap = new Map();

    sourceModules.forEach((caseData) => {
      const pathId = getPathId(caseData);
      const updatedAtMs = getProgressUpdatedAtMs(caseData);
      const entry = pathMap.get(pathId);
      if (!entry || updatedAtMs > entry.updatedAtMs) {
        pathMap.set(pathId, {
          pathId,
          title: caseData?.pathTitle || '',
          description: caseData?.pathDescription || '',
          updatedAtMs,
        });
      }
    });

    const ordered = Array.from(pathMap.values()).sort((a, b) => {
      if (b.updatedAtMs !== a.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
      return getPathLabel(a.pathId, a.title).localeCompare(getPathLabel(b.pathId, b.title));
    });

    return ordered.slice(0, 6).map((entry) => ({
      value: entry.pathId,
      label: getPathLabel(entry.pathId, entry.title),
      description: entry.description || 'Path modules in this sequence.',
    }));
  }, [casesWithProgress, eligibleModules]);

  useEffect(() => {
    if (!selectedPathId) return;
    const stillValid = pathOptions.some((option) => option.value === selectedPathId);
    if (!stillValid) setSelectedPathId(null);
  }, [pathOptions, selectedPathId]);

  const recommendedCase = useMemo(() => {
    const availablePaths = pathOptions;
    const fallbackPathId = availablePaths[0]?.value || DEFAULT_PATH_ID;
    const pathId = selectedPathId || fallbackPathId;
    const activeTier = getCurrentTierForPath(pathId);

    const sortedModules = eligibleModules
      .filter((caseData) => getPathId(caseData) === pathId && normalizeTier(caseData?.tier) === activeTier)
      .sort((a, b) => {
        const aIndex = Number(a?.orderIndex ?? Number.POSITIVE_INFINITY);
        const bIndex = Number(b?.orderIndex ?? Number.POSITIVE_INFINITY);
        if (aIndex !== bIndex) return aIndex - bIndex;
        return getModuleTitle(a).localeCompare(getModuleTitle(b));
      });

    return sortedModules[0] || null;
  }, [eligibleModules, getCurrentTierForPath, pathOptions, selectedPathId]);

  const heroCase = draftCase || recommendedCase;
  const heroMode = draftCase ? 'resume' : 'continue';
  const heroPathId = heroCase ? getPathId(heroCase) : DEFAULT_PATH_ID;
  const heroTier = normalizeTier(heroCase?.tier);
  const heroPathLabel = heroCase ? getPathLabel(heroPathId, heroCase?.pathTitle) : getPathLabel(heroPathId, '');
  const heroSkills = heroCase ? getModuleSkills(heroCase) : [];

  const currentFocusCase = heroCase;
  const currentPathId = currentFocusCase
    ? getPathId(currentFocusCase)
    : selectedPathId || pathOptions[0]?.value || DEFAULT_PATH_ID;
  const currentPathLabel = currentFocusCase
    ? getPathLabel(currentPathId, currentFocusCase?.pathTitle)
    : getPathLabel(currentPathId, '');
  const currentTier = currentFocusCase ? normalizeTier(currentFocusCase?.tier) : getCurrentTierForPath(currentPathId);
  const currentTierLabel = formatTier(currentTier);

  const currentPathStats = getTierStatsForPath(currentPathId);
  const currentTierStats = currentPathStats[currentTier] || { done: 0, total: 0 };

  const shouldShowFocusSkills = heroSkills.length > 0 && Boolean(heroCase);

  const getNextTierGateMessage = () => {
    if (!currentFocusCase) return '';
    const nextTier = currentTier === 'foundations' ? 'core' : currentTier === 'core' ? 'advanced' : null;
    if (!nextTier) return '';
    const nextTierLabel = formatTier(nextTier);
    const isLocked = !isTierUnlocked(currentPathId, nextTier);
    if (!isLocked) return '';
    return `${nextTierLabel} locked until ${formatTier(currentTier)} is complete.`;
  };

  const handleChooseDifferent = () => {
    const options = eligibleModules.filter((caseData) => caseData.id !== heroCase?.id);
    const modal = showModalRef.current;
    if (!modal) return;
    if (options.length === 0) {
      modal('No other activities are available right now.', 'Choose a different activity');
      return;
    }
    const orderedOptions = heroCase
      ? [
          ...options.filter(
            (caseData) =>
              getPathId(caseData) === heroPathId && normalizeTier(caseData?.tier) === heroTier
          ),
          ...options.filter(
            (caseData) =>
              getPathId(caseData) === heroPathId && normalizeTier(caseData?.tier) !== heroTier
          ),
          ...options.filter((caseData) => getPathId(caseData) !== heroPathId),
        ]
      : options;
    modal(
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <p className="text-sm text-gray-600">
          {heroMode === 'resume'
            ? 'Pick another activity to work on now. Your draft stays saved.'
            : 'Pick another activity to work on now.'}
        </p>
        <div className="space-y-3">
          {orderedOptions.map((caseData) => (
            <button
              key={caseData.id}
              type="button"
              onClick={() => {
                hideModal();
                navigate(`/cases/${caseData.id}`);
              }}
              className="w-full rounded-md border border-gray-200 p-3 text-left hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              <div className="text-sm font-semibold text-gray-900">{getModuleTitle(caseData)}</div>
              <div className="text-xs text-gray-500 mt-1">
                {getPathLabel(getPathId(caseData), caseData?.pathTitle)} · {formatTier(caseData?.tier)}
              </div>
            </button>
          ))}
        </div>
      </div>,
      'Choose a different activity'
    );
  };

  const handleDiscardDraft = () => {
    if (!draftCase || !userId) return;
    const modal = showModalRef.current;
    if (!modal) return;
    modal(
      <div className="space-y-3">
        <p className="text-gray-700">
          This will erase your current progress for this draft.
        </p>
        <p className="text-sm text-gray-500">This can’t be undone.</p>
      </div>,
      'Discard draft?',
      (close) => (
        <>
          <Button variant="secondary" onClick={close}>
            Keep draft
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              close();
              try {
                await saveProgress({
                  appId,
                  uid: userId,
                  caseId: draftCase.id,
                  patch: {
                    percentComplete: 0,
                    state: 'not_started',
                    step: 'selection',
                    draft: {},
                    activeAttempt: {},
                    hasSuccessfulAttempt: false,
                  },
                  forceOverwrite: true,
                });
              } catch (err) {
                const errorMessage = err?.message || 'Unable to discard the draft.';
                const fallbackModal = showModalRef.current;
                if (fallbackModal) fallbackModal(errorMessage, 'Error');
              }
            }}
          >
            Discard draft
          </Button>
        </>
      )
    );
  };

  const handleOpenFocusPicker = () => {
    const modal = showModalRef.current;
    if (!modal) return;
    if (pathOptions.length === 0) {
      modal('No paths are available yet.', 'Change Path');
      return;
    }
    modal(
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <p className="text-sm text-gray-600">Choose a path for your next stretch of work.</p>
        <div className="space-y-3">
          {pathOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setSelectedPathId(option.value);
                hideModal();
              }}
              className="w-full rounded-md border border-gray-200 p-3 text-left hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              <div className="text-sm font-semibold text-gray-900">{option.label}</div>
              {option.description ? (
                <div className="text-xs text-gray-500 mt-1">{option.description}</div>
              ) : null}
            </button>
          ))}
        </div>
      </div>,
      'Change Path'
    );
  };

  if (!userId && initialLoad) {
    return <div className="p-4 text-center">Authenticating user, please wait...</div>;
  }

  const lastEditedMs = heroCase ? getProgressUpdatedAtMs(heroCase) : 0;
  const lastEditedLabel = heroCase
    ? formatRelativeDate(lastEditedMs ? new Date(lastEditedMs) : null, now)
    : '';
  const estimatedTime = heroCase ? formatMinutes(heroCase?.estimatedMinutes) : '';
  const focusGateMessage = getNextTierGateMessage();

  const availableModules = recipes;

  const handleStartModule = async (moduleId) => {
    if (!moduleId || !userId) return;
    if (startingModuleId) return;
    try {
      setStartingModuleId(moduleId);
      const caseId = await generateAttemptFromRecipe({ moduleId, uid: userId });
      navigate(`/cases/${caseId}`);
    } catch (err) {
      console.error('Failed to start module:', err);
      const modal = showModalRef.current;
      if (modal) modal(err?.message || 'Unable to start module. Please try again.', 'Error');
    } finally {
      setStartingModuleId('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="text-sm font-semibold tracking-wide text-gray-700">Audit Simulator</div>
          <button
            type="button"
            className="rounded-full text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="Profile"
          >
            <UserCircle2 size={28} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-4">
            {error}
          </div>
        ) : null}

        {initialLoad && loading ? (
          <div className="text-center py-16 bg-white rounded-lg shadow-sm">
            <Loader2 size={32} className="animate-spin text-gray-500 mx-auto mb-3" />
            <p className="text-gray-600">Loading your dashboard…</p>
          </div>
        ) : heroCase ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-500">
                {heroMode === 'resume' ? 'In progress' : 'Next up'}
              </div>
              <h1 className="text-3xl font-semibold text-gray-900">
                {heroMode === 'resume' ? `${getModuleTitle(heroCase)} — Draft` : getModuleTitle(heroCase)}
              </h1>
              {heroMode === 'resume' ? (
                <div className="text-sm text-gray-600 space-y-1">
                  <div>Last edited: {lastEditedLabel}</div>
                  {estimatedTime ? <div>Estimated time: {estimatedTime}</div> : null}
                </div>
              ) : (
                <div className="text-sm text-gray-600">
                  Continues {heroPathLabel} in {formatTier(heroTier)}
                  {heroSkills.length > 0 ? ` · Focus: ${heroSkills[0]}` : ''}.
                </div>
              )}
            </div>
            <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:gap-6 gap-3">
              <Button
                onClick={() => navigate(`/cases/${heroCase.id}`)}
                className="sm:w-auto w-full"
              >
                {heroMode === 'resume' ? 'Resume' : 'Continue'}
              </Button>
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                <button
                  type="button"
                  onClick={handleChooseDifferent}
                  className="hover:text-gray-700 transition-colors"
                >
                  Choose a different activity
                </button>
                {heroMode === 'resume' ? (
                  <button
                    type="button"
                    onClick={handleDiscardDraft}
                    className="hover:text-gray-700 transition-colors"
                  >
                    Discard draft
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : availableModules.length > 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Available module</div>
              <h1 className="text-3xl font-semibold text-gray-900">
                {availableModules[0]?.moduleTitle || availableModules[0]?.title || 'Module'}
              </h1>
              <div className="text-sm text-gray-600">
                Start your first attempt to enter the cockpit.
              </div>
            </div>
            <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:gap-6 gap-3">
              <Button
                onClick={() => handleStartModule(availableModules[0]?.moduleId || availableModules[0]?.id)}
                className="sm:w-auto w-full"
                isLoading={startingModuleId === (availableModules[0]?.moduleId || availableModules[0]?.id)}
                disabled={startingModuleId !== '' && startingModuleId !== (availableModules[0]?.moduleId || availableModules[0]?.id)}
              >
                Start Module
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center space-y-3">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500">All clear</div>
            <h1 className="text-2xl font-semibold text-gray-900">No activities assigned yet.</h1>
            <p className="text-sm text-gray-600">
              {recipesLoading ? 'Loading modules…' : 'Check back soon or contact your instructor for access.'}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between text-sm text-gray-500">
          <div>
            Current Path: {currentPathLabel} → {currentTierLabel}
          </div>
          <button
            type="button"
            onClick={handleOpenFocusPicker}
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            Change Path
          </button>
        </div>

        {heroCase ? (
          <div className="bg-white rounded-lg border border-gray-100 p-5 space-y-3">
            <div className="text-sm font-semibold text-gray-800">Tier progress</div>
            {currentTierStats.total > 0 ? (
              <div className="text-sm text-gray-600">
                {currentPathLabel} · {currentTierLabel} — {currentTierStats.done}/{currentTierStats.total} modules
                complete
              </div>
            ) : null}
            {focusGateMessage ? <div className="text-sm text-gray-500">{focusGateMessage}</div> : null}
          </div>
        ) : null}

        {shouldShowFocusSkills ? (
          <div className="bg-white rounded-lg border border-gray-100 p-5 space-y-3">
            <div className="text-sm font-semibold text-gray-800">Focus skills for your next step</div>
            <div className="space-y-2 text-sm text-gray-700">
              {heroSkills.map((skill) => (
                <div key={skill}>{skill}</div>
              ))}
            </div>
          </div>
        ) : null}

        {availableModules.length > 0 ? (
          <div className="bg-white rounded-lg border border-gray-100 p-5 space-y-3">
            <div className="text-sm font-semibold text-gray-800">Modules</div>
            <div className="space-y-3">
              {availableModules.map((recipe) => {
                const moduleId = recipe.moduleId || recipe.id;
                const progress = recipeProgress.get(moduleId);
                const gatePassed = progress && progress.passedVersion >= (recipe.recipeVersion || 1);
                return (
                  <div
                    key={moduleId}
                    className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {recipe.moduleTitle || recipe.title || 'Module'}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {getPathLabel(recipe.pathId || DEFAULT_PATH_ID, '')} · {formatTier(recipe.tier)}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => handleStartModule(moduleId)}
                      isLoading={startingModuleId === moduleId}
                      disabled={startingModuleId !== '' && startingModuleId !== moduleId}
                      className="sm:w-auto w-full"
                    >
                      {gatePassed ? 'Generate new attempt' : 'Start Module'}
                    </Button>
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
